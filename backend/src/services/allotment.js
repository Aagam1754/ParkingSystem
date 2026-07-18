import { normalizePlate } from '../utils/plates.js';

export async function findRegisteredVehicle(conn, plateNormalized) {
  const [rows] = await conn.query(
    `SELECT v.*, c.name AS company_name, c.code AS company_code, c.color_hex AS company_color,
            u.id AS member_id, u.full_name AS member_name, u.email AS member_email, u.role AS member_role
     FROM vehicles v
     LEFT JOIN companies c ON c.id = v.company_id
     LEFT JOIN users u ON u.id = v.owner_user_id
     WHERE v.plate_normalized = ?
       AND v.status = 'ACTIVE'
       AND v.deleted_at IS NULL
     LIMIT 1`,
    [plateNormalized]
  );
  return rows[0] || null;
}

export async function findOpenSession(conn, plateNormalized) {
  const [rows] = await conn.query(
    `SELECT * FROM parking_sessions WHERE plate_normalized = ? AND is_open = 1 LIMIT 1`,
    [plateNormalized]
  );
  return rows[0] || null;
}

/**
 * First-come-first-serve: lowest free slot id in the matching pool.
 * Company members use company slots in preferred basement (then any basement).
 * Guests / unknown use GENERAL slots.
 */
export async function pickFreeSlotFCFS(conn, { vehicleType, companyId = null, preferredBaseId = null }) {
  if (companyId) {
    if (preferredBaseId) {
      const [preferred] = await conn.query(
        `SELECT s.*, b.name AS base_name, b.code AS base_code
         FROM slots s
         JOIN bases b ON b.id = s.base_id
         WHERE s.owner_type = 'COMPANY'
           AND s.company_id = ?
           AND s.vehicle_type = ?
           AND s.status = 'FREE'
           AND s.base_id = ?
           AND b.status = 'ACTIVE'
         ORDER BY s.id ASC
         LIMIT 1
         FOR UPDATE`,
        [companyId, vehicleType, preferredBaseId]
      );
      if (preferred[0]) return preferred[0];
    }

    const [companySlots] = await conn.query(
      `SELECT s.*, b.name AS base_name, b.code AS base_code
       FROM slots s
       JOIN bases b ON b.id = s.base_id
       WHERE s.owner_type = 'COMPANY'
         AND s.company_id = ?
         AND s.vehicle_type = ?
         AND s.status = 'FREE'
         AND b.status = 'ACTIVE'
       ORDER BY s.base_id ASC, s.id ASC
       LIMIT 1
       FOR UPDATE`,
      [companyId, vehicleType]
    );
    if (companySlots[0]) return companySlots[0];
  }

  if (preferredBaseId) {
    const [preferredGeneral] = await conn.query(
      `SELECT s.*, b.name AS base_name, b.code AS base_code
       FROM slots s
       JOIN bases b ON b.id = s.base_id
       WHERE s.owner_type = 'GENERAL'
         AND s.company_id IS NULL
         AND s.vehicle_type = ?
         AND s.status = 'FREE'
         AND s.base_id = ?
         AND b.status = 'ACTIVE'
       ORDER BY s.id ASC
       LIMIT 1
       FOR UPDATE`,
      [vehicleType, preferredBaseId]
    );
    if (preferredGeneral[0]) return preferredGeneral[0];
  }

  const [general] = await conn.query(
    `SELECT s.*, b.name AS base_name, b.code AS base_code
     FROM slots s
     JOIN bases b ON b.id = s.base_id
     WHERE s.owner_type = 'GENERAL'
       AND s.company_id IS NULL
       AND s.vehicle_type = ?
       AND s.status = 'FREE'
       AND b.status = 'ACTIVE'
     ORDER BY s.base_id ASC, s.id ASC
     LIMIT 1
     FOR UPDATE`,
    [vehicleType]
  );
  return general[0] || null;
}

async function ensureGuestVehicle(conn, { plateNormalized, plateRaw, vehicleType }) {
  let vehicle = await findRegisteredVehicle(conn, plateNormalized);
  if (vehicle) return { vehicle, created: false };

  const [userResult] = await conn.query(
    `INSERT INTO users (role, company_id, email, full_name, status)
     VALUES ('GUEST', NULL, ?, ?, 'ACTIVE')`,
    [`guest_${plateNormalized.toLowerCase()}@parking.local`, `Guest ${plateNormalized}`]
  );

  const [vehicleResult] = await conn.query(
    `INSERT INTO vehicles
      (company_id, owner_user_id, plate_raw, plate_normalized, vehicle_type, is_guest, status)
     VALUES (NULL, ?, ?, ?, ?, 1, 'ACTIVE')`,
    [userResult.insertId, plateRaw || plateNormalized, plateNormalized, vehicleType]
  );

  await conn.query(
    `INSERT INTO vehicle_authorizations
      (user_id, vehicle_id, auth_type, status, valid_from)
     VALUES (?, ?, 'GUEST', 'ACTIVE', NOW())`,
    [userResult.insertId, vehicleResult.insertId]
  );

  vehicle = await findRegisteredVehicle(conn, plateNormalized);
  return { vehicle, created: true };
}

/**
 * Webcam / gate entry:
 * 1) registered company vehicle → FCFS company slot in basement pools
 * 2) unknown plate → auto-register guest + vehicle → FCFS general slot
 */
export async function processEntryScan(conn, payload) {
  const plateNormalized = normalizePlate(payload.plate);
  if (!plateNormalized || plateNormalized.length < 4) {
    const err = new Error('Invalid number plate');
    err.status = 400;
    throw err;
  }

  const vehicleType = (payload.vehicleType || 'CAR').toUpperCase();
  if (!['CAR', 'BIKE'].includes(vehicleType)) {
    const err = new Error('vehicleType must be CAR or BIKE');
    err.status = 400;
    throw err;
  }

  const confidence = Number(payload.confidence ?? 0.92);
  const source = payload.source || 'WEBCAM';
  const preferredBaseId = payload.baseId ? Number(payload.baseId) : null;
  const idempotencyKey =
    payload.idempotencyKey ||
    `entry-${plateNormalized}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const [existingEvent] = await conn.query(
    `SELECT * FROM alpr_events WHERE idempotency_key = ? LIMIT 1`,
    [idempotencyKey]
  );
  if (existingEvent[0]) {
    const [sessions] = await conn.query(
      `SELECT * FROM parking_sessions WHERE entry_event_id = ? LIMIT 1`,
      [existingEvent[0].id]
    );
    return { duplicate: true, event: existingEvent[0], session: sessions[0] || null };
  }

  const open = await findOpenSession(conn, plateNormalized);
  if (open) {
    const err = new Error(`Vehicle ${plateNormalized} already checked in (session #${open.id})`);
    err.status = 409;
    throw err;
  }

  const [eventResult] = await conn.query(
    `INSERT INTO alpr_events
      (base_id, plate_raw, plate_normalized, vehicle_type_hint, confidence, lane_type, source,
       processing_status, idempotency_key, observed_at, image_path)
     VALUES (?, ?, ?, ?, ?, 'ENTRY', ?, 'RECEIVED', ?, NOW(), ?)`,
    [
      preferredBaseId,
      payload.plate,
      plateNormalized,
      vehicleType,
      confidence,
      source,
      idempotencyKey,
      payload.imagePath || null,
    ]
  );
  const eventId = eventResult.insertId;

  let vehicle = await findRegisteredVehicle(conn, plateNormalized);

  // Registered but not ACTIVE (e.g. IN_SERVICE) must not fall through to guest auto-register
  if (!vehicle) {
    const [nonActive] = await conn.query(
      `SELECT id, status, is_guest FROM vehicles
       WHERE plate_normalized = ? AND deleted_at IS NULL LIMIT 1`,
      [plateNormalized]
    );
    if (nonActive[0]?.status === 'IN_SERVICE') {
      const err = new Error(
        `Vehicle ${plateNormalized} is marked IN_SERVICE. Use your claimed temp plate at the gate, or mark this vehicle ACTIVE again in the member app.`
      );
      err.status = 409;
      throw err;
    }
    if (nonActive[0]?.status === 'BLOCKED') {
      const err = new Error(`Vehicle ${plateNormalized} is blocked and cannot enter`);
      err.status = 403;
      throw err;
    }
    if (nonActive[0] && nonActive[0].status !== 'ACTIVE') {
      const err = new Error(
        `Vehicle ${plateNormalized} is ${nonActive[0].status} and cannot check in`
      );
      err.status = 409;
      throw err;
    }
  }

  let guestCreated = false;
  let sessionType;
  let allotmentNote;
  let targetCompanyId = null;

  if (vehicle && vehicle.company_id && !vehicle.is_guest) {
    sessionType = 'COMPANY';
    targetCompanyId = vehicle.company_id;
    allotmentNote = `Registered ${vehicle.company_name} member → company pool (FCFS)`;
  } else {
    if (!vehicle) {
      const ensured = await ensureGuestVehicle(conn, {
        plateNormalized,
        plateRaw: payload.plate,
        vehicleType,
      });
      vehicle = ensured.vehicle;
      guestCreated = ensured.created;
    }
    sessionType = 'GUEST';
    allotmentNote = guestCreated
      ? 'New guest registered → Basement 1 general parking (FCFS)'
      : 'Guest / unregistered → Basement 1 general parking (FCFS)';
  }

  const resolvedType = vehicle?.vehicle_type || vehicleType;

  // Guests always prefer Basement 1 (GENERAL). Company cars skip B1.
  let effectivePreferredBaseId = preferredBaseId;
  if (sessionType === 'GUEST' || sessionType === 'GENERAL') {
    const [generalBase] = await conn.query(
      `SELECT id FROM bases WHERE base_kind = 'GENERAL' AND status = 'ACTIVE' ORDER BY level_no ASC LIMIT 1`
    );
    effectivePreferredBaseId = generalBase[0]?.id || preferredBaseId;
  } else if (preferredBaseId) {
    const [baseMeta] = await conn.query(`SELECT base_kind FROM bases WHERE id = ? LIMIT 1`, [
      preferredBaseId,
    ]);
    if (baseMeta[0]?.base_kind === 'GENERAL') {
      effectivePreferredBaseId = null; // company vehicle should not park in B1 pools
    }
  }

  let slot = await pickFreeSlotFCFS(conn, {
    vehicleType: resolvedType,
    companyId: targetCompanyId,
    preferredBaseId: effectivePreferredBaseId,
  });

  // Company pool full → overflow into Basement 1 general
  if (!slot && targetCompanyId) {
    const [generalBase] = await conn.query(
      `SELECT id FROM bases WHERE base_kind = 'GENERAL' AND status = 'ACTIVE' ORDER BY level_no ASC LIMIT 1`
    );
    slot = await pickFreeSlotFCFS(conn, {
      vehicleType: resolvedType,
      companyId: null,
      preferredBaseId: generalBase[0]?.id || null,
    });
    if (slot) {
      sessionType = 'GENERAL';
      allotmentNote = `Company pool full → overflow Basement 1 general (FCFS)`;
    }
  }

  if (!slot) {
    await conn.query(
      `INSERT INTO incidents (base_id, type, severity, status, message, payload_json)
       VALUES (?, 'LOT_FULL', 'HIGH', 'OPEN', ?, ?)`,
      [
        preferredBaseId,
        `No free ${resolvedType} slots available`,
        JSON.stringify({ plate: plateNormalized, vehicleType: resolvedType }),
      ]
    );

    const [denied] = await conn.query(
      `INSERT INTO parking_sessions
        (base_id, plate_normalized, vehicle_id, user_id, company_id, vehicle_type, session_type,
         status, entry_event_id, denial_reason, is_open, started_at, allotment_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'DENIED', ?, ?, NULL, NOW(), ?)`,
      [
        preferredBaseId || 1,
        plateNormalized,
        vehicle?.id || null,
        vehicle?.member_id || vehicle?.owner_user_id || null,
        vehicle?.company_id || null,
        resolvedType,
        sessionType,
        eventId,
        `No free ${resolvedType} slots`,
        allotmentNote,
      ]
    );
    await conn.query(`UPDATE alpr_events SET processing_status = 'PROCESSED' WHERE id = ?`, [eventId]);
    return {
      allotted: false,
      guestCreated,
      reason: `No free ${resolvedType} slots`,
      sessionId: denied.insertId,
      plateNormalized,
      vehicle,
    };
  }

  const [sessionResult] = await conn.query(
    `INSERT INTO parking_sessions
      (base_id, slot_id, plate_normalized, vehicle_id, user_id, company_id, vehicle_type, session_type,
       status, entry_event_id, is_open, started_at, allotted_at, allotment_note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ALLOTTED', ?, 1, NOW(), NOW(), ?)`,
    [
      slot.base_id,
      slot.id,
      plateNormalized,
      vehicle?.id || null,
      vehicle?.member_id || vehicle?.owner_user_id || null,
      vehicle?.company_id || null,
      resolvedType,
      sessionType,
      eventId,
      allotmentNote,
    ]
  );

  await conn.query(`UPDATE slots SET status = 'OCCUPIED' WHERE id = ?`, [slot.id]);
  await conn.query(
    `INSERT INTO slot_assignments
      (parking_session_id, slot_id, assigned_by, assignment_reason, is_active, assigned_at)
     VALUES (?, ?, 'ENGINE', ?, 1, NOW())`,
    [sessionResult.insertId, slot.id, allotmentNote]
  );
  await conn.query(`UPDATE alpr_events SET processing_status = 'PROCESSED', base_id = ? WHERE id = ?`, [
    slot.base_id,
    eventId,
  ]);

  if (guestCreated) {
    await conn.query(
      `INSERT INTO incidents (base_id, session_id, type, severity, status, message, payload_json)
       VALUES (?, ?, 'GUEST_REGISTERED', 'LOW', 'RESOLVED', ?, ?)`,
      [
        slot.base_id,
        sessionResult.insertId,
        `Guest registered for plate ${plateNormalized}`,
        JSON.stringify({ plate: plateNormalized, slot: slot.code }),
      ]
    );
  }

  const [sessionRows] = await conn.query(`SELECT * FROM parking_sessions WHERE id = ?`, [
    sessionResult.insertId,
  ]);

  let companyColor = null;
  let companyCode = null;
  if (slot.company_id) {
    const [co] = await conn.query(
      `SELECT name, code, color_hex FROM companies WHERE id = ? LIMIT 1`,
      [slot.company_id]
    );
    companyColor = co[0]?.color_hex || null;
    companyCode = co[0]?.code || null;
  } else {
    companyColor = '#8FA9A0';
    companyCode = 'GENERAL';
  }

  return {
    allotted: true,
    guestCreated,
    plateNormalized,
    sessionType,
    allotmentNote,
    vehicle: vehicle
      ? {
          id: vehicle.id,
          plate: vehicle.plate_raw,
          type: vehicle.vehicle_type,
          company: vehicle.company_name || null,
          companyCode: vehicle.company_code || companyCode,
          member: vehicle.member_name || vehicle.full_name || null,
          isGuest: Boolean(vehicle.is_guest),
        }
      : null,
    base: {
      id: slot.base_id,
      name: slot.base_name,
      code: slot.base_code,
    },
    slot: {
      id: slot.id,
      code: slot.code,
      vehicleType: slot.vehicle_type,
      ownerType: slot.owner_type,
      companyId: slot.company_id,
      companyColor,
      companyCode,
      row: slot.row_no,
      col: slot.col_no,
    },
    session: sessionRows[0],
  };
}

export async function processExitScan(conn, payload) {
  const plateNormalized = normalizePlate(payload.plate);
  const open = await findOpenSession(conn, plateNormalized);
  if (!open) {
    const err = new Error(`No active check-in for ${plateNormalized}`);
    err.status = 404;
    throw err;
  }

  const idempotencyKey =
    payload.idempotencyKey ||
    `exit-${plateNormalized}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const [eventResult] = await conn.query(
    `INSERT INTO alpr_events
      (base_id, plate_raw, plate_normalized, vehicle_type_hint, confidence, lane_type, source,
       processing_status, idempotency_key, observed_at)
     VALUES (?, ?, ?, ?, ?, 'EXIT', ?, 'PROCESSED', ?, NOW())`,
    [
      open.base_id,
      payload.plate,
      plateNormalized,
      open.vehicle_type,
      Number(payload.confidence ?? 0.93),
      payload.source || 'WEBCAM',
      idempotencyKey,
    ]
  );

  if (open.slot_id) {
    await conn.query(`UPDATE slots SET status = 'FREE' WHERE id = ?`, [open.slot_id]);
    await conn.query(
      `UPDATE slot_assignments
       SET is_active = NULL, released_at = NOW()
       WHERE parking_session_id = ? AND is_active = 1`,
      [open.id]
    );
  }

  await conn.query(
    `UPDATE parking_sessions
     SET status = 'CLOSED', is_open = NULL, exit_event_id = ?, exited_at = NOW(), closed_at = NOW()
     WHERE id = ?`,
    [eventResult.insertId, open.id]
  );

  const [sessions] = await conn.query(`SELECT * FROM parking_sessions WHERE id = ?`, [open.id]);
  return { closed: true, session: sessions[0] };
}

import { normalizePlate } from '../utils/plates.js';

export async function findRegisteredVehicle(conn, plateNormalized) {
  const [rows] = await conn.query(
    `SELECT v.*, c.name AS company_name, c.code AS company_code,
            u.id AS member_id, u.full_name AS member_name, u.email AS member_email,
            b.id AS company_base_id, b.name AS company_base_name, b.code AS company_base_code
     FROM vehicles v
     LEFT JOIN companies c ON c.id = v.company_id
     LEFT JOIN users u ON u.id = v.owner_user_id
     LEFT JOIN bases b ON b.company_id = v.company_id AND b.base_type = 'COMPANY' AND b.status = 'ACTIVE'
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

export async function pickFreeSlot(conn, baseId, vehicleType) {
  const [rows] = await conn.query(
    `SELECT * FROM slots
     WHERE base_id = ? AND vehicle_type = ? AND status = 'FREE'
     ORDER BY row_no ASC, col_no ASC, id ASC
     LIMIT 1
     FOR UPDATE`,
    [baseId, vehicleType]
  );
  return rows[0] || null;
}

export async function getGeneralBase(conn) {
  const [rows] = await conn.query(
    `SELECT * FROM bases WHERE base_type = 'GENERAL' AND status = 'ACTIVE' ORDER BY id ASC LIMIT 1`
  );
  return rows[0] || null;
}

/**
 * Core entry flow:
 * - registered company vehicle -> allot from that company's base
 * - unknown vehicle -> allot from general base
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
  const idempotencyKey =
    payload.idempotencyKey || `entry-${plateNormalized}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

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
    const err = new Error(`Vehicle ${plateNormalized} already has an active session (#${open.id})`);
    err.status = 409;
    throw err;
  }

  const [eventResult] = await conn.query(
    `INSERT INTO alpr_events
      (plate_raw, plate_normalized, vehicle_type_hint, confidence, lane_type, processing_status, idempotency_key, observed_at)
     VALUES (?, ?, ?, ?, 'ENTRY', 'RECEIVED', ?, NOW())`,
    [payload.plate, plateNormalized, vehicleType, confidence, idempotencyKey]
  );
  const eventId = eventResult.insertId;

  const vehicle = await findRegisteredVehicle(conn, plateNormalized);
  let base;
  let sessionType;
  let allotmentNote;

  if (vehicle && vehicle.company_base_id) {
    const [bases] = await conn.query(`SELECT * FROM bases WHERE id = ? LIMIT 1`, [vehicle.company_base_id]);
    base = bases[0];
    sessionType = 'COMPANY';
    allotmentNote = `Registered ${vehicle.company_name} vehicle → company base`;
  } else {
    base = await getGeneralBase(conn);
    sessionType = 'GENERAL';
    allotmentNote = vehicle
      ? 'Registered vehicle without company base → general parking'
      : 'Unregistered plate → general parking';
  }

  if (!base) {
    const err = new Error('No parking base available');
    err.status = 500;
    throw err;
  }

  const resolvedType = vehicle?.vehicle_type || vehicleType;
  const slot = await pickFreeSlot(conn, base.id, resolvedType);

  if (!slot) {
    await conn.query(
      `INSERT INTO incidents (base_id, type, severity, status, message, payload_json)
       VALUES (?, 'LOT_FULL', 'HIGH', 'OPEN', ?, ?)`,
      [
        base.id,
        `${base.name} has no free ${resolvedType} slots`,
        JSON.stringify({ plate: plateNormalized, vehicleType: resolvedType }),
      ]
    );

    const [denied] = await conn.query(
      `INSERT INTO parking_sessions
        (base_id, plate_normalized, vehicle_id, user_id, company_id, vehicle_type, session_type,
         status, entry_event_id, denial_reason, is_open, started_at, allotment_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'DENIED', ?, ?, NULL, NOW(), ?)`,
      [
        base.id,
        plateNormalized,
        vehicle?.id || null,
        vehicle?.member_id || null,
        vehicle?.company_id || null,
        resolvedType,
        sessionType,
        eventId,
        `No free ${resolvedType} slots in ${base.name}`,
        allotmentNote,
      ]
    );

    await conn.query(`UPDATE alpr_events SET processing_status = 'PROCESSED' WHERE id = ?`, [eventId]);

    return {
      allotted: false,
      reason: `No free ${resolvedType} slots in ${base.name}`,
      sessionId: denied.insertId,
      base,
      vehicle,
      plateNormalized,
    };
  }

  const [sessionResult] = await conn.query(
    `INSERT INTO parking_sessions
      (base_id, slot_id, plate_normalized, vehicle_id, user_id, company_id, vehicle_type, session_type,
       status, entry_event_id, is_open, started_at, allotted_at, allotment_note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ALLOTTED', ?, 1, NOW(), NOW(), ?)`,
    [
      base.id,
      slot.id,
      plateNormalized,
      vehicle?.id || null,
      vehicle?.member_id || null,
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
  await conn.query(`UPDATE alpr_events SET processing_status = 'PROCESSED' WHERE id = ?`, [eventId]);

  if (!vehicle) {
    await conn.query(
      `INSERT INTO incidents (base_id, session_id, type, severity, status, message, payload_json)
       VALUES (?, ?, 'UNRECOGNIZED_PLATE', 'LOW', 'OPEN', ?, ?)`,
      [
        base.id,
        sessionResult.insertId,
        `Unregistered plate ${plateNormalized} allotted in general parking`,
        JSON.stringify({ plate: plateNormalized, slot: slot.code }),
      ]
    );
  }

  const [sessionRows] = await conn.query(`SELECT * FROM parking_sessions WHERE id = ?`, [
    sessionResult.insertId,
  ]);

  return {
    allotted: true,
    plateNormalized,
    sessionType,
    allotmentNote,
    vehicle: vehicle
      ? {
          id: vehicle.id,
          plate: vehicle.plate_raw,
          type: vehicle.vehicle_type,
          company: vehicle.company_name,
          member: vehicle.member_name,
        }
      : null,
    base: {
      id: base.id,
      name: base.name,
      code: base.code,
      type: base.base_type,
    },
    slot: {
      id: slot.id,
      code: slot.code,
      vehicleType: slot.vehicle_type,
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
    const err = new Error(`No active session for ${plateNormalized}`);
    err.status = 404;
    throw err;
  }

  const idempotencyKey =
    payload.idempotencyKey || `exit-${plateNormalized}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const [eventResult] = await conn.query(
    `INSERT INTO alpr_events
      (plate_raw, plate_normalized, vehicle_type_hint, confidence, lane_type, processing_status, idempotency_key, observed_at)
     VALUES (?, ?, ?, ?, 'EXIT', 'PROCESSED', ?, NOW())`,
    [payload.plate, plateNormalized, open.vehicle_type, Number(payload.confidence ?? 0.93), idempotencyKey]
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

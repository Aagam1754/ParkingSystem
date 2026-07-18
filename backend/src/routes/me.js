import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { normalizePlate } from '../utils/plates.js';

const router = Router();

const memberRoles = requireRoles('CORPORATE_MEMBER', 'SUPER_ADMIN', 'LOT_ADMIN');

router.use(requireAuth, memberRoles);

router.get('/profile', async (req, res) => {
  try {
    const rows = await query(
      `SELECT u.id, u.email, u.full_name, u.role, u.company_id, u.employee_code, u.phone, u.status,
              c.name AS company_name, c.code AS company_code, c.color_hex AS company_color,
              c.floor_label AS company_floor, bld.name AS building_name, bld.code AS building_code
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       LEFT JOIN buildings bld ON bld.id = c.building_id
       WHERE u.id = ? AND u.deleted_at IS NULL
       LIMIT 1`,
      [req.user.id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      companyId: user.company_id,
      companyName: user.company_name,
      companyCode: user.company_code,
      companyColor: user.company_color,
      companyFloor: user.company_floor,
      buildingName: user.building_name,
      buildingCode: user.building_code,
      employeeCode: user.employee_code,
      phone: user.phone,
      status: user.status,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load profile' });
  }
});

router.get('/overview', async (req, res) => {
  try {
    const vehicleStats = await query(
      `SELECT
         COUNT(*) AS total,
         SUM(status = 'ACTIVE') AS active_count,
         SUM(status = 'IN_SERVICE') AS in_service_count
       FROM vehicles
       WHERE owner_user_id = ? AND deleted_at IS NULL`,
      [req.user.id]
    );
    const openSessions = await query(
      `SELECT COUNT(*) AS open_count
       FROM parking_sessions ps
       LEFT JOIN vehicles v ON v.id = ps.vehicle_id
       WHERE ps.is_open = 1
         AND (ps.user_id = ? OR v.owner_user_id = ?)`,
      [req.user.id, req.user.id]
    );
    const vehicles = vehicleStats[0] || {};
    return res.json({
      vehicles: {
        total: Number(vehicles.total || 0),
        active: Number(vehicles.active_count || 0),
        inService: Number(vehicles.in_service_count || 0),
      },
      openSessions: Number(openSessions[0]?.open_count || 0),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load overview' });
  }
});

router.get('/vehicles', async (req, res) => {
  try {
    const rows = await query(
      `SELECT v.*, c.name AS company_name, c.code AS company_code, c.color_hex AS company_color,
        COALESCE(
          (SELECT va.auth_type FROM vehicle_authorizations va
           WHERE va.vehicle_id = v.id AND va.user_id = ? AND va.status = 'ACTIVE'
           ORDER BY va.id DESC LIMIT 1),
          'OWNED'
        ) AS auth_type,
        (SELECT ps.id FROM parking_sessions ps WHERE ps.vehicle_id = v.id AND ps.is_open = 1 LIMIT 1) AS active_session_id,
        (SELECT ps.session_type FROM parking_sessions ps WHERE ps.vehicle_id = v.id AND ps.is_open = 1 LIMIT 1) AS active_session_type,
        (SELECT s.code FROM parking_sessions ps
           JOIN slots s ON s.id = ps.slot_id
         WHERE ps.vehicle_id = v.id AND ps.is_open = 1 LIMIT 1) AS active_slot_code,
        (SELECT b.code FROM parking_sessions ps
           JOIN bases b ON b.id = ps.base_id
         WHERE ps.vehicle_id = v.id AND ps.is_open = 1 LIMIT 1) AS active_base_code
       FROM vehicles v
       LEFT JOIN companies c ON c.id = v.company_id
       WHERE v.owner_user_id = ?
         AND v.deleted_at IS NULL
       ORDER BY
         CASE v.status WHEN 'IN_SERVICE' THEN 0 WHEN 'ACTIVE' THEN 1 ELSE 2 END,
         v.created_at DESC`,
      [req.user.id, req.user.id]
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load vehicles' });
  }
});

router.patch('/vehicles/:id/status', async (req, res) => {
  try {
    const vehicleId = Number(req.params.id);
    const status = String(req.body?.status || '').toUpperCase();
    if (!['ACTIVE', 'IN_SERVICE'].includes(status)) {
      return res.status(400).json({ error: 'Members may only set ACTIVE or IN_SERVICE' });
    }

    const owned = await query(
      `SELECT * FROM vehicles WHERE id = ? AND owner_user_id = ? AND deleted_at IS NULL LIMIT 1`,
      [vehicleId, req.user.id]
    );
    if (!owned[0]) return res.status(404).json({ error: 'Vehicle not found' });
    if (owned[0].status === 'BLOCKED') {
      return res.status(403).json({ error: 'Blocked vehicles cannot be changed by members' });
    }

    const open = await query(
      `SELECT id FROM parking_sessions WHERE vehicle_id = ? AND is_open = 1 LIMIT 1`,
      [vehicleId]
    );
    if (open[0] && status === 'IN_SERVICE') {
      return res.status(409).json({
        error: 'Check out this vehicle at the gate before marking it in service',
      });
    }

    await query(`UPDATE vehicles SET status = ? WHERE id = ?`, [status, vehicleId]);
    await query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details_json)
       VALUES (?, 'VEHICLE_STATUS', 'vehicle', ?, ?)`,
      [req.user.id, vehicleId, JSON.stringify({ status, previous: owned[0].status })]
    );

    const rows = await query(`SELECT * FROM vehicles WHERE id = ?`, [vehicleId]);
    return res.json(rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update vehicle status' });
  }
});

router.post('/vehicles/temp-claim', async (req, res) => {
  try {
    const { plate, vehicleType, make, model, color, replacesVehicleId } = req.body || {};
    const plateNormalized = normalizePlate(plate);
    const type = String(vehicleType || '').toUpperCase();

    if (!plateNormalized || !['CAR', 'BIKE'].includes(type)) {
      return res.status(400).json({ error: 'Valid plate and vehicleType (CAR|BIKE) required' });
    }

    const profile = await query(
      `SELECT id, company_id, full_name FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [req.user.id]
    );
    const member = profile[0];
    if (!member?.company_id) {
      return res.status(400).json({ error: 'Temp plate claim requires a company membership' });
    }

    let primaryId = replacesVehicleId ? Number(replacesVehicleId) : null;
    if (primaryId) {
      const primary = await query(
        `SELECT * FROM vehicles
         WHERE id = ? AND owner_user_id = ? AND deleted_at IS NULL LIMIT 1`,
        [primaryId, req.user.id]
      );
      if (!primary[0]) {
        return res.status(404).json({ error: 'Primary vehicle not found' });
      }
      if (primary[0].status !== 'IN_SERVICE') {
        return res.status(400).json({
          error: 'Mark the primary vehicle as IN_SERVICE before claiming a temp plate',
        });
      }
    } else {
      const inService = await query(
        `SELECT id FROM vehicles
         WHERE owner_user_id = ? AND status = 'IN_SERVICE' AND deleted_at IS NULL
         ORDER BY updated_at DESC LIMIT 1`,
        [req.user.id]
      );
      if (!inService[0]) {
        return res.status(400).json({
          error: 'Mark a vehicle as IN_SERVICE before claiming a temp plate',
        });
      }
      primaryId = inService[0].id;
    }

    const result = await query(
      `INSERT INTO vehicles
        (company_id, owner_user_id, plate_raw, plate_normalized, vehicle_type, make, model, color, is_guest, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'ACTIVE')`,
      [
        member.company_id,
        req.user.id,
        plate,
        plateNormalized,
        type,
        make || null,
        model || null,
        color || null,
      ]
    );

    await query(
      `INSERT INTO vehicle_authorizations
        (user_id, vehicle_id, auth_type, status, valid_from, created_by)
       VALUES (?, ?, 'TEMP_SERVICE', 'ACTIVE', NOW(), ?)`,
      [req.user.id, result.insertId, req.user.id]
    );

    await query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details_json)
       VALUES (?, 'TEMP_PLATE_CLAIM', 'vehicle', ?, ?)`,
      [
        req.user.id,
        result.insertId,
        JSON.stringify({
          plate: plateNormalized,
          replacesVehicleId: primaryId,
        }),
      ]
    );

    const rows = await query(`SELECT * FROM vehicles WHERE id = ?`, [result.insertId]);
    return res.status(201).json({
      ...rows[0],
      auth_type: 'TEMP_SERVICE',
      replacesVehicleId: primaryId,
      hint: 'Temp plate is ACTIVE for company-pool allotment. Present it at the gate; the in-service plate will be rejected until marked ACTIVE again.',
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Plate already registered' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Failed to claim temp plate' });
  }
});

/** Soft-retire a TEMP_SERVICE plate when the primary car is back */
router.post('/vehicles/:id/retire-temp', async (req, res) => {
  try {
    const vehicleId = Number(req.params.id);
    const rows = await query(
      `SELECT v.*,
         (SELECT va.auth_type FROM vehicle_authorizations va
          WHERE va.vehicle_id = v.id AND va.user_id = ? AND va.status = 'ACTIVE'
          ORDER BY va.id DESC LIMIT 1) AS auth_type
       FROM vehicles v
       WHERE v.id = ? AND v.owner_user_id = ? AND v.deleted_at IS NULL
       LIMIT 1`,
      [req.user.id, vehicleId, req.user.id]
    );
    const vehicle = rows[0];
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    if (vehicle.auth_type !== 'TEMP_SERVICE') {
      return res.status(400).json({ error: 'Only temporary service plates can be retired here' });
    }

    const open = await query(
      `SELECT id FROM parking_sessions WHERE vehicle_id = ? AND is_open = 1 LIMIT 1`,
      [vehicleId]
    );
    if (open[0]) {
      return res.status(409).json({ error: 'Check out this temp plate at the gate before retiring it' });
    }

    await query(`UPDATE vehicles SET status = 'BLOCKED', deleted_at = NOW() WHERE id = ?`, [vehicleId]);
    await query(
      `UPDATE vehicle_authorizations SET status = 'REVOKED' WHERE vehicle_id = ? AND user_id = ?`,
      [vehicleId, req.user.id]
    );
    await query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details_json)
       VALUES (?, 'TEMP_PLATE_RETIRE', 'vehicle', ?, ?)`,
      [req.user.id, vehicleId, JSON.stringify({ plate: vehicle.plate_normalized })]
    );

    return res.json({ ok: true, id: vehicleId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to retire temp plate' });
  }
});

router.get('/sessions/current', async (req, res) => {
  try {
    const rows = await query(
      `SELECT ps.*, b.name AS base_name, b.code AS base_code, b.level_no AS base_level,
              s.code AS slot_code, s.row_no, s.col_no, s.owner_type AS slot_owner_type,
              v.plate_raw, v.plate_normalized, v.vehicle_type AS vehicle_type_label,
              v.make, v.model, v.color AS vehicle_color,
              c.name AS company_name, c.code AS company_code, c.color_hex AS company_color
       FROM parking_sessions ps
       JOIN bases b ON b.id = ps.base_id
       LEFT JOIN slots s ON s.id = ps.slot_id
       LEFT JOIN vehicles v ON v.id = ps.vehicle_id
       LEFT JOIN companies c ON c.id = ps.company_id
       WHERE ps.is_open = 1
         AND (ps.user_id = ? OR v.owner_user_id = ?)
       ORDER BY ps.started_at DESC
       LIMIT 1`,
      [req.user.id, req.user.id]
    );
    return res.json(rows[0] || null);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load current session' });
  }
});

router.get('/sessions', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const status = String(req.query.status || '').toLowerCase();
    let where = `WHERE (ps.user_id = ? OR v.owner_user_id = ?)`;
    if (status === 'active' || status === 'open') {
      where += ` AND ps.is_open = 1`;
    } else if (status === 'closed') {
      where += ` AND (ps.is_open IS NULL OR ps.is_open = 0)`;
    }

    const rows = await query(
      `SELECT ps.*, b.name AS base_name, b.code AS base_code, s.code AS slot_code,
              v.plate_raw, v.plate_normalized, c.name AS company_name, c.code AS company_code
       FROM parking_sessions ps
       JOIN bases b ON b.id = ps.base_id
       LEFT JOIN slots s ON s.id = ps.slot_id
       LEFT JOIN vehicles v ON v.id = ps.vehicle_id
       LEFT JOIN companies c ON c.id = ps.company_id
       ${where}
       ORDER BY ps.created_at DESC
       LIMIT ${limit}`,
      [req.user.id, req.user.id]
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load session history' });
  }
});

export default router;

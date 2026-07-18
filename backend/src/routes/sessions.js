import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { processEntryScan, processExitScan } from '../services/allotment.js';
import { emitAssistantTips } from '../services/assistantTips.js';

const router = Router();

function emitOccupancy(io) {
  if (!io) return;
  io.emit('occupancy.updated', { at: new Date().toISOString() });
  emitAssistantTips(io);
}

router.get('/', requireAuth, async (req, res) => {
  const status = req.query.status;
  const limit = Math.min(Number(req.query.limit || 50), 200);
  let sql = `
    SELECT ps.*, b.name AS base_name, b.code AS base_code, s.code AS slot_code,
           v.plate_raw, u.full_name AS member_name, c.name AS company_name
    FROM parking_sessions ps
    JOIN bases b ON b.id = ps.base_id
    LEFT JOIN slots s ON s.id = ps.slot_id
    LEFT JOIN vehicles v ON v.id = ps.vehicle_id
    LEFT JOIN users u ON u.id = ps.user_id
    LEFT JOIN companies c ON c.id = ps.company_id
  `;
  const params = {};
  if (status === 'active') {
    sql += ` WHERE ps.is_open = 1`;
  } else if (status) {
    sql += ` WHERE ps.status = :status`;
    params.status = status;
  }
  sql += ` ORDER BY ps.created_at DESC LIMIT ${limit}`;
  const rows = await query(sql, params);
  res.json(rows);
});

router.post(
  '/entry-scan',
  requireAuth,
  requireRoles('SUPER_ADMIN', 'LOT_ADMIN', 'SECURITY_OPERATOR'),
  async (req, res) => {
    try {
      const result = await withTransaction((conn) => processEntryScan(conn, req.body || {}));
      emitOccupancy(req.app.get('io'));
      req.app.get('io')?.emit('session.updated', result);
      return res.status(result.allotted ? 201 : 409).json(result);
    } catch (err) {
      console.error(err);
      return res.status(err.status || 500).json({ error: err.message || 'Entry scan failed' });
    }
  }
);

router.post(
  '/exit-scan',
  requireAuth,
  requireRoles('SUPER_ADMIN', 'LOT_ADMIN', 'SECURITY_OPERATOR'),
  async (req, res) => {
    try {
      const result = await withTransaction((conn) => processExitScan(conn, req.body || {}));
      emitOccupancy(req.app.get('io'));
      req.app.get('io')?.emit('session.updated', result);
      return res.json(result);
    } catch (err) {
      console.error(err);
      return res.status(err.status || 500).json({ error: err.message || 'Exit scan failed' });
    }
  }
);

router.post(
  '/demo-random-entry',
  requireAuth,
  requireRoles('SUPER_ADMIN', 'LOT_ADMIN', 'SECURITY_OPERATOR'),
  async (req, res) => {
    try {
      const registered = await query(
        `SELECT plate_raw, vehicle_type FROM vehicles WHERE status = 'ACTIVE' AND deleted_at IS NULL`
      );
      const activePlates = new Set(
        (await query(`SELECT plate_normalized FROM parking_sessions WHERE is_open = 1`)).map(
          (r) => r.plate_normalized
        )
      );

      const availableRegistered = registered.filter(
        (v) => !activePlates.has(v.plate_raw.replace(/[^A-Z0-9]/gi, '').toUpperCase())
      );

      let plate;
      let vehicleType;

      const forceGeneral = Boolean(req.body?.forceGeneral);
      if (!forceGeneral && availableRegistered.length && Math.random() > 0.35) {
        const pick = availableRegistered[Math.floor(Math.random() * availableRegistered.length)];
        plate = pick.plate_raw;
        vehicleType = pick.vehicle_type;
      } else {
        vehicleType = Math.random() > 0.4 ? 'CAR' : 'BIKE';
        const prefix = ['MH', 'GJ', 'DL', 'KA', 'TN'][Math.floor(Math.random() * 5)];
        plate = `${prefix}${Math.floor(10 + Math.random() * 89)}${String.fromCharCode(
          65 + Math.floor(Math.random() * 26)
        )}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${Math.floor(
          1000 + Math.random() * 9000
        )}`;
      }

      const result = await withTransaction((conn) =>
        processEntryScan(conn, {
          plate,
          vehicleType,
          confidence: 0.88 + Math.random() * 0.1,
        })
      );
      emitOccupancy(req.app.get('io'));
      req.app.get('io')?.emit('session.updated', result);
      return res.status(result.allotted ? 201 : 409).json(result);
    } catch (err) {
      console.error(err);
      return res.status(err.status || 500).json({ error: err.message || 'Random entry failed' });
    }
  }
);

export default router;

import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { normalizePlate } from '../utils/plates.js';

const router = Router();

router.get('/', requireAuth, async (_req, res) => {
  const rows = await query(
    `SELECT v.*, c.name AS company_name, u.full_name AS owner_name,
      (SELECT ps.id FROM parking_sessions ps WHERE ps.vehicle_id = v.id AND ps.is_open = 1 LIMIT 1) AS active_session_id
     FROM vehicles v
     LEFT JOIN companies c ON c.id = v.company_id
     LEFT JOIN users u ON u.id = v.owner_user_id
     WHERE v.deleted_at IS NULL
     ORDER BY v.created_at DESC`
  );
  res.json(rows);
});

router.post(
  '/',
  requireAuth,
  requireRoles('SUPER_ADMIN', 'LOT_ADMIN'),
  async (req, res) => {
    try {
      const { plate, vehicleType, companyId, ownerUserId, make, model, color } = req.body || {};
      const plateNormalized = normalizePlate(plate);
      if (!plateNormalized || !['CAR', 'BIKE'].includes(String(vehicleType || '').toUpperCase())) {
        return res.status(400).json({ error: 'Valid plate and vehicleType (CAR|BIKE) required' });
      }

      const result = await query(
        `INSERT INTO vehicles
          (company_id, owner_user_id, plate_raw, plate_normalized, vehicle_type, make, model, color, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
        [
          companyId || null,
          ownerUserId || null,
          plate,
          plateNormalized,
          String(vehicleType).toUpperCase(),
          make || null,
          model || null,
          color || null,
        ]
      );

      if (ownerUserId) {
        await query(
          `INSERT INTO vehicle_authorizations
            (user_id, vehicle_id, auth_type, status, valid_from, created_by)
           VALUES (?, ?, 'OWNED', 'ACTIVE', NOW(), ?)`,
          [ownerUserId, result.insertId, req.user.id]
        );
      }

      await query(
        `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details_json)
         VALUES (?, 'VEHICLE_CREATE', 'vehicle', ?, ?)`,
        [req.user.id, result.insertId, JSON.stringify({ plate: plateNormalized })]
      );

      const rows = await query(`SELECT * FROM vehicles WHERE id = ?`, [result.insertId]);
      return res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'Plate already registered' });
      }
      console.error(err);
      return res.status(500).json({ error: 'Failed to create vehicle' });
    }
  }
);

router.patch(
  '/:id/status',
  requireAuth,
  requireRoles('SUPER_ADMIN', 'LOT_ADMIN', 'SECURITY_OPERATOR'),
  async (req, res) => {
    const status = String(req.body?.status || '').toUpperCase();
    if (!['ACTIVE', 'IN_SERVICE', 'BLOCKED', 'PENDING_VERIFICATION'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    await query(`UPDATE vehicles SET status = ? WHERE id = ?`, [status, Number(req.params.id)]);
    const rows = await query(`SELECT * FROM vehicles WHERE id = ?`, [Number(req.params.id)]);
    if (!rows[0]) return res.status(404).json({ error: 'Vehicle not found' });
    res.json(rows[0]);
  }
);

export default router;

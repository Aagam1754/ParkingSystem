import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, async (_req, res) => {
  const bases = await query(
    `SELECT b.*, c.name AS company_name, c.code AS company_code,
      (SELECT COUNT(*) FROM slots s WHERE s.base_id = b.id AND s.vehicle_type = 'CAR') AS car_total,
      (SELECT COUNT(*) FROM slots s WHERE s.base_id = b.id AND s.vehicle_type = 'CAR' AND s.status = 'FREE') AS car_free,
      (SELECT COUNT(*) FROM slots s WHERE s.base_id = b.id AND s.vehicle_type = 'BIKE') AS bike_total,
      (SELECT COUNT(*) FROM slots s WHERE s.base_id = b.id AND s.vehicle_type = 'BIKE' AND s.status = 'FREE') AS bike_free,
      (SELECT COUNT(*) FROM slots s WHERE s.base_id = b.id AND s.status = 'OCCUPIED') AS occupied_total
     FROM bases b
     LEFT JOIN companies c ON c.id = b.company_id
     WHERE b.status = 'ACTIVE'
     ORDER BY b.id ASC`
  );
  res.json(bases);
});

router.get('/:id/occupancy', requireAuth, async (req, res) => {
  const baseId = Number(req.params.id);
  const bases = await query(
    `SELECT b.*, c.name AS company_name
     FROM bases b
     LEFT JOIN companies c ON c.id = b.company_id
     WHERE b.id = ? LIMIT 1`,
    [baseId]
  );
  const base = bases[0];
  if (!base) return res.status(404).json({ error: 'Base not found' });

  const slots = await query(
    `SELECT s.*,
       ps.id AS session_id,
       ps.plate_normalized,
       ps.session_type,
       ps.started_at,
       ps.allotted_at,
       u.full_name AS member_name,
       co.name AS company_name
     FROM slots s
     LEFT JOIN parking_sessions ps ON ps.slot_id = s.id AND ps.is_open = 1
     LEFT JOIN users u ON u.id = ps.user_id
     LEFT JOIN companies co ON co.id = ps.company_id
     WHERE s.base_id = ?
     ORDER BY s.vehicle_type ASC, s.row_no ASC, s.col_no ASC, s.id ASC`,
    [baseId]
  );

  const summary = {
    car: {
      total: slots.filter((s) => s.vehicle_type === 'CAR').length,
      free: slots.filter((s) => s.vehicle_type === 'CAR' && s.status === 'FREE').length,
      occupied: slots.filter((s) => s.vehicle_type === 'CAR' && s.status === 'OCCUPIED').length,
    },
    bike: {
      total: slots.filter((s) => s.vehicle_type === 'BIKE').length,
      free: slots.filter((s) => s.vehicle_type === 'BIKE' && s.status === 'FREE').length,
      occupied: slots.filter((s) => s.vehicle_type === 'BIKE' && s.status === 'OCCUPIED').length,
    },
  };

  res.json({ base, summary, slots });
});

export default router;

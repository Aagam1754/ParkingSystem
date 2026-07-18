import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/overview', requireAuth, async (_req, res) => {
  const [totals] = await query(
    `SELECT
      (SELECT COUNT(*) FROM bases WHERE status = 'ACTIVE') AS bases,
      (SELECT COUNT(*) FROM slots) AS slots,
      (SELECT COUNT(*) FROM slots WHERE status = 'FREE') AS free_slots,
      (SELECT COUNT(*) FROM slots WHERE status = 'OCCUPIED') AS occupied_slots,
      (SELECT COUNT(*) FROM vehicles WHERE deleted_at IS NULL) AS vehicles,
      (SELECT COUNT(*) FROM parking_sessions WHERE is_open = 1) AS active_sessions,
      (SELECT COUNT(*) FROM parking_sessions WHERE DATE(started_at) = CURDATE()) AS entries_today,
      (SELECT COUNT(*) FROM incidents WHERE status = 'OPEN') AS open_incidents`
  );

  const byBase = await query(
    `SELECT b.id, b.name, b.code, b.base_type,
      SUM(s.vehicle_type = 'CAR') AS car_total,
      SUM(s.vehicle_type = 'CAR' AND s.status = 'FREE') AS car_free,
      SUM(s.vehicle_type = 'BIKE') AS bike_total,
      SUM(s.vehicle_type = 'BIKE' AND s.status = 'FREE') AS bike_free,
      SUM(s.status = 'OCCUPIED') AS occupied
     FROM bases b
     JOIN slots s ON s.base_id = b.id
     WHERE b.status = 'ACTIVE'
     GROUP BY b.id
     ORDER BY b.id`
  );

  const recent = await query(
    `SELECT ps.id, ps.plate_normalized, ps.session_type, ps.vehicle_type, ps.status,
            ps.started_at, b.name AS base_name, s.code AS slot_code
     FROM parking_sessions ps
     JOIN bases b ON b.id = ps.base_id
     LEFT JOIN slots s ON s.id = ps.slot_id
     ORDER BY ps.created_at DESC
     LIMIT 12`
  );

  const incidents = await query(
    `SELECT * FROM incidents ORDER BY created_at DESC LIMIT 8`
  );

  res.json({ totals, byBase, recent, incidents });
});

router.get('/companies', requireAuth, async (_req, res) => {
  const rows = await query(
    `SELECT c.*,
      (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id) AS member_count,
      (SELECT COUNT(*) FROM vehicles v WHERE v.company_id = c.id AND v.deleted_at IS NULL) AS vehicle_count,
      (SELECT b.id FROM bases b WHERE b.company_id = c.id AND b.base_type = 'COMPANY' LIMIT 1) AS base_id
     FROM companies c
     ORDER BY c.id`
  );
  res.json(rows);
});

router.get('/members', requireAuth, async (_req, res) => {
  const rows = await query(
    `SELECT u.id, u.full_name, u.email, u.role, u.employee_code, u.status, c.name AS company_name
     FROM users u
     LEFT JOIN companies c ON c.id = u.company_id
     WHERE u.role IN ('CORPORATE_MEMBER','GUEST')
     ORDER BY u.id`
  );
  res.json(rows);
});

router.get('/incidents', requireAuth, async (_req, res) => {
  const rows = await query(
    `SELECT i.*, b.name AS base_name
     FROM incidents i
     LEFT JOIN bases b ON b.id = i.base_id
     ORDER BY i.created_at DESC
     LIMIT 100`
  );
  res.json(rows);
});

export default router;

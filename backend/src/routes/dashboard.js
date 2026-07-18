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
      (SELECT COUNT(*) FROM vehicles WHERE is_guest = 1 AND deleted_at IS NULL) AS guest_vehicles,
      (SELECT COUNT(*) FROM parking_sessions WHERE is_open = 1) AS active_sessions,
      (SELECT COUNT(*) FROM parking_sessions WHERE DATE(started_at) = CURDATE()) AS entries_today,
      (SELECT COUNT(*) FROM incidents WHERE status = 'OPEN') AS open_incidents`
  );

  const byBase = await query(
    `SELECT b.id, b.name, b.code, b.level_no,
      SUM(s.vehicle_type = 'CAR') AS car_total,
      SUM(s.vehicle_type = 'CAR' AND s.status = 'FREE') AS car_free,
      SUM(s.vehicle_type = 'BIKE') AS bike_total,
      SUM(s.vehicle_type = 'BIKE' AND s.status = 'FREE') AS bike_free,
      SUM(s.status = 'OCCUPIED') AS occupied,
      SUM(s.owner_type = 'GENERAL') AS general_slots,
      SUM(s.owner_type = 'COMPANY') AS company_slots
     FROM bases b
     JOIN slots s ON s.base_id = b.id
     WHERE b.status = 'ACTIVE'
     GROUP BY b.id
     ORDER BY b.level_no, b.id`
  );

  const companyPools = await query(
    `SELECT c.id, c.name, c.code,
      SUM(s.status = 'FREE') AS free_slots,
      SUM(s.status = 'OCCUPIED') AS occupied_slots,
      COUNT(s.id) AS total_slots
     FROM companies c
     LEFT JOIN slots s ON s.company_id = c.id AND s.owner_type = 'COMPANY'
     GROUP BY c.id
     ORDER BY c.id`
  );

  const recent = await query(
    `SELECT ps.id, ps.plate_normalized, ps.session_type, ps.vehicle_type, ps.status,
            ps.started_at, ps.allotment_note, b.name AS base_name, s.code AS slot_code,
            c.name AS company_name
     FROM parking_sessions ps
     JOIN bases b ON b.id = ps.base_id
     LEFT JOIN slots s ON s.id = ps.slot_id
     LEFT JOIN companies c ON c.id = ps.company_id
     ORDER BY ps.created_at DESC
     LIMIT 12`
  );

  const incidents = await query(`SELECT * FROM incidents ORDER BY created_at DESC LIMIT 8`);

  res.json({ totals, byBase, companyPools, recent, incidents });
});

router.get('/companies', requireAuth, async (_req, res) => {
  const rows = await query(
    `SELECT c.*,
      b.name AS building_name,
      (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id) AS member_count,
      (SELECT COUNT(*) FROM vehicles v WHERE v.company_id = c.id AND v.deleted_at IS NULL) AS vehicle_count,
      (SELECT COUNT(*) FROM slots s WHERE s.company_id = c.id) AS slot_count
     FROM companies c
     LEFT JOIN buildings b ON b.id = c.building_id
     ORDER BY c.id`
  );
  res.json(rows);
});

router.get('/building', requireAuth, async (_req, res) => {
  const rows = await query(`SELECT * FROM buildings WHERE status = 'ACTIVE' ORDER BY id LIMIT 1`);
  res.json(rows[0] || null);
});

router.get('/members', requireAuth, async (_req, res) => {
  const rows = await query(
    `SELECT u.id, u.full_name, u.email, u.role, u.employee_code, u.status, c.name AS company_name
     FROM users u
     LEFT JOIN companies c ON c.id = u.company_id
     WHERE u.role IN ('CORPORATE_MEMBER','GUEST')
     ORDER BY u.role ASC, u.id`
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

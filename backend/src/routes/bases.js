import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, async (_req, res) => {
  const bases = await query(
    `SELECT b.*,
      (SELECT COUNT(*) FROM slots s WHERE s.base_id = b.id) AS slot_total,
      (SELECT COUNT(*) FROM slots s WHERE s.base_id = b.id AND s.status = 'FREE') AS free_total,
      (SELECT COUNT(*) FROM slots s WHERE s.base_id = b.id AND s.status = 'OCCUPIED') AS occupied_total
     FROM bases b
     WHERE b.status = 'ACTIVE'
     ORDER BY b.level_no ASC, b.id ASC`
  );

  const pools = await query(
    `SELECT s.base_id, s.owner_type, s.company_id, c.name AS company_name, c.code AS company_code,
            s.vehicle_type,
            COUNT(*) AS total,
            SUM(s.status = 'FREE') AS free_count,
            SUM(s.status = 'OCCUPIED') AS occupied_count
     FROM slots s
     LEFT JOIN companies c ON c.id = s.company_id
     GROUP BY s.base_id, s.owner_type, s.company_id, c.name, c.code, s.vehicle_type
     ORDER BY s.base_id, s.owner_type, s.company_id, s.vehicle_type`
  );

  const byBase = Object.fromEntries(bases.map((b) => [b.id, { ...b, pools: [] }]));
  for (const p of pools) {
    if (byBase[p.base_id]) byBase[p.base_id].pools.push(p);
  }

  res.json(Object.values(byBase));
});

router.get('/:id/occupancy', requireAuth, async (req, res) => {
  const baseId = Number(req.params.id);
  const bases = await query(`SELECT * FROM bases WHERE id = ? LIMIT 1`, [baseId]);
  const base = bases[0];
  if (!base) return res.status(404).json({ error: 'Basement not found' });

  const slots = await query(
    `SELECT s.*,
       c.name AS company_name, c.code AS company_code,
       ps.id AS session_id,
       ps.plate_normalized,
       ps.session_type,
       ps.started_at,
       ps.allotted_at,
       u.full_name AS member_name
     FROM slots s
     LEFT JOIN companies c ON c.id = s.company_id
     LEFT JOIN parking_sessions ps ON ps.slot_id = s.id AND ps.is_open = 1
     LEFT JOIN users u ON u.id = ps.user_id
     WHERE s.base_id = ?
     ORDER BY
       CASE s.owner_type WHEN 'GENERAL' THEN 0 ELSE 1 END,
       s.company_id IS NULL DESC,
       s.company_id ASC,
       s.vehicle_type ASC,
       s.row_no ASC,
       s.col_no ASC,
       s.id ASC`,
    [baseId]
  );

  const groups = [];
  const map = new Map();
  for (const slot of slots) {
    const key = `${slot.owner_type}:${slot.company_id || 0}`;
    if (!map.has(key)) {
      const group = {
        key,
        ownerType: slot.owner_type,
        companyId: slot.company_id,
        companyName: slot.company_name || 'General Parking',
        companyCode: slot.company_code || 'GENERAL',
        cars: [],
        bikes: [],
      };
      map.set(key, group);
      groups.push(group);
    }
    const g = map.get(key);
    if (slot.vehicle_type === 'CAR') g.cars.push(slot);
    else g.bikes.push(slot);
  }

  res.json({
    base,
    groups,
    summary: {
      total: slots.length,
      free: slots.filter((s) => s.status === 'FREE').length,
      occupied: slots.filter((s) => s.status === 'OCCUPIED').length,
    },
  });
});

export default router;

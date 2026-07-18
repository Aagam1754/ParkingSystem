import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { pool, query } from './pool.js';
import { normalizePlate } from '../utils/plates.js';

dotenv.config();

async function seedSlots(baseId, prefix) {
  const values = [];

  for (let i = 1; i <= 50; i += 1) {
    const row = Math.ceil(i / 10);
    const col = ((i - 1) % 10) + 1;
    values.push([baseId, `${prefix}-C${String(i).padStart(2, '0')}`, 'CAR', 'FREE', row, col]);
  }

  for (let i = 1; i <= 30; i += 1) {
    const row = Math.ceil(i / 10);
    const col = ((i - 1) % 10) + 1;
    values.push([baseId, `${prefix}-B${String(i).padStart(2, '0')}`, 'BIKE', 'FREE', row, col]);
  }

  await query(
    `INSERT INTO slots (base_id, code, vehicle_type, status, row_no, col_no) VALUES ?`,
    [values]
  );
}

async function seed() {
  console.log('Seeding parking database...');

  await query('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of [
    'audit_logs',
    'incidents',
    'slot_assignments',
    'parking_sessions',
    'alpr_events',
    'vehicle_authorizations',
    'vehicles',
    'slots',
    'bases',
    'companies',
    'users',
  ]) {
    await query(`TRUNCATE TABLE ${table}`);
  }
  await query('SET FOREIGN_KEY_CHECKS = 1');

  const passwordHash = await bcrypt.hash('Admin@123', 10);

  const companyResult = await query(
    `INSERT INTO companies (name, code, status) VALUES
      ('Nexus Technologies', 'NEXUS', 'ACTIVE'),
      ('Orbit Motors', 'ORBIT', 'ACTIVE')`
  );

  // mysql2 insertId for multi-row is first id
  const nexusId = companyResult.insertId;
  const orbitId = nexusId + 1;

  await query(
    `INSERT INTO users (role, company_id, email, password_hash, full_name, employee_code, status) VALUES
      ('SUPER_ADMIN', NULL, 'admin@parking.local', ?, 'System Admin', 'ADM001', 'ACTIVE'),
      ('LOT_ADMIN', NULL, 'ops@parking.local', ?, 'Lot Operator', 'OPS001', 'ACTIVE'),
      ('SECURITY_OPERATOR', NULL, 'security@parking.local', ?, 'Gate Security', 'SEC001', 'ACTIVE'),
      ('CORPORATE_MEMBER', ?, 'aisha@nexus.local', ?, 'Aisha Khan', 'NX-104', 'ACTIVE'),
      ('CORPORATE_MEMBER', ?, 'rohan@nexus.local', ?, 'Rohan Mehta', 'NX-218', 'ACTIVE'),
      ('CORPORATE_MEMBER', ?, 'meera@orbit.local', ?, 'Meera Shah', 'OR-077', 'ACTIVE'),
      ('CORPORATE_MEMBER', ?, 'vikram@orbit.local', ?, 'Vikram Patel', 'OR-091', 'ACTIVE')`,
    [passwordHash, passwordHash, passwordHash, nexusId, passwordHash, nexusId, passwordHash, orbitId, passwordHash, orbitId, passwordHash]
  );

  const users = await query(`SELECT id, email FROM users`);
  const byEmail = Object.fromEntries(users.map((u) => [u.email, u.id]));

  const basesResult = await query(
    `INSERT INTO bases (company_id, name, code, base_type, description, status) VALUES
      (NULL, 'Base 1 · General Parking', 'BASE-GENERAL', 'GENERAL', 'Open parking for unregistered / temporary vehicles', 'ACTIVE'),
      (?, 'Base 2 · Nexus Corporate', 'BASE-NEXUS', 'COMPANY', 'Reserved for Nexus Technologies employees', 'ACTIVE'),
      (?, 'Base 3 · Orbit Corporate', 'BASE-ORBIT', 'COMPANY', 'Reserved for Orbit Motors employees', 'ACTIVE')`,
    [nexusId, orbitId]
  );

  const generalBaseId = basesResult.insertId;
  const nexusBaseId = generalBaseId + 1;
  const orbitBaseId = generalBaseId + 2;

  await seedSlots(generalBaseId, 'G');
  await seedSlots(nexusBaseId, 'N');
  await seedSlots(orbitBaseId, 'O');

  const vehicleRows = [
    ['MH12AB1234', 'CAR', 'Honda', 'City', 'White', nexusId, byEmail['aisha@nexus.local']],
    ['MH12CD5678', 'BIKE', 'Royal Enfield', 'Classic 350', 'Black', nexusId, byEmail['aisha@nexus.local']],
    ['MH14EF9012', 'CAR', 'Hyundai', 'Creta', 'Blue', nexusId, byEmail['rohan@nexus.local']],
    ['GJ01GH3456', 'CAR', 'Toyota', 'Innova', 'Silver', orbitId, byEmail['meera@orbit.local']],
    ['GJ01JK7890', 'BIKE', 'Yamaha', 'MT-15', 'Red', orbitId, byEmail['vikram@orbit.local']],
    ['DL08LM2468', 'CAR', 'Maruti', 'Swift', 'Grey', orbitId, byEmail['vikram@orbit.local']],
  ];

  for (const [plate, type, make, model, color, companyId, ownerId] of vehicleRows) {
    const result = await query(
      `INSERT INTO vehicles
        (company_id, owner_user_id, plate_raw, plate_normalized, vehicle_type, make, model, color, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
      [companyId, ownerId, plate, normalizePlate(plate), type, make, model, color]
    );

    await query(
      `INSERT INTO vehicle_authorizations
        (user_id, vehicle_id, auth_type, status, valid_from, created_by)
       VALUES (?, ?, 'OWNED', 'ACTIVE', NOW(), ?)`,
      [ownerId, result.insertId, byEmail['admin@parking.local']]
    );
  }

  // Pre-occupy a few slots so the live map looks alive
  const occupyPlan = [
    { baseId: generalBaseId, codes: ['G-C01', 'G-C02', 'G-B01', 'G-B02', 'G-C10'] },
    { baseId: nexusBaseId, codes: ['N-C01', 'N-C03', 'N-B01', 'N-C12'] },
    { baseId: orbitBaseId, codes: ['O-C02', 'O-B03', 'O-C05'] },
  ];

  const demoPlates = ['TMP001', 'TMP002', 'TMP003', 'TMP004', 'TMP005', 'TMP006', 'TMP007', 'TMP008', 'TMP009', 'TMP010', 'TMP011', 'TMP012'];
  let plateIdx = 0;

  for (const plan of occupyPlan) {
    for (const code of plan.codes) {
      const slots = await query(`SELECT * FROM slots WHERE base_id = ? AND code = ? LIMIT 1`, [
        plan.baseId,
        code,
      ]);
      const slot = slots[0];
      if (!slot) continue;

      const plate = demoPlates[plateIdx++];
      const session = await query(
        `INSERT INTO parking_sessions
          (base_id, slot_id, plate_normalized, vehicle_type, session_type, status, is_open, started_at, allotted_at, allotment_note)
         VALUES (?, ?, ?, ?, ?, 'ALLOTTED', 1, NOW(), NOW(), 'Seed occupancy')`,
        [
          plan.baseId,
          slot.id,
          plate,
          slot.vehicle_type,
          plan.baseId === generalBaseId ? 'GENERAL' : 'COMPANY',
        ]
      );

      await query(`UPDATE slots SET status = 'OCCUPIED' WHERE id = ?`, [slot.id]);
      await query(
        `INSERT INTO slot_assignments
          (parking_session_id, slot_id, assigned_by, assignment_reason, is_active, assigned_at)
         VALUES (?, ?, 'SYSTEM', 'Seed data', 1, NOW())`,
        [session.insertId, slot.id]
      );
    }
  }

  console.log('Seed complete.');
  console.log('Admin login: admin@parking.local / Admin@123');
  console.log('Bases: GENERAL, NEXUS, ORBIT — each with 50 car + 30 bike slots');
  await pool.end();
}

seed().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});

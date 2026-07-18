import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { pool, query } from './pool.js';
import { normalizePlate } from '../utils/plates.js';

dotenv.config();

async function insertSlotBatch(values) {
  if (!values.length) return;
  const chunk = 100;
  for (let i = 0; i < values.length; i += chunk) {
    await query(
      `INSERT INTO slots
        (base_id, company_id, owner_type, code, vehicle_type, status, row_no, col_no)
       VALUES ?`,
      [values.slice(i, i + chunk)]
    );
  }
}

function buildSlots({ baseId, companyId, ownerType, prefix, carCount, bikeCount }) {
  const values = [];
  for (let i = 1; i <= carCount; i += 1) {
    const row = Math.ceil(i / 10);
    const col = ((i - 1) % 10) + 1;
    values.push([
      baseId,
      companyId,
      ownerType,
      `${prefix}-C${String(i).padStart(2, '0')}`,
      'CAR',
      'FREE',
      row,
      col,
    ]);
  }
  for (let i = 1; i <= bikeCount; i += 1) {
    const row = Math.ceil(i / 10);
    const col = ((i - 1) % 10) + 1;
    values.push([
      baseId,
      companyId,
      ownerType,
      `${prefix}-B${String(i).padStart(2, '0')}`,
      'BIKE',
      'FREE',
      row,
      col,
    ]);
  }
  return values;
}

async function seed() {
  console.log('Seeding multi-company basement parking...');

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
    'company_base_allocations',
    'bases',
    'users',
    'companies',
  ]) {
    await query(`TRUNCATE TABLE ${table}`);
  }
  await query('SET FOREIGN_KEY_CHECKS = 1');

  const passwordHash = await bcrypt.hash('Admin@123', 10);

  const companyResult = await query(
    `INSERT INTO companies (name, code, status) VALUES
      ('Nexus Technologies', 'NEXUS', 'ACTIVE'),
      ('Orbit Motors', 'ORBIT', 'ACTIVE'),
      ('Pixel Labs', 'PIXEL', 'ACTIVE')`
  );
  const nexusId = companyResult.insertId;
  const orbitId = nexusId + 1;
  const pixelId = nexusId + 2;

  await query(
    `INSERT INTO users (role, company_id, email, password_hash, full_name, employee_code, status) VALUES
      ('SUPER_ADMIN', NULL, 'admin@parking.local', ?, 'System Admin', 'ADM001', 'ACTIVE'),
      ('LOT_ADMIN', NULL, 'ops@parking.local', ?, 'Lot Operator', 'OPS001', 'ACTIVE'),
      ('SECURITY_OPERATOR', NULL, 'security@parking.local', ?, 'Gate Security', 'SEC001', 'ACTIVE'),
      ('CORPORATE_MEMBER', ?, 'aisha@nexus.local', ?, 'Aisha Khan', 'NX-104', 'ACTIVE'),
      ('CORPORATE_MEMBER', ?, 'rohan@nexus.local', ?, 'Rohan Mehta', 'NX-218', 'ACTIVE'),
      ('CORPORATE_MEMBER', ?, 'meera@orbit.local', ?, 'Meera Shah', 'OR-077', 'ACTIVE'),
      ('CORPORATE_MEMBER', ?, 'vikram@orbit.local', ?, 'Vikram Patel', 'OR-091', 'ACTIVE'),
      ('CORPORATE_MEMBER', ?, 'neha@pixel.local', ?, 'Neha Rao', 'PX-012', 'ACTIVE')`,
    [
      passwordHash,
      passwordHash,
      passwordHash,
      nexusId,
      passwordHash,
      nexusId,
      passwordHash,
      orbitId,
      passwordHash,
      orbitId,
      passwordHash,
      pixelId,
      passwordHash,
    ]
  );

  const users = await query(`SELECT id, email FROM users`);
  const byEmail = Object.fromEntries(users.map((u) => [u.email, u.id]));

  // Two basements; each hosts GENERAL + multiple company slot pools
  const basesResult = await query(
    `INSERT INTO bases (name, code, level_no, description, status) VALUES
      ('Basement B1', 'B1', 1, 'Multi-company basement: General + Nexus + Orbit + Pixel pools (FCFS)', 'ACTIVE'),
      ('Basement B2', 'B2', 2, 'Overflow basement with General + Nexus + Orbit pools', 'ACTIVE')`
  );
  const b1 = basesResult.insertId;
  const b2 = b1 + 1;

  await query(
    `INSERT INTO company_base_allocations (base_id, company_id, car_quota, bike_quota) VALUES
      (?, ?, 20, 12),
      (?, ?, 15, 10),
      (?, ?, 10, 8),
      (?, ?, 18, 10),
      (?, ?, 12, 8)`,
    [b1, nexusId, b1, orbitId, b1, pixelId, b2, nexusId, b2, orbitId]
  );

  const slotValues = [
    ...buildSlots({ baseId: b1, companyId: null, ownerType: 'GENERAL', prefix: 'B1G', carCount: 20, bikeCount: 15 }),
    ...buildSlots({ baseId: b1, companyId: nexusId, ownerType: 'COMPANY', prefix: 'B1N', carCount: 20, bikeCount: 12 }),
    ...buildSlots({ baseId: b1, companyId: orbitId, ownerType: 'COMPANY', prefix: 'B1O', carCount: 15, bikeCount: 10 }),
    ...buildSlots({ baseId: b1, companyId: pixelId, ownerType: 'COMPANY', prefix: 'B1P', carCount: 10, bikeCount: 8 }),
    ...buildSlots({ baseId: b2, companyId: null, ownerType: 'GENERAL', prefix: 'B2G', carCount: 25, bikeCount: 15 }),
    ...buildSlots({ baseId: b2, companyId: nexusId, ownerType: 'COMPANY', prefix: 'B2N', carCount: 18, bikeCount: 10 }),
    ...buildSlots({ baseId: b2, companyId: orbitId, ownerType: 'COMPANY', prefix: 'B2O', carCount: 12, bikeCount: 8 }),
  ];
  await insertSlotBatch(slotValues);

  const vehicleRows = [
    ['MH12AB1234', 'CAR', 'Honda', 'City', 'White', nexusId, byEmail['aisha@nexus.local'], 0],
    ['MH12CD5678', 'BIKE', 'Royal Enfield', 'Classic 350', 'Black', nexusId, byEmail['aisha@nexus.local'], 0],
    ['MH14EF9012', 'CAR', 'Hyundai', 'Creta', 'Blue', nexusId, byEmail['rohan@nexus.local'], 0],
    ['GJ01GH3456', 'CAR', 'Toyota', 'Innova', 'Silver', orbitId, byEmail['meera@orbit.local'], 0],
    ['GJ01JK7890', 'BIKE', 'Yamaha', 'MT-15', 'Red', orbitId, byEmail['vikram@orbit.local'], 0],
    ['DL08LM2468', 'CAR', 'Maruti', 'Swift', 'Grey', orbitId, byEmail['vikram@orbit.local'], 0],
    ['KA03NP1122', 'CAR', 'Tata', 'Nexon', 'Green', pixelId, byEmail['neha@pixel.local'], 0],
  ];

  for (const [plate, type, make, model, color, companyId, ownerId, isGuest] of vehicleRows) {
    const result = await query(
      `INSERT INTO vehicles
        (company_id, owner_user_id, plate_raw, plate_normalized, vehicle_type, make, model, color, is_guest, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
      [companyId, ownerId, plate, normalizePlate(plate), type, make, model, color, isGuest]
    );
    await query(
      `INSERT INTO vehicle_authorizations
        (user_id, vehicle_id, auth_type, status, valid_from, created_by)
       VALUES (?, ?, 'OWNED', 'ACTIVE', NOW(), ?)`,
      [ownerId, result.insertId, byEmail['admin@parking.local']]
    );
  }

  console.log('Seed complete.');
  console.log('Admin: admin@parking.local / Admin@123');
  console.log('B1 pools: General + Nexus + Orbit + Pixel (FCFS within each pool)');
  await pool.end();
}

seed().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});

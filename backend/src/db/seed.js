import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { pool, query } from './pool.js';
import { normalizePlate } from '../utils/plates.js';

dotenv.config();

async function insertSlotBatch(values) {
  const chunk = 120;
  for (let i = 0; i < values.length; i += chunk) {
    await query(
      `INSERT INTO slots
        (base_id, company_id, owner_type, code, vehicle_type, status, has_ev_charger, row_no, col_no)
       VALUES ?`,
      [values.slice(i, i + chunk)]
    );
  }
}

function buildSlots({ baseId, companyId, ownerType, prefix, carCount, bikeCount, evEvery = 0 }) {
  const values = [];
  for (let i = 1; i <= carCount; i += 1) {
    const hasEv = evEvery > 0 && i % evEvery === 0 ? 1 : 0;
    values.push([
      baseId,
      companyId,
      ownerType,
      `${prefix}-C${String(i).padStart(2, '0')}`,
      'CAR',
      'FREE',
      hasEv,
      Math.ceil(i / 10),
      ((i - 1) % 10) + 1,
    ]);
  }
  for (let i = 1; i <= bikeCount; i += 1) {
    values.push([
      baseId,
      companyId,
      ownerType,
      `${prefix}-B${String(i).padStart(2, '0')}`,
      'BIKE',
      'FREE',
      0,
      Math.ceil(i / 10),
      ((i - 1) % 10) + 1,
    ]);
  }
  return values;
}

async function seed() {
  console.log('Seeding Eastface · York IE demo parking...');

  await query('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of [
    'audit_logs',
    'incidents',
    'slot_assignments',
    'parking_sessions',
    'alpr_events',
    'vehicle_authorizations',
    'vehicles',
    'parking_rates',
    'slots',
    'company_base_allocations',
    'bases',
    'users',
    'companies',
    'buildings',
  ]) {
    await query(`TRUNCATE TABLE ${table}`);
  }
  await query('SET FOREIGN_KEY_CHECKS = 1');

  const passwordHash = await bcrypt.hash('Admin@123', 10);

  const building = await query(
    `INSERT INTO buildings (name, code, address, city, state, pincode, status)
     VALUES (
       'Eastface',
       'EASTFACE',
       'Iscon, Ambli Rd, behind Maruti Suzuki Arena, Ambli',
       'Ahmedabad',
       'Gujarat',
       '380058',
       'ACTIVE'
     )`
  );
  const buildingId = building.insertId;

  const companyResult = await query(
    `INSERT INTO companies
      (building_id, name, code, floor_label, address, color_hex, status)
     VALUES
      (?, 'York IE APAC Pvt Ltd', 'YORK', '2nd Floor',
       '2nd floor Eastface, Iscon, Ambli Rd, behind Maruti Suzuki Arena, Ambli, Ahmedabad, Gujarat 380058',
       '#2F80ED', 'ACTIVE'),
      (?, 'Nexus Technologies', 'NEXUS', '3rd Floor',
       '3rd floor Eastface, Ambli Rd, Ahmedabad, Gujarat 380058',
       '#27C498', 'ACTIVE'),
      (?, 'Orbit Motors Desk', 'ORBIT', '4th Floor',
       '4th floor Eastface, Ambli Rd, Ahmedabad, Gujarat 380058',
       '#F5A623', 'ACTIVE')`,
    [buildingId, buildingId, buildingId]
  );
  const yorkId = companyResult.insertId;
  const nexusId = yorkId + 1;
  const orbitId = yorkId + 2;

  await query(
    `INSERT INTO users (role, company_id, email, password_hash, full_name, employee_code, status) VALUES
      ('SUPER_ADMIN', NULL, 'admin@parking.local', ?, 'Eastface Admin', 'ADM001', 'ACTIVE'),
      ('LOT_ADMIN', NULL, 'ops@parking.local', ?, 'Basement Operator', 'OPS001', 'ACTIVE'),
      ('SECURITY_OPERATOR', NULL, 'security@parking.local', ?, 'Gate Security', 'SEC001', 'ACTIVE'),
      ('CORPORATE_MEMBER', ?, 'priya@yorkie.local', ?, 'Priya Sharma', 'YK-101', 'ACTIVE'),
      ('CORPORATE_MEMBER', ?, 'arjun@yorkie.local', ?, 'Arjun Mehta', 'YK-204', 'ACTIVE'),
      ('CORPORATE_MEMBER', ?, 'aisha@nexus.local', ?, 'Aisha Khan', 'NX-104', 'ACTIVE'),
      ('CORPORATE_MEMBER', ?, 'rohan@nexus.local', ?, 'Rohan Mehta', 'NX-218', 'ACTIVE'),
      ('CORPORATE_MEMBER', ?, 'meera@orbit.local', ?, 'Meera Shah', 'OR-077', 'ACTIVE')`,
    [
      passwordHash,
      passwordHash,
      passwordHash,
      yorkId,
      passwordHash,
      yorkId,
      passwordHash,
      nexusId,
      passwordHash,
      nexusId,
      passwordHash,
      orbitId,
      passwordHash,
    ]
  );

  const users = await query(`SELECT id, email FROM users`);
  const byEmail = Object.fromEntries(users.map((u) => [u.email, u.id]));

  // 3 basements: B1 general only, B2 + B3 multi-company
  const basesResult = await query(
    `INSERT INTO bases (building_id, name, code, level_no, base_kind, description, status) VALUES
      (?, 'Basement 1 · General Parking', 'B1', 1, 'GENERAL',
       'Eastface visitor / guest / unregistered parking only', 'ACTIVE'),
      (?, 'Basement 2 · Company Parking', 'B2', 2, 'MULTI_COMPANY',
       'York IE + Nexus + Orbit reserved pools (FCFS)', 'ACTIVE'),
      (?, 'Basement 3 · Company Parking', 'B3', 3, 'MULTI_COMPANY',
       'York IE + Nexus overflow company pools (FCFS)', 'ACTIVE')`,
    [buildingId, buildingId, buildingId]
  );
  const b1 = basesResult.insertId;
  const b2 = b1 + 1;
  const b3 = b1 + 2;

  await query(
    `INSERT INTO company_base_allocations (base_id, company_id, car_quota, bike_quota) VALUES
      (?, ?, 20, 12),
      (?, ?, 15, 10),
      (?, ?, 12, 8),
      (?, ?, 18, 10),
      (?, ?, 12, 8)`,
    [b2, yorkId, b2, nexusId, b2, orbitId, b3, yorkId, b3, nexusId]
  );

  const slotValues = [
    // B1 GENERAL only — lighter EV set for visitors
    ...buildSlots({
      baseId: b1,
      companyId: null,
      ownerType: 'GENERAL',
      prefix: 'B1G',
      carCount: 50,
      bikeCount: 30,
      evEvery: 10,
    }),
    // B2 multi-company — denser EV on company floors
    ...buildSlots({
      baseId: b2,
      companyId: yorkId,
      ownerType: 'COMPANY',
      prefix: 'B2Y',
      carCount: 20,
      bikeCount: 12,
      evEvery: 4,
    }),
    ...buildSlots({
      baseId: b2,
      companyId: nexusId,
      ownerType: 'COMPANY',
      prefix: 'B2N',
      carCount: 15,
      bikeCount: 10,
      evEvery: 5,
    }),
    ...buildSlots({
      baseId: b2,
      companyId: orbitId,
      ownerType: 'COMPANY',
      prefix: 'B2O',
      carCount: 12,
      bikeCount: 8,
      evEvery: 4,
    }),
    // B3 multi-company
    ...buildSlots({
      baseId: b3,
      companyId: yorkId,
      ownerType: 'COMPANY',
      prefix: 'B3Y',
      carCount: 18,
      bikeCount: 10,
      evEvery: 3,
    }),
    ...buildSlots({
      baseId: b3,
      companyId: nexusId,
      ownerType: 'COMPANY',
      prefix: 'B3N',
      carCount: 12,
      bikeCount: 8,
      evEvery: 4,
    }),
  ];
  await insertSlotBatch(slotValues);

  await query(
    `INSERT INTO parking_rates
      (session_type, vehicle_type, hourly_inr, daily_cap_inr, notes)
     VALUES
      ('COMPANY', 'CAR', 0, 0, 'Corporate members — complimentary while employed'),
      ('COMPANY', 'BIKE', 0, 0, 'Corporate members — complimentary while employed'),
      ('GENERAL', 'CAR', 30, 200, 'Registered general / overflow pool'),
      ('GENERAL', 'BIKE', 15, 100, 'Registered general / overflow pool'),
      ('GUEST', 'CAR', 40, 250, 'Visitor / unknown plate auto-guest'),
      ('GUEST', 'BIKE', 20, 120, 'Visitor / unknown plate auto-guest')`
  );

  const vehicleRows = [
    // York IE demo plates
    ['GJ01YK1001', 'CAR', 'Hyundai', 'Creta', 'White', yorkId, byEmail['priya@yorkie.local']],
    ['GJ01YK1002', 'BIKE', 'Honda', 'Activa', 'Black', yorkId, byEmail['priya@yorkie.local']],
    ['GJ01YK2044', 'CAR', 'Toyota', 'Innova', 'Silver', yorkId, byEmail['arjun@yorkie.local']],
    ['MH12AB1234', 'CAR', 'Honda', 'City', 'White', nexusId, byEmail['aisha@nexus.local']],
    ['MH12CD5678', 'BIKE', 'Royal Enfield', 'Classic 350', 'Black', nexusId, byEmail['aisha@nexus.local']],
    ['MH14EF9012', 'CAR', 'Hyundai', 'Venue', 'Blue', nexusId, byEmail['rohan@nexus.local']],
    ['GJ01GH3456', 'CAR', 'Maruti', 'Swift', 'Grey', orbitId, byEmail['meera@orbit.local']],
  ];

  for (const [plate, type, make, model, color, companyId, ownerId] of vehicleRows) {
    const result = await query(
      `INSERT INTO vehicles
        (company_id, owner_user_id, plate_raw, plate_normalized, vehicle_type, make, model, color, is_guest, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'ACTIVE')`,
      [companyId, ownerId, plate, normalizePlate(plate), type, make, model, color]
    );
    await query(
      `INSERT INTO vehicle_authorizations
        (user_id, vehicle_id, auth_type, status, valid_from, created_by)
       VALUES (?, ?, 'OWNED', 'ACTIVE', NOW(), ?)`,
      [ownerId, result.insertId, byEmail['admin@parking.local']]
    );
  }

  console.log('Seed complete for Eastface building.');
  console.log('Primary demo company: York IE APAC Pvt Ltd');
  console.log('York plates: GJ01YK1001, GJ01YK1002, GJ01YK2044');
  console.log('Admin: admin@parking.local / Admin@123');
  await pool.end();
}

seed().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});

/**
 * Lightweight migrations for existing local/remote DBs without a full reseed.
 * Usage: npm run db:migrate --prefix backend
 */
import { pool, query } from './pool.js';

async function columnExists(table, column) {
  const rows = await query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(rows[0]?.c) > 0;
}

async function tableExists(table) {
  const rows = await query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return Number(rows[0]?.c) > 0;
}

async function migrate() {
  if (!(await columnExists('slots', 'has_ev_charger'))) {
    await query(
      `ALTER TABLE slots
       ADD COLUMN has_ev_charger TINYINT(1) NOT NULL DEFAULT 0 AFTER status`
    );
    console.log('✓ Added slots.has_ev_charger');
  } else {
    console.log('· slots.has_ev_charger already present');
  }

  try {
    await query(`CREATE INDEX idx_slots_ev ON slots (has_ev_charger, status)`);
    console.log('✓ Added index idx_slots_ev');
  } catch (err) {
    if (err.code === 'ER_DUP_KEYNAME') console.log('· idx_slots_ev already present');
    else throw err;
  }

  if (!(await tableExists('parking_rates'))) {
    await query(`
      CREATE TABLE parking_rates (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        session_type ENUM('COMPANY','GENERAL','GUEST') NOT NULL,
        vehicle_type ENUM('CAR','BIKE') NOT NULL,
        hourly_inr DECIMAL(10,2) NOT NULL,
        daily_cap_inr DECIMAL(10,2) NULL,
        notes VARCHAR(255) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_rate (session_type, vehicle_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await query(`
      INSERT INTO parking_rates
        (session_type, vehicle_type, hourly_inr, daily_cap_inr, notes)
      VALUES
        ('COMPANY', 'CAR', 0, 0, 'Corporate members — complimentary while employed'),
        ('COMPANY', 'BIKE', 0, 0, 'Corporate members — complimentary while employed'),
        ('GENERAL', 'CAR', 30, 200, 'Registered general / overflow pool'),
        ('GENERAL', 'BIKE', 15, 100, 'Registered general / overflow pool'),
        ('GUEST', 'CAR', 40, 250, 'Visitor / unknown plate auto-guest'),
        ('GUEST', 'BIKE', 20, 120, 'Visitor / unknown plate auto-guest')
    `);
    console.log('✓ Created parking_rates + seed tariffs');
  } else {
    console.log('· parking_rates already present');
  }

  console.log('Migrations complete.');
  await pool.end();
}

migrate().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});

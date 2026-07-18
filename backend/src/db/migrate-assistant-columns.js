import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'parking',
    multipleStatements: true,
  });

  const [cols] = await conn.query("SHOW COLUMNS FROM slots LIKE 'has_ev_charger'");
  if (!cols.length) {
    await conn.query(
      'ALTER TABLE slots ADD COLUMN has_ev_charger TINYINT(1) NOT NULL DEFAULT 0 AFTER status'
    );
    try {
      await conn.query('ALTER TABLE slots ADD KEY idx_slots_ev (has_ev_charger, status)');
    } catch (err) {
      if (err.code !== 'ER_DUP_KEYNAME') throw err;
    }
    console.log('Added slots.has_ev_charger');
  } else {
    console.log('slots.has_ev_charger already present');
  }

  const [rates] = await conn.query("SHOW TABLES LIKE 'parking_rates'");
  if (!rates.length) {
    await conn.query(`
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
    await conn.query(`
      INSERT INTO parking_rates (session_type, vehicle_type, hourly_inr, daily_cap_inr, notes) VALUES
        ('GUEST','CAR',40,300,'Visitor / unknown plate'),
        ('GUEST','BIKE',20,150,'Visitor bike'),
        ('GENERAL','CAR',30,250,'Company overflow / general'),
        ('GENERAL','BIKE',15,120,'General bike'),
        ('COMPANY','CAR',20,180,'Registered company member'),
        ('COMPANY','BIKE',10,90,'Registered company bike')
    `);
    console.log('Created parking_rates');
  } else {
    console.log('parking_rates already present');
  }

  const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM slots WHERE has_ev_charger = 1');
  if (Number(n) === 0) {
    const [ids] = await conn.query('SELECT id FROM slots ORDER BY id ASC LIMIT 20');
    if (ids.length) {
      await conn.query(
        `UPDATE slots SET has_ev_charger = 1 WHERE id IN (${ids.map((r) => r.id).join(',')})`
      );
      console.log(`Marked ${ids.length} sample EV slots`);
    }
  }

  await conn.end();
  console.log('Migration complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

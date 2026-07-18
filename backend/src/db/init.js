import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import { getDatabaseName, getMysqlConfig } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function init() {
  const dbName = getDatabaseName();
  const conn = await mysql.createConnection({
    ...getMysqlConfig({ includeDatabase: false }),
    multipleStatements: true,
  });

  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } catch (err) {
    console.warn(`CREATE DATABASE skipped: ${err.message}`);
  }

  await conn.query(`USE \`${dbName}\``);

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await conn.query(schema);
  await conn.end();
  console.log(`Database "${dbName}" initialized.`);
}

init().catch((err) => {
  console.error(err);
  process.exit(1);
});

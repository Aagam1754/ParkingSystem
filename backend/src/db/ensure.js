/**
 * Production-safe bootstrap:
 * - creates the database when allowed
 * - applies schema + demo seed only when tables are missing
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import mysql from 'mysql2/promise';
import { getDatabaseName, getMysqlConfig } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function runNodeScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      stdio: 'inherit',
      env: process.env,
      cwd: path.resolve(__dirname, '../..'),
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(scriptPath)} exited with code ${code}`));
    });
  });
}

async function tableExists(conn, dbName, tableName) {
  const [rows] = await conn.query(
    `SELECT 1 AS ok
     FROM information_schema.tables
     WHERE table_schema = ? AND table_name = ?
     LIMIT 1`,
    [dbName, tableName]
  );
  return rows.length > 0;
}

async function ensure() {
  const dbName = getDatabaseName();
  const baseConfig = getMysqlConfig({ includeDatabase: false });

  let conn = await mysql.createConnection({
    ...baseConfig,
    multipleStatements: true,
  });

  try {
    try {
      await conn.query(
        `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      );
    } catch (err) {
      console.warn(
        `Could not CREATE DATABASE "${dbName}" (continuing with existing DB):`,
        err.message
      );
    }

    await conn.query(`USE \`${dbName}\``);

    const hasUsers = await tableExists(conn, dbName, 'users');
    if (hasUsers) {
      console.log(`Database "${dbName}" already initialized — skipping schema/seed.`);
      await conn.end();
      return;
    }

    console.log(`Database "${dbName}" is empty — applying schema + demo seed…`);
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await conn.query(schema);
    await conn.end();
    conn = null;

    await runNodeScript(path.join(__dirname, 'seed.js'));
    console.log('Database ensure complete.');
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

ensure().catch((err) => {
  console.error(err);
  process.exit(1);
});

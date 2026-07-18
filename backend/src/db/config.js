import dotenv from 'dotenv';

dotenv.config();

function parseMysqlUrl(urlString) {
  const parsed = new URL(urlString);
  const database = parsed.pathname.replace(/^\//, '') || undefined;
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
  };
}

function wantsSsl() {
  if (process.env.DB_SSL === 'true') return true;
  if (process.env.DB_SSL === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

/** Shared MySQL connection options for pool / init / ensure. */
export function getMysqlConfig({ includeDatabase = true } = {}) {
  const url = (process.env.DATABASE_URL || process.env.MYSQL_URL || '').trim();
  const base = url
    ? parseMysqlUrl(url)
    : {
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'parking',
      };

  const config = {
    host: base.host,
    port: base.port,
    user: base.user,
    password: base.password,
    namedPlaceholders: true,
  };

  if (includeDatabase && base.database) {
    config.database = base.database;
  }

  if (wantsSsl()) {
    config.ssl = { rejectUnauthorized: false };
  }

  return config;
}

export function getDatabaseName() {
  const url = (process.env.DATABASE_URL || process.env.MYSQL_URL || '').trim();
  if (url) {
    const name = new URL(url).pathname.replace(/^\//, '');
    if (name) return name;
  }
  return process.env.DB_NAME || 'parking';
}

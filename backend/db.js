import pg from 'pg';
const { Pool, types } = pg;
// DATE (oid 1082) -> вернуть как строку 'YYYY-MM-DD', без сдвига часового пояса.
types.setTypeParser(1082, (v) => v);
// TIME (oid 1083) -> обрезаем секунды до HH:MM.
types.setTypeParser(1083, (v) => (v ? v.slice(0, 5) : v));
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const pool = new Pool({
  host: process.env.DB_HOST || 'db',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'calendar',
  password: process.env.DB_PASSWORD || 'calendar',
  database: process.env.DB_NAME || 'calendar',
});

// Ждём, пока Postgres поднимется, затем применяем schema.sql.
export async function initDb() {
  const schemaPath = join(__dirname, 'db', 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf8');

  let lastErr;
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      await pool.query('SELECT 1');
      await pool.query(schema);
      console.log('БД готова, схема применена (schema.sql)');
      return;
    } catch (err) {
      lastErr = err;
      console.log(`Ожидание БД... попытка ${attempt}/30 (${err.code || err.message})`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

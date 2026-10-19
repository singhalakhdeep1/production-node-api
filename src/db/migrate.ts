/**
 * Forward-only SQL migration runner.
 * Applies migrations/*.sql in filename order, each inside a transaction, recording them in
 * schema_migrations. A Postgres advisory lock keeps concurrent PM2 workers / replicas from
 * racing on startup.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pool } from './pool';
import { logger } from '../services/structured-logging/structured-logging.service';

// dist/src/db -> ../../../migrations, src/db (tsx) -> ../../migrations, else ./migrations
const CANDIDATES = [path.resolve(__dirname, '../../../migrations'), path.resolve(__dirname, '../../migrations'), path.resolve(process.cwd(), 'migrations')];
const LOCK_ID = 727274;

export async function runMigrations(): Promise<string[]> {
  const dir = CANDIDATES.find((d) => fs.existsSync(d) && fs.readdirSync(d).some((f) => f.endsWith('.sql')));
  if (!dir) throw new Error(`No migrations directory found (looked in ${CANDIDATES.join(', ')})`);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const done = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
        logger.info(`Applied migration ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
    client.release();
  }
  return applied;
}

if (require.main === module) {
  runMigrations()
    .then((applied) => {
      logger.info(applied.length ? `Applied ${applied.length} migration(s)` : 'Database schema is up to date');
      return pool.end();
    })
    .catch((error) => {
      logger.error((error as Error).message);
      process.exit(1);
    });
}

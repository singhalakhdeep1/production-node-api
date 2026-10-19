import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { config } from '../config';
import { dbPoolConnections, dbQueryDuration } from '../metrics';
import { logger } from '../services/structured-logging/structured-logging.service';
import { tracer } from '../tracing/tracer';

export const pool = new Pool({
  connectionString: config.db.url,
  min: config.db.poolMin,
  max: config.db.poolMax,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  keepAlive: true,
  ssl: config.db.ssl ? { rejectUnauthorized: false } : undefined,
  application_name: config.serviceName,
});

pool.on('error', (err) => logger.error('Idle PostgreSQL client error', { error: err.message }));

const updatePoolGauges = () => {
  dbPoolConnections.set({ state: 'total' }, pool.totalCount);
  dbPoolConnections.set({ state: 'idle' }, pool.idleCount);
  dbPoolConnections.set({ state: 'waiting' }, pool.waitingCount);
};
setInterval(updatePoolGauges, 5000).unref();

const operationOf = (sql: string) => sql.trim().split(/\s+/, 1)[0]?.toUpperCase() ?? 'QUERY';

/** Parameterised query with a metrics sample and a Tempo child span. */
export async function query<R extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  client?: PoolClient,
): Promise<QueryResult<R>> {
  const operation = operationOf(sql);
  const end = dbQueryDuration.startTimer({ operation });
  const span = tracer.startSpan(`pg ${operation}`, { 'db.system': 'postgresql', 'db.statement': sql.slice(0, 500) });
  try {
    const result = await (client ?? pool).query<R>(sql, params);
    end({ success: 'true' });
    span.end();
    return result;
  } catch (error) {
    end({ success: 'false' });
    span.end(error);
    throw error;
  }
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function pingDatabase(): Promise<number> {
  const start = Date.now();
  await pool.query('SELECT 1');
  return Date.now() - start;
}

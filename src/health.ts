import fs from 'node:fs/promises';
import os from 'node:os';
import { cache } from './cache/redis';
import { config } from './config';
import { pingDatabase } from './db/pool';
import { eventLoopLagMs } from './middleware/load-shedding';
import { CircuitBreakerService } from './services/circuit-breaker/circuit-breaker.service';
import { HealthCheckService } from './services/health-check/health-check.service';
import { uploadDir } from './upload/multer';

export const healthChecks = new HealthCheckService(config.health.timeoutSeconds * 1000);

// Database: critical. Wrapped in a breaker so a dead DB fails fast instead of piling up probes.
const dbBreaker = new CircuitBreakerService({ name: 'database', ...config.circuitBreaker, resetTimeout: Math.min(config.circuitBreaker.resetTimeout, 15000) });
healthChecks.registerCheck('database', async () => {
  const latency = await dbBreaker.execute(pingDatabase);
  return { healthy: true, message: `PostgreSQL reachable (${latency}ms)`, details: { latencyMs: latency } };
});

// Redis: non-critical. The API keeps serving from Postgres + the in-memory cache without it.
healthChecks.registerCheck('redis', async () => {
  if (!cache.enabled) return { healthy: true, degraded: true, message: 'Redis not configured (memory cache only)' };
  const latency = await cache.ping();
  return { healthy: true, message: `Redis reachable (${latency}ms)`, details: { latencyMs: latency } };
}, { critical: false });

healthChecks.registerCheck('memory', async () => {
  const rssMb = process.memoryUsage().rss / 1024 / 1024;
  const limitMb = Number(process.env.MEMORY_WARN_MB ?? 450);
  return { healthy: true, degraded: rssMb > limitMb, message: `RSS ${rssMb.toFixed(0)}MB (warn above ${limitMb}MB)`, details: { rssMb: Math.round(rssMb), freeSystemMb: Math.round(os.freemem() / 1048576) } };
}, { critical: false });

healthChecks.registerCheck('eventLoop', async () => {
  const lag = eventLoopLagMs();
  return { healthy: true, degraded: lag > config.loadShedding.maxEventLoopDelayMs / 2, message: `mean lag ${lag.toFixed(1)}ms`, details: { lagMs: Math.round(lag * 10) / 10 } };
}, { critical: false });

healthChecks.registerCheck('uploads', async () => {
  await fs.access(uploadDir, fs.constants.W_OK);
  return { healthy: true, message: 'Upload directory writable' };
}, { critical: false });

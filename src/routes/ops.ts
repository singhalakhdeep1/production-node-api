/**
 * Operations API used by the dashboard and on-call:
 *  - GET  /status                    any authenticated user: runtime, breakers, limiter, cache, sinks
 *  - POST /circuit-breakers/:name/*  admin: trip / reset a breaker
 *  - POST /cache/flush               admin
 *  - POST /load-shedding             admin: simulate overload for N ms
 *  - GET  /traces/:id, /traces       admin: read traces back from Tempo
 *  - GET  /logs                      admin: LogQL query against Loki
 *  - GET/POST /incidents...          admin: PagerDuty incidents
 *  - POST /simulate-error            admin: raise an unhandled 500 (exercises the alert path)
 *  - POST /alertmanager              Prometheus Alertmanager webhook (shared token) -> PagerDuty
 */
import { Router } from 'express';
import os from 'node:os';
import { enabledSinks, monitoring } from '../../monitoring';
import { cache } from '../cache/redis';
import { config } from '../config';
import { pool } from '../db/pool';
import { eventBusMode } from '../events';
import { graphqlStats } from '../graphql/server';
import { HttpError } from '../http-error';
import { requireAuth, requireRole } from '../middleware/auth';
import { eventLoopLagMs, forceShedding } from '../middleware/load-shedding';
import { tokenBuckets } from '../middleware/rate-limit';
import { CircuitBreakerService } from '../services/circuit-breaker/circuit-breaker.service';
import { structuredLogger } from '../services/structured-logging/structured-logging.service';
import { tracer } from '../tracing/tracer';
import { websocketStats } from '../websocket/server';

export const opsRouter = Router();

const requireSink = <T>(sink: T | undefined, name: string): T => {
  if (!sink) throw new HttpError(501, `${name} is not configured on this instance`);
  return sink;
};

/** Alertmanager webhook: authenticated by a shared bearer token, not a user session. */
opsRouter.post('/alertmanager', async (req, res, next) => {
  try {
    const token = config.monitoring.alertWebhookToken;
    if (!token || req.header('authorization') !== `Bearer ${token}`) throw new HttpError(401, 'Invalid webhook token');
    const pd = requireSink(monitoring.pagerduty, 'PagerDuty');
    const alerts = (req.body?.alerts ?? []) as { status: string; labels: Record<string, string>; annotations: Record<string, string>; fingerprint?: string }[];
    const results = [];
    for (const alert of alerts) {
      const dedupKey = `alertmanager-${alert.fingerprint ?? alert.labels.alertname}`;
      if (alert.status === 'resolved') {
        results.push(await pd.resolveIncident(dedupKey));
      } else {
        const severity = alert.labels.severity === 'critical' ? 'critical' : alert.labels.severity === 'warning' ? 'warning' : 'error';
        results.push(await pd.triggerIncident({
          summary: alert.annotations.summary ?? alert.labels.alertname,
          severity,
          dedupKey,
          details: { ...alert.labels, ...alert.annotations },
        }, { force: true }));
      }
    }
    res.json({ received: alerts.length, results });
  } catch (error) {
    next(error);
  }
});

opsRouter.use(requireAuth);

opsRouter.get('/status', async (_req, res) => {
  const mem = process.memoryUsage();
  res.json({
    service: config.serviceName,
    version: config.version,
    environment: config.env,
    instance: config.instance,
    pid: process.pid,
    node: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    hostname: os.hostname(),
    loadAverage: os.loadavg(),
    memory: { rssMb: Math.round(mem.rss / 1048576), heapUsedMb: Math.round(mem.heapUsed / 1048576), heapTotalMb: Math.round(mem.heapTotal / 1048576) },
    eventLoopLagMs: Math.round(eventLoopLagMs() * 10) / 10,
    database: { totalConnections: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, max: config.db.poolMax },
    cache: cache.snapshot(),
    eventBus: eventBusMode(),
    circuitBreakers: CircuitBreakerService.all().map((b) => b.snapshot()),
    rateLimiting: {
      ip: { windowMs: config.rateLimit.windowMs, max: config.rateLimit.max },
      tokenBucket: tokenBuckets.getStatistics(),
    },
    websockets: websocketStats(),
    graphql: graphqlStats(),
    monitoring: {
      sinks: enabledSinks(),
      tracing: { exporting: tracer.enabled, exportedSpans: tracer.exported, droppedSpans: tracer.dropped },
      loki: monitoring.loki ? { pushedLines: monitoring.loki.pushed } : null,
      cloudwatch: monitoring.cloudwatch ? { publishedData: monitoring.cloudwatch.published } : null,
      pagerduty: monitoring.pagerduty ? { incidents: monitoring.pagerduty.listIncidents().slice(0, 20) } : null,
    },
  });
});

opsRouter.use(requireRole('admin'));

opsRouter.post('/circuit-breakers/:name/:action(trip|reset)', (req, res, next) => {
  const breaker = CircuitBreakerService.get(req.params.name);
  if (!breaker) return next(new HttpError(404, `Unknown circuit breaker "${req.params.name}"`));
  if (req.params.action === 'trip') breaker.manualTrip();
  else breaker.manualReset();
  structuredLogger.logAuditEvent('CircuitBreakerChanged', `Circuit breaker ${req.params.action}`, { breaker: breaker.name, userId: req.user!.id });
  res.json(breaker.snapshot());
});

opsRouter.post('/cache/flush', async (req, res) => {
  await cache.flushAll();
  structuredLogger.logAuditEvent('CacheFlushed', 'Cache flushed', { userId: req.user!.id });
  res.json({ flushed: true, cache: cache.snapshot() });
});

opsRouter.post('/load-shedding', (req, res) => {
  const ms = Math.min(Math.max(Number(req.body?.durationMs ?? 5000), 0), 60000);
  forceShedding(ms);
  structuredLogger.logAuditEvent('LoadSheddingForced', 'Load shedding forced', { durationMs: ms, userId: req.user!.id });
  res.json({ sheddingForMs: ms });
});

opsRouter.get('/traces/:traceId', async (req, res, next) => {
  try {
    res.json(await requireSink(monitoring.tempo, 'Tempo').getTrace(req.params.traceId));
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(502, (error as Error).message));
  }
});

opsRouter.get('/traces', async (req, res, next) => {
  try {
    const query = Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, String(v)]));
    res.json(await requireSink(monitoring.tempo, 'Tempo').searchTraces({ tags: `service.name=${config.serviceName}`, limit: 20, ...query }));
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(502, (error as Error).message));
  }
});

opsRouter.get('/logs', async (req, res, next) => {
  try {
    const query = typeof req.query.query === 'string' ? req.query.query : `{job="${config.serviceName}"}`;
    const limit = Math.min(Number(req.query.limit ?? 100), 1000);
    res.json(await requireSink(monitoring.loki, 'Loki').queryLogs(query, limit));
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(502, (error as Error).message));
  }
});

opsRouter.get('/incidents', (_req, res, next) => {
  try {
    res.json({ items: requireSink(monitoring.pagerduty, 'PagerDuty').listIncidents() });
  } catch (error) {
    next(error);
  }
});

opsRouter.post('/incidents', async (req, res, next) => {
  try {
    const { summary, severity = 'warning', dedupKey } = req.body ?? {};
    if (typeof summary !== 'string' || !summary.trim()) throw new HttpError(400, 'summary is required');
    if (!['critical', 'error', 'warning', 'info'].includes(severity)) throw new HttpError(400, 'invalid severity');
    const result = await requireSink(monitoring.pagerduty, 'PagerDuty').triggerIncident(
      { summary, severity, dedupKey: typeof dedupKey === 'string' && dedupKey ? dedupKey : `manual-${Date.now()}`, details: { triggeredBy: req.user!.id } },
      { force: true },
    );
    res.status(201).json(result);
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(502, (error as Error).message));
  }
});

opsRouter.post('/incidents/:dedupKey/:action(acknowledge|resolve)', async (req, res, next) => {
  try {
    const pd = requireSink(monitoring.pagerduty, 'PagerDuty');
    res.json(req.params.action === 'acknowledge' ? await pd.acknowledgeIncident(req.params.dedupKey) : await pd.resolveIncident(req.params.dedupKey));
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(502, (error as Error).message));
  }
});

opsRouter.post('/simulate-error', () => {
  throw new Error('Simulated unhandled error (ops test)');
});

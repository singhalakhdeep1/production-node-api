import { Router } from 'express';
import { config } from '../config';
import { healthChecks } from '../health';

export const healthRouter = Router();

/** Full report: 200 for pass/warn, 503 when a critical dependency fails. */
healthRouter.get('/', async (_req, res) => {
  const report = await healthChecks.performHealthCheck();
  res.status(report.status === 'fail' ? 503 : 200).json({
    ...report,
    checkStatus: report.status,
    status: report.status === 'fail' ? 'unhealthy' : report.status === 'warn' ? 'degraded' : 'healthy',
    uptime: process.uptime(),
    version: config.version,
    instance: config.instance,
  });
});

/** Liveness: the process is up and the event loop is turning. */
healthRouter.get('/live', async (_req, res) => {
  res.json(await healthChecks.performLivenessCheck());
});

/** Readiness: critical dependencies reachable, safe to route traffic here. */
healthRouter.get('/ready', async (_req, res) => {
  const result = await healthChecks.performReadinessCheck();
  res.status(result.status === 'pass' ? 200 : 503).json(result);
});

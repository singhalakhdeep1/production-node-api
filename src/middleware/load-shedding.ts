/**
 * Load shedding: when the event loop is lagging past the threshold the process is saturated,
 * so new API requests get a fast 503 + Retry-After instead of queueing and timing out.
 * Health and metrics endpoints are never shed so orchestration keeps seeing the process.
 */
import type { NextFunction, Request, Response } from 'express';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { config } from '../config';
import { loadShedTotal } from '../metrics';

const histogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();

let currentLagMs = 0;
setInterval(() => {
  currentLagMs = histogram.mean / 1e6;
  histogram.reset();
}, 1000).unref();

export const eventLoopLagMs = () => currentLagMs;
let forcedUntil = 0;

/** Lets ops (and the e2e script) simulate overload for `ms` milliseconds. */
export function forceShedding(ms: number): void {
  forcedUntil = Date.now() + ms;
}

export function loadShedding(req: Request, res: Response, next: NextFunction): void {
  if (req.path.startsWith('/api/health') || req.path === '/metrics' || req.path.startsWith('/api/ops')) return next();
  const overloaded = currentLagMs > config.loadShedding.maxEventLoopDelayMs || Date.now() < forcedUntil;
  if (!overloaded) return next();
  loadShedTotal.inc();
  res.setHeader('Retry-After', '2');
  res.status(503).json({ error: 'Server is overloaded, please retry shortly' });
}

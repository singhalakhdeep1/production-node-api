/**
 * First middleware in the chain: correlation id, W3C trace context, structured access log,
 * Prometheus HTTP metrics and the monitoring hooks, all keyed to one request.
 */
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { httpInFlight, httpRequestDuration, httpRequestSize, httpRequestsTotal, httpResponseSize } from '../metrics';
import { hooks } from '../observability/hooks';
import { logger, StructuredLoggingService } from '../services/structured-logging/structured-logging.service';
import { Tracer, tracer } from '../tracing/tracer';

const SKIP_LOG = new Set(['/metrics', '/api/health/live']);
const SAFE_ID = /^[\w.:-]{1,128}$/;

/** Low-cardinality route label: the matched Express route, else a bucket. */
export function routeLabel(req: Request): string {
  if (req.route?.path) return `${req.baseUrl}${req.route.path === '/' && req.baseUrl ? '' : req.route.path}`;
  if (req.path.startsWith('/uploads/')) return '/uploads/:file';
  if (req.path.startsWith('/api/docs')) return '/api/docs';
  if (req.path.startsWith('/graphql')) return '/graphql';
  if (req.path.startsWith('/_next/')) return '/_next';
  return 'unmatched';
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-correlation-id') ?? req.header('x-request-id');
  const correlationId = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  const requestId = randomUUID();
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);
  res.setHeader('X-Request-ID', requestId);

  const span = tracer.startSpan(`${req.method} ${req.path}`, {
    'http.method': req.method,
    'http.target': req.originalUrl.slice(0, 300),
    'http.user_agent': req.header('user-agent') ?? '',
    'net.peer.ip': req.ip ?? '',
    'correlation.id': correlationId,
  }, { kind: 'server', parent: Tracer.parseTraceparent(req.header('traceparent')) });
  res.setHeader('traceparent', span.traceparent());
  res.setHeader('X-Trace-ID', span.traceId);

  const start = process.hrtime.bigint();
  httpInFlight.inc();

  res.on('finish', () => {
    httpInFlight.dec();
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const route = routeLabel(req);
    const status = res.statusCode;
    const labels = { method: req.method, route, status: String(status) };
    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, durationMs / 1000);
    httpRequestSize.observe({ method: req.method, route }, Number(req.header('content-length') ?? 0));
    httpResponseSize.observe({ method: req.method, route }, Number(res.getHeader('content-length') ?? 0));

    span.setAttribute('http.route', route).setAttribute('http.status_code', status);
    if (status >= 500) span.setStatus('error', `HTTP ${status}`);
    span.end();

    hooks.emitRequest({
      method: req.method,
      route,
      path: req.path,
      status,
      durationMs,
      userId: req.user?.id,
      traceId: span.traceId,
      correlationId,
    });

    if (!SKIP_LOG.has(req.path)) {
      const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
      logger.log(level, `${req.method} ${req.originalUrl} ${status} ${durationMs.toFixed(1)}ms`, {
        http: { method: req.method, route, status, durationMs: Math.round(durationMs * 10) / 10, ip: req.ip },
        correlationId,
        requestId,
        traceId: span.traceId,
        userId: req.user?.id,
      });
    }
  });
  res.on('close', () => {
    if (!res.writableFinished) httpInFlight.dec();
  });

  StructuredLoggingService.runWithContext(
    {
      correlationId,
      requestId,
      ipAddress: req.ip,
      userAgent: req.header('user-agent'),
      traceId: span.traceId,
      spanId: span.spanId,
    },
    () => tracer.withSpan(span, next),
  );
}

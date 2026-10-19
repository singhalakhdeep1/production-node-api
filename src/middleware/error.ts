import type { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';
import { config } from '../config';
import { HttpError } from '../http-error';
import { hooks } from '../observability/hooks';
import { logger } from '../services/structured-logging/structured-logging.service';
import { tracer } from '../tracing/tracer';
import { routeLabel } from './request-context';

export function notFound(req: Request, res: Response): void {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  let status = 500;
  let message = 'Internal server error';
  let details: unknown;

  if (err instanceof HttpError) {
    status = err.status;
    message = err.message;
    details = err.details;
  } else if (err instanceof MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    message = err.message;
  } else if (err instanceof SyntaxError && 'body' in err) {
    status = 400;
    message = 'Malformed JSON body';
  } else if ((err as { type?: string }).type === 'entity.too.large') {
    status = 413;
    message = 'Request body too large';
  }

  const correlationId = req.correlationId;
  if (status >= 500) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error('Unhandled error', { error: { message: error.message, stack: error.stack }, correlationId });
    tracer.currentSpan()?.setStatus('error', error.message);
    hooks.emitError({
      error,
      method: req.method,
      route: routeLabel(req),
      status,
      userId: req.user?.id,
      correlationId,
      traceId: tracer.currentSpan()?.traceId,
    });
  }

  if (res.headersSent) return;
  res.status(status).json({
    error: message,
    ...(details ? { details } : {}),
    ...(status >= 500 && !config.isProduction && err instanceof Error ? { message: err.message } : {}),
    correlationId,
  });
}

/**
 * Structured Logging Service (HLD/LLD #4)
 * Winston JSON logs enriched with a per-request context (correlation id, request id,
 * user, trace id) carried through async calls by AsyncLocalStorage.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import winston from 'winston';
import Transport from 'winston-transport';
import { config } from '../../config';

export interface LogContext {
  correlationId: string;
  requestId?: string;
  userId?: string | null;
  ipAddress?: string;
  userAgent?: string;
  traceId?: string;
  spanId?: string;
}

const storage = new AsyncLocalStorage<LogContext>();

const contextFormat = winston.format((info) => {
  const ctx = storage.getStore();
  if (ctx) {
    info.correlationId ??= ctx.correlationId;
    info.requestId ??= ctx.requestId;
    info.userId ??= ctx.userId ?? undefined;
    info.traceId ??= ctx.traceId;
  }
  info.service = config.serviceName;
  info.instance = config.instance;
  return info;
});

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: config.isProduction
      ? winston.format.json()
      : winston.format.combine(winston.format.colorize(), winston.format.simple()),
  }),
];
if (config.logDir && config.env !== 'test') {
  fs.mkdirSync(config.logDir, { recursive: true });
  transports.push(
    new winston.transports.File({ filename: `${config.logDir}/error.log`, level: 'error' }),
    new winston.transports.File({ filename: `${config.logDir}/combined.log` }),
  );
}

export const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    contextFormat(),
    winston.format.json(),
  ),
  transports,
});

/** Extra sinks (Loki, CloudWatch Logs) register themselves here at startup. */
export function addLogTransport(transport: Transport): void {
  logger.add(transport);
}

export class StructuredLoggingService {
  static createCorrelationId(): string {
    return randomUUID();
  }

  /** Runs `fn` with `context` as the active log context for everything it awaits. */
  static runWithContext<T>(context: LogContext, fn: () => T): T {
    return storage.run(context, fn);
  }

  static getContext(): LogContext | undefined {
    return storage.getStore();
  }

  /** Mutates the active context (e.g. once auth has resolved the user). */
  static updateContext(patch: Partial<LogContext>): void {
    const ctx = storage.getStore();
    if (ctx) Object.assign(ctx, patch);
  }

  logInformation(message: string, additionalContext: Record<string, unknown> = {}): void {
    logger.info(message, additionalContext);
  }

  logWarning(message: string, additionalContext: Record<string, unknown> = {}): void {
    logger.warn(message, additionalContext);
  }

  logError(message: string, error?: unknown, additionalContext: Record<string, unknown> = {}): void {
    const err = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error;
    logger.error(message, { ...additionalContext, error: err });
  }

  logAuditEvent(eventType: string, description: string, additionalContext: Record<string, unknown> = {}): void {
    logger.info(`AUDIT: ${description}`, {
      ...additionalContext,
      audit: true,
      auditEventType: eventType,
      auditDescription: description,
    });
  }
}

export const structuredLogger = new StructuredLoggingService();

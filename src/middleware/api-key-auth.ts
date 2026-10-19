/**
 * API-key-only authentication (for machine clients / integrations).
 * Routes that accept either a JWT or an API key use `requireAuth` from ./auth instead.
 */
import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../http-error';
import { authenticateApiKey, requireScope } from './auth';
import { StructuredLoggingService } from '../services/structured-logging/structured-logging.service';

export async function apiKeyAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const key = req.headers['x-api-key'];
    if (!key || Array.isArray(key)) throw new HttpError(401, 'API key required');
    const result = await authenticateApiKey(key);
    if (!result) throw new HttpError(401, 'Invalid or expired API key');
    req.apiKey = result.record;
    req.user = result.principal;
    StructuredLoggingService.updateContext({ userId: result.principal.id });
    next();
  } catch (error) {
    next(error);
  }
}

export { requireScope };

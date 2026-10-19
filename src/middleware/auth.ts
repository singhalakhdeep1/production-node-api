/**
 * Authentication for REST, GraphQL and WebSockets.
 * A request is authenticated by either `Authorization: Bearer <JWT>` or `X-API-Key: pk_...`.
 * JWT principals have every scope; API-key principals only have the scopes on the key.
 */
import type { NextFunction, Request, Response } from 'express';
import { apiKeyService, type ApiKeyRecord } from '../auth/api-key';
import { verifyToken } from '../auth/jwt';
import { HttpError } from '../http-error';
import { authAttempts } from '../metrics';
import type { Role } from '../models/user';
import { StructuredLoggingService } from '../services/structured-logging/structured-logging.service';
import { tracer } from '../tracing/tracer';

export interface Principal {
  id: string;
  email?: string;
  role: Role;
  method: 'jwt' | 'api_key';
  scopes: string[];
  apiKeyId?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: Principal;
      apiKey?: ApiKeyRecord;
      correlationId?: string;
    }
  }
}

/** Resolves a principal from a bearer token (string with or without "Bearer "). */
export async function authenticateToken(token: string | undefined | null): Promise<Principal | null> {
  if (!token) return null;
  try {
    const payload = verifyToken(token);
    authAttempts.inc({ method: 'jwt', result: 'success' });
    return { id: payload.sub, email: payload.email, role: payload.role, method: 'jwt', scopes: ['*'] };
  } catch {
    authAttempts.inc({ method: 'jwt', result: 'failure' });
    return null;
  }
}

export async function authenticateApiKey(key: string | undefined | null): Promise<{ principal: Principal; record: ApiKeyRecord } | null> {
  if (!key) return null;
  const record = await apiKeyService.validateApiKey(key);
  authAttempts.inc({ method: 'api_key', result: record ? 'success' : 'failure' });
  if (!record) return null;
  return {
    record,
    principal: {
      id: record.userId,
      role: record.scopes.includes('admin') || record.scopes.includes('*') ? 'admin' : 'user',
      method: 'api_key',
      scopes: record.scopes,
      apiKeyId: record.id,
    },
  };
}

/** Resolves credentials from request headers without rejecting anonymous requests. */
export async function resolvePrincipal(headers: { authorization?: string; 'x-api-key'?: string | string[] }) {
  const apiKey = Array.isArray(headers['x-api-key']) ? headers['x-api-key'][0] : headers['x-api-key'];
  if (apiKey) return authenticateApiKey(apiKey);
  const principal = await authenticateToken(headers.authorization);
  return principal ? { principal, record: undefined } : null;
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  resolvePrincipal(req.headers)
    .then((result) => {
      if (result) attach(req, result.principal, result.record);
      next();
    })
    .catch(next);
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  resolvePrincipal(req.headers)
    .then((result) => {
      if (!result) {
        const hasCredentials = Boolean(req.headers.authorization || req.headers['x-api-key']);
        throw new HttpError(401, hasCredentials ? 'Invalid or expired credentials' : 'Authentication required');
      }
      attach(req, result.principal, result.record);
      next();
    })
    .catch(next);
}

function attach(req: Request, principal: Principal, record?: ApiKeyRecord): void {
  req.user = principal;
  if (record) req.apiKey = record;
  StructuredLoggingService.updateContext({ userId: principal.id });
  tracer.currentSpan()?.setAttribute('enduser.id', principal.id).setAttribute('auth.method', principal.method);
}

export function hasScope(principal: Principal, scope: string): boolean {
  return principal.scopes.includes('*') || principal.scopes.includes(scope);
}

export function requireScope(scope: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new HttpError(401, 'Authentication required'));
    if (!hasScope(req.user, scope)) return next(new HttpError(403, `Insufficient permissions. Required scope: ${scope}`));
    next();
  };
}

export function requireRole(role: Role) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new HttpError(401, 'Authentication required'));
    if (req.user.role !== role) return next(new HttpError(403, `Requires role: ${role}`));
    next();
  };
}

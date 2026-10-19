/**
 * Two rate limiters:
 *  - `ipRateLimiter`: express-rate-limit fixed window per client IP on /api (abuse / DDoS guard)
 *  - `principalRateLimiter`: token bucket (RateLimitingService) per authenticated user or API key,
 *    so one noisy integration cannot starve the others behind the same NAT.
 */
import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config';
import { rateLimitRejections } from '../metrics';
import { RateLimitingService } from '../services/rate-limiting/rate-limiting.service';

export const tokenBuckets = new RateLimitingService({
  bucketCapacity: config.rateLimit.bucketCapacity,
  refillRate: config.rateLimit.refillRate,
});

export const ipRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.max,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/health'),
  handler: (_req, res) => {
    rateLimitRejections.inc({ limiter: 'ip' });
    res.status(429).json({ error: 'Too many requests from this IP, please try again later' });
  },
});

/** Stricter limit for credential endpoints (login/register) against brute force. */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 20),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (_req, res) => {
    rateLimitRejections.inc({ limiter: 'auth' });
    res.status(429).json({ error: 'Too many failed authentication attempts, please try again later' });
  },
});

export function principalRateLimiter(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) return next();
  const key = req.user.apiKeyId ? `key:${req.user.apiKeyId}` : `user:${req.user.id}`;
  const allowed = tokenBuckets.isAllowed(key);
  res.setHeader('X-RateLimit-Bucket-Remaining', String(tokenBuckets.getRemainingTokens(key)));
  if (allowed) return next();
  rateLimitRejections.inc({ limiter: 'token_bucket' });
  const retryAfter = Math.max(1, Math.ceil(tokenBuckets.getRetryAfterMs(key) / 1000));
  res.setHeader('Retry-After', String(retryAfter));
  res.status(429).json({ error: 'Rate limit exceeded for this account', retryAfterSeconds: retryAfter });
}

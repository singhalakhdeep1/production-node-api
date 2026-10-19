import { Router } from 'express';
import { generateToken } from '../auth/jwt';
import { HttpError } from '../http-error';
import { requireAuth } from '../middleware/auth';
import { authRateLimiter } from '../middleware/rate-limit';
import { UserModel } from '../models/user';
import { structuredLogger } from '../services/structured-logging/structured-logging.service';
import { userSchemas, validationMiddleware } from '../validation/schemas';

export const authRouter = Router();

authRouter.post('/register', authRateLimiter, validationMiddleware(userSchemas.register), async (req, res, next) => {
  try {
    const user = await UserModel.create(req.body);
    structuredLogger.logAuditEvent('UserRegistered', 'User registered', { userId: user.id });
    res.status(201).json({ token: generateToken(user), user });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/login', authRateLimiter, validationMiddleware(userSchemas.login), async (req, res, next) => {
  try {
    const user = await UserModel.authenticate(req.body.email, req.body.password);
    structuredLogger.logAuditEvent('UserLoggedIn', 'User logged in', { userId: user.id });
    res.json({ token: generateToken(user), user });
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      structuredLogger.logAuditEvent('LoginFailed', 'Failed login attempt', { email: String(req.body.email).toLowerCase() });
    }
    next(error);
  }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await UserModel.findById(req.user!.id);
    if (!user) throw new HttpError(404, 'User not found');
    res.json({ user, auth: { method: req.user!.method, scopes: req.user!.scopes } });
  } catch (error) {
    next(error);
  }
});

authRouter.patch('/me', requireAuth, validationMiddleware(userSchemas.update), async (req, res, next) => {
  try {
    if (req.user!.method !== 'jwt') throw new HttpError(403, 'Profile changes require a user session, not an API key');
    const user = await UserModel.update(req.user!.id, req.body);
    structuredLogger.logAuditEvent('UserUpdated', 'User profile updated', { userId: user.id, fields: Object.keys(req.body) });
    res.json({ user, token: generateToken(user) });
  } catch (error) {
    next(error);
  }
});

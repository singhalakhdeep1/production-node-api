import { Router } from 'express';
import { apiKeyService } from '../auth/api-key';
import { HttpError } from '../http-error';
import { requireAuth } from '../middleware/auth';
import { structuredLogger } from '../services/structured-logging/structured-logging.service';
import { apiKeySchemas, uuidParam, validationMiddleware } from '../validation/schemas';

export const apiKeysRouter = Router();

// Key management needs a real user session: an API key must not be able to mint more keys.
apiKeysRouter.use(requireAuth, (req, _res, next) => {
  next(req.user!.method === 'jwt' ? undefined : new HttpError(403, 'API keys can only be managed with a user session'));
});

apiKeysRouter.get('/', async (req, res, next) => {
  try {
    res.json({ items: await apiKeyService.getUserApiKeys(req.user!.id) });
  } catch (error) {
    next(error);
  }
});

apiKeysRouter.post('/', validationMiddleware(apiKeySchemas.create), async (req, res, next) => {
  try {
    const { name, scopes, expiresInDays } = req.body as { name: string; scopes: string[]; expiresInDays?: number };
    if (scopes.some((s) => s === 'admin' || s === '*') && req.user!.role !== 'admin') {
      throw new HttpError(403, 'Only admins can create keys with the admin or * scope');
    }
    const created = await apiKeyService.createApiKey(req.user!.id, name, scopes, expiresInDays);
    structuredLogger.logAuditEvent('ApiKeyCreated', 'API key created', { userId: req.user!.id, apiKeyId: created.id, scopes });
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

apiKeysRouter.delete('/:id', validationMiddleware(uuidParam, 'params'), async (req, res, next) => {
  try {
    const revoked = await apiKeyService.revokeApiKey(req.params.id, req.user!.id);
    if (!revoked) throw new HttpError(404, 'API key not found');
    structuredLogger.logAuditEvent('ApiKeyRevoked', 'API key revoked', { userId: req.user!.id, apiKeyId: revoked.id });
    res.json(revoked);
  } catch (error) {
    next(error);
  }
});

import { Router } from 'express';
import { requireAuth, requireScope } from '../middleware/auth';
import { principalRateLimiter } from '../middleware/rate-limit';
import { UploadController } from '../upload/controller';

export const uploadsRouter = Router();
uploadsRouter.use(requireAuth, principalRateLimiter);

uploadsRouter.get('/', requireScope('read'), UploadController.list);
uploadsRouter.post('/', requireScope('upload'), UploadController.uploadSingle);
uploadsRouter.post('/multiple', requireScope('upload'), UploadController.uploadMultiple);
uploadsRouter.delete('/:filename', requireScope('upload'), UploadController.deleteFile);

/** Mounted at /uploads: owner-only file download. */
export const filesRouter = Router();
filesRouter.get('/:filename', requireAuth, requireScope('read'), UploadController.download);

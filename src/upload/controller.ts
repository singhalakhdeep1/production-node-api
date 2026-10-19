import fs from 'node:fs/promises';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../http-error';
import { uploadsBytes } from '../metrics';
import { TodoModel } from '../models/todo';
import { UploadModel, type Upload } from '../models/upload';
import { structuredLogger } from '../services/structured-logging/structured-logging.service';
import { upload, uploadDir } from './multer';

const removeFiles = (files: Express.Multer.File[]) => Promise.all(files.map((f) => fs.rm(f.path, { force: true })));

async function persist(req: Request, files: Express.Multer.File[]): Promise<Upload[]> {
  const todoId = typeof req.body?.todoId === 'string' && req.body.todoId ? req.body.todoId : null;
  if (todoId && !(await TodoModel.findById(todoId, req.user!.id).catch(() => null))) {
    await removeFiles(files);
    throw new HttpError(404, 'Todo not found');
  }
  const saved: Upload[] = [];
  try {
    for (const file of files) {
      saved.push(await UploadModel.create({
        filename: file.filename,
        originalName: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        userId: req.user!.id,
        todoId,
      }));
      uploadsBytes.inc(file.size);
    }
  } catch (error) {
    await removeFiles(files);
    throw error;
  }
  structuredLogger.logAuditEvent('FilesUploaded', 'Files uploaded', { userId: req.user!.id, count: saved.length });
  return saved;
}

export class UploadController {
  static uploadSingle(req: Request, res: Response, next: NextFunction): void {
    upload.single('file')(req, res, async (err?: unknown) => {
      try {
        if (err) throw err;
        if (!req.file) throw new HttpError(400, 'No file uploaded (multipart field "file")');
        const [file] = await persist(req, [req.file]);
        res.status(201).json({ message: 'File uploaded successfully', file });
      } catch (error) {
        next(error);
      }
    });
  }

  static uploadMultiple(req: Request, res: Response, next: NextFunction): void {
    upload.array('files', 10)(req, res, async (err?: unknown) => {
      try {
        if (err) throw err;
        const files = (req.files as Express.Multer.File[] | undefined) ?? [];
        if (files.length === 0) throw new HttpError(400, 'No files uploaded (multipart field "files")');
        const saved = await persist(req, files);
        res.status(201).json({ message: 'Files uploaded successfully', files: saved, count: saved.length });
      } catch (error) {
        next(error);
      }
    });
  }

  static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const todoId = typeof req.query.todoId === 'string' ? req.query.todoId : undefined;
      res.json({ items: await UploadModel.listByUser(req.user!.id, todoId) });
    } catch (error) {
      next(error);
    }
  }

  /** Serves a file to its owner only (uploads are private). */
  static async download(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const filename = path.basename(req.params.filename);
      const record = await UploadModel.findByFilename(filename);
      if (!record || record.userId !== req.user!.id) throw new HttpError(404, 'File not found');
      res.setHeader('Content-Type', record.mimetype);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(record.originalName)}"`);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.sendFile(path.join(uploadDir, filename));
    } catch (error) {
      next(error);
    }
  }

  static async deleteFile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const filename = path.basename(req.params.filename);
      if (!(await UploadModel.delete(filename, req.user!.id))) throw new HttpError(404, 'File not found');
      await fs.rm(path.join(uploadDir, filename), { force: true });
      structuredLogger.logAuditEvent('FileDeleted', 'File deleted', { userId: req.user!.id, filename });
      res.json({ message: 'File deleted successfully' });
    } catch (error) {
      next(error);
    }
  }
}

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { config } from '../config';
import { HttpError } from '../http-error';

export const uploadDir = path.resolve(config.uploads.path);
fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED: Record<string, string[]> = {
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.gif': ['image/gif'],
  '.webp': ['image/webp'],
  '.pdf': ['application/pdf'],
  '.txt': ['text/plain'],
  '.csv': ['text/csv', 'application/vnd.ms-excel'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
});

export const upload = multer({
  storage,
  limits: { fileSize: config.uploads.maxFileSize, files: 10 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED[ext]?.includes(file.mimetype)) return cb(null, true);
    cb(new HttpError(415, `Unsupported file type ${ext || '(none)'} / ${file.mimetype}. Allowed: ${Object.keys(ALLOWED).join(', ')}`));
  },
});

export const allowedExtensions = Object.keys(ALLOWED);

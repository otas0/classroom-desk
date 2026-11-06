import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { getDataDir } from '../db/client.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { newId } from '../utils/id.js';

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.ms-excel',
  'application/zip',
]);

const ALLOWED_EXT = new Set([
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.txt',
  '.csv',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.zip',
]);

const uploadDir = () => path.join(getDataDir(), 'uploads');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = uploadDir();
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 20).toLowerCase();
    cb(null, `${newId()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeOk = ALLOWED_MIME.has(file.mimetype) || file.mimetype === 'application/octet-stream';
    const extOk = ALLOWED_EXT.has(ext);
    if (mimeOk && extOk) {
      cb(null, true);
      return;
    }
    cb(new Error('mime_not_allowed'));
  },
});

export const uploadsRouter = Router();

uploadsRouter.post(
  '/api/v1/uploads',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res, next) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err) {
        const message = err instanceof Error ? err.message : 'upload_failed';
        res.status(400).json({ error: message === 'mime_not_allowed' ? 'mime_not_allowed' : 'upload_failed' });
        return;
      }
      next();
    });
  },
  (req: AuthedRequest, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'file_required' });
      return;
    }
    const url = `/uploads/${req.file.filename}`;
    res.status(201).json({
      url,
      originalName: req.file.originalname,
      size: req.file.size,
      mime: req.file.mimetype,
    });
  },
);

uploadsRouter.get('/api/v1/uploads/allowed-types', requireAuth, (_req, res) => {
  res.json({ mime: [...ALLOWED_MIME], extensions: [...ALLOWED_EXT] });
});

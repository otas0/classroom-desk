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
  'image/gif',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/zip',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'video/mp4',
  'video/webm',
]);

const ALLOWED_EXT = new Set([
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.txt',
  '.md',
  '.csv',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.zip',
  '.mp3',
  '.m4a',
  '.wav',
  '.mp4',
  '.webm',
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
        const zh =
          message === 'mime_not_allowed'
            ? '不支持的文件类型。允许：pdf/图片/Office/音视频/zip/txt/md/csv'
            : message.includes('File too large')
              ? '单文件不能超过 10MB'
              : '上传失败';
        res.status(400).json({
          error: message === 'mime_not_allowed' ? 'mime_not_allowed' : 'upload_failed',
          message: zh,
        });
        return;
      }
      next();
    });
  },
  (req: AuthedRequest, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'file_required', message: '未收到文件' });
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

/** Upload several classroom files in one request (questions / materials). */
uploadsRouter.post(
  '/api/v1/uploads/batch',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res, next) => {
    upload.array('files', 12)(req, res, (err: unknown) => {
      if (err) {
        const message = err instanceof Error ? err.message : 'upload_failed';
        res.status(400).json({
          error: message === 'mime_not_allowed' ? 'mime_not_allowed' : 'upload_failed',
          message:
            message === 'mime_not_allowed'
              ? '含有不支持的文件类型'
              : message.includes('File too large')
                ? '单文件不能超过 10MB'
                : '批量上传失败',
        });
        return;
      }
      next();
    });
  },
  (req: AuthedRequest, res) => {
    const files = (req.files ?? []) as Array<{
      filename: string;
      originalname: string;
      size: number;
      mimetype: string;
    }>;
    if (!files.length) {
      res.status(400).json({ error: 'file_required', message: '未收到文件' });
      return;
    }
    res.status(201).json({
      items: files.map((f) => ({
        url: `/uploads/${f.filename}`,
        originalName: f.originalname,
        size: f.size,
        mime: f.mimetype,
      })),
    });
  },
);

uploadsRouter.get('/api/v1/uploads/allowed-types', requireAuth, (_req, res) => {
  res.json({ mime: [...ALLOWED_MIME], extensions: [...ALLOWED_EXT] });
});

import { createHash } from 'node:crypto';
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { GITHUB_RELEASES_BASE } from '@classroom-desk/shared';
import { getDataDir, openDb } from '../db/client.js';
import { getSetting } from '../db/migrate.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { packageVersion } from './health.js';

export const upgradesRouter = Router();

function upgradesDir(): string {
  return process.env.CLASSROOM_DESK_UPGRADES_DIR
    ? path.resolve(process.env.CLASSROOM_DESK_UPGRADES_DIR)
    : path.join(getDataDir(), 'upgrades');
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = upgradesDir();
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const safe = path.basename(file.originalname).replace(/[^\w.\-()+ ]+/g, '_');
      cb(null, safe || `upgrade-${Date.now()}.exe`);
    },
  }),
  limits: { fileSize: 250 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(exe|sha256|json|msi|zip)$/i.test(file.originalname);
    if (ok) cb(null, true);
    else cb(new Error('unsupported_file'));
  },
});

function publicBase(req: AuthedRequest): string {
  const configured = getSetting(openDb(), 'lan_upgrade_base')?.trim();
  if (configured) return configured.replace(/\/$/, '');
  const host = req.get('host') || '127.0.0.1:8787';
  const proto = req.protocol || 'http';
  return `${proto}://${host}`;
}

upgradesRouter.get('/api/v1/upgrades', requireAuth, requireRoles('teacher', 'admin', 'assistant'), (req: AuthedRequest, res) => {
  const dir = upgradesDir();
  fs.mkdirSync(dir, { recursive: true });
  const expected = packageVersion();
  const files = fs
    .readdirSync(dir)
    .filter((n) => !n.startsWith('.'))
    .map((name) => {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      return {
        name,
        size: st.size,
        mtime: st.mtime.toISOString(),
        url: `${publicBase(req)}/upgrades/${encodeURIComponent(name)}`,
      };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
  const setup = files.find((f) => /Setup.*\.exe$/i.test(f.name) || /ClassroomDesk.*\.exe$/i.test(f.name));
  res.json({
    expectedVersion: expected,
    dir,
    files,
    preferredLanUrl: setup?.url ?? null,
    githubReleaseUrl: `${GITHUB_RELEASES_BASE}/tag/v${expected}`,
    tipTemplate: setup
      ? `请从教室局域网安装：${setup.url}（应对齐 v${expected}）`
      : `请从 Release 安装 v${expected}：${GITHUB_RELEASES_BASE}/tag/v${expected}`,
  });
});

upgradesRouter.post(
  '/api/v1/upgrades',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        res.status(400).json({ error: 'upload_failed', message: err instanceof Error ? err.message : String(err) });
        return;
      }
      next();
    });
  },
  (req: AuthedRequest, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'file_required' });
      return;
    }
    let sha256Name: string | null = null;
    if (/\.exe$/i.test(file.filename)) {
      const hash = createHash('sha256').update(fs.readFileSync(file.path)).digest('hex');
      sha256Name = `${file.filename}.sha256`;
      fs.writeFileSync(path.join(upgradesDir(), sha256Name), `${hash}  ${file.filename}\n`, 'utf8');
    }
    res.status(201).json({
      ok: true,
      name: file.filename,
      size: file.size,
      url: `${publicBase(req)}/upgrades/${encodeURIComponent(file.filename)}`,
      sha256Name,
      sha256Url: sha256Name
        ? `${publicBase(req)}/upgrades/${encodeURIComponent(sha256Name)}`
        : null,
    });
  },
);

/** Mount static upgrades in createApp via express.static — this route is authenticated listing only. */

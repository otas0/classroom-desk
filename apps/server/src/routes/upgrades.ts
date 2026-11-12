import { createHash } from 'node:crypto';
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { GITHUB_RELEASES_BASE } from '@classroom-desk/shared';
import { getDataDir, openDb } from '../db/client.js';
import { getSetting } from '../db/migrate.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { upsertSetting } from '../services/exitLock.js';
import { writeAudit } from '../services/audit.js';
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

function listUpgradeFiles(req: AuthedRequest) {
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
  const shaName = setup ? `${setup.name}.sha256` : null;
  const shaFile = shaName ? files.find((f) => f.name === shaName) : null;
  const autoUpdate = (getSetting(openDb(), 'student_auto_update') ?? '1') === '1';
  return {
    expectedVersion: expected,
    dir,
    files,
    preferredLanUrl: setup?.url ?? null,
    preferredLanSha256Url: shaFile?.url ?? null,
    preferredLanName: setup?.name ?? null,
    studentAutoUpdate: autoUpdate,
    githubReleaseUrl: `${GITHUB_RELEASES_BASE}/tag/v${expected}`,
    tipTemplate: setup
      ? `请从教室局域网安装：${setup.url}（应对齐 v${expected}）`
      : `请从 Release 安装 v${expected}：${GITHUB_RELEASES_BASE}/tag/v${expected}`,
  };
}

/** Public latest LAN package (no auth) — students use for drift banner / teacher-forced sync. */
upgradesRouter.get('/api/v1/upgrades/latest', (req: AuthedRequest, res) => {
  const info = listUpgradeFiles(req);
  res.json({
    expectedVersion: info.expectedVersion,
    preferredLanUrl: info.preferredLanUrl,
    preferredLanSha256Url: info.preferredLanSha256Url,
    preferredLanName: info.preferredLanName,
    studentAutoUpdate: info.studentAutoUpdate,
    githubReleaseUrl: info.githubReleaseUrl,
    tipTemplate: info.tipTemplate,
  });
});

upgradesRouter.get('/api/v1/upgrades', requireAuth, requireRoles('teacher', 'admin', 'assistant'), (req: AuthedRequest, res) => {
  res.json(listUpgradeFiles(req));
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
    let pruned: string[] = [];
    let forceSyncEnabled = false;
    if (/\.exe$/i.test(file.filename)) {
      const hash = createHash('sha256').update(fs.readFileSync(file.path)).digest('hex');
      sha256Name = `${file.filename}.sha256`;
      fs.writeFileSync(path.join(upgradesDir(), sha256Name), `${hash}  ${file.filename}\n`, 'utf8');
      const db = openDb();
      const keep = Number(getSetting(db, 'upgrades_keep_count') ?? process.env.CLASSROOM_DESK_UPGRADES_KEEP ?? 3);
      pruned = pruneOldSetupExes(Number.isFinite(keep) ? Math.max(1, Math.min(20, Math.trunc(keep))) : 3);
      // Teacher uploaded a new Setup → turn on forced same-version (teacher > student).
      upsertSetting(db, 'student_auto_update', '1');
      forceSyncEnabled = true;
      writeAudit({
        actorUserId: req.user?.id,
        actorRole: req.user?.role,
        action: 'settings.student_auto_update',
        detail: { studentAutoUpdate: true, reason: 'setup_upload' },
        clientIp: req.ip,
      });
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
      pruned,
      studentAutoUpdate: forceSyncEnabled
        ? true
        : (getSetting(openDb(), 'student_auto_update') ?? '1') === '1',
    });
  },
);

const KEEP_SETUP = Number(process.env.CLASSROOM_DESK_UPGRADES_KEEP ?? 3);

/** Keep newest N Setup*.exe (+ paired .sha256); delete older. */
export function pruneOldSetupExes(keep = KEEP_SETUP): string[] {
  const dir = upgradesDir();
  let names: string[];
  try {
    if (!fs.existsSync(dir)) return [];
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const exes = names
    .filter((n) => /\.exe$/i.test(n) && (/Setup/i.test(n) || /ClassroomDesk/i.test(n)))
    .map((name) => {
      const full = path.join(dir, name);
      return { name, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  const removed: string[] = [];
  for (const row of exes.slice(Math.max(1, keep))) {
    try {
      fs.unlinkSync(path.join(dir, row.name));
      removed.push(row.name);
      const side = `${row.name}.sha256`;
      if (fs.existsSync(path.join(dir, side))) {
        fs.unlinkSync(path.join(dir, side));
        removed.push(side);
      }
    } catch {
      /* ignore */
    }
  }
  return removed;
}

upgradesRouter.delete(
  '/api/v1/upgrades/:name',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const name = path.basename(String(req.params.name ?? ''));
    if (!name || name.startsWith('.')) {
      res.status(400).json({ error: 'invalid_name' });
      return;
    }
    const full = path.join(upgradesDir(), name);
    if (!fs.existsSync(full)) {
      res.status(404).json({ error: 'file_not_found' });
      return;
    }
    fs.unlinkSync(full);
    const side = path.join(upgradesDir(), `${name}.sha256`);
    let removedSha: string | null = null;
    if (/\.exe$/i.test(name) && fs.existsSync(side)) {
      fs.unlinkSync(side);
      removedSha = `${name}.sha256`;
    }
    res.json({ ok: true, removed: name, removedSha256: removedSha });
  },
);

/** Verify an .exe against its paired .sha256 (or recompute). */
upgradesRouter.post(
  '/api/v1/upgrades/verify-sha256',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const name = path.basename(String(req.body?.name ?? ''));
    if (!name || !/\.exe$/i.test(name)) {
      res.status(400).json({ error: 'exe_name_required' });
      return;
    }
    const full = path.join(upgradesDir(), name);
    if (!fs.existsSync(full)) {
      res.status(404).json({ error: 'file_not_found' });
      return;
    }
    const actual = createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    const sidePath = path.join(upgradesDir(), `${name}.sha256`);
    let expected: string | null = null;
    let sideExists = false;
    if (fs.existsSync(sidePath)) {
      sideExists = true;
      const text = fs.readFileSync(sidePath, 'utf8').trim();
      expected = (text.split(/\s+/)[0] || '').toLowerCase();
    }
    const match = expected != null && expected === actual.toLowerCase();
    res.json({
      ok: true,
      name,
      actual,
      expected,
      sideExists,
      match: sideExists ? match : null,
      message: !sideExists
        ? '无配对 .sha256（可重新上传 exe 自动生成）'
        : match
          ? '哈希一致'
          : '哈希不匹配',
    });
  },
);

/** Mount static upgrades in createApp via express.static — this route is authenticated listing only. */

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
import {
  checkLatestRelease,
  getReleaseStatusSummary,
  pullLatestReleaseToUpgrades,
} from '../services/githubRelease.js';
import {
  applyTeacherHostCodeUpdate,
  scheduleTeacherHostRestart,
  teacherSelfUpdateEnabled,
} from '../services/teacherHostUpdate.js';
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
    filename: (req, file, cb) => {
      let safe = path.basename(file.originalname).replace(/[^\w.\-()+ ]+/g, '_');
      const archField = String((req as { body?: { arch?: string } }).body?.arch ?? '')
        .trim()
        .toLowerCase();
      if (/\.exe$/i.test(safe) && (archField === 'x64' || archField === 'arm64')) {
        const archTag = archField === 'arm64' ? '-arm64' : '-x64';
        if (!new RegExp(`${archTag}\\.`, 'i').test(safe) && !/arm64|x64|amd64/i.test(safe)) {
          safe = safe.replace(/\.exe$/i, `${archTag}.exe`);
        }
      }
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

function detectArch(name: string): 'arm64' | 'x64' | 'unknown' {
  if (/-arm64\./i.test(name) || /arm64/i.test(name)) return 'arm64';
  if (/-x64\./i.test(name) || /x64|amd64/i.test(name)) return 'x64';
  // Legacy unsuffixed Setup → treat as x64 alias.
  if (/ClassroomDesk-Setup-[\d.]+\.exe$/i.test(name)) return 'x64';
  return 'unknown';
}

function listUpgradeFiles(req: AuthedRequest, preferArch?: string) {
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
        arch: detectArch(name),
      };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
  const setups = files.filter(
    (f) => /Setup.*\.exe$/i.test(f.name) || /ClassroomDesk.*\.exe$/i.test(f.name),
  );
  const arch = preferArch === 'arm64' || preferArch === 'x64' ? preferArch : '';
  const setup =
    (arch ? setups.find((f) => f.arch === arch) : null) ||
    setups.find((f) => f.arch === 'x64') ||
    setups[0] ||
    null;
  const shaName = setup ? `${setup.name}.sha256` : null;
  const shaFile = shaName ? files.find((f) => f.name === shaName) : null;
  const autoUpdate = (getSetting(openDb(), 'student_auto_update') ?? '1') === '1';
  const byArch = {
    x64: setups.find((f) => f.arch === 'x64') ?? null,
    arm64: setups.find((f) => f.arch === 'arm64') ?? null,
  };
  return {
    expectedVersion: expected,
    dir,
    files,
    preferredLanUrl: setup?.url ?? null,
    preferredLanSha256Url: shaFile?.url ?? null,
    preferredLanName: setup?.name ?? null,
    preferredArch: setup?.arch ?? null,
    byArch,
    studentAutoUpdate: autoUpdate,
    githubReleaseUrl: `${GITHUB_RELEASES_BASE}/tag/v${expected}`,
    tipTemplate: setup
      ? `请从教室局域网安装：${setup.url}（应对齐 v${expected}${setup.arch !== 'unknown' ? ` · ${setup.arch}` : ''}）`
      : `请从 Release 安装 v${expected}：${GITHUB_RELEASES_BASE}/tag/v${expected}`,
  };
}

/** Public latest LAN package (no auth) — students use for drift banner / teacher-forced sync. */
upgradesRouter.get('/api/v1/upgrades/latest', (req: AuthedRequest, res) => {
  const arch = String(req.query.arch ?? '').trim().toLowerCase();
  const info = listUpgradeFiles(req, arch);
  const release = getReleaseStatusSummary();
  res.json({
    expectedVersion: info.expectedVersion,
    preferredLanUrl: info.preferredLanUrl,
    preferredLanSha256Url: info.preferredLanSha256Url,
    preferredLanName: info.preferredLanName,
    preferredArch: info.preferredArch,
    byArch: info.byArch,
    studentAutoUpdate: info.studentAutoUpdate,
    githubReleaseUrl: info.githubReleaseUrl,
    tipTemplate: info.tipTemplate,
    releaseUpdateAvailable: release.updateAvailable,
    releaseLatestTag: release.latest?.tag ?? null,
    studentGetUrl: `${publicBase(req)}/get`,
  });
});

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Extreme-simple student download page (no login). One big button + apiBase. */
function buildStudentGetHtml(req: AuthedRequest): string {
  const info = listUpgradeFiles(req);
  const base = publicBase(req);
  const x64 = info.byArch.x64;
  const arm64 = info.byArch.arm64;
  const primary = x64 ?? arm64 ?? null;
  const ver = escapeHtml(info.expectedVersion);
  const apiBase = escapeHtml(base);
  const gh = escapeHtml(info.githubReleaseUrl);
  const primaryHref = primary?.url ? escapeHtml(primary.url) : gh;
  const primaryLabel = primary
    ? `下载学生端（${escapeHtml(primary.arch)}）`
    : '打开 GitHub 下载（教室暂无局域网包）';
  const x64Btn = x64
    ? `<a class="btn" href="${escapeHtml(x64.url)}">下载 x64</a>`
    : '';
  const armBtn = arm64
    ? `<a class="btn secondary" href="${escapeHtml(arm64.url)}">下载 ARM64</a>`
    : '';
  const lanHint = primary
    ? `<p class="meta">教室局域网包已就绪 · v${ver}</p>`
    : `<p class="meta">教师机联网后会自动拉包；也可打开 <a href="${gh}">GitHub Release</a></p>`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>下载学生端 · Classroom Desk</title>
  <style>
    :root { color-scheme: light; font-family: "PingFang SC", "Microsoft YaHei", sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center;
      background: linear-gradient(160deg, #e8f1ff 0%, #f7fafc 45%, #eef6f0 100%); color: #111; }
    main { width: min(28rem, 92vw); padding: 2rem 1.75rem; border-radius: 1.1rem;
      background: #fff; box-shadow: 0 12px 40px rgba(15,40,80,.1); text-align: center; }
    h1 { margin: 0 0 .35rem; font-size: 1.55rem; letter-spacing: -.02em; }
    .lead { margin: 0 0 1.25rem; color: #444; line-height: 1.45; font-size: .98rem; }
    .btn { display: inline-block; margin: .35rem .25rem; padding: .85rem 1.35rem; font-size: 1.05rem;
      font-weight: 600; text-decoration: none; color: #fff; background: #1a5fb4; border-radius: .65rem; }
    .btn.secondary { background: #3d4f5f; }
    .btn.ghost { background: transparent; color: #1a5fb4; border: 1px solid #b6c7db; }
    .api { margin: 1.25rem 0 .4rem; padding: .65rem .75rem; background: #f4f6f8; border-radius: .5rem;
      font-family: ui-monospace, Consolas, monospace; font-size: .92rem; word-break: break-all; }
    .meta { color: #666; font-size: .9rem; margin: .5rem 0; line-height: 1.4; }
    .steps { text-align: left; margin: 1.1rem 0 0; padding: 0 0 0 1.1rem; color: #333; font-size: .92rem; }
    .steps li { margin: .35rem 0; }
  </style>
</head>
<body>
  <main>
    <h1>下载学生端</h1>
    <p class="lead">装完后打开客户端，会自动找教室。无需改设置。</p>
    <p><a class="btn" data-testid="get-primary-dl" href="${primaryHref}">${primaryLabel}</a></p>
    <p>${x64Btn}${armBtn}</p>
    ${lanHint}
    <p class="api" data-testid="get-apibase">${apiBase}</p>
    <p class="meta">上面是教室地址（apiBase）。学生端「找教室」一般不用手填。</p>
    <ol class="steps">
      <li>点上方按钮安装（勿关 Defender）</li>
      <li>打开 Classroom Desk → 找教室 / 扫码</li>
      <li>有新版本时会自动从教室更新</li>
    </ol>
    <p style="margin-top:1.25rem">
      <a class="btn ghost" href="/ready">课前连通检测</a>
    </p>
  </main>
</body>
</html>`;
}

/** Public student download — zero settings. */
upgradesRouter.get('/get', (req: AuthedRequest, res) => {
  res.type('html').send(buildStudentGetHtml(req));
});

upgradesRouter.get('/download', (_req, res) => {
  res.redirect(302, '/get');
});

/** Cached / live GitHub latest release (teacher). */
upgradesRouter.get(
  '/api/v1/upgrades/release-check',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  async (req: AuthedRequest, res) => {
    try {
      const force = req.query.refresh === '1' || req.query.refresh === 'true';
      const result = await checkLatestRelease({ force });
      const lan = listUpgradeFiles(req);
      res.json({
        ok: true,
        localVersion: result.localVersion,
        latestTag: result.latest.tag,
        latestName: result.latest.name,
        htmlUrl: result.latest.htmlUrl,
        publishedAt: result.latest.publishedAt,
        checkedAt: result.latest.checkedAt,
        updateAvailable: result.updateAvailable,
        fromCache: result.fromCache,
        setupAssets: result.latest.assets
          .filter((a) => /\.exe$/i.test(a.name) && (/Setup/i.test(a.name) || /ClassroomDesk/i.test(a.name)))
          .map((a) => ({ name: a.name, size: a.size })),
        lanByArch: lan.byArch,
        studentAutoUpdate: lan.studentAutoUpdate,
      });
    } catch (e) {
      const summary = getReleaseStatusSummary();
      res.status(502).json({
        ok: false,
        error: 'release_check_failed',
        message: e instanceof Error ? e.message : String(e),
        ...summary,
        githubReleaseUrl: `${GITHUB_RELEASES_BASE}/latest`,
      });
    }
  },
);

/**
 * One-click: pull latest GitHub Release Setup into LAN upgrades dir,
 * optionally update teacher host checkout to the same tag and restart API.
 * Skips unchanged student assets (size + sha). Enables student force sync.
 */
upgradesRouter.post(
  '/api/v1/upgrades/pull-release',
  requireAuth,
  requireRoles('teacher', 'admin'),
  async (req: AuthedRequest, res) => {
    try {
      const archesRaw = req.body?.arches;
      const arches = Array.isArray(archesRaw)
        ? archesRaw
            .map((x: unknown) => String(x).toLowerCase())
            .filter((x: string): x is 'x64' | 'arm64' => x === 'x64' || x === 'arm64')
        : undefined;
      const updateTeacher =
        req.body?.updateTeacherHost !== false &&
        req.body?.updateTeacherHost !== 0 &&
        req.body?.updateTeacherHost !== '0' &&
        teacherSelfUpdateEnabled();

      const pulled = await pullLatestReleaseToUpgrades({ arches });

      let teacherHost: Awaited<ReturnType<typeof applyTeacherHostCodeUpdate>> | null = null;
      let restart: ReturnType<typeof scheduleTeacherHostRestart> | null = null;
      if (updateTeacher) {
        teacherHost = await applyTeacherHostCodeUpdate(pulled.tag);
        if (teacherHost.ok && !teacherHost.skipped) {
          restart = scheduleTeacherHostRestart({ delayMs: 2500 });
        }
      }

      writeAudit({
        actorUserId: req.user?.id,
        actorRole: req.user?.role,
        action: 'upgrades.pull_release',
        detail: {
          tag: pulled.tag,
          downloaded: pulled.downloaded,
          skipped: pulled.skipped,
          pruned: pulled.pruned,
          teacherHost,
          restartScheduled: Boolean(restart?.restartScheduled),
        },
        clientIp: req.ip,
      });
      const lan = listUpgradeFiles(req);
      const teacherMsg =
        teacherHost?.skipped
          ? '；教师机自更新已关闭'
          : teacherHost?.ok
            ? `；教师机已切到 ${pulled.tag}，约 3 秒后自动重启 API`
            : teacherHost
              ? `；教师机更新失败：${teacherHost.reason || teacherHost.detail || 'error'}`
              : '';
      res.json({
        ok: true,
        ...pulled,
        byArch: lan.byArch,
        files: lan.files.map((f) => f.name),
        tipTemplate: lan.tipTemplate,
        teacherHost,
        restartScheduled: Boolean(restart?.restartScheduled),
        message: `已同步 GitHub ${pulled.tag}：下载 ${pulled.downloaded.length}，跳过 ${pulled.skipped.length}（增量）${teacherMsg}`,
      });

      if (restart?.restartScheduled) {
        setTimeout(() => {
          try {
            process.exit(0);
          } catch {
            /* ignore */
          }
        }, 1200);
      }
    } catch (e) {
      res.status(502).json({
        ok: false,
        error: 'pull_release_failed',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  },
);

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

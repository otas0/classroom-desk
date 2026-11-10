import { Router } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { getDataDir, getDbPath, openDb } from '../db/client.js';
import { getSetting } from '../db/migrate.js';
import { readAuditWriteFailure } from '../services/auditFail.js';
import { auditRetryHealth } from '../services/auditRetry.js';
import { exportTempStats } from '../utils/exportTempTracker.js';
import { config } from '../config.js';
import { getDeskDnsStatus } from '../services/deskDns.js';
import { getShieldConnector, listShieldAdapterIds } from '../services/shield/registry.js';

export const healthRouter = Router();

export function packageVersion(): string {
  try {
    const rootPkg = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../../package.json',
    );
    const raw = JSON.parse(fs.readFileSync(rootPkg, 'utf8')) as { version?: string };
    return String(raw.version ?? '0.0.0');
  } catch {
    return '0.0.0';
  }
}

function lanIpv4List(): string[] {
  try {
    const out: string[] = [];
    for (const list of Object.values(networkInterfaces())) {
      for (const n of list ?? []) {
        if (String(n.family) === 'IPv4' && !n.internal) out.push(n.address);
      }
    }
    return out;
  } catch {
    return [];
  }
}

function backupDirPath(): string {
  return process.env.CLASSROOM_DESK_BACKUP_DIR
    ? path.resolve(process.env.CLASSROOM_DESK_BACKUP_DIR)
    : path.join(getDataDir(), 'backups');
}

function latestBackupInfo(): {
  path: string | null;
  at: string | null;
  ageHours: number | null;
  lastError: { at: string; message: string } | null;
} {
  const backupDir = backupDirPath();
  let lastError: { at: string; message: string } | null = null;
  const errFile = path.join(backupDir, 'last-error.json');
  if (fs.existsSync(errFile)) {
    try {
      const raw = JSON.parse(fs.readFileSync(errFile, 'utf8')) as { at?: string; message?: string };
      if (raw.message) lastError = { at: String(raw.at ?? ''), message: String(raw.message) };
    } catch {
      lastError = { at: new Date().toISOString(), message: 'unreadable last-error.json' };
    }
  }
  if (!fs.existsSync(backupDir)) {
    return { path: null, at: null, ageHours: null, lastError };
  }
  const files = fs
    .readdirSync(backupDir)
    .filter((name) => /^classroom-.*\.db$/.test(name))
    .map((name) => {
      const full = path.join(backupDir, name);
      const st = fs.statSync(full);
      return { full, mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  const newest = files[0];
  if (!newest) return { path: null, at: null, ageHours: null, lastError };
  const at = new Date(newest.mtime).toISOString();
  const ageHours = Number(((Date.now() - newest.mtime) / 3_600_000).toFixed(2));
  return { path: newest.full, at, ageHours, lastError };
}

function buildHealthPayload() {
  const db = openDb();
  let dbOk = false;
  let tableCount = 0;

  try {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table'`).get() as {
      c: number;
    };
    tableCount = Number(row.c);
    db.prepare('SELECT 1 AS ok').get();
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const backup = latestBackupInfo();
  const auditLastError = readAuditWriteFailure();
  const auditRetry = auditRetryHealth();
  const exportTmp = exportTempStats();
  const detected = lanIpv4List();
  const storedBase = getSetting(db, 'classroom_api_base')?.replace(/\/$/, '') ?? '';
  let fromStored = '';
  try {
    if (storedBase) fromStored = new URL(storedBase).hostname;
  } catch {
    fromStored = '';
  }
  const lanIps = detected.length ? detected : fromStored && fromStored !== '127.0.0.1' ? [fromStored] : [];
  const suggestedApiBase =
    storedBase ||
    (lanIps[0] ? `http://${lanIps[0]}:${config.port}` : `http://127.0.0.1:${config.port}`);
  const teacherDistCandidates = [
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../teacher-web/dist'),
    path.resolve(getDataDir(), '../teacher-web/dist'),
  ];
  let permissionsMd = false;
  for (const dist of teacherDistCandidates) {
    if (fs.existsSync(path.join(dist, 'PERMISSIONS.md'))) {
      permissionsMd = true;
      break;
    }
  }
  const degraded = Boolean(auditLastError) || auditRetry.degraded || exportTmp.tmpLeaked > 0;
  const deskDns = getDeskDnsStatus();
  const shield = getShieldConnector();
  return {
    ok: dbOk,
    degraded,
    service: 'classroom-desk-server',
    version: packageVersion(),
    studentDesktopVersion: packageVersion(),
    engine: 'node:sqlite',
    time: new Date().toISOString(),
    hostName: os.hostname(),
    lanIps,
    suggestedApiBase,
    studentHealthUrl: `${suggestedApiBase}/health`,
    studentReadyUrl: `${suggestedApiBase}/ready`,
    db: {
      ok: dbOk,
      path: getDbPath(),
      tableCount,
      schemaVersion: getSetting(db, 'schema_version'),
      pointRequestTtlMinutes: Number(getSetting(db, 'point_request_ttl_minutes') ?? 60),
      dailyCleanupTime: getSetting(db, 'point_request_daily_cleanup_time'),
    },
    backup: {
      latestPath: backup.path,
      latestAt: backup.at,
      ageHours: backup.ageHours,
      lastError: backup.lastError,
    },
    audit: {
      lastError: auditLastError,
      ...auditRetry,
    },
    exportTmp,
    admin: {
      permissionsMd,
      permissionsUrl: '/admin/PERMISSIONS.md',
    },
    lastCleanupAt: getSetting(db, 'last_cleanup_at'),
    deskDns: {
      enabled: deskDns.enabled,
      running: deskDns.running,
      port: deskDns.port,
      error: deskDns.error,
    },
    shield: {
      active: shield.id,
      displayName: shield.displayName,
      adapters: listShieldAdapterIds(),
    },
  };
}

function wantsHtml(req: { headers: { accept?: string }; query: Record<string, unknown> }): boolean {
  if (String(req.query.view ?? '') === 'html' || String(req.query.format ?? '') === 'html') return true;
  const accept = String(req.headers.accept ?? '');
  if (!accept || accept === '*/*') return false;
  return accept.includes('text/html') && !accept.includes('application/json');
}

function healthHtmlPage(payload: ReturnType<typeof buildHealthPayload>): string {
  const ok = Boolean(payload.ok);
  const err = payload.backup.lastError;
  const title = ok ? '上课前检测 · 通过' : '上课前检测 · 未通过';
  const tone = ok ? '#0f7a3a' : '#b42318';
  const bg = ok ? '#ecfdf3' : '#fef3f2';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root { color-scheme: light; font-family: "PingFang SC", "Microsoft YaHei", sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: ${bg}; color: #111; }
    main { width: min(36rem, 92vw); padding: 2rem; border-radius: 1rem; background: #fff; box-shadow: 0 8px 30px rgba(0,0,0,.08); }
    h1 { margin: 0 0 .5rem; font-size: 1.75rem; color: ${tone}; }
    p { margin: .4rem 0; line-height: 1.5; }
    .meta { color: #555; font-size: .95rem; }
    code { background: #f4f4f5; padding: .1rem .35rem; border-radius: .3rem; }
    button { margin-top: 1rem; font-size: 1rem; padding: .55rem 1rem; cursor: pointer; }
  </style>
</head>
<body>
  <main>
    <h1>${ok ? '✓ 可以上课' : '✗ 连不上教师机'}</h1>
    <p>${ok ? '本机浏览器已连通教室服务器。请关闭本页，打开课堂客户端。' : '请告诉老师：检查教师机是否开机、防火墙、是否同一 Wi‑Fi，并关闭 AP/访客隔离。'}</p>
    <p class="meta">时间：${payload.time}</p>
    <p class="meta">数据库：${payload.db.ok ? '正常' : '异常'} · 备份：${payload.backup.latestAt ?? '无'}${err ? ` · 备份错误：${String(err.message)}` : ''}</p>
    <p class="meta">DeskDNS：${payload.deskDns.enabled ? (payload.deskDns.running ? `运行中 udp/${payload.deskDns.port}` : `已启用未绑定${payload.deskDns.error ? `（${payload.deskDns.error}）` : ''}`) : '未启用'} · Shield：${payload.shield.displayName}（${payload.shield.active}）</p>
    <p class="meta">接口：<code>/health</code>（JSON 客户端仍返回 JSON）</p>
    <button type="button" onclick="location.reload()">重新检测</button>
  </main>
</body>
</html>`;
}

function sendHealth(req: { headers: { accept?: string }; query: Record<string, unknown> }, res: import('express').Response) {
  const payload = buildHealthPayload();
  const status = payload.ok ? 200 : 503;
  if (wantsHtml(req)) {
    res.status(status).type('html').send(healthHtmlPage(payload));
    return;
  }
  res.status(status).json(payload);
}

/** Browser-friendly pre-class gate (每台学生机浏览器上课前打开). */
healthRouter.get('/ready', (req, res) => {
  req.query.view = 'html';
  sendHealth(req, res);
});

healthRouter.get('/health', (req, res) => {
  sendHealth(req, res);
});

/**
 * DeskDNS :53 / bind acceptance for teacher UI one-click.
 * Runs ss -ulnp when available (Linux); always returns /health deskDns block.
 */
healthRouter.get('/api/v1/health/deskdns-check', async (_req, res) => {
  const deskDns = getDeskDnsStatus();
  let probe = '';
  let probeTool: 'ss' | 'lsof' | 'none' = 'none';
  let listening53: boolean | null = null;
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  try {
    const { stdout } = await execFileAsync('ss', ['-ulnp'], {
      timeout: 3_000,
      maxBuffer: 512_000,
    });
    probe = String(stdout).slice(0, 4_000);
    probeTool = 'ss';
    listening53 = /:53\b/.test(probe);
  } catch {
    // macOS / BSD: fall back to lsof
    try {
      const { stdout } = await execFileAsync('lsof', ['-nP', '-iUDP:53'], {
        timeout: 3_000,
        maxBuffer: 512_000,
      });
      probe = String(stdout).slice(0, 4_000);
      probeTool = 'lsof';
      listening53 = /UDP.*:53\b|:53\b/i.test(probe) && probe.trim().length > 0;
      if (!probe.trim()) listening53 = false;
    } catch (e2) {
      // Also try 5353 for lab default
      try {
        const { stdout } = await execFileAsync('lsof', ['-nP', '-iUDP:5353'], {
          timeout: 3_000,
          maxBuffer: 256_000,
        });
        probe = String(stdout).slice(0, 4_000);
        probeTool = 'lsof';
        if (deskDns.port === 53) listening53 = false;
        else listening53 = probe.trim().length > 0 ? true : false;
      } catch {
        probe = e2 instanceof Error ? e2.message : 'probe_unavailable';
        listening53 = null;
      }
    }
  }
  const ok =
    !deskDns.enabled ||
    (deskDns.running && (deskDns.port !== 53 || listening53 !== false));
  res.status(ok ? 200 : 503).json({
    ok,
    deskDns,
    listening53,
    probeTool,
    ssSample: probe
      .split('\n')
      .filter((l) => /:53\b|:5353\b|UNCONN|udp|UDP|COMMAND/i.test(l))
      .slice(0, 20),
    hint:
      deskDns.port === 53 && listening53 === false
        ? 'CLASSROOM_DESK_DNS_PORT=53 but no udp/53 listener — see docs/DESKDNS_PORT53.md'
        : null,
  });
});

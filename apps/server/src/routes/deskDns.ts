import { spawnSync } from 'node:child_process';
import { Router } from 'express';
import { openDb } from '../db/client.js';
import { getSetting } from '../db/migrate.js';
import { getDeskDnsResolveSnapshot, getDeskDnsStatus } from '../services/deskDns.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { upsertSetting } from '../services/exitLock.js';

export const deskDnsRouter = Router();

const PROFILE_KEY = 'deskdns_profile';
const PROFILES = new Set(['exam', 'normal', 'open']);

function probePort53(): { pid?: number; cmd?: string; hint?: string } | null {
  try {
    const r = spawnSync('lsof', ['-nP', '-iUDP:53'], { encoding: 'utf8' });
    const lines = (r.stdout || '').split('\n').filter(Boolean);
    if (lines.length <= 1) return null;
    const parts = lines[1]!.split(/\s+/);
    const cmd = parts[0];
    const pid = Number(parts[1]);
    return {
      pid: Number.isFinite(pid) ? pid : undefined,
      cmd,
      hint: '改绑 CLASSROOM_DESK_DNS_PORT=5353，或停止占用 :53 的进程后再启 DeskDNS。',
    };
  } catch {
    return null;
  }
}

/**
 * Public policy for embedded DeskDNS + bypass/sidecar DeskDNS.
 * Lab LAN only — same trust model as /api/v1/device-control/public.
 */
deskDnsRouter.get('/api/v1/desk-dns/policy', (_req, res) => {
  const snap = getDeskDnsResolveSnapshot(openDb());
  res.json({
    ...snap,
    status: getDeskDnsStatus(),
  });
});

deskDnsRouter.get(
  '/api/v1/deskdns/status',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (_req: AuthedRequest, res) => {
    const db = openDb();
    const profile = getSetting(db, PROFILE_KEY) || 'normal';
    const enabled = process.env.CLASSROOM_DESK_DNS === '1';
    const port = enabled ? Number(process.env.CLASSROOM_DESK_DNS_PORT || 5353) : null;
    res.json({
      profile,
      running: enabled,
      port,
      conflict: probePort53(),
    });
  },
);

deskDnsRouter.post(
  '/api/v1/deskdns/profile',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const profile = String(req.body?.profile ?? '').trim();
    if (!PROFILES.has(profile)) {
      res.status(400).json({ error: 'invalid_profile' });
      return;
    }
    upsertSetting(openDb(), PROFILE_KEY, profile);
    res.json({ ok: true, profile });
  },
);
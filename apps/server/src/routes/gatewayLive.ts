import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { openDb } from '../db/client.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { listGatewayAccess } from '../services/gatewayAllowlist.js';
import { getSetting } from '../db/migrate.js';
import { listPortalBlockAlerts } from '../services/portalAuth.js';
import { formatShieldActiveLabel, getShieldConnector } from '../services/shield/registry.js';

export const gatewayLiveRouter = Router();

gatewayLiveRouter.get(
  '/api/v1/gateway/allowlist-live',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (_req: AuthedRequest, res) => {
    const db = openDb();
    const entries = listGatewayAccess(db);
    const recentRaw = getSetting(db, 'gateway_decision_log') ?? '[]';
    let recent: Array<{ clientKey: string; ip?: string; decision?: string; at?: string }> = [];
    try {
      recent = JSON.parse(recentRaw) as typeof recent;
    } catch {
      recent = [];
    }
    const shieldActive = formatShieldActiveLabel(getShieldConnector().id);
    const lastError = getSetting(db, 'shield_last_error');
    const hb = getSetting(db, 'shield_last_heartbeat_at');
    const portalBlocks = listPortalBlockAlerts(db, 8);
    res.json({
      count: entries.length,
      recent: recent.slice(-5).reverse(),
      items: entries.slice(0, 50),
      portalBlocks,
      shield: {
        active: shieldActive,
        lastError: lastError || null,
        healthy: !lastError,
        lastHeartbeatAt: hb || null,
      },
    });
  },
);

gatewayLiveRouter.post(
  '/api/v1/gateway/export-live-evidence',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (_req: AuthedRequest, res) => {
    const root = process.cwd();
    const script = path.join(root, 'scripts/archive-live-shield-evidence.mjs');
    if (!fs.existsSync(script)) {
      res.status(500).json({ ok: false, detail: 'archive_script_missing' });
      return;
    }
    const r = spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env },
    });
    const day = new Date().toISOString().slice(0, 10);
    const outDir = path.join(root, 'tmp/live-evidence', day);
    res.json({
      ok: r.status === 0,
      path: outDir,
      detail: (r.stdout || r.stderr || '').slice(0, 500),
    });
  },
);

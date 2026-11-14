import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Router } from 'express';
import { openDb, getDataDir } from '../db/client.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { buildNetReconcileReport } from '../services/netReconcile.js';
import { reconcileGatewayAliases } from '../services/gatewayAliasReconcile.js';
import { createHash } from 'node:crypto';
import {
  purgeExpiredAuditLog,
  resolveAuditRetentionDays,
  countAuditLog,
  listAudit,
  writeAudit,
  verifyAuditHashChain,
} from '../services/audit.js';
import { upsertSetting } from '../services/exitLock.js';
import {
  deskDnsFollowDeepLock,
  setDeskDnsFollowDeepLock,
} from '../services/deskDnsDeepLockSync.js';
import { getSetting } from '../db/migrate.js';
import {
  evaluateNetPathsArmed,
  securityTierSEnabled,
  strictNetFailClosed,
} from '../services/securityTier.js';

export const complianceRouter = Router();

/** Dual-path network reconcile snapshot (校园网包 + DeskDNS). */
complianceRouter.get(
  '/api/v1/compliance/net-reconcile',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (req: AuthedRequest, res) => {
    const classId = String(req.query.classId ?? '').trim() || null;
    res.json(buildNetReconcileReport(openDb(), classId));
  },
);

/** OPNsense/UniFi alias membership vs local portal allowlist. */
complianceRouter.get(
  '/api/v1/compliance/alias-reconcile',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  async (req: AuthedRequest, res) => {
    const classId = String(req.query.classId ?? '').trim() || null;
    const report = await reconcileGatewayAliases(openDb(), classId);
    res.json(report);
  },
);

complianceRouter.get(
  '/api/v1/compliance/audit-retention',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (_req: AuthedRequest, res) => {
    const db = openDb();
    res.json({
      retentionDays: resolveAuditRetentionDays(db),
      rowCount: countAuditLog(db),
      minDays: 30,
      maxDays: 730,
      defaultDays: 180,
      deskDnsFollowDeepLock: deskDnsFollowDeepLock(db),
    });
  },
);

complianceRouter.get(
  '/api/v1/compliance/audit-chain',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (_req: AuthedRequest, res) => {
    const db = openDb();
    res.json({
      ...verifyAuditHashChain(db),
      securityTierS: securityTierSEnabled(db),
      strictNetFailClosed: strictNetFailClosed(db),
      netPaths: evaluateNetPathsArmed(),
    });
  },
);

complianceRouter.patch(
  '/api/v1/compliance/audit-retention',
  requireAuth,
  requireRoles('admin'),
  (req: AuthedRequest, res) => {
    const days = Math.trunc(Number(req.body?.retentionDays ?? req.body?.audit_retention_days));
    if (!Number.isFinite(days) || days < 30 || days > 730) {
      res.status(400).json({ error: 'invalid_retention', message: '留存须为 30–730 天' });
      return;
    }
    const db = openDb();
    upsertSetting(db, 'audit_retention_days', String(days));
    if (req.body?.deskDnsFollowDeepLock != null) {
      const on =
        req.body.deskDnsFollowDeepLock === true ||
        req.body.deskDnsFollowDeepLock === 1 ||
        req.body.deskDnsFollowDeepLock === '1';
      setDeskDnsFollowDeepLock(db, on);
    }
    writeAudit({
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      action: 'compliance.audit_retention',
      detail: {
        retentionDays: days,
        deskDnsFollowDeepLock: deskDnsFollowDeepLock(db),
      },
      clientIp: req.ip,
    });
    res.json({
      ok: true,
      retentionDays: resolveAuditRetentionDays(db),
      rowCount: countAuditLog(db),
      deskDnsFollowDeepLock: deskDnsFollowDeepLock(db),
    });
  },
);

complianceRouter.post(
  '/api/v1/compliance/audit-purge',
  requireAuth,
  requireRoles('admin'),
  (req: AuthedRequest, res) => {
    const db = openDb();
    const result = purgeExpiredAuditLog(db);
    writeAudit({
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      action: 'compliance.audit_purge',
      detail: result,
      clientIp: req.ip,
    });
    res.json({ ok: true, ...result, rowCount: countAuditLog(db) });
  },
);

/**
 * One-click compliance pack (JSON download). Not formal MLPS cert.
 * Includes net-reconcile + alias-reconcile + audit sample (redacted tokens in detail strings lightly).
 */
complianceRouter.post(
  '/api/v1/compliance/export-pack',
  requireAuth,
  requireRoles('teacher', 'admin'),
  async (req: AuthedRequest, res) => {
    const db = openDb();
    const classId = String(req.body?.classId ?? req.query.classId ?? '').trim() || null;
    const reconcile = buildNetReconcileReport(db, classId);
    const alias = await reconcileGatewayAliases(db, classId);
    const chain = verifyAuditHashChain(db);
    const packBody = {
      generatedAt: new Date().toISOString(),
      purpose: 'classroom-desk S-tier compliance pack (Pilot; NOT national classified / 绝密)',
      gaNote:
        'School live OPNsense/UniFi evidence still required for GA; lab SKIPPED cannot replace it.',
      securityTier: {
        s: securityTierSEnabled(db),
        strictNetFailClosed: strictNetFailClosed(db),
        netPaths: evaluateNetPathsArmed(),
      },
      reconcile,
      alias,
      auditChain: chain,
      audit: {
        retentionDays: resolveAuditRetentionDays(db),
        rowCount: countAuditLog(db),
        sample: listAudit({ limit: 80 }),
      },
      settings: {
        deskDnsFollowDeepLock: deskDnsFollowDeepLock(db),
        deskdnsProfile: getSetting(db, 'deskdns_profile') || 'normal',
      },
    };
    const bodyText = JSON.stringify(packBody, null, 2);
    const sha256 = createHash('sha256').update(bodyText, 'utf8').digest('hex');
    const pack = { ...packBody, contentSha256: sha256 };
    const finalText = JSON.stringify(pack, null, 2);
    writeAudit({
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      action: 'compliance.export_pack',
      classId,
      detail: {
        failClosedOk: reconcile.failClosedOk,
        aliasOk: alias.ok,
        contentSha256: sha256,
        chainOk: chain.ok,
      },
      clientIp: req.ip,
    });
    const outName = `compliance-pack-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
    const dir = path.join(getDataDir(), 'compliance-exports');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, outName);
    fs.writeFileSync(filePath, finalText);
    fs.writeFileSync(`${filePath}.sha256`, `${sha256}  ${outName}\n`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
    res.setHeader('X-Content-SHA256', sha256);
    res.send(finalText);
  },
);

/**
 * Trigger school/lab live-shield archive script.
 * GA hard gate unchanged: without OPNSENSE_LIVE/UNIFI_LIVE creds → SKIPPED in evidence dir.
 */
complianceRouter.post(
  '/api/v1/compliance/archive-live-evidence',
  requireAuth,
  requireRoles('admin'),
  (req: AuthedRequest, res) => {
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
    writeAudit({
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      action: 'compliance.archive_live_evidence',
      detail: {
        exit: r.status,
        path: outDir,
        gaNote: 'SKIPPED without school LIVE env is not GA evidence',
      },
      clientIp: req.ip,
    });
    res.json({
      ok: r.status === 0,
      path: outDir,
      detail: (r.stdout || r.stderr || '').slice(0, 800),
      gaHardGate:
        'npm run check:live-evidence must pass with school OPNsense/UniFi live (not lab SKIPPED alone) before GA narrative.',
    });
  },
);

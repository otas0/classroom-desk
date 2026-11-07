import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { getDataDir, openDb } from '../db/client.js';
import { getSetting } from '../db/migrate.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';
import {
  auditRetryHealth,
  enqueueAuditRetry,
  flushAuditRetryQueue,
} from '../services/auditRetry.js';
import { getBackupStatus } from '../services/backup.js';
import { listPresenceClients } from '../services/presenceHub.js';
import { summarizeDurations } from '../utils/percentile.js';
import { nowIso } from '../utils/id.js';
import { packageVersion } from '../routes/health.js';

export const opsRouter = Router();

const ONLINE_MS = 90_000;

function upgradesDir(): string {
  return process.env.CLASSROOM_DESK_UPGRADES_DIR
    ? path.resolve(process.env.CLASSROOM_DESK_UPGRADES_DIR)
    : path.join(getDataDir(), 'upgrades');
}

opsRouter.get(
  '/api/v1/ops/dashboard',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (_req: AuthedRequest, res) => {
    const db = openDb();
    const expected = packageVersion();
    const classes = db
      .prepare(`SELECT id, name FROM classes ORDER BY created_at DESC`)
      .all() as Array<{ id: string; name: string }>;

    let rosterTotal = 0;
    let onlineTotal = 0;
    let driftClients = 0;
    const byClass: Array<{
      classId: string;
      name: string;
      roster: number;
      online: number;
      onlineRate: number;
      driftCount: number;
      versions: string[];
    }> = [];

    for (const c of classes) {
      const roster = Number(
        (
          db
            .prepare(
              `SELECT COUNT(*) AS n FROM users
               WHERE role = 'student' AND class_id = ?
                 AND (deleted_at IS NULL OR deleted_at = '')`,
            )
            .get(c.id) as { n: number }
        ).n,
      );
      const clients = listPresenceClients(c.id, ONLINE_MS);
      const versions = [...new Set(clients.map((x) => x.clientVersion).filter(Boolean))];
      const drift = clients.filter((x) => x.clientVersion && expected && x.clientVersion !== expected).length;
      rosterTotal += roster;
      onlineTotal += clients.length;
      driftClients += drift;
      byClass.push({
        classId: c.id,
        name: c.name,
        roster,
        online: clients.length,
        onlineRate: roster > 0 ? clients.length / roster : 0,
        driftCount: drift,
        versions,
      });
    }

    const readyRows = db
      .prepare(
        `SELECT detail, class_id AS classId, created_at AS createdAt
         FROM teacher_audit_log
         WHERE action = 'setup.classroom_ready'
         ORDER BY created_at DESC
         LIMIT 500`,
      )
      .all() as Array<{ detail: string; classId: string | null; createdAt: string }>;
    const durations: number[] = [];
    const byClassReady: Record<string, number[]> = {};
    for (const row of readyRows) {
      try {
        const d = JSON.parse(row.detail) as { durationMs?: number };
        if (typeof d.durationMs === 'number' && Number.isFinite(d.durationMs)) {
          durations.push(d.durationMs);
          const key = row.classId || '_';
          (byClassReady[key] ??= []).push(d.durationMs);
        }
      } catch {
        /* ignore */
      }
    }
    const ctaCount = Number(
      (
        db
          .prepare(`SELECT COUNT(*) AS n FROM teacher_audit_log WHERE action = 'setup.scan_assign_cta'`)
          .get() as { n: number }
      ).n,
    );

    const backup = getBackupStatus(getSetting(db, 'last_auto_backup_at'));
    let upgradeFiles: string[] = [];
    try {
      const dir = upgradesDir();
      if (fs.existsSync(dir)) {
        upgradeFiles = fs
          .readdirSync(dir)
          .filter((n) => /\.exe$/i.test(n) || /\.sha256$/i.test(n) || /\.json$/i.test(n))
          .sort();
      }
    } catch {
      upgradeFiles = [];
    }

    const histBuckets = [
      { label: '<30s', maxMs: 30_000, count: 0 },
      { label: '30–60s', maxMs: 60_000, count: 0 },
      { label: '1–3m', maxMs: 180_000, count: 0 },
      { label: '3–10m', maxMs: 600_000, count: 0 },
      { label: '>10m', maxMs: Infinity, count: 0 },
    ];
    for (const ms of durations) {
      const b = histBuckets.find((x) => ms < x.maxMs) ?? histBuckets[histBuckets.length - 1]!;
      b.count += 1;
    }

    const driftAudit = db
      .prepare(
        `SELECT created_at AS createdAt, detail FROM teacher_audit_log
         WHERE action = 'fleet.drift_snapshot'
         ORDER BY created_at DESC LIMIT 500`,
      )
      .all() as Array<{ createdAt: string; detail: string }>;
    const driftByDay: Record<string, { samples: number; driftSum: number }> = {};
    for (const row of driftAudit) {
      const day = String(row.createdAt).slice(0, 10);
      const slot = (driftByDay[day] ??= { samples: 0, driftSum: 0 });
      slot.samples += 1;
      try {
        const d = JSON.parse(row.detail) as { driftCount?: number; driftRate?: number };
        if (typeof d.driftCount === 'number') slot.driftSum += d.driftCount;
        else if (typeof d.driftRate === 'number') slot.driftSum += d.driftRate * 100;
      } catch {
        /* ignore */
      }
    }
    const driftTrend = Object.entries(driftByDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([day, v]) => ({
        day,
        samples: v.samples,
        driftAvg: v.samples > 0 ? v.driftSum / v.samples : 0,
      }));
    // Live fleet point as latest sample when audit sparse
    if (driftTrend.length === 0 || driftTrend[driftTrend.length - 1]?.day !== new Date().toISOString().slice(0, 10)) {
      driftTrend.push({
        day: new Date().toISOString().slice(0, 10),
        samples: 1,
        driftAvg: driftClients,
      });
    }

    res.json({
      at: new Date().toISOString(),
      expectedStudentVersion: expected,
      fleet: {
        classCount: classes.length,
        rosterTotal,
        onlineTotal,
        onlineRate: rosterTotal > 0 ? onlineTotal / rosterTotal : 0,
        driftClients,
        driftRate: onlineTotal > 0 ? driftClients / onlineTotal : 0,
        driftSnapshotLastAt: driftAudit[0]?.createdAt ?? null,
      },
      readiness: {
        ctaCount,
        readyCount: durations.length,
        funnelRate: ctaCount > 0 ? durations.length / ctaCount : null,
        ...summarizeDurations(durations),
        histogram: histBuckets.map(({ label, count }) => ({ label, count })),
        byClass: Object.entries(byClassReady).map(([classId, vals]) => ({
          classId,
          ...summarizeDurations(vals),
        })),
      },
      driftTrend,
      backup: {
        ageHours: backup.ageHours,
        latestAt: backup.latestAt,
        lastError: backup.lastError,
        dir: backup.dir,
      },
      upgrades: {
        dir: upgradesDir(),
        files: upgradeFiles,
      },
      classes: byClass,
    });
  },
);

/** Seed one retry-queue row (settings flush UI / e2e). */
opsRouter.post(
  '/api/v1/ops/audit-retry/enqueue',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const action = String(req.body?.action ?? 'ops.audit_retry_enqueue').trim() || 'ops.audit_retry_enqueue';
    const detail =
      req.body?.detail && typeof req.body.detail === 'object'
        ? JSON.stringify(req.body.detail)
        : String(req.body?.detail ?? JSON.stringify({ note: 'manual enqueue' }));
    enqueueAuditRetry({
      actorUserId: req.user?.id ?? null,
      actorRole: req.user?.role ?? null,
      action,
      classId: String(req.body?.classId ?? '').trim() || null,
      detail,
      clientIp: req.ip ?? null,
      createdAt: nowIso(),
    });
    writeAudit({
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      action: 'ops.audit_retry_enqueue',
      detail: { queuedAction: action },
      clientIp: req.ip,
    });
    res.json({ ok: true, health: auditRetryHealth(), message: '已写入审计重试队列 1 条' });
  },
);

/** Manually drain audit retry JSONL queue (teacher settings / health bypass). */
opsRouter.post(
  '/api/v1/ops/audit-retry/flush',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const before = auditRetryHealth();
    const result = flushAuditRetryQueue();
    const after = auditRetryHealth();
    writeAudit({
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      action: 'ops.audit_retry_flush',
      detail: {
        flushed: result.flushed,
        remaining: result.remaining,
        failed: result.failed,
        beforeSize: before.retryQueueSize,
        afterSize: after.retryQueueSize,
      },
      clientIp: req.ip,
    });
    res.json({
      ok: true,
      before,
      result,
      after,
      message: `已重试写入 ${result.flushed} 条，剩余 ${result.remaining}，放弃 ${result.failed}`,
    });
  },
);

/** Readiness-only slice for charts. */
opsRouter.get(
  '/api/v1/ops/readiness',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (req: AuthedRequest, res) => {
    const classId = String(req.query.classId ?? '').trim();
    const db = openDb();
    let sql = `SELECT detail, class_id AS classId, created_at AS createdAt
               FROM teacher_audit_log WHERE action = 'setup.classroom_ready'`;
    const params: string[] = [];
    if (classId) {
      sql += ` AND class_id = ?`;
      params.push(classId);
    }
    sql += ` ORDER BY created_at DESC LIMIT 500`;
    const rows = db.prepare(sql).all(...params) as Array<{ detail: string; classId: string | null }>;
    const durations: number[] = [];
    for (const row of rows) {
      try {
        const d = JSON.parse(row.detail) as { durationMs?: number };
        if (typeof d.durationMs === 'number') durations.push(d.durationMs);
      } catch {
        /* ignore */
      }
    }
    const ctaSql = classId
      ? `SELECT COUNT(*) AS n FROM teacher_audit_log WHERE action = 'setup.scan_assign_cta' AND class_id = ?`
      : `SELECT COUNT(*) AS n FROM teacher_audit_log WHERE action = 'setup.scan_assign_cta'`;
    const ctaCount = Number((db.prepare(ctaSql).get(...(classId ? [classId] : [])) as { n: number }).n);
    res.json({
      classId: classId || null,
      ctaCount,
      readyCount: durations.length,
      ...summarizeDurations(durations),
    });
  },
);

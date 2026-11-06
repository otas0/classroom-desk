import { Router } from 'express';
import { APP_NOTICE, ATTENDANCE_NOTICE } from '@classroom-desk/shared';
import { openDb } from '../db/client.js';
import { getSetting } from '../db/migrate.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { config } from '../config.js';

export const settingsRouter = Router();

settingsRouter.get('/api/v1/settings/public', (_req, res) => {
  const db = openDb();
  res.json({
    noticeText: getSetting(db, 'notice_text') ?? APP_NOTICE,
    attendanceNoticeText: getSetting(db, 'attendance_notice_text') ?? ATTENDANCE_NOTICE,
    messagesEnabled: (getSetting(db, 'messages_enabled') ?? '1') !== '0',
    pointRequestTtlMinutes: Number(
      getSetting(db, 'point_request_ttl_minutes') ?? config.defaultPointRequestTtlMinutes,
    ),
    pointRequestDailyCleanupTime: getSetting(db, 'point_request_daily_cleanup_time') ?? '02:00',
    pointRequestCleanupReadonlyNote:
      '未确认加分请求每天凌晨清空；已通过加分永久保留并可按月导出。',
  });
});

settingsRouter.get('/api/v1/settings', requireAuth, requireRoles('teacher', 'admin'), (_req, res) => {
  const db = openDb();
  const cleanupStats = db
    .prepare(
      `SELECT id, cleanup_date AS cleanupDate, removed_count AS removedCount, kind, created_at AS createdAt
       FROM cleanup_stats ORDER BY created_at DESC LIMIT 30`,
    )
    .all();
  const lastCleanup = cleanupStats[0] as
    | { createdAt: string; kind: string; removedCount: number; cleanupDate: string }
    | undefined;
  res.json({
    pointRequestTtlMinutes: Number(
      getSetting(db, 'point_request_ttl_minutes') ?? config.defaultPointRequestTtlMinutes,
    ),
    pointRequestDailyCleanupTime: getSetting(db, 'point_request_daily_cleanup_time') ?? '02:00',
    pointRequestDailyCleanupEditable: false,
    messagesEnabled: (getSetting(db, 'messages_enabled') ?? '1') !== '0',
    noticeText: getSetting(db, 'notice_text') ?? APP_NOTICE,
    attendanceNoticeText: getSetting(db, 'attendance_notice_text') ?? ATTENDANCE_NOTICE,
    note: '未确认加分请求每天凌晨清空；已通过加分永久保留并可按月导出。',
    cleanupStats,
    lastCleanupAt: lastCleanup?.createdAt ?? getSetting(db, 'last_cleanup_at'),
    lastCleanupKind: lastCleanup?.kind ?? getSetting(db, 'last_cleanup_kind'),
    lastCleanupRemovedCount: lastCleanup?.removedCount ?? null,
  });
});

settingsRouter.patch('/api/v1/settings', requireAuth, requireRoles('teacher', 'admin'), (req: AuthedRequest, res) => {
  const db = openDb();
  if (req.body?.pointRequestTtlMinutes != null) {
    const ttl = Number(req.body.pointRequestTtlMinutes);
    if (
      !Number.isFinite(ttl) ||
      ttl < config.minPointRequestTtlMinutes ||
      ttl > config.maxPointRequestTtlMinutes
    ) {
      res.status(400).json({ error: 'invalid_ttl' });
      return;
    }
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('point_request_ttl_minutes', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(String(Math.trunc(ttl)));
  }

  // Daily cleanup time is fixed / read-only by product requirement.
  if (req.body?.pointRequestDailyCleanupTime != null) {
    res.status(400).json({ error: 'daily_cleanup_time_readonly' });
    return;
  }

  if (req.body?.messagesEnabled != null) {
    const enabled = Boolean(req.body.messagesEnabled);
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('messages_enabled', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(enabled ? '1' : '0');
  }

  res.json({ ok: true });
});

import { Router } from 'express';
import { APP_NOTICE, ATTENDANCE_NOTICE } from '@classroom-desk/shared';
import { openDb } from '../db/client.js';
import { getSetting } from '../db/migrate.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { config } from '../config.js';
import {
  getClientExitLockState,
  grantBatchExitUnlock,
  listExitLockEvents,
  relockClientExit,
  setClientExitLockedFlag,
  setExitUnlockCode,
} from '../services/exitLock.js';

export const settingsRouter = Router();

settingsRouter.get('/api/v1/settings/public', (_req, res) => {
  const db = openDb();
  const exit = getClientExitLockState(db);
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
    clientExitAllowed: exit.clientExitAllowed,
    clientExitUnlockUntil: exit.clientExitUnlockUntil,
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
  const exit = getClientExitLockState(db);
  res.json({
    pointRequestTtlMinutes: Number(
      getSetting(db, 'point_request_ttl_minutes') ?? config.defaultPointRequestTtlMinutes,
    ),
    pointRequestDailyCleanupTime: getSetting(db, 'point_request_daily_cleanup_time') ?? '02:00',
    pointRequestDailyCleanupEditable: false,
    messagesEnabled: (getSetting(db, 'messages_enabled') ?? '1') !== '0',
    classroomApiBase: getSetting(db, 'classroom_api_base') ?? '',
    noticeText: getSetting(db, 'notice_text') ?? APP_NOTICE,
    attendanceNoticeText: getSetting(db, 'attendance_notice_text') ?? ATTENDANCE_NOTICE,
    note: '未确认加分请求每天凌晨清空；已通过加分永久保留并可按月导出。本地部署无需代码签名。',
    cleanupStats,
    lastCleanupAt: lastCleanup?.createdAt ?? getSetting(db, 'last_cleanup_at'),
    lastCleanupKind: lastCleanup?.kind ?? getSetting(db, 'last_cleanup_kind'),
    lastCleanupRemovedCount: lastCleanup?.removedCount ?? null,
    ...exit,
  });
});

settingsRouter.patch('/api/v1/settings', requireAuth, requireRoles('teacher', 'admin'), async (req: AuthedRequest, res) => {
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

  if (req.body?.classroomApiBase != null) {
    const base = String(req.body.classroomApiBase).trim().replace(/\/$/, '');
    if (base && !/^https?:\/\/[^/\s]+/i.test(base)) {
      res.status(400).json({ error: 'invalid_classroom_api_base', message: 'apiBase 须为 http://教师IP:8787' });
      return;
    }
    if (/127\.0\.0\.1|localhost/i.test(base)) {
      res.status(400).json({
        error: 'localhost_not_allowed',
        message: '学生机不可使用 127.0.0.1 / localhost，请填教师机局域网 IP',
      });
      return;
    }
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('classroom_api_base', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(base);
  }

  const actor = {
    actorUserId: req.user?.id,
    actorRole: req.user?.role,
    clientIp: String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '')
      .split(',')[0]
      .trim(),
  };

  // Student desktop exit lock: batch unlock window / relock / dedicated unlock code
  if (req.body?.clientExitUnlockMinutes != null) {
    const mins = Number(req.body.clientExitUnlockMinutes);
    if (!Number.isFinite(mins) || mins < 1 || mins > 240) {
      res.status(400).json({ error: 'invalid_unlock_minutes', message: '解除时长须为 1–240 分钟' });
      return;
    }
    const granted = grantBatchExitUnlock(db, mins, actor);
    res.json({ ok: true, ...getClientExitLockState(db), batchUnlock: granted });
    return;
  }

  if (req.body?.clientExitRelock === true) {
    relockClientExit(db, actor);
    res.json({ ok: true, ...getClientExitLockState(db) });
    return;
  }

  if (req.body?.clientExitLocked != null) {
    setClientExitLockedFlag(db, Boolean(req.body.clientExitLocked), actor);
  }

  if (req.body?.exitUnlockCode != null) {
    const code = String(req.body.exitUnlockCode);
    if (code.trim() === '') {
      res.status(400).json({ error: 'invalid_exit_unlock_code', message: '解除码不能为空' });
      return;
    }
    const set = await setExitUnlockCode(db, code, actor);
    if (!set.ok) {
      res.status(400).json({ error: set.error, message: set.message });
      return;
    }
  }

  res.json({ ok: true, ...getClientExitLockState(db) });
});

settingsRouter.get(
  '/api/v1/settings/exit-lock-events',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const limit = Number(req.query.limit ?? 40);
    res.json({ items: listExitLockEvents(openDb(), limit) });
  },
);

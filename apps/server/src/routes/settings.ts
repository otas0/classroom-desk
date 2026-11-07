import { createHash } from 'node:crypto';
import { Router } from 'express';
import {
  APP_NOTICE,
  ATTENDANCE_NOTICE,
  RECYCLE_RETENTION_DAYS,
  RECYCLE_URGENT_DAYS,
} from '@classroom-desk/shared';
import fs from 'node:fs';
import path from 'node:path';
import { getDataDir, getDbPath, openDb } from '../db/client.js';
import { getSetting } from '../db/migrate.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { config } from '../config.js';
import {
  getClientExitLockState,
  grantBatchExitUnlock,
  countExitLockEvents,
  listExitLockEvents,
  relockClientExit,
  setClientExitLockedFlag,
  setExitUnlockCode,
  setExitUnlockRateConfig,
} from '../services/exitLock.js';
import {
  applyExamModeInputLock,
  getInputLockStore,
  inputLockActive,
  resolveInputLock,
  setInputLockStore,
  type InputLockFlags,
} from '../services/inputLock.js';
import { addExitLockSseClient, broadcastExitLockPayload } from '../services/exitLockHub.js';
import { previewPurgeExpiredSoftDeletes, purgeExpiredSoftDeletes, writeAudit } from '../services/audit.js';
import { toCsv } from '../utils/csv.js';
import {
  decryptFileAesGcm,
  getBackupStatus,
  runDbBackup,
} from '../services/backup.js';
import {
  consumeRestoreConfirmCode,
  issueRestoreConfirmCode,
} from '../services/restoreConfirm.js';
import { notifyRestoreConfirm } from '../services/notifyEmail.js';
import { pruneOldSetupExes } from './upgrades.js';
import { getExtraWeakPasswords, setExtraWeakPasswords } from '../services/weakPasswords.js';
import { nowIso } from '../utils/id.js';

export const settingsRouter = Router();

settingsRouter.get('/api/v1/settings/public', (req, res) => {
  const db = openDb();
  const exit = getClientExitLockState(db);
  const classId = String(req.query.classId ?? '').trim();
  const seatId = String(req.query.seatId ?? '').trim();
  const store = getInputLockStore(db);
  const resolved = resolveInputLock(store, {
    classId: classId || null,
    seatId: seatId || null,
  });
  res.json({
    noticeText: getSetting(db, 'notice_text') ?? APP_NOTICE,
    attendanceNoticeText: getSetting(db, 'attendance_notice_text') ?? ATTENDANCE_NOTICE,
    messagesEnabled: (getSetting(db, 'messages_enabled') ?? '1') !== '0',
    quizConfirmSubmit: (getSetting(db, 'quiz_confirm_submit') ?? '1') !== '0',
    pointRequestTtlMinutes: Number(
      getSetting(db, 'point_request_ttl_minutes') ?? config.defaultPointRequestTtlMinutes,
    ),
    pointRequestDailyCleanupTime: getSetting(db, 'point_request_daily_cleanup_time') ?? '02:00',
    pointRequestCleanupReadonlyNote:
      '未确认加分请求每天凌晨清空；已通过加分永久保留并可按月导出。',
    clientExitAllowed: exit.clientExitAllowed,
    clientExitUnlockUntil: exit.clientExitUnlockUntil,
    exitUnlockCodeRotationDue: exit.exitUnlockCodeRotationDue,
    exitUnlockCodeAgeDays: exit.exitUnlockCodeAgeDays,
    exitUnlockCodeRotateDays: exit.exitUnlockCodeRotateDays,
    inputLock: resolved,
    inputLockStore: store,
    inputLockActive: inputLockActive(resolved),
  });
});

settingsRouter.get('/api/v1/settings', requireAuth, requireRoles('teacher', 'admin', 'assistant'), (_req, res) => {
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
    quizConfirmSubmit: (getSetting(db, 'quiz_confirm_submit') ?? '1') !== '0',
    liveboardReadonlyAfterMinutes: Number(getSetting(db, 'liveboard_readonly_after_minutes') ?? 5),
    weakTeacherPasswordsExtra: getExtraWeakPasswords(db),
    recycleRetentionDays: Number(
      getSetting(db, 'recycle_retention_days') ?? RECYCLE_RETENTION_DAYS,
    ),
    recycleUrgentDays: Number(getSetting(db, 'recycle_urgent_days') ?? RECYCLE_URGENT_DAYS),
    fleetDriftSnapshotMinutes: Number(getSetting(db, 'fleet_drift_snapshot_minutes') ?? 5),
    fleetDriftSnapshotLastAt:
      (
        db
          .prepare(
            `SELECT created_at AS createdAt FROM teacher_audit_log
             WHERE action = 'fleet.drift_snapshot'
             ORDER BY created_at DESC LIMIT 1`,
          )
          .get() as { createdAt?: string } | undefined
      )?.createdAt ?? null,
    upgradesKeepCount: Number(getSetting(db, 'upgrades_keep_count') ?? 3),
    restoreConfirmEmail: getSetting(db, 'restore_confirm_email') ?? '',
    hasBackupEncryptPassphrase: Boolean((getSetting(db, 'backup_encrypt_passphrase') ?? '').trim()),
    projectionHighContrast: (getSetting(db, 'projection_high_contrast') ?? '0') === '1',
    classroomApiBase: getSetting(db, 'classroom_api_base') ?? '',
    noticeText: getSetting(db, 'notice_text') ?? APP_NOTICE,
    attendanceNoticeText: getSetting(db, 'attendance_notice_text') ?? ATTENDANCE_NOTICE,
    note: '未确认加分请求每天凌晨清空；已通过加分永久保留并可按月导出。本地部署无需代码签名。',
    cleanupStats,
    lastCleanupAt: lastCleanup?.createdAt ?? getSetting(db, 'last_cleanup_at'),
    lastCleanupKind: lastCleanup?.kind ?? getSetting(db, 'last_cleanup_kind'),
    lastCleanupRemovedCount: lastCleanup?.removedCount ?? null,
    backup: getBackupStatus(getSetting(db, 'last_auto_backup_at')),
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

  if (req.body?.quizConfirmSubmit != null) {
    const enabled = Boolean(req.body.quizConfirmSubmit);
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('quiz_confirm_submit', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(enabled ? '1' : '0');
  }

  if (req.body?.liveboardReadonlyAfterMinutes != null) {
    const mins = Number(req.body.liveboardReadonlyAfterMinutes);
    if (!Number.isFinite(mins) || mins < 0 || mins > 240) {
      res.status(400).json({
        error: 'invalid_readonly_minutes',
        message: '投影只读自动开启须为 0–240 分钟（0=关闭）',
      });
      return;
    }
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('liveboard_readonly_after_minutes', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(String(Math.trunc(mins)));
  }

  if (req.body?.weakTeacherPasswordsExtra != null) {
    if (!Array.isArray(req.body.weakTeacherPasswordsExtra)) {
      res.status(400).json({ error: 'invalid_weak_list', message: '须为字符串数组' });
      return;
    }
    setExtraWeakPasswords(
      (req.body.weakTeacherPasswordsExtra as unknown[]).map((x) => String(x)),
      db,
    );
  }

  if (req.body?.recycleRetentionDays != null) {
    const days = Number(req.body.recycleRetentionDays);
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      res.status(400).json({ error: 'invalid_retention_days', message: '回收站保留须为 1–365 天' });
      return;
    }
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('recycle_retention_days', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(String(Math.trunc(days)));
  }

  if (req.body?.fleetDriftSnapshotMinutes != null) {
    const mins = Number(req.body.fleetDriftSnapshotMinutes);
    if (!Number.isFinite(mins) || mins < 0 || mins > 1440) {
      res.status(400).json({
        error: 'invalid_drift_minutes',
        message: '漂移快照间隔须为 0–1440 分钟（0=关闭）',
      });
      return;
    }
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('fleet_drift_snapshot_minutes', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(String(Math.trunc(mins)));
  }

  let upgradesPruned: string[] | null = null;
  if (req.body?.upgradesKeepCount != null) {
    const n = Number(req.body.upgradesKeepCount);
    if (!Number.isFinite(n) || n < 1 || n > 20) {
      res.status(400).json({ error: 'invalid_upgrades_keep', message: '升级包保留须为 1–20 份' });
      return;
    }
    const keep = Math.trunc(n);
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('upgrades_keep_count', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(String(keep));
    upgradesPruned = pruneOldSetupExes(keep);
    writeAudit({
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      action: 'upgrades.keep_prune',
      detail: { keep, pruned: upgradesPruned },
      clientIp: req.ip,
    });
  }

  if (req.body?.restoreConfirmEmail !== undefined) {
    const email = String(req.body.restoreConfirmEmail ?? '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({
        error: 'invalid_restore_confirm_email',
        message: '恢复确认邮箱格式不正确',
      });
      return;
    }
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('restore_confirm_email', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(email);
  }

  if (req.body?.recycleUrgentDays != null) {
    const days = Number(req.body.recycleUrgentDays);
    if (!Number.isFinite(days) || days < 0 || days > 30) {
      res.status(400).json({
        error: 'invalid_urgent_days',
        message: '即将到期高亮阈值须为 0–30 天（剩余天数 ≤ 该值时醒目）',
      });
      return;
    }
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('recycle_urgent_days', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(String(Math.trunc(days)));
  }

  if (req.body?.backupEncryptPassphrase !== undefined) {
    const pass = String(req.body.backupEncryptPassphrase ?? '');
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('backup_encrypt_passphrase', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(pass);
  }

  if (req.body?.projectionHighContrast != null) {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('projection_high_contrast', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(req.body.projectionHighContrast ? '1' : '0');
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

  /** One-click exam mode: full input lock + exit relock. */
  if (req.body?.examMode === true) {
    const classId = String(req.body?.examModeClassId ?? req.body?.classId ?? '').trim();
    applyExamModeInputLock(db, { classId: classId || null }, actor);
    relockClientExit(db, actor);
    const state = getClientExitLockState(db);
    broadcastExitLockPayload(state);
    res.json({ ok: true, examMode: true, ...state });
    return;
  }

  /** Physical input lock (global / class / seat). Visible kiosk control, not OS malware. */
  if (req.body?.inputLock != null && typeof req.body.inputLock === 'object') {
    const raw = req.body.inputLock as Partial<InputLockFlags> & {
      classId?: string;
      seatId?: string;
      clearClass?: boolean;
      clearSeat?: boolean;
      scope?: 'global' | 'class' | 'seat';
    };
    const classId = String(raw.classId ?? req.body?.classId ?? '').trim();
    const seatId = String(raw.seatId ?? req.body?.seatId ?? '').trim();
    const scope = raw.scope ?? (seatId ? 'seat' : classId ? 'class' : 'global');
    setInputLockStore(
      db,
      {
        classId: scope === 'global' ? null : classId || null,
        seatId: scope === 'seat' ? seatId || null : null,
        flags: {
          keyboard: raw.keyboard,
          mouse: raw.mouse,
          voice: raw.voice,
          camera: raw.camera,
        },
        clearClass: raw.clearClass === true,
        clearSeat: raw.clearSeat === true,
      },
      actor,
    );
    const state = getClientExitLockState(db);
    broadcastExitLockPayload(state);
    res.json({ ok: true, ...state });
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

  if (
    req.body?.exitUnlockMaxFails != null ||
    req.body?.exitUnlockWindowMinutes != null ||
    req.body?.exitUnlockLockoutMinutes != null ||
    req.body?.exitUnlockCodeRotateDays != null
  ) {
    setExitUnlockRateConfig(
      db,
      {
        exitUnlockMaxFails: req.body.exitUnlockMaxFails,
        exitUnlockWindowMinutes: req.body.exitUnlockWindowMinutes,
        exitUnlockLockoutMinutes: req.body.exitUnlockLockoutMinutes,
        exitUnlockCodeRotateDays: req.body.exitUnlockCodeRotateDays,
      },
      actor,
    );
  }

  /** E2E / CI only: backdate exit_unlock_code_set_at without touching live sqlite from the test runner (WAL race). */
  if (req.body?.exitUnlockCodeSetAt != null) {
    const allow =
      process.env.CLASSROOM_DESK_E2E === '1' ||
      String(process.env.JWT_SECRET ?? '').includes('ci-secret');
    if (!allow) {
      res.status(403).json({
        error: 'e2e_clock_forbidden',
        message: 'exitUnlockCodeSetAt 仅联调/E2E 可用（CLASSROOM_DESK_E2E=1）',
      });
      return;
    }
    const at = String(req.body.exitUnlockCodeSetAt).trim();
    if (!at || !Number.isFinite(Date.parse(at))) {
      res.status(400).json({ error: 'invalid_set_at', message: 'exitUnlockCodeSetAt 须为合法 ISO 时间' });
      return;
    }
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('exit_unlock_code_set_at', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(new Date(Date.parse(at)).toISOString());
  }

  res.json({
    ok: true,
    ...getClientExitLockState(db),
    ...(upgradesPruned ? { pruned: upgradesPruned } : {}),
  });
});

settingsRouter.get('/api/v1/exit-lock/stream', (_req, res) => {
  addExitLockSseClient(res);
});

settingsRouter.get(
  '/api/v1/settings/exit-lock-events',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (req: AuthedRequest, res) => {
    const limit = Number(req.query.limit ?? 20);
    const offset = Number(req.query.offset ?? 0);
    const kind = String(req.query.kind ?? '').trim() || undefined;
    const db = openDb();
    const safeLimit = Number.isFinite(limit) ? limit : 20;
    const safeOffset = Number.isFinite(offset) ? offset : 0;
    const total = countExitLockEvents(db, kind);
    res.json({
      items: listExitLockEvents(db, {
        limit: safeLimit,
        offset: safeOffset,
        kind,
      }),
      total,
      limit: safeLimit,
      offset: safeOffset,
    });
  },
);

settingsRouter.get(
  '/api/v1/settings/backup',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (_req, res) => {
    const db = openDb();
    res.json(getBackupStatus(getSetting(db, 'last_auto_backup_at')));
  },
);

settingsRouter.post(
  '/api/v1/settings/backup-now',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (_req, res) => {
    const result = runDbBackup();
    const db = openDb();
    if (result.ok) {
      db.prepare(
        `INSERT INTO settings (key, value) VALUES ('last_auto_backup_at', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run(nowIso());
    }
    res.status(result.ok ? 200 : 500).json({
      ...result,
      ...getBackupStatus(getSetting(db, 'last_auto_backup_at')),
    });
  },
);

/** Restore wizard: decrypt .enc → sidecar, return checklist + sha256 for live replace. */
settingsRouter.post(
  '/api/v1/settings/backup-restore-preview',
  requireAuth,
  requireRoles('teacher', 'admin'),
  async (req: AuthedRequest, res) => {
    const fileName = path.basename(String(req.body?.fileName ?? ''));
    const passphrase = String(req.body?.passphrase ?? '');
    const commit = req.body?.commit === true;
    if (!fileName.endsWith('.enc') && !fileName.endsWith('.db')) {
      res.status(400).json({
        error: 'backup_file_required',
        message: '请指定 backups 目录下的 .enc 或 .db 文件名',
      });
      return;
    }
    const status = getBackupStatus(getSetting(openDb(), 'last_auto_backup_at'));
    const src = path.join(status.dir, fileName);
    if (!fs.existsSync(src)) {
      res.status(404).json({ error: 'file_not_found' });
      return;
    }
    try {
      let restoredPath = src;
      if (fileName.endsWith('.enc')) {
        restoredPath = path.join(getDataDir(), `classroom.db.restored-${Date.now()}`);
        decryptFileAesGcm(
          src,
          restoredPath,
          passphrase || getSetting(openDb(), 'backup_encrypt_passphrase') || '',
        );
      }
      const hash = createHash('sha256').update(fs.readFileSync(restoredPath)).digest('hex');
      const live = getDbPath();
      const checklist = [
        '1. 通知机房：暂停上课 / 学生端暂时离线',
        '2. 停止 classroom-desk-server 进程（Ctrl+C 或 systemd stop）',
        `3. 备份当前库：复制 ${live} → ${live}.bak-$(date +%Y%m%d)`,
        `4. 校验哈希 sha256=${hash}`,
        `5. 用恢复文件替换：cp "${restoredPath}" "${live}"`,
        '6. 重启服务并打开 /health 确认 ok',
      ];
      if (commit) {
        const confirmCode = String(req.body?.confirmCode ?? '').trim();
        const check = consumeRestoreConfirmCode({
          actorId: req.user!.id,
          sha256: hash,
          code: confirmCode,
        });
        if (!check.ok) {
          res.status(400).json({
            error: check.error,
            message:
              check.error === 'confirm_code_mismatch'
                ? '二次确认码不正确'
                : check.error === 'confirm_code_expired'
                  ? '确认码已过期，请重新「校验哈希」'
                  : '请先完成校验并输入六位确认码',
          });
          return;
        }
        const bak = `${live}.pre-restore-${Date.now()}`;
        fs.copyFileSync(live, bak);
        fs.copyFileSync(restoredPath, live);
        writeAudit({
          actorUserId: req.user!.id,
          actorRole: req.user!.role,
          action: 'backup.restore_commit',
          detail: {
            fileName,
            sha256: hash,
            restoredPath,
            backupOfLive: bak,
            liveDb: live,
          },
        });
        res.json({
          ok: true,
          committed: true,
          restoredPath,
          backupOfLive: bak,
          sha256: hash,
          liveDb: live,
          checklist,
          message: '已校验哈希与确认码并替换 live DB（已先备份为 .pre-restore-*）。请立即重启服务。',
        });
        return;
      }
      const confirmCode = issueRestoreConfirmCode({
        actorId: req.user!.id,
        sha256: hash,
        fileName,
      });
      const delivery = await notifyRestoreConfirm({
        to: getSetting(openDb(), 'restore_confirm_email'),
        code: confirmCode,
        sha256: hash,
        fileName,
        actorUserId: req.user?.id ?? null,
        actorRole: req.user?.role ?? null,
      });
      res.json({
        ok: true,
        committed: false,
        restoredPath,
        liveDb: live,
        sha256: hash,
        confirmCode,
        emailDelivered: delivery.emailDelivered,
        mailtoUrl: delivery.mailtoUrl,
        webhookStatus: delivery.webhookStatus ?? null,
        webhookError: delivery.webhookError ?? null,
        checklist,
        message: delivery.emailDelivered
          ? '已准备恢复文件。确认码已通过邮件 webhook 送达（页面不回显），确认哈希后带 confirmCode 请求 commit:true。'
          : delivery.mailtoUrl
            ? '已准备恢复文件。确认码已签发（可用 mailto）；确认哈希后带 confirmCode 请求 commit:true。'
            : delivery.webhookError
              ? `已准备恢复文件。邮件 webhook 失败（${delivery.webhookError}，已写审计）；请用剪贴板中的确认码。`
              : '已准备恢复文件。确认码已签发一次（剪贴板），确认哈希后带 confirmCode 请求 commit:true。',
      });
    } catch (e) {
      res.status(400).json({
        error: 'restore_failed',
        message: e instanceof Error ? e.message : '恢复失败',
      });
    }
  },
);

settingsRouter.post(
  '/api/v1/settings/recycle-purge-now',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const dryRun = req.body?.dryRun === true || String(req.query.dryRun ?? '') === '1';
    if (dryRun) {
      const preview = previewPurgeExpiredSoftDeletes(openDb());
      writeAudit({
        actorUserId: req.user!.id,
        actorRole: req.user!.role,
        action: 'recycle.purge_preview',
        classId: preview.classId,
        detail: {
          students: preview.students,
          questions: preview.questions,
          count: preview.count,
          classId: preview.classId,
          byClass: preview.byClass.slice(0, 20),
          retentionDays: preview.retentionDays,
          cutoff: preview.cutoff,
          dryRun: true,
        },
      });
      res.json({
        ok: true,
        ...preview,
        message: `预览：将硬删学生 ${preview.students} · 题目 ${preview.questions}（共 ${preview.count}，保留 ${preview.retentionDays} 天，cutoff ${preview.cutoff}）`,
      });
      return;
    }
    const result = purgeExpiredSoftDeletes(openDb());
    writeAudit({
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      action: 'recycle.purge_now',
      detail: result,
    });
    res.json({
      ok: true,
      dryRun: false,
      ...result,
      message: `已按保留 ${result.retentionDays} 天清理：学生 ${result.students} · 题目 ${result.questions}`,
    });
  },
);

/** Open backup directory on the teacher host (server OS). No-op in headless CI. */
settingsRouter.post(
  '/api/v1/settings/backup-open-dir',
  requireAuth,
  requireRoles('teacher', 'admin'),
  async (_req, res) => {
    const status = getBackupStatus(getSetting(openDb(), 'last_auto_backup_at'));
    const dir = status.dir;
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execFileAsync = promisify(execFile);
      if (process.platform === 'darwin') {
        await execFileAsync('open', [dir]);
      } else if (process.platform === 'win32') {
        await execFileAsync('explorer', [dir]);
      } else {
        await execFileAsync('xdg-open', [dir]);
      }
      res.json({ ok: true, dir, opened: true });
    } catch (e) {
      res.json({
        ok: true,
        dir,
        opened: false,
        message: e instanceof Error ? e.message : '无法在本机打开目录（无图形环境时属正常）',
      });
    }
  },
);

settingsRouter.get(
  '/api/v1/settings/exit-lock-events.csv',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (req: AuthedRequest, res) => {
    const limit = Number(req.query.limit ?? 200);
    const offset = Number(req.query.offset ?? 0);
    const kind = String(req.query.kind ?? '').trim();
    const items = listExitLockEvents(openDb(), {
      limit: Number.isFinite(limit) ? limit : 200,
      offset: Number.isFinite(offset) ? offset : 0,
      kind: kind || undefined,
    }) as Array<{
      id: string;
      kind: string;
      actorUserId: string | null;
      actorRole: string | null;
      detail: string;
      clientIp: string | null;
      createdAt: string;
    }>;
    const csv = toCsv(
      ['时间', '类型', '角色', '详情', 'IP', 'ID'],
      items.map((e) => [e.createdAt, e.kind, e.actorRole ?? '', e.detail, e.clientIp ?? '', e.id]),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="exit-lock-events.csv"');
    res.send('\uFEFF' + csv);
  },
);

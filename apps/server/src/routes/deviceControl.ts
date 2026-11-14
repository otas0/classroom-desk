import { Router } from 'express';
import {
  normalizeDeviceControlPolicy,
  normalizeOfflineLockPolicy,
  type OfflineLockScope,
} from '@classroom-desk/shared';
import { openDb } from '../db/client.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import {
  addDeviceControlSseClient,
  broadcastDeviceControl,
  clearDeviceControlScope,
  clearOfflineLockScope,
  deviceControlPublicPayload,
  getDeviceControlPolicy,
  getDeviceControlStore,
  getOfflineLockPolicy,
  getOfflineLockStore,
  publishDeviceCommand,
  saveDeviceControlPolicyScoped,
  saveOfflineLockPolicyScoped,
} from '../services/deviceControl.js';
import { writeAudit } from '../services/audit.js';

export const deviceControlRouter = Router();

function parseScope(raw: unknown): OfflineLockScope {
  const s = String(raw ?? 'global').trim();
  return s === 'class' || s === 'student' || s === 'global' ? s : 'global';
}

function parseStudentIds(body: Record<string, unknown>, query?: Record<string, unknown>): string[] {
  if (Array.isArray(body.studentIds)) {
    return body.studentIds.map((x) => String(x).trim()).filter(Boolean);
  }
  if (body.studentId) return [String(body.studentId).trim()].filter(Boolean);
  const q = String(query?.studentId ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  return q;
}

/** Lab-agent pull (no auth): policy + last command + resolved offline policy. */
deviceControlRouter.get('/api/v1/device-control/public', (req, res) => {
  const classId = String(req.query.classId ?? '').trim() || null;
  const studentId = String(req.query.studentId ?? '').trim() || null;
  res.json(deviceControlPublicPayload(openDb(), { classId, studentId }));
});

deviceControlRouter.get('/api/v1/device-control/stream', (_req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const db = openDb();
  res.write(`event: device_control\ndata: ${JSON.stringify(deviceControlPublicPayload(db))}\n\n`);
  addDeviceControlSseClient(res);
});

deviceControlRouter.get(
  '/api/v1/device-control',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (req: AuthedRequest, res) => {
    const classId = String(req.query.classId ?? '').trim() || null;
    const studentId = String(req.query.studentId ?? '').trim() || null;
    res.json(deviceControlPublicPayload(openDb(), { classId, studentId }));
  },
);

deviceControlRouter.put(
  '/api/v1/device-control/policy',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const db = openDb();
    const scope = parseScope(req.body?.scope);
    const classId = String(req.body?.classId ?? '').trim() || null;
    const studentIds = parseStudentIds((req.body ?? {}) as Record<string, unknown>);
    try {
      const { store, policy } = saveDeviceControlPolicyScoped(
        db,
        normalizeDeviceControlPolicy(req.body?.policy ?? req.body),
        { scope, classId, studentIds },
      );
      writeAudit(
        {
          actorUserId: req.user?.id ?? null,
          actorRole: req.user?.role ?? null,
          action: 'device_control.policy',
          classId,
          detail: {
            scope,
            blockedApps: policy.blockedApps.length,
            blockedHosts: policy.blockedHosts.length,
            studentCount: studentIds.length,
          },
        },
        db,
      );
      broadcastDeviceControl(deviceControlPublicPayload(db, { classId, studentId: studentIds[0] }));
      res.json({ ok: true, policy, store, scope });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'save_failed';
      if (msg === 'class_id_required') {
        res.status(400).json({ error: 'class_id_required', message: '班级范围需要 classId' });
        return;
      }
      if (msg === 'student_ids_required') {
        res.status(400).json({ error: 'student_ids_required', message: '学生范围需要 studentIds' });
        return;
      }
      throw e;
    }
  },
);

deviceControlRouter.put(
  '/api/v1/device-control/offline-policy',
  requireAuth,
  requireRoles('teacher', 'admin'),
  async (req: AuthedRequest, res) => {
    const db = openDb();
    const scope = parseScope(req.body?.scope);
    const classId = String(req.body?.classId ?? '').trim() || null;
    const studentIds = parseStudentIds((req.body ?? {}) as Record<string, unknown>);
    const offlineNorm = normalizeOfflineLockPolicy(
      req.body?.offline ?? req.body?.policy ?? req.body,
    );
    const armFlag =
      req.body?.armMaxSecrecy === true ||
      req.body?.armMaxSecrecy === 1 ||
      req.body?.armMaxSecrecy === '1';
    try {
      const {
        offlinePolicyRequiresLabGoLive,
        assertLabGoLiveReady,
        LabGoLiveBlockedError,
      } = await import('../services/labGoLive.js');
      if (armFlag || offlinePolicyRequiresLabGoLive(offlineNorm)) {
        try {
          await assertLabGoLiveReady(db, classId);
        } catch (e) {
          if (e instanceof LabGoLiveBlockedError) {
            res.status(403).json({
              error: e.code,
              message: e.message,
              blockReasons: e.blockReasons,
              labGoLive: e.labGoLive,
            });
            return;
          }
          throw e;
        }
      }
      const { store, offline } = saveOfflineLockPolicyScoped(db, offlineNorm, {
        scope,
        classId,
        studentIds,
      });
      writeAudit(
        {
          actorUserId: req.user?.id ?? null,
          actorRole: req.user?.role ?? null,
          action: 'device_control.offline_policy',
          classId,
          detail: {
            scope,
            mode: offline.mode,
            graceMs: offline.graceMs,
            freezeClassOnPeerDrop: offline.freezeClassOnPeerDrop,
            studentCount: studentIds.length,
          },
        },
        db,
      );
      broadcastDeviceControl(deviceControlPublicPayload(db, { classId, studentId: studentIds[0] }));
      res.json({ ok: true, offline, store, scope });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'save_failed';
      if (msg === 'class_id_required') {
        res.status(400).json({ error: 'class_id_required', message: '班级范围需要 classId' });
        return;
      }
      if (msg === 'student_ids_required') {
        res.status(400).json({ error: 'student_ids_required', message: '学生范围需要 studentIds' });
        return;
      }
      throw e;
    }
  },
);

/** Clear class/student overrides for both blocklists and offline policy. */
deviceControlRouter.delete(
  '/api/v1/device-control/scope',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const scope = String(req.body?.scope ?? req.query.scope ?? '').trim();
    const classId = String(req.body?.classId ?? req.query.classId ?? '').trim() || null;
    const studentIds = parseStudentIds(
      (req.body ?? {}) as Record<string, unknown>,
      req.query as Record<string, unknown>,
    );
    if (scope !== 'class' && scope !== 'student') {
      res.status(400).json({ error: 'invalid_scope', message: '仅支持清除 class / student 覆盖' });
      return;
    }
    const db = openDb();
    const offlineStore = clearOfflineLockScope(db, { scope, classId, studentIds });
    const policyStore = clearDeviceControlScope(db, { scope, classId, studentIds });
    writeAudit(
      {
        actorUserId: req.user?.id ?? null,
        actorRole: req.user?.role ?? null,
        action: 'device_control.scope_clear',
        classId,
        detail: { scope, studentCount: studentIds.length },
      },
      db,
    );
    broadcastDeviceControl(deviceControlPublicPayload(db, { classId }));
    res.json({
      ok: true,
      offlineStore,
      policyStore,
      offline: getOfflineLockPolicy(db),
      policy: getDeviceControlPolicy(db),
    });
  },
);

/** @deprecated alias — clears offline + blocklist for scope. */
deviceControlRouter.delete(
  '/api/v1/device-control/offline-policy',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const scope = String(req.body?.scope ?? req.query.scope ?? '').trim();
    const classId = String(req.body?.classId ?? req.query.classId ?? '').trim() || null;
    const studentIds = parseStudentIds(
      (req.body ?? {}) as Record<string, unknown>,
      req.query as Record<string, unknown>,
    );
    if (scope !== 'class' && scope !== 'student') {
      res.status(400).json({ error: 'invalid_scope', message: '仅支持清除 class / student 覆盖' });
      return;
    }
    const db = openDb();
    const offlineStore = clearOfflineLockScope(db, { scope, classId, studentIds });
    const policyStore = clearDeviceControlScope(db, { scope, classId, studentIds });
    writeAudit(
      {
        actorUserId: req.user?.id ?? null,
        actorRole: req.user?.role ?? null,
        action: 'device_control.scope_clear',
        classId,
        detail: { scope, studentCount: studentIds.length, via: 'offline-policy' },
      },
      db,
    );
    broadcastDeviceControl(deviceControlPublicPayload(db, { classId }));
    res.json({
      ok: true,
      store: offlineStore,
      offlineStore,
      policyStore,
      offline: getOfflineLockPolicy(db),
      policy: getDeviceControlPolicy(db),
    });
  },
);

deviceControlRouter.post(
  '/api/v1/device-control/command',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const kind = String(req.body?.kind ?? '');
    const classId = String(req.body?.classId ?? '').trim();
    if (!classId) {
      res.status(400).json({ error: 'class_required', message: '需要 classId' });
      return;
    }
    if (kind !== 'open_url' && kind !== 'open_app' && kind !== 'close_apps') {
      res.status(400).json({ error: 'invalid_kind', message: 'kind 无效' });
      return;
    }
    if (kind === 'open_url') {
      const url = String(req.body?.url ?? '').trim();
      if (!/^https?:\/\//i.test(url)) {
        res.status(400).json({ error: 'invalid_url', message: '仅允许 http(s) URL' });
        return;
      }
    }
    if (kind === 'open_app' && !String(req.body?.app ?? '').trim()) {
      res.status(400).json({ error: 'invalid_app', message: '需要应用名' });
      return;
    }
    const studentIds = Array.isArray(req.body?.studentIds)
      ? req.body.studentIds.map((x: unknown) => String(x).trim()).filter(Boolean)
      : [];
    const db = openDb();
    const command = publishDeviceCommand(db, {
      classId,
      studentIds: studentIds.length ? studentIds : undefined,
      kind,
      url: req.body?.url != null ? String(req.body.url) : undefined,
      app: req.body?.app != null ? String(req.body.app) : undefined,
      apps: Array.isArray(req.body?.apps) ? req.body.apps.map(String) : undefined,
    });
    writeAudit(
      {
        actorUserId: req.user?.id ?? null,
        actorRole: req.user?.role ?? null,
        action: 'device_control.command',
        classId,
        detail: {
          kind: command.kind,
          id: command.id,
          studentCount: command.studentIds?.length ?? 0,
        },
      },
      db,
    );
    res.json({
      ok: true,
      command,
      policy: getDeviceControlPolicy(db, { classId }),
      offline: getOfflineLockPolicy(db),
      store: getOfflineLockStore(db),
      policyStore: getDeviceControlStore(db),
    });
  },
);

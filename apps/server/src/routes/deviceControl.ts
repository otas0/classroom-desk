import { Router } from 'express';
import {
  normalizeDeviceControlPolicy,
  normalizeOfflineLockPolicy,
} from '@classroom-desk/shared';
import { openDb } from '../db/client.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import {
  addDeviceControlSseClient,
  broadcastDeviceControl,
  deviceControlPublicPayload,
  getDeviceControlPolicy,
  getOfflineLockPolicy,
  publishDeviceCommand,
  saveDeviceControlPolicy,
  saveOfflineLockPolicy,
} from '../services/deviceControl.js';
import { writeAudit } from '../services/audit.js';

export const deviceControlRouter = Router();

/** Lab-agent pull (no auth): policy + last command + offline policy. */
deviceControlRouter.get('/api/v1/device-control/public', (_req, res) => {
  res.json(deviceControlPublicPayload(openDb()));
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
  (_req, res) => {
    res.json(deviceControlPublicPayload(openDb()));
  },
);

deviceControlRouter.put(
  '/api/v1/device-control/policy',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const db = openDb();
    const policy = saveDeviceControlPolicy(db, normalizeDeviceControlPolicy(req.body?.policy ?? req.body));
    writeAudit(
      {
        actorUserId: req.user?.id ?? null,
        actorRole: req.user?.role ?? null,
        action: 'device_control.policy',
        detail: { blockedApps: policy.blockedApps.length, blockedHosts: policy.blockedHosts.length },
      },
      db,
    );
    broadcastDeviceControl(deviceControlPublicPayload(db));
    res.json({ ok: true, policy });
  },
);

deviceControlRouter.put(
  '/api/v1/device-control/offline-policy',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const db = openDb();
    const offline = saveOfflineLockPolicy(
      db,
      normalizeOfflineLockPolicy(req.body?.offline ?? req.body?.policy ?? req.body),
    );
    writeAudit(
      {
        actorUserId: req.user?.id ?? null,
        actorRole: req.user?.role ?? null,
        action: 'device_control.offline_policy',
        detail: { mode: offline.mode, graceMs: offline.graceMs },
      },
      db,
    );
    broadcastDeviceControl(deviceControlPublicPayload(db));
    res.json({ ok: true, offline });
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
    const db = openDb();
    const command = publishDeviceCommand(db, {
      classId,
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
        detail: { kind: command.kind, id: command.id },
      },
      db,
    );
    res.json({ ok: true, command, policy: getDeviceControlPolicy(db), offline: getOfflineLockPolicy(db) });
  },
);

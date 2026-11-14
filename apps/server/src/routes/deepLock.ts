import { Router } from 'express';
import { openDb } from '../db/client.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { MANAGER_ROLES, STAFF_ROLES } from '../middleware/roles.js';
import {
  applyDeepLockAction,
  clearFocusViolations,
  getDeepLockForClass,
  getDeepLockStore,
  listFocusViolations,
  recordFocusViolation,
  type DeepLockAction,
} from '../services/deepLock.js';
import { addDeepLockSseClient, broadcastDeepLock, buildDeepLockPayload } from '../services/deepLockHub.js';
import { broadcastExitLockPayload } from '../services/exitLockHub.js';
import { getClientExitLockState } from '../services/exitLock.js';
import { broadcastInputLock } from '../services/inputLockHub.js';
import { getShieldConnector } from '../services/shield/registry.js';

export const deepLockRouter = Router();

const ACTIONS = new Set<DeepLockAction>([
  'freeze',
  'exam_net',
  'allow_net',
  'kick_class',
  'end',
  'patch',
]);

deepLockRouter.get('/api/v1/deep-lock', requireAuth, requireRoles(...STAFF_ROLES), (req, res) => {
  const db = openDb();
  const classId = String((req.query.classId as string) ?? '').trim();
  const payload = buildDeepLockPayload(db);
  res.json({
    ...payload,
    state: getDeepLockForClass(db, classId || null),
  });
});

deepLockRouter.get('/api/v1/deep-lock/stream', (_req, res) => {
  addDeepLockSseClient(res);
  // Push current snapshot immediately for late subscribers.
  try {
    broadcastDeepLock(openDb());
  } catch {
    /* ignore */
  }
});

deepLockRouter.get('/api/v1/deep-lock/public', (_req, res) => {
  const db = openDb();
  const store = getDeepLockStore(db);
  res.json({
    type: 'deep_lock',
    at: new Date().toISOString(),
    store,
    shield: {
      id: getShieldConnector().id,
      displayName: getShieldConnector().displayName,
    },
  });
});

deepLockRouter.post(
  '/api/v1/deep-lock/action',
  requireAuth,
  requireRoles(...MANAGER_ROLES),
  async (req: AuthedRequest, res) => {
    const action = String(req.body?.action ?? '').trim() as DeepLockAction;
    if (!ACTIONS.has(action)) {
      res.status(400).json({ error: 'invalid_action', message: '未知深锁动作' });
      return;
    }
    const classId = String(req.body?.classId ?? '').trim();
    const examUrl = req.body?.examUrl != null ? String(req.body.examUrl) : undefined;
    const allowlistHosts = Array.isArray(req.body?.allowlistHosts)
      ? req.body.allowlistHosts
      : undefined;
    const db = openDb();
    const actor = {
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      clientIp: req.ip,
    };
    try {
      const { store, state } = await applyDeepLockAction(
        db,
        {
          action,
          classId: classId || null,
          examUrl,
          allowlistHosts,
          patch: req.body?.patch && typeof req.body.patch === 'object' ? req.body.patch : undefined,
        },
        actor,
      );
      if (action === 'end' && classId) clearFocusViolations(db, classId);
      if (action === 'end' && !classId) clearFocusViolations(db, null);
      let easyJoinCleared = false;
      if (action === 'end') {
        const { maybeAutoOffEasyJoin } = await import('../services/easyJoin.js');
        easyJoinCleared = maybeAutoOffEasyJoin(db, {
          actorUserId: req.user?.id,
          actorRole: req.user?.role,
          clientIp: req.ip,
          reason: 'deep_lock_end',
        });
      }
      broadcastDeepLock(db);
      broadcastInputLock(db);
      broadcastExitLockPayload(getClientExitLockState(db));
      res.json({
        ok: true,
        action,
        state,
        store,
        easyJoinCleared,
        violations: listFocusViolations(db).slice(0, 50),
        shield: {
          id: getShieldConnector().id,
          displayName: getShieldConnector().displayName,
        },
      });
    } catch (e) {
      const { LabGoLiveBlockedError } = await import('../services/labGoLive.js');
      if (e instanceof LabGoLiveBlockedError) {
        res.status(403).json({
          error: e.code,
          message: e.message,
          blockReasons: e.blockReasons,
          labGoLive: e.labGoLive,
        });
        return;
      }
      res.status(400).json({
        error: 'deep_lock_failed',
        message: e instanceof Error ? e.message : 'deep_lock_failed',
      });
    }
  },
);

deepLockRouter.post(
  '/api/v1/deep-lock/focus-violation',
  requireAuth,
  requireRoles('student'),
  (req: AuthedRequest, res) => {
    const db = openDb();
    const studentId = String(req.user?.id ?? '').trim();
    const classId = String(req.body?.classId ?? req.user?.classId ?? '').trim();
    if (!studentId || !classId) {
      res.status(400).json({ error: 'missing_identity' });
      return;
    }
    const state = getDeepLockForClass(db, classId);
    if (!state.focusFreeze && !state.frozen) {
      res.json({ ok: true, ignored: true });
      return;
    }
    const row = recordFocusViolation(db, { studentId, classId });
    broadcastDeepLock(db);
    res.json({ ok: true, violation: row });
  },
);

deepLockRouter.get(
  '/api/v1/deep-lock/shield/health',
  requireAuth,
  requireRoles(...STAFF_ROLES),
  async (_req, res) => {
    const connector = getShieldConnector();
    const health = connector.health ? await connector.health() : { ok: true, detail: 'no_health' };
    res.json({ id: connector.id, displayName: connector.displayName, ...health });
  },
);

import { Router } from 'express';
import { openDb } from '../db/client.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { applyDeepLockAction } from '../services/deepLock.js';
import { clearEasyJoin } from '../services/easyJoin.js';
import { upsertSetting } from '../services/exitLock.js';
import { getPortalSessionEpoch } from '../services/portalSessionRevoke.js';
import { maxSecrecyEnabled } from '../services/maxSecrecy.js';
import {
  twoPersonRequiredResponse,
  verifyTwoPersonRule,
} from '../services/reauth.js';

export const endOfLessonRouter = Router();

const DNS_PROFILE_KEY = 'deskdns_profile';

/**
 * One-shot end-of-class: deep-lock end (epoch + allowlist), DNS profile → normal, easy-join off.
 */
endOfLessonRouter.post(
  '/api/v1/classes/end-of-lesson',
  requireAuth,
  requireRoles('teacher', 'admin'),
  async (req: AuthedRequest, res) => {
    const classId = String(req.body?.classId ?? '').trim();
    if (!classId) {
      res.status(400).json({ error: 'classId_required' });
      return;
    }
    const db = openDb();
    if (maxSecrecyEnabled(db)) {
      const two = await verifyTwoPersonRule(db, {
        userId: req.user?.id,
        role: req.user?.role,
        confirmPassword: req.body?.confirmPassword ?? req.body?.password,
        secondPassword: req.body?.secondPassword,
      });
      if (!two.ok) {
        res.status(403).json(twoPersonRequiredResponse(two.detail));
        return;
      }
    }
    const actor = {
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      clientIp: req.ip,
    };
    await applyDeepLockAction(db, { action: 'end', classId }, actor);
    upsertSetting(db, DNS_PROFILE_KEY, 'normal');
    const easyJoinCleared = clearEasyJoin(db, {
      ...actor,
      reason: 'end_of_lesson',
    });
    res.json({
      ok: true,
      classId,
      portalEpoch: getPortalSessionEpoch(db, classId),
      allowlistCleared: true,
      dnsProfile: 'normal',
      easyJoinCleared,
    });
  },
);

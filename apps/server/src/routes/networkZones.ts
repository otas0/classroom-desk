import { Router } from 'express';
import {
  ensureZoneIds,
  getNetworkZones,
  listZoneViolations,
  saveNetworkZones,
} from '../services/networkZones.js';
import { openDb } from '../db/client.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { MANAGER_ROLES, STAFF_ROLES } from '../middleware/roles.js';
import { normalizeNetworkZones } from '@classroom-desk/shared';

export const networkZonesRouter = Router();

networkZonesRouter.get(
  '/api/v1/network-zones',
  requireAuth,
  requireRoles(...STAFF_ROLES),
  (_req, res) => {
    const db = openDb();
    res.json({
      zones: getNetworkZones(db),
      violations: listZoneViolations(db).slice(0, 80),
    });
  },
);

networkZonesRouter.put(
  '/api/v1/network-zones',
  requireAuth,
  requireRoles(...MANAGER_ROLES),
  (req: AuthedRequest, res) => {
    const db = openDb();
    const incoming = normalizeNetworkZones(req.body?.zones);
    const zones = saveNetworkZones(db, ensureZoneIds(incoming), {
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      clientIp: req.ip,
    });
    res.json({ ok: true, zones });
  },
);

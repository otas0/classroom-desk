import { Router } from 'express';
import {
  ensureZoneIds,
  exportNetworkZonesFirewallMap,
  getNetworkZones,
  listZoneViolations,
  saveNetworkZones,
} from '../services/networkZones.js';
import { openDb } from '../db/client.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { MANAGER_ROLES, STAFF_ROLES } from '../middleware/roles.js';
import { normalizeNetworkZones } from '@classroom-desk/shared';
import { getSetting } from '../db/migrate.js';

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

/**
 * Public firewall export (SSID/CIDR → VLAN). No JWT — lab LAN only.
 * Does not include secrets; VLAN strings are IT mapping hints.
 */
networkZonesRouter.get('/api/v1/network-zones/export', (_req, res) => {
  const db = openDb();
  const body = exportNetworkZonesFirewallMap(db);
  res.json({
    ...body,
    enterprise8021x: {
      required: (getSetting(db, 'enterprise_8021x_required') ?? '0') === '1',
      idp: getSetting(db, 'enterprise_8021x_idp') ?? '',
      staffSsid: getSetting(db, 'enterprise_8021x_staff_ssid') ?? '',
      staffVlan: getSetting(db, 'enterprise_8021x_staff_vlan') ?? '',
      studentSsid: getSetting(db, 'enterprise_8021x_student_ssid') ?? '',
      studentVlan: getSetting(db, 'enterprise_8021x_student_vlan') ?? '',
    },
  });
});

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

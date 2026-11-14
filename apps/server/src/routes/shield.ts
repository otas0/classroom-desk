import { Router } from 'express';
import { openDb } from '../db/client.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { getGatewayPolicySnapshot } from '../services/gatewayPolicy.js';
import { resyncShieldFromDesk } from '../services/deepLock.js';
import { getShieldConnector, listShieldAdapterIds } from '../services/shield/registry.js';
import { getShieldLastError } from '../services/shield/lastError.js';
import { writeAudit } from '../services/audit.js';

export const shieldRouter = Router();

/**
 * Public Shield/net intent for appliances (no JWT).
 * Includes gateway allowlist + deepLock + blockedHosts (DeskDNS-shaped).
 */
shieldRouter.get('/api/v1/shield/policy', (_req, res) => {
  const db = openDb();
  const gw = getGatewayPolicySnapshot(db);
  const connector = getShieldConnector();
  res.json({
    type: 'shield_policy',
    at: gw.at,
    epoch: gw.epoch,
    adapter: connector.id,
    displayName: connector.displayName,
    adapters: listShieldAdapterIds(),
    lastError: getShieldLastError(),
    allowedIps: gw.allowedIps,
    items: gw.items,
    deepLock: gw.deepLock,
    blockedHosts: gw.blockedHosts,
    portalHost: gw.portalHost,
    teacherApiHosts: gw.teacherApiHosts,
  });
});

/** Staff: force re-push current Desk intent to the active Shield adapter. */
shieldRouter.post(
  '/api/v1/shield/pull-sync',
  requireAuth,
  requireRoles('teacher', 'admin'),
  async (req: AuthedRequest, res) => {
    const db = openDb();
    const connector = getShieldConnector();
    if (!connector.id || connector.id === 'off') {
      res.status(400).json({
        error: 'shield_off',
        message: '未启用 Shield 适配器（settings.shieldAdapter）',
      });
      return;
    }
    const result = await resyncShieldFromDesk(db);
    writeAudit(
      {
        actorUserId: req.user?.id ?? null,
        actorRole: req.user?.role ?? null,
        action: 'shield.pull_sync',
        detail: { adapter: connector.id, classes: result.classes },
      },
      db,
    );
    res.json({
      ok: true,
      adapter: connector.id,
      classes: result.classes,
      lastError: getShieldLastError(),
    });
  },
);

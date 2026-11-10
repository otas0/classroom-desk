import { Router } from 'express';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { productCapabilities } from '../services/portalAuth.js';
import { listShieldAdapterIds } from '../services/shield/registry.js';
import { buildPrincipalStatsPayload } from '../services/principalHub.js';

export const principalRouter = Router();

/**
 * Read-only campus board for principals: live online + violation counts + capability flags.
 * Realtime: WebSocket /api/v1/principal/ws?token=
 */
principalRouter.get(
  '/api/v1/principal/stats',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (_req: AuthedRequest, res) => {
    const stats = buildPrincipalStatsPayload();
    res.json({
      ...stats,
      capabilities: {
        ...productCapabilities(),
        netShieldAdapters: listShieldAdapterIds(),
        netShieldActive: stats.shield.active,
        netDnsRunning: stats.deskDns.running,
      },
    });
  },
);

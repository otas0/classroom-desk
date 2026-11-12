import { Router } from 'express';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { productCapabilities } from '../services/portalAuth.js';
import { listShieldAdapterIds } from '../services/shield/registry.js';
import { buildPrincipalStatsPayload } from '../services/principalHub.js';
import { buildPrincipalOpsCsv } from '../services/principalOpsExport.js';

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

principalRouter.get(
  '/api/v1/principal/ops-export.csv',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (_req: AuthedRequest, res) => {
    const stamp = new Date().toISOString().slice(0, 10);
    const csv = buildPrincipalOpsCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="principal-ops-${stamp}.csv"`);
    res.send(`\uFEFF${csv}`);
  },
);

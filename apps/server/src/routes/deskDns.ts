import { Router } from 'express';
import { openDb } from '../db/client.js';
import { getDeskDnsResolveSnapshot, getDeskDnsStatus } from '../services/deskDns.js';

export const deskDnsRouter = Router();

/**
 * Public policy for embedded DeskDNS + bypass/sidecar DeskDNS.
 * Lab LAN only — same trust model as /api/v1/device-control/public.
 */
deskDnsRouter.get('/api/v1/desk-dns/policy', (_req, res) => {
  const snap = getDeskDnsResolveSnapshot(openDb());
  res.json({
    ...snap,
    status: getDeskDnsStatus(),
  });
});

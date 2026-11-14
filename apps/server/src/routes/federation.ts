import { Router } from 'express';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import {
  buildLocalAnnouncePayload,
  listFederationPeers,
  upsertFederationPeer,
  type FederationPeer,
} from '../services/federationHub.js';

export const federationRouter = Router();

/** Public list of recently announced podia (LAN federation). */
federationRouter.get('/api/v1/federation/peers', (_req, res) => {
  res.json({ ok: true, peers: listFederationPeers() });
});

/** Ingest peer announce (local hub or CLASSROOM_DESK_FEDERATION_HUB target). */
federationRouter.post('/api/v1/federation/ingest', (req, res) => {
  const body = req.body ?? {};
  const apiBase = String(body.apiBase ?? '')
    .trim()
    .replace(/\/$/, '');
  if (!apiBase || !/^https?:\/\//i.test(apiBase) || /127\.0\.0\.1|localhost/i.test(apiBase)) {
    res.status(400).json({ error: 'invalid_api_base' });
    return;
  }
  const peer: FederationPeer = {
    apiBase,
    displayName: String(body.displayName ?? '').trim().slice(0, 64),
    roomId: String(body.roomId ?? '').trim().slice(0, 32),
    roomCode: body.roomCode ? String(body.roomCode).trim().slice(0, 16) : null,
    hostName: String(body.hostName ?? '').trim().slice(0, 64),
    classId: body.classId ? String(body.classId).trim() : null,
    className: body.className ? String(body.className).trim().slice(0, 64) : null,
    updatedAt: new Date().toISOString(),
    // Status-only fields from peer — never used for remote lock commands.
    netMode: body.netMode != null ? String(body.netMode).trim().slice(0, 32) : null,
    examActive: Boolean(body.examActive),
    frozen: Boolean(body.frozen),
  };
  const peers = upsertFederationPeer(peer);
  res.json({ ok: true, peers: peers.length });
});

federationRouter.post(
  '/api/v1/federation/announce',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (_req: AuthedRequest, res) => {
    const self = buildLocalAnnouncePayload();
    upsertFederationPeer(self);
    res.json({ ok: true, peer: self, peers: listFederationPeers() });
  },
);

/** Room-mode: find peer by room id (exact, case-insensitive). */
federationRouter.get('/api/v1/federation/rooms/:roomId', (req, res) => {
  const roomId = String(req.params.roomId ?? '')
    .trim()
    .toLowerCase();
  if (!roomId) {
    res.status(400).json({ error: 'room_id_required' });
    return;
  }
  const hits = listFederationPeers().filter((p) => p.roomId.toLowerCase() === roomId);
  res.json({ ok: true, roomId, peers: hits });
});

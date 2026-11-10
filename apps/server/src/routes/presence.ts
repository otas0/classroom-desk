import { Router } from 'express';
import { openDb } from '../db/client.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { findUserById, mapUser, verifyToken } from '../services/auth.js';
import {
  addPresenceSseClient,
  broadcastPresence,
  listPresenceClients,
  presenceSnapshot,
} from '../services/presenceHub.js';
import { newId, nowIso } from '../utils/id.js';
import { enforceStudentZonePolicy } from '../services/networkZones.js';

export const presenceRouter = Router();

const ONLINE_MS = 90_000;

/**
 * In-app presence heartbeat only — used for auto attendance + fleet version.
 * Does not capture screens, keyboard, camera, or other system activity.
 */
presenceRouter.post(
  '/api/v1/presence/heartbeat',
  requireAuth,
  requireRoles('student'),
  async (req: AuthedRequest, res) => {
    if (!req.user?.classId) {
      res.status(400).json({ error: 'class_required' });
      return;
    }
    const db = openDb();
    const now = nowIso();
    const clientVersion = String(req.body?.clientVersion ?? req.body?.version ?? '')
      .trim()
      .slice(0, 32);
    const clientPlatform = String(req.body?.clientPlatform ?? req.body?.platform ?? '')
      .trim()
      .slice(0, 64);
    const clientId = String(req.body?.clientId ?? req.body?.presenceClientId ?? '')
      .trim()
      .slice(0, 64);
    const hardened =
      req.body?.hardened === true ||
      req.body?.hardened === 1 ||
      req.body?.hardened === '1'
        ? 1
        : 0;
    const netHintRaw = req.body?.networkHint ?? req.body?.netHint;
    const netSsid = String(netHintRaw?.ssid ?? req.body?.netSsid ?? '')
      .trim()
      .slice(0, 128);
    const netIpv4 = String(netHintRaw?.ipv4 ?? req.body?.netIpv4 ?? '')
      .trim()
      .slice(0, 64);
    const netGateway = String(netHintRaw?.gateway ?? req.body?.netGateway ?? '')
      .trim()
      .slice(0, 64);
    const hint = { ssid: netSsid, ipv4: netIpv4, gateway: netGateway };

    const zoneResult = await enforceStudentZonePolicy(db, {
      studentId: req.user.id,
      classId: req.user.classId,
      clientId,
      hint,
    });
    const zoneId = zoneResult.zone?.id ?? '';
    const zoneUnauthorized = zoneResult.unauthorized ? 1 : 0;

    db.prepare(
      `INSERT INTO presence_heartbeats (
         student_id, class_id, last_seen_at, client_version, client_platform, client_id, hardened,
         net_ssid, net_ipv4, net_gateway, net_zone_id, net_zone_unauthorized
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(student_id) DO UPDATE SET
         class_id = excluded.class_id,
         last_seen_at = excluded.last_seen_at,
         client_version = excluded.client_version,
         client_platform = excluded.client_platform,
         client_id = CASE
           WHEN excluded.client_id != '' THEN excluded.client_id
           ELSE presence_heartbeats.client_id
         END,
         hardened = excluded.hardened,
         net_ssid = excluded.net_ssid,
         net_ipv4 = excluded.net_ipv4,
         net_gateway = excluded.net_gateway,
         net_zone_id = excluded.net_zone_id,
         net_zone_unauthorized = excluded.net_zone_unauthorized`,
    ).run(
      req.user.id,
      req.user.classId,
      now,
      clientVersion,
      clientPlatform,
      clientId,
      hardened,
      netSsid,
      netIpv4,
      netGateway,
      zoneId,
      zoneUnauthorized,
    );

    // Auto check-in for open auto sessions if online during window.
    const sessions = db
      .prepare(
        `SELECT * FROM attendance_sessions
         WHERE class_id = ? AND mode = 'auto' AND status = 'open' AND start_at <= ? AND end_at >= ?`,
      )
      .all(req.user.classId, now, now) as Array<{
      id: string;
      start_at: string;
      late_after_minutes: number;
    }>;

    for (const session of sessions) {
      const existing = db
        .prepare(`SELECT id FROM attendance_records WHERE session_id = ? AND student_id = ?`)
        .get(session.id, req.user.id);
      if (existing) continue;
      const lateBoundary = new Date(session.start_at).getTime() + session.late_after_minutes * 60_000;
      const status = Date.now() > lateBoundary ? 'late' : 'present';
      db.prepare(
        `INSERT INTO attendance_records
          (id, session_id, student_id, status, checked_at, source, remark, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, 'auto', '', NULL, NULL)`,
      ).run(newId(), session.id, req.user.id, status, now);
    }

    broadcastPresence(req.user.classId);
    res.json({
      ok: true,
      at: now,
      networkZone: zoneResult.zone
        ? { id: zoneResult.zone.id, label: zoneResult.zone.label }
        : null,
      networkUnauthorized: zoneResult.unauthorized,
      networkAction: zoneResult.action,
    });
  },
);

/** Recent student desktops for a class (teacher checklist / version drift). */
presenceRouter.get(
  '/api/v1/presence/clients',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (req: AuthedRequest, res) => {
    const classId = String(req.query.classId ?? '').trim();
    if (!classId) {
      res.status(400).json({ error: 'class_id_required' });
      return;
    }
    const sinceMs = Number(req.query.sinceMs ?? ONLINE_MS);
    const rows = listPresenceClients(
      classId,
      Number.isFinite(sinceMs) && sinceMs > 0 ? sinceMs : ONLINE_MS,
    );
    const snap = presenceSnapshot(classId);
    res.json({
      classId,
      onlineWindowMs: Number.isFinite(sinceMs) && sinceMs > 0 ? sinceMs : ONLINE_MS,
      count: snap.count,
      versions: snap.versions,
      hardenedCount: snap.hardenedCount,
      unhardenedCount: snap.unhardenedCount,
      items: rows,
    });
  },
);

/**
 * Teacher presence SSE. EventSource cannot set Authorization → pass JWT as ?token=.
 * Path: GET /api/v1/presence/stream?classId=&token=
 */
presenceRouter.get('/api/v1/presence/stream', async (req, res) => {
  const classId = String(req.query.classId ?? '').trim();
  const token = String(req.query.token ?? '').trim();
  if (!classId || !token) {
    res.status(400).json({ error: 'class_id_and_token_required' });
    return;
  }
  const payload = await verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const dbUser = findUserById(openDb(), payload.id);
  if (!dbUser) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const user = mapUser(dbUser);
  if (user.role !== 'teacher' && user.role !== 'admin' && user.role !== 'assistant') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  addPresenceSseClient(res, classId);
});
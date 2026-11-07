import type { Response } from 'express';
import { openDb } from '../db/client.js';

const ONLINE_MS = 90_000;

export type PresenceClientRow = {
  studentId: string;
  classId: string;
  lastSeenAt: string;
  clientVersion: string;
  clientPlatform: string;
  displayName: string;
  studentNo: string | null;
};

type PresencePayload = {
  type: 'presence';
  classId: string;
  at: string;
  count: number;
  versions: string[];
  items: PresenceClientRow[];
};

type Sub = { res: Response; classId: string };

const sseClients = new Set<Sub>();

export function listPresenceClients(classId: string, sinceMs = ONLINE_MS): PresenceClientRow[] {
  const cutoff = new Date(Date.now() - (Number.isFinite(sinceMs) && sinceMs > 0 ? sinceMs : ONLINE_MS)).toISOString();
  return openDb()
    .prepare(
      `SELECT p.student_id AS studentId, p.class_id AS classId, p.last_seen_at AS lastSeenAt,
              p.client_version AS clientVersion, p.client_platform AS clientPlatform,
              u.display_name AS displayName, u.student_no AS studentNo
       FROM presence_heartbeats p
       JOIN users u ON u.id = p.student_id
       WHERE p.class_id = ? AND p.last_seen_at >= ?
       ORDER BY p.last_seen_at DESC`,
    )
    .all(classId, cutoff) as PresenceClientRow[];
}

export function presenceSnapshot(classId: string): PresencePayload {
  const items = listPresenceClients(classId);
  const versions = [...new Set(items.map((r) => r.clientVersion).filter(Boolean))];
  return {
    type: 'presence',
    classId,
    at: new Date().toISOString(),
    count: items.length,
    versions,
    items,
  };
}

export function broadcastPresence(classId: string) {
  if (!classId) return;
  const payload = presenceSnapshot(classId);
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  for (const sub of sseClients) {
    if (sub.classId !== classId) continue;
    try {
      sub.res.write(line);
    } catch {
      sseClients.delete(sub);
    }
  }
}

/** SSE for teacher presence board. Auth via ?token= (EventSource cannot set headers). */
export function addPresenceSseClient(res: Response, classId: string) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const sub: Sub = { res, classId };
  sseClients.add(sub);
  res.write(`data: ${JSON.stringify(presenceSnapshot(classId))}\n\n`);
  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      clearInterval(heartbeat);
      sseClients.delete(sub);
    }
  }, 25000);
  res.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(sub);
  });
}

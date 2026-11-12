import type { Response } from 'express';
import { openDb } from '../db/client.js';

const ONLINE_MS = 90_000;

export type PresenceClientRow = {
  studentId: string;
  classId: string;
  lastSeenAt: string;
  clientVersion: string;
  clientPlatform: string;
  /** Stable machine id from student desktop (for seat-scoped input lock). */
  clientId: string;
  /** Student-reported Assigned Access / MDM signal (0/1). */
  hardened: boolean;
  netSsid: string;
  netIpv4: string;
  netZoneId: string;
  netZoneUnauthorized: boolean;
  displayName: string;
  studentNo: string | null;
  seatId: string | null;
  seatLabel: string | null;
};

type PresencePayload = {
  type: 'presence';
  classId: string;
  at: string;
  count: number;
  versions: string[];
  hardenedCount: number;
  unhardenedCount: number;
  items: PresenceClientRow[];
};

type Sub = { res: Response; classId: string };

const sseClients = new Set<Sub>();

export function listPresenceClients(classId: string, sinceMs = ONLINE_MS): PresenceClientRow[] {
  const cutoff = new Date(Date.now() - (Number.isFinite(sinceMs) && sinceMs > 0 ? sinceMs : ONLINE_MS)).toISOString();
  const rows = openDb()
    .prepare(
      `SELECT p.student_id AS studentId, p.class_id AS classId, p.last_seen_at AS lastSeenAt,
              p.client_version AS clientVersion, p.client_platform AS clientPlatform,
              COALESCE(p.client_id, '') AS clientId,
              COALESCE(p.hardened, 0) AS hardenedInt,
              COALESCE(p.net_ssid, '') AS netSsid,
              COALESCE(p.net_ipv4, '') AS netIpv4,
              COALESCE(p.net_zone_id, '') AS netZoneId,
              COALESCE(p.net_zone_unauthorized, 0) AS netZoneUnauthorizedInt,
              u.display_name AS displayName, u.student_no AS studentNo,
              s.id AS seatId, s.label AS seatLabel
       FROM presence_heartbeats p
       JOIN users u ON u.id = p.student_id
       LEFT JOIN seat_map s ON s.class_id = p.class_id AND s.student_id = p.student_id
       WHERE p.class_id = ? AND p.last_seen_at >= ?
       ORDER BY p.last_seen_at DESC`,
    )
    .all(classId, cutoff) as Array<
    Omit<PresenceClientRow, 'hardened' | 'netZoneUnauthorized'> & {
      hardenedInt?: number;
      netZoneUnauthorizedInt?: number;
    }
  >;
  return rows.map((r) => {
    const { hardenedInt, netZoneUnauthorizedInt, ...rest } = r;
    return {
      ...rest,
      hardened: Number(hardenedInt ?? 0) === 1,
      netZoneUnauthorized: Number(netZoneUnauthorizedInt ?? 0) === 1,
    };
  });
}

export function presenceSnapshot(classId: string): PresencePayload {
  const items = listPresenceClients(classId);
  const versions = [...new Set(items.map((r) => r.clientVersion).filter(Boolean))];
  const hardenedCount = items.filter((i) => i.hardened).length;
  return {
    type: 'presence',
    classId,
    at: new Date().toISOString(),
    count: items.length,
    versions,
    hardenedCount,
    unhardenedCount: items.length - hardenedCount,
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
  // Keep principal campus board in sync when seats come online.
  void import('./principalHub.js')
    .then((m) => m.broadcastPrincipalStats())
    .catch(() => undefined);
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
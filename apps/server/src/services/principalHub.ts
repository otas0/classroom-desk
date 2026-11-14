import { createHash } from 'node:crypto';
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { openDb } from '../db/client.js';
import { findUserById, mapUser, verifyToken } from './auth.js';
import { listFocusViolations } from './deepLock.js';
import { listZoneViolations } from './networkZones.js';
import { listPresenceClients } from './presenceHub.js';
import { getDeskDnsStatus } from './deskDns.js';
import { getShieldConnector } from './shield/registry.js';
import { getClientExitLockState } from './exitLock.js';

type Client = { send: (data: string) => void };

const clients = new Set<Client>();
const ONLINE_MS = 90_000;
let ticker: ReturnType<typeof setInterval> | null = null;

export function buildPrincipalStatsPayload() {
  const db = openDb();
  const classes = db
    .prepare(`SELECT id, name FROM classes ORDER BY created_at DESC`)
    .all() as Array<{ id: string; name: string }>;

  let onlineTotal = 0;
  let rosterTotal = 0;
  let unauthorizedNet = 0;
  const byClass: Array<{
    classId: string;
    name: string;
    roster: number;
    online: number;
    netZoneUnauthorized: number;
  }> = [];

  for (const c of classes) {
    const roster = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM users
             WHERE role = 'student' AND class_id = ?
               AND (deleted_at IS NULL OR deleted_at = '')`,
          )
          .get(c.id) as { n: number }
      ).n,
    );
    const clientsOnline = listPresenceClients(c.id, ONLINE_MS);
    const unauth = clientsOnline.filter((x) => x.netZoneUnauthorized).length;
    rosterTotal += roster;
    onlineTotal += clientsOnline.length;
    unauthorizedNet += unauth;
    byClass.push({
      classId: c.id,
      name: c.name,
      roster,
      online: clientsOnline.length,
      netZoneUnauthorized: unauth,
    });
  }

  const focusViolations = listFocusViolations(db);
  const zoneViolations = listZoneViolations(db);
  const shield = getShieldConnector();
  const deskDns = getDeskDnsStatus();

  // Aggregate ops metrics without student PII (counts only).
  const today = new Date().toISOString().slice(0, 10);
  let deepLockSessionsToday = 0;
  let portalAdmitsToday = 0;
  try {
    deepLockSessionsToday = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM teacher_audit_log
             WHERE action LIKE 'deep_lock.%'
               AND substr(created_at, 1, 10) = ?`,
          )
          .get(today) as { n: number }
      ).n,
    );
    portalAdmitsToday = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM teacher_audit_log
             WHERE action LIKE 'portal.%'
               AND substr(created_at, 1, 10) = ?`,
          )
          .get(today) as { n: number }
      ).n,
    );
  } catch {
    /* audit table unavailable in some tests */
  }
  const unlockRotationDue = Boolean(getClientExitLockState(db).exitUnlockCodeRotationDue);

  return {
    type: 'principal' as const,
    ok: true,
    generatedAt: new Date().toISOString(),
    onlineTotal,
    rosterTotal,
    unauthorizedNet,
    focusViolationEvents: focusViolations.reduce((s, v) => s + (v.count || 1), 0),
    focusViolationStudents: focusViolations.length,
    zoneViolationEvents: zoneViolations.length,
    deepLockSessionsToday,
    portalAdmitsToday,
    unlockCodeOverdueClasses: unlockRotationDue ? 1 : 0,
    byClass,
    deskDns,
    shield: { active: shield.id, displayName: shield.displayName },
  };
}

export function broadcastPrincipalStats() {
  if (!clients.size) return;
  const payload = JSON.stringify(buildPrincipalStatsPayload());
  for (const c of clients) {
    try {
      c.send(payload);
    } catch {
      clients.delete(c);
    }
  }
}

function ensureTicker() {
  if (ticker) return;
  ticker = setInterval(() => {
    if (!clients.size) return;
    broadcastPrincipalStats();
  }, 5_000);
}

function wsReject(socket: Duplex, status: number, body: string) {
  try {
    socket.write(
      `HTTP/1.1 ${status} Error\r\nContent-Type: text/plain\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
    );
  } catch {
    /* ignore */
  }
  socket.destroy();
}

/** Campus principal board WebSocket — live online/violation counts. */
export function attachPrincipalWebSocket(server: HttpServer) {
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    if (!url.pathname.startsWith('/api/v1/principal/ws')) return;
    void head;
    const token = String(url.searchParams.get('token') ?? '').trim();
    const key = req.headers['sec-websocket-key'];
    if (!token || !key || typeof key !== 'string') {
      wsReject(socket, 401, 'unauthorized');
      return;
    }
    void (async () => {
      const payload = await verifyToken(token);
      if (!payload) {
        wsReject(socket, 401, 'unauthorized');
        return;
      }
      const dbUser = findUserById(openDb(), payload.id);
      if (!dbUser) {
        wsReject(socket, 401, 'unauthorized');
        return;
      }
      const user = mapUser(dbUser);
      if (user.role !== 'teacher' && user.role !== 'admin' && user.role !== 'assistant') {
        wsReject(socket, 403, 'forbidden');
        return;
      }
      const accept = createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Accept: ${accept}\r\n` +
          '\r\n',
      );

      const send = (data: string) => {
        const payloadBuf = Buffer.from(data);
        const len = payloadBuf.length;
        let header: Buffer;
        if (len < 126) {
          header = Buffer.alloc(2);
          header[0] = 0x81;
          header[1] = len;
        } else if (len < 65536) {
          header = Buffer.alloc(4);
          header[0] = 0x81;
          header[1] = 126;
          header.writeUInt16BE(len, 2);
        } else {
          header = Buffer.alloc(10);
          header[0] = 0x81;
          header[1] = 127;
          header.writeBigUInt64BE(BigInt(len), 2);
        }
        socket.write(Buffer.concat([header, payloadBuf]));
      };

      const client: Client = { send };
      clients.add(client);
      ensureTicker();
      try {
        send(JSON.stringify(buildPrincipalStatsPayload()));
      } catch {
        clients.delete(client);
      }

      socket.on('close', () => clients.delete(client));
      socket.on('error', () => clients.delete(client));
      socket.on('data', () => {
        /* ignore client frames; server pushes */
      });
    })();
  });
}

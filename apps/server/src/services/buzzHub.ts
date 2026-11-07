import { createHash } from 'node:crypto';
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { openDb } from '../db/client.js';
import { findUserById, mapUser, verifyToken } from './auth.js';

type Client = { send: (data: string) => void; classId: string };

const clients = new Set<Client>();

export function buzzSnapshot(classId: string) {
  const db = openDb();
  const round = db
    .prepare(
      `SELECT id, class_id AS classId, status, opened_at AS openedAt, closed_at AS closedAt,
              winner_student_id AS winnerStudentId, reason
       FROM buzz_rounds WHERE class_id = ? ORDER BY opened_at DESC LIMIT 1`,
    )
    .get(classId) as Record<string, unknown> | undefined;
  const hits = round
    ? (db
        .prepare(
          `SELECT h.student_id AS studentId, h.hit_at AS hitAt, u.display_name AS displayName, u.student_no AS studentNo
           FROM buzz_hits h JOIN users u ON u.id = h.student_id
           WHERE h.round_id = ? ORDER BY h.hit_at ASC LIMIT 30`,
        )
        .all(String(round.id)) as Array<Record<string, unknown>>)
    : [];
  return { type: 'buzz', classId, at: new Date().toISOString(), round: round ?? null, hits };
}

export function broadcastBuzz(classId: string) {
  if (!classId) return;
  const payload = JSON.stringify(buzzSnapshot(classId));
  for (const c of clients) {
    if (c.classId !== classId) continue;
    try {
      c.send(payload);
    } catch {
      clients.delete(c);
    }
  }
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

export function attachBuzzWebSocket(server: HttpServer) {
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    if (!url.pathname.startsWith('/api/v1/session/buzz/ws')) return;
    void head;
    const classId = String(url.searchParams.get('classId') ?? '').trim();
    const token = String(url.searchParams.get('token') ?? '').trim();
    const key = req.headers['sec-websocket-key'];
    if (!classId || !token || !key || typeof key !== 'string') {
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
      if (
        (dbUser.role === 'assistant' || dbUser.role === 'teacher') &&
        dbUser.disabled_at != null &&
        String(dbUser.disabled_at).trim() !== ''
      ) {
        wsReject(socket, 401, 'account_disabled');
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
      const client: Client = {
        classId,
        send(data: string) {
          socket.write(encodeWsText(data));
        },
      };
      clients.add(client);
      client.send(JSON.stringify(buzzSnapshot(classId)));
      socket.on('close', () => clients.delete(client));
      socket.on('error', () => clients.delete(client));
      socket.on('data', () => undefined);
    })().catch(() => wsReject(socket, 500, 'upgrade_failed'));
  });
}

function encodeWsText(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  if (len < 126) {
    const out = Buffer.alloc(2 + len);
    out[0] = 0x81;
    out[1] = len;
    payload.copy(out, 2);
    return out;
  }
  if (len < 65536) {
    const out = Buffer.alloc(4 + len);
    out[0] = 0x81;
    out[1] = 126;
    out.writeUInt16BE(len, 2);
    payload.copy(out, 4);
    return out;
  }
  const out = Buffer.alloc(10 + len);
  out[0] = 0x81;
  out[1] = 127;
  out.writeBigUInt64BE(BigInt(len), 2);
  payload.copy(out, 10);
  return out;
}

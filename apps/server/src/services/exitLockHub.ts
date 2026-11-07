import { createHash } from 'node:crypto';
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Response } from 'express';

type ExitLockPayload = Record<string, unknown> & { type: 'exit_lock'; at: string };

const sseClients = new Set<Response>();
const wsClients = new Set<{ send: (data: string) => void; close: () => void }>();

let lastPayload: ExitLockPayload = {
  type: 'exit_lock',
  at: new Date().toISOString(),
  clientExitAllowed: false,
};

export function broadcastExitLockPayload(state: Record<string, unknown>) {
  const payload: ExitLockPayload = {
    type: 'exit_lock',
    at: new Date().toISOString(),
    ...state,
  };
  lastPayload = payload;
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(line);
    } catch {
      sseClients.delete(res);
    }
  }
  const text = JSON.stringify(payload);
  for (const ws of wsClients) {
    try {
      ws.send(text);
    } catch {
      wsClients.delete(ws);
    }
  }
}

/** SSE for EventSource fallback. */
export function addExitLockSseClient(res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  sseClients.add(res);
  res.write(`data: ${JSON.stringify(lastPayload)}\n\n`);
  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 25000);
  res.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
}

/**
 * Minimal WebSocket accept (RFC6455) without external deps — classroom LAN only.
 * Path: /api/v1/exit-lock/ws
 */
export function attachExitLockWebSocket(server: HttpServer) {
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = req.url ?? '';
    if (!url.startsWith('/api/v1/exit-lock/ws')) return;
    void head;
    const key = req.headers['sec-websocket-key'];
    if (!key || typeof key !== 'string') {
      socket.destroy();
      return;
    }
    const accept = websocketAcceptKey(key);
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n` +
        '\r\n',
    );

    const client = {
      send(data: string) {
        socket.write(encodeWsText(data));
      },
      close() {
        try {
          socket.end();
        } catch {
          /* ignore */
        }
      },
    };
    wsClients.add(client);
    client.send(JSON.stringify(lastPayload));

    socket.on('close', () => wsClients.delete(client));
    socket.on('error', () => wsClients.delete(client));
    socket.on('data', () => {
      /* ignore client frames; server→client push only */
    });
  });
}

function websocketAcceptKey(secKey: string): string {
  return createHash('sha1')
    .update(secKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
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

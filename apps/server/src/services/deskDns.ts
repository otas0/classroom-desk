import dgram from 'node:dgram';
import { openDb } from '../db/client.js';
import { getDeviceControlPolicy } from './deviceControl.js';

/**
 * Optional classroom DNS (CLASSROOM_DESK_DNS=1, default UDP 5353).
 * Device-control blocked hosts resolve to 0.0.0.0; other queries are forwarded.
 */
let sock: dgram.Socket | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let blocked = new Set<string>();

function refreshBlocked() {
  try {
    const policy = getDeviceControlPolicy(openDb());
    blocked = new Set(policy.blockedHosts.map((h) => h.toLowerCase()));
  } catch {
    blocked = new Set();
  }
}

function hostBlocked(name: string): boolean {
  const host = name.replace(/\.$/, '').toLowerCase();
  for (const h of blocked) {
    if (host === h || host.endsWith(`.${h}`)) return true;
  }
  return false;
}

function readName(buf: Buffer, offset: number): { name: string; next: number } {
  const labels: string[] = [];
  let o = offset;
  let next = offset;
  let jumped = false;
  for (let guard = 0; guard < 32 && o < buf.length; guard += 1) {
    const len = buf[o] ?? 0;
    if (len === 0) {
      if (!jumped) next = o + 1;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      const ptr = ((len & 0x3f) << 8) | (buf[o + 1] ?? 0);
      if (!jumped) next = o + 2;
      jumped = true;
      o = ptr;
      continue;
    }
    labels.push(buf.subarray(o + 1, o + 1 + len).toString('utf8'));
    o += 1 + len;
    if (!jumped) next = o;
  }
  return { name: labels.join('.'), next };
}

function sinkResponse(query: Buffer): Buffer | null {
  if (query.length < 12) return null;
  const { name } = readName(query, 12);
  if (!name || !hostBlocked(name)) return null;
  const qd = query.subarray(12);
  const header = Buffer.alloc(12);
  query.copy(header, 0, 0, 12);
  header[2] = 0x81;
  header[3] = 0x80;
  header[6] = 0;
  header[7] = 1;
  const answer = Buffer.from([
    0xc0, 0x0c, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x1e, 0x00, 0x04, 0, 0, 0, 0,
  ]);
  return Buffer.concat([header, qd, answer]);
}

function forward(query: Buffer, upstream: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const u = dgram.createSocket('udp4');
    const timer = setTimeout(() => {
      try {
        u.close();
      } catch {
        /* ignore */
      }
      reject(new Error('dns_forward_timeout'));
    }, 2000);
    u.once('message', (msg) => {
      clearTimeout(timer);
      u.close();
      resolve(msg);
    });
    u.once('error', (err) => {
      clearTimeout(timer);
      try {
        u.close();
      } catch {
        /* ignore */
      }
      reject(err);
    });
    u.send(query, 53, upstream);
  });
}

export function startDeskDns() {
  if (process.env.CLASSROOM_DESK_DNS !== '1') return;
  if (sock) return;
  const port = Number(process.env.CLASSROOM_DESK_DNS_PORT ?? 5353);
  const upstream = process.env.CLASSROOM_DESK_DNS_UPSTREAM ?? '1.1.1.1';
  refreshBlocked();
  refreshTimer = setInterval(refreshBlocked, 5_000);
  sock = dgram.createSocket('udp4');
  sock.on('message', (msg, rinfo) => {
    const sink = sinkResponse(msg);
    if (sink) {
      sock?.send(sink, rinfo.port, rinfo.address);
      return;
    }
    void forward(msg, upstream)
      .then((res) => sock?.send(res, rinfo.port, rinfo.address))
      .catch(() => undefined);
  });
  sock.on('error', (err) => {
    console.error('[deskdns]', err instanceof Error ? err.message : err);
  });
  sock.bind(port, '0.0.0.0', () => {
    console.log(`[deskdns] listening udp/${port} (blocked hosts → 0.0.0.0, else ${upstream})`);
  });
}

export function stopDeskDns() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  try {
    sock?.close();
  } catch {
    /* ignore */
  }
  sock = null;
}

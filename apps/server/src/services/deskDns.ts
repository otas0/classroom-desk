import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import { openDb } from '../db/client.js';
import { getSetting } from '../db/migrate.js';
import { getDeepLockStore } from './deepLock.js';
import { getDeviceControlPolicy } from './deviceControl.js';
import { resolveDeepLockState, deepLockAggressive } from '@classroom-desk/shared';

/**
 * Lightweight DeskDNS — single-network schools point DHCP DNS here.
 * When deep-lock netMode=deny → NXDOMAIN for most names (except portal host allow).
 * When allowlist → only listed hosts resolve via upstream.
 * When allow/idle → recurse upstream.
 * Device-control blocked hosts resolve to 0.0.0.0.
 *
 * Enable: CLASSROOM_DESK_DNS=1  PORT default 5353 (use 53 with cap_net_bind).
 */
let server: dgram.Socket | null = null;

function readName(buf: Buffer, offset: number): { name: string; offset: number } {
  const labels: string[] = [];
  let jumped = false;
  let pos = offset;
  let end = offset;
  for (let guard = 0; guard < 32; guard++) {
    if (pos >= buf.length) break;
    const len = buf[pos]!;
    if (len === 0) {
      if (!jumped) end = pos + 1;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      const ptr = ((len & 0x3f) << 8) | buf[pos + 1]!;
      if (!jumped) end = pos + 2;
      pos = ptr;
      jumped = true;
      continue;
    }
    pos += 1;
    labels.push(buf.subarray(pos, pos + len).toString('ascii'));
    pos += len;
    if (!jumped) end = pos;
  }
  return { name: labels.join('.').toLowerCase(), offset: end };
}

function encodeName(name: string): Buffer {
  const parts = name.split('.').filter(Boolean);
  const chunks: number[] = [];
  for (const p of parts) {
    chunks.push(p.length);
    for (let i = 0; i < p.length; i++) chunks.push(p.charCodeAt(i));
  }
  chunks.push(0);
  return Buffer.from(chunks);
}

function buildResponse(req: Buffer, name: string, ips: string[] | null): Buffer {
  const id = req.subarray(0, 2);
  const flags = Buffer.from([0x81, ips && ips.length ? 0x80 : 0x83]); // QR+RD+RA or NXDOMAIN
  const counts = Buffer.alloc(8);
  counts.writeUInt16BE(1, 0); // QDCOUNT
  counts.writeUInt16BE(ips && ips.length ? ips.length : 0, 2);
  const qName = encodeName(name);
  const qTail = Buffer.from([0x00, 0x01, 0x00, 0x01]); // A IN
  const question = Buffer.concat([qName, qTail]);
  const answers: Buffer[] = [];
  if (ips) {
    for (const ip of ips) {
      const parts = ip.split('.').map((x) => Number(x));
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) continue;
      const rr = Buffer.concat([
        encodeName(name),
        Buffer.from([0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x3c, 0x00, 0x04]),
        Buffer.from(parts),
      ]);
      answers.push(rr);
    }
  }
  return Buffer.concat([id, flags, counts, question, ...answers]);
}

function deviceHostBlocked(name: string): boolean {
  try {
    const host = name.replace(/\.$/, '').toLowerCase();
    const hosts = getDeviceControlPolicy(openDb()).blockedHosts.map((h) => h.toLowerCase());
    return hosts.some((h) => h && (host === h || host.endsWith(`.${h}`)));
  } catch {
    return false;
  }
}

async function resolvePolicy(name: string): Promise<string[] | null> {
  if (deviceHostBlocked(name)) return ['0.0.0.0'];
  const db = openDb();
  const store = getDeepLockStore(db);
  const state = resolveDeepLockState(store, null);
  const profile = (getSetting(db, 'deskdns_profile') || 'normal').toLowerCase();
  const portalHost = String(process.env.CLASSROOM_DESK_PORTAL_HOST ?? '')
    .trim()
    .toLowerCase();

  if (portalHost && (name === portalHost || name.endsWith(`.${portalHost}`))) {
    try {
      return await dns.resolve4(name);
    } catch {
      return null;
    }
  }

  // Forced exam profile (deep-lock follow or teacher preset): NXDOMAIN except portal.
  if (profile === 'exam') return null;

  if (!deepLockAggressive(state) && state.netMode === 'allow' && profile !== 'exam') {
    try {
      return await dns.resolve4(name);
    } catch {
      return null;
    }
  }

  if (state.netMode === 'deny') return null;

  if (state.netMode === 'allowlist') {
    const ok = state.allowlistHosts.some(
      (h) => name === h || name.endsWith(`.${h}`) || h.endsWith(`.${name}`),
    );
    if (!ok) return null;
    try {
      return await dns.resolve4(name);
    } catch {
      return null;
    }
  }

  try {
    return await dns.resolve4(name);
  } catch {
    return null;
  }
}

let boundPort: number | null = null;
let bindError: string | null = null;

function readDeskDnsConfig(): { enabled: boolean; port: number } {
  const envOn =
    process.env.CLASSROOM_DESK_DNS === '1' || process.env.CLASSROOM_DESK_DNS === 'true';
  let settingsOn = false;
  let settingsPort: number | null = null;
  try {
    const db = openDb();
    settingsOn = (getSetting(db, 'desk_dns_enabled') ?? '0') === '1';
    const p = Number(getSetting(db, 'desk_dns_port') ?? 5353);
    if (Number.isFinite(p) && p > 0 && p < 65536) settingsPort = Math.trunc(p);
  } catch {
    /* db not ready */
  }
  const envPort = Number(process.env.CLASSROOM_DESK_DNS_PORT ?? NaN);
  const port =
    Number.isFinite(envPort) && envPort > 0
      ? Math.trunc(envPort)
      : (settingsPort ?? 5353);
  return { enabled: envOn || settingsOn, port };
}

export function startDeskDns(port?: number) {
  if (server) return server;
  const cfg = readDeskDnsConfig();
  if (!cfg.enabled) return null;
  const listenPort = port ?? cfg.port;
  server = dgram.createSocket('udp4');
  server.on('message', (msg, rinfo) => {
    void (async () => {
      try {
        if (msg.length < 12) return;
        const { name } = readName(msg, 12);
        if (!name) return;
        const qtype = msg.readUInt16BE(msg.length >= 14 ? msg.length - 4 : 0);
        // Only handle A in this MVP (type in question section — re-parse simply)
        const ips = await resolvePolicy(name);
        const resp = buildResponse(msg, name, ips);
        server?.send(resp, rinfo.port, rinfo.address);
        void qtype;
      } catch {
        /* ignore malformed */
      }
    })();
  });
  server.on('error', (err) => {
    bindError = err.message;
    console.error(`[desk-dns] bind error: ${err.message}`);
  });
  server.bind(listenPort, () => {
    boundPort = listenPort;
    bindError = null;
    console.log(`[desk-dns] listening udp/${listenPort}`);
  });
  return server;
}

export function stopDeskDns() {
  server?.close();
  server = null;
  boundPort = null;
  bindError = null;
}

/** Re-read settings/env and (re)bind. */
export function reloadDeskDnsFromConfig() {
  stopDeskDns();
  return startDeskDns();
}

export function getDeskDnsStatus(): {
  enabled: boolean;
  running: boolean;
  port: number | null;
  error: string | null;
} {
  const cfg = readDeskDnsConfig();
  return {
    enabled: cfg.enabled,
    running: Boolean(server && boundPort != null && !bindError),
    port: boundPort ?? (cfg.enabled ? cfg.port : null),
    error: bindError,
  };
}

/**
 * DNS-SD / mDNS advertise for `_classroomdesk._tcp.local`.
 * Complements UDP beacon; still does not pierce AP isolation (use room code).
 */
import os from 'node:os';
import multicastDns from 'multicast-dns';
import { encodeRoomCode } from '@classroom-desk/shared';
import { config } from '../config.js';
import { openDb } from '../db/client.js';
import { getSetting } from '../db/migrate.js';
import { orderedLanIpsForAdvertise, resolveAdvertiseLanIp } from './lanNetwork.js';
import { maxSecrecyAirgap } from './maxSecrecy.js';

type Mdns = ReturnType<typeof multicastDns>;

let mdns: Mdns | null = null;
let announceTimer: ReturnType<typeof setInterval> | null = null;

function lanIps(): string[] {
  return orderedLanIpsForAdvertise(openDb());
}

function serviceInstance(): string {
  const host = os.hostname().replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 40) || 'teacher';
  return `${host}._classroomdesk._tcp.local`;
}

function txtRecords(): string[] {
  const db = openDb();
  const displayName = String(getSetting(db, 'classroom_display_name') ?? '').trim();
  const roomId = String(getSetting(db, 'classroom_room_id') ?? '').trim();
  const advertiseIp = resolveAdvertiseLanIp(db);
  const roomCode = advertiseIp ? encodeRoomCode(advertiseIp) : '';
  const storedBase = String(getSetting(db, 'classroom_api_base') ?? '').trim().replace(/\/$/, '');
  let apiBase = storedBase;
  if (!apiBase || /127\.0\.0\.1|localhost/i.test(apiBase)) {
    apiBase = advertiseIp ? `http://${advertiseIp}:${config.port}` : '';
  }
  return [
    `txtvers=1`,
    `port=${config.port}`,
    apiBase ? `apiBase=${apiBase}` : '',
    displayName ? `displayName=${displayName.slice(0, 64)}` : '',
    roomId ? `roomId=${roomId.slice(0, 32)}` : '',
    roomCode ? `roomCode=${roomCode}` : '',
  ].filter(Boolean);
}

function answers() {
  const name = serviceInstance();
  const host = `${os.hostname().replace(/[^a-zA-Z0-9-.]/g, '-') || 'teacher'}.local`;
  const ips = lanIps();
  const records: Array<Record<string, unknown>> = [
    {
      name: '_classroomdesk._tcp.local',
      type: 'PTR',
      ttl: 120,
      data: name,
    },
    {
      name,
      type: 'SRV',
      ttl: 120,
      data: { priority: 0, weight: 0, port: config.port, target: host },
    },
    {
      name,
      type: 'TXT',
      ttl: 120,
      data: txtRecords(),
    },
  ];
  for (const ip of ips.slice(0, 4)) {
    records.push({ name: host, type: 'A', ttl: 120, data: ip });
  }
  return records;
}

function announce() {
  if (!mdns) return;
  try {
    if (maxSecrecyAirgap(openDb())) return;
  } catch {
    /* continue */
  }
  try {
    mdns.respond({ answers: answers() as never });
  } catch {
    /* ignore */
  }
}

export function startClassroomMdns(): void {
  if (mdns) return;
  if (process.env.CLASSROOM_DESK_MDNS === '0') {
    console.log('[classroom-mdns] disabled (CLASSROOM_DESK_MDNS=0)');
    return;
  }
  try {
    if (maxSecrecyAirgap(openDb())) {
      console.log('[classroom-mdns] disabled (max_secrecy airgap)');
      return;
    }
  } catch {
    /* continue */
  }
  try {
    mdns = multicastDns();
    mdns.on('query', (...args: never[]) => {
      const query = args[0] as { questions?: Array<{ name?: string; type?: string }> };
      const hit = (query.questions ?? []).some((q) => {
        const n = String(q.name ?? '').toLowerCase();
        return (
          n === '_classroomdesk._tcp.local' ||
          n.endsWith('._classroomdesk._tcp.local') ||
          n === '_services._dns-sd._udp.local'
        );
      });
      if (hit) announce();
    });
    mdns.on('error', (...args: never[]) => {
      const e = args[0] as Error;
      console.warn('[classroom-mdns]', e?.message ?? e);
    });
    announce();
    announceTimer = setInterval(announce, 30_000);
    console.log('[classroom-mdns] advertising _classroomdesk._tcp.local');
  } catch (e) {
    console.warn('[classroom-mdns] start failed', e instanceof Error ? e.message : e);
    mdns = null;
  }
}

/** Re-announce after teacher changes advertise LAN IP / display settings. */
export function bumpClassroomMdnsAnnounce(): void {
  announce();
}

export function stopClassroomMdns(): void {
  if (announceTimer) {
    clearInterval(announceTimer);
    announceTimer = null;
  }
  if (mdns) {
    try {
      mdns.destroy();
    } catch {
      /* ignore */
    }
    mdns = null;
  }
}

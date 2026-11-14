/**
 * Multi-teacher LAN federation: peers announce themselves; students/teachers
 * can list other podia without scanning every /24.
 * Optional external hub: CLASSROOM_DESK_FEDERATION_HUB=https://hub/api/v1/federation/ingest
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encodeRoomCode } from '@classroom-desk/shared';
import { config } from '../config.js';
import { getDataDir, openDb } from '../db/client.js';
import { getSetting } from '../db/migrate.js';
import { getDeepLockForClass } from './deepLock.js';

export type FederationPeer = {
  apiBase: string;
  displayName: string;
  roomId: string;
  roomCode: string | null;
  hostName: string;
  classId: string | null;
  className: string | null;
  updatedAt: string;
  /**
   * Status-only interop (no remote lockdown): deep-lock net mode for this room's default class.
   * Consumers may show “exam in progress” — must NOT apply remote freeze/kick.
   */
  netMode?: string | null;
  examActive?: boolean;
  frozen?: boolean;
};

const TTL_MS = 5 * 60_000;

function peersPath(): string {
  return path.join(getDataDir(), 'federation-peers.json');
}

function readStore(): FederationPeer[] {
  try {
    const raw = fs.readFileSync(peersPath(), 'utf8');
    const j = JSON.parse(raw) as { peers?: FederationPeer[] };
    return Array.isArray(j.peers) ? j.peers : [];
  } catch {
    return [];
  }
}

function writeStore(peers: FederationPeer[]) {
  fs.mkdirSync(path.dirname(peersPath()), { recursive: true });
  fs.writeFileSync(peersPath(), JSON.stringify({ peers }, null, 2), 'utf8');
}

function prune(peers: FederationPeer[], now = Date.now()): FederationPeer[] {
  return peers.filter((p) => {
    const t = Date.parse(p.updatedAt);
    return Number.isFinite(t) && now - t < TTL_MS;
  });
}

export function listFederationPeers(): FederationPeer[] {
  return prune(readStore()).sort((a, b) =>
    (a.displayName || a.roomId || a.apiBase).localeCompare(b.displayName || b.roomId || b.apiBase),
  );
}

export function upsertFederationPeer(peer: FederationPeer): FederationPeer[] {
  const next = prune(readStore()).filter(
    (p) => p.apiBase.replace(/\/$/, '') !== peer.apiBase.replace(/\/$/, ''),
  );
  next.push({ ...peer, apiBase: peer.apiBase.replace(/\/$/, '') });
  writeStore(next);
  return prune(next);
}

export function buildLocalAnnouncePayload(): FederationPeer {
  const db = openDb();
  const displayName = String(getSetting(db, 'classroom_display_name') ?? '').trim();
  const roomId = String(getSetting(db, 'classroom_room_id') ?? '').trim();
  const classId = String(getSetting(db, 'student_easy_join_class_id') ?? '').trim() || null;
  let className: string | null = null;
  if (classId) {
    const row = db.prepare(`SELECT name FROM classes WHERE id = ?`).get(classId) as
      | { name?: string }
      | undefined;
    className = String(row?.name ?? '').trim() || null;
  }
  let apiBase = String(getSetting(db, 'classroom_api_base') ?? '')
    .trim()
    .replace(/\/$/, '');
  if (!apiBase || /127\.0\.0\.1|localhost/i.test(apiBase)) {
    let ip = '';
    for (const list of Object.values(os.networkInterfaces())) {
      for (const n of list ?? []) {
        if (n.family === 'IPv4' && !n.internal) {
          ip = n.address;
          break;
        }
      }
      if (ip) break;
    }
    apiBase = ip ? `http://${ip}:${config.port}` : `http://127.0.0.1:${config.port}`;
  }
  let lanIp = '';
  try {
    lanIp = new URL(apiBase).hostname;
  } catch {
    lanIp = '';
  }
  let netMode: string | null = null;
  let examActive = false;
  let frozen = false;
  try {
    const state = getDeepLockForClass(db, classId);
    netMode = state.netMode;
    frozen = Boolean(state.frozen);
    examActive =
      Boolean(state.frozen) ||
      state.netMode === 'deny' ||
      state.netMode === 'allowlist' ||
      Boolean(state.examUrl);
  } catch {
    /* deep-lock optional at announce time */
  }
  return {
    apiBase,
    displayName,
    roomId,
    roomCode: lanIp ? encodeRoomCode(lanIp) : null,
    hostName: os.hostname(),
    classId,
    className,
    updatedAt: new Date().toISOString(),
    netMode,
    examActive,
    frozen,
  };
}

let announceTimer: ReturnType<typeof setInterval> | null = null;

/** Settings first, then CLASSROOM_DESK_FEDERATION_HUB / TOKEN env. */
export function resolveFederationHubIngest(db = openDb()): { hub: string; token: string } {
  const hubSetting = String(getSetting(db, 'federation_hub_url') ?? '').trim();
  const hub = hubSetting || String(process.env.CLASSROOM_DESK_FEDERATION_HUB ?? '').trim();
  const tokenSetting = String(getSetting(db, 'federation_hub_token') ?? '').trim();
  const token =
    tokenSetting ||
    String(
      process.env.CLASSROOM_DESK_FEDERATION_HUB_TOKEN ?? process.env.FEDERATION_HUB_TOKEN ?? '',
    ).trim();
  return { hub, token };
}

export function startFederationAnnounce(): void {
  if (announceTimer) return;
  const tick = () => {
    try {
      const self = buildLocalAnnouncePayload();
      upsertFederationPeer(self);
      const db = openDb();
      const { hub, token } = resolveFederationHubIngest(db);
      if (hub && /^https?:\/\//i.test(hub)) {
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (token) headers.authorization = `Bearer ${token}`;
        void fetch(hub, {
          method: 'POST',
          headers,
          body: JSON.stringify(self),
        }).catch(() => undefined);
      }
    } catch {
      /* ignore */
    }
  };
  tick();
  announceTimer = setInterval(tick, 60_000);
}

export function stopFederationAnnounce(): void {
  if (announceTimer) {
    clearInterval(announceTimer);
    announceTimer = null;
  }
}

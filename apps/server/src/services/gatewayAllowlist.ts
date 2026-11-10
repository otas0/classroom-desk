import type { DatabaseSync } from 'node:sqlite';
import { getSetting } from '../db/migrate.js';
import { nowIso } from '../utils/id.js';
import { upsertSetting } from './exitLock.js';

const KEY = 'gateway_allowed_clients';

export type GatewayAllowEntry = {
  clientKey: string;
  studentId?: string;
  ip?: string;
  mac?: string;
  expiresAt: number;
  updatedAt: string;
};

type Bucket = Record<string, GatewayAllowEntry>;

function read(db: DatabaseSync): Bucket {
  const raw = getSetting(db, KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Bucket;
  } catch {
    return {};
  }
}

function write(db: DatabaseSync, bucket: Bucket) {
  const now = Date.now();
  const next: Bucket = {};
  for (const [k, v] of Object.entries(bucket)) {
    if (v.expiresAt > now) next[k] = v;
  }
  upsertSetting(db, KEY, JSON.stringify(next));
}

/** After portal admit allow — gateway may permit this IP until TTL. */
export function grantGatewayAccess(
  db: DatabaseSync,
  opts: { clientKey: string; studentId?: string; ip?: string; mac?: string; ttlSec?: number },
): GatewayAllowEntry {
  const ttl = Math.max(60, Math.min(86_400, Number(opts.ttlSec) || 12 * 3600));
  const bucket = read(db);
  const entry: GatewayAllowEntry = {
    clientKey: opts.clientKey,
    studentId: opts.studentId,
    ip: opts.ip,
    mac: opts.mac,
    expiresAt: Date.now() + ttl * 1000,
    updatedAt: nowIso(),
  };
  bucket[opts.clientKey] = entry;
  write(db, bucket);
  return entry;
}

export function revokeGatewayAccess(db: DatabaseSync, clientKey: string) {
  const bucket = read(db);
  delete bucket[clientKey];
  write(db, bucket);
}

export function revokeAllGatewayAccess(db: DatabaseSync) {
  upsertSetting(db, KEY, '{}');
}

export function listGatewayAccess(db: DatabaseSync): GatewayAllowEntry[] {
  return Object.values(read(db));
}

export function isGatewayAllowed(db: DatabaseSync, opts: { clientKey?: string; ip?: string }): boolean {
  const bucket = read(db);
  const now = Date.now();
  if (opts.clientKey && bucket[opts.clientKey] && bucket[opts.clientKey]!.expiresAt > now) {
    return true;
  }
  if (opts.ip) {
    for (const e of Object.values(bucket)) {
      if (e.ip === opts.ip && e.expiresAt > now) return true;
    }
  }
  return false;
}

/** Snippet for IT: walled garden until admit. */
export function walledGardenHint(portalBase: string): string {
  return [
    '# Walled garden (concept)',
    `# Allow DNS + ${portalBase}/portal + ${portalBase}/api/v1/portal/* before auth`,
    '# Deny other WAN until client IP appears in GET /api/v1/gateway/allowlist',
    '# After POST /api/v1/portal/admit → allow, IP is granted here for Shield/OPNsense adapters',
  ].join('\n');
}

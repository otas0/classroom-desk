import type { DatabaseSync } from 'node:sqlite';
import {
  matchNetworkZone,
  normalizeNetworkZones,
  studentUnauthorizedOnZone,
  type NetworkHint,
  type NetworkZone,
  type NetworkZoneUnauthorizedAction,
} from '@classroom-desk/shared';
import { getSetting } from '../db/migrate.js';
import { newId, nowIso } from '../utils/id.js';
import { writeAudit } from './audit.js';
import { upsertSetting } from './exitLock.js';
import { getShieldConnector } from './shield/registry.js';

export const KEY_NETWORK_ZONES = 'network_zones';

export type ZoneViolation = {
  studentId: string;
  classId: string;
  zoneId: string;
  zoneLabel: string;
  ssid: string;
  ipv4: string;
  action: NetworkZoneUnauthorizedAction;
  count: number;
  lastAt: string;
};

const KEY_ZONE_VIOLATIONS = 'network_zone_violations';

export function getNetworkZones(db: DatabaseSync): NetworkZone[] {
  const raw = getSetting(db, KEY_NETWORK_ZONES);
  if (!raw) return [];
  try {
    return normalizeNetworkZones(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveNetworkZones(
  db: DatabaseSync,
  zones: NetworkZone[],
  actor?: { actorUserId?: string; actorRole?: string; clientIp?: string },
): NetworkZone[] {
  const next = normalizeNetworkZones(zones);
  upsertSetting(db, KEY_NETWORK_ZONES, JSON.stringify(next));
  writeAudit(
    {
      action: 'network_zones.save',
      actorUserId: actor?.actorUserId,
      actorRole: actor?.actorRole,
      classId: null,
      detail: `zones=${next.length}`,
      clientIp: actor?.clientIp,
    },
    db,
  );
  return next;
}

export function ensureZoneIds(zones: NetworkZone[]): NetworkZone[] {
  return zones.map((z) => ({
    ...z,
    id: z.id?.trim() || newId(),
  }));
}

export function resolveZoneForHint(db: DatabaseSync, hint: NetworkHint | null | undefined) {
  return matchNetworkZone(getNetworkZones(db), hint);
}

export function listZoneViolations(db: DatabaseSync): ZoneViolation[] {
  const raw = getSetting(db, KEY_ZONE_VIOLATIONS);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as ZoneViolation[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveZoneViolations(db: DatabaseSync, rows: ZoneViolation[]) {
  upsertSetting(
    db,
    KEY_ZONE_VIOLATIONS,
    JSON.stringify(
      rows
        .sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)))
        .slice(0, 500),
    ),
  );
}

export function recordZoneViolation(
  db: DatabaseSync,
  opts: {
    studentId: string;
    classId: string;
    zone: NetworkZone;
    hint: NetworkHint;
  },
): ZoneViolation {
  const list = listZoneViolations(db);
  const at = nowIso();
  const idx = list.findIndex(
    (v) => v.studentId === opts.studentId && v.zoneId === opts.zone.id,
  );
  let row: ZoneViolation;
  if (idx >= 0) {
    row = {
      ...list[idx]!,
      count: list[idx]!.count + 1,
      lastAt: at,
      ssid: String(opts.hint.ssid ?? list[idx]!.ssid ?? ''),
      ipv4: String(opts.hint.ipv4 ?? list[idx]!.ipv4 ?? ''),
      action: opts.zone.studentUnauthorized,
      zoneLabel: opts.zone.label,
    };
    list[idx] = row;
  } else {
    row = {
      studentId: opts.studentId,
      classId: opts.classId,
      zoneId: opts.zone.id,
      zoneLabel: opts.zone.label,
      ssid: String(opts.hint.ssid ?? ''),
      ipv4: String(opts.hint.ipv4 ?? ''),
      action: opts.zone.studentUnauthorized,
      count: 1,
      lastAt: at,
    };
    list.push(row);
  }
  saveZoneViolations(db, list);
  return row;
}

/**
 * If student is on a zone that disallows students, flag and optionally shield deny/kick.
 */
export async function enforceStudentZonePolicy(
  db: DatabaseSync,
  opts: {
    studentId: string;
    classId: string;
    clientId: string;
    hint: NetworkHint;
  },
): Promise<{
  zone: NetworkZone | null;
  unauthorized: boolean;
  action: NetworkZoneUnauthorizedAction | null;
  violation: ZoneViolation | null;
}> {
  const zone = resolveZoneForHint(db, opts.hint);
  const unauthorized = studentUnauthorizedOnZone(zone);
  if (!zone || !unauthorized) {
    return { zone, unauthorized: false, action: null, violation: null };
  }

  const violation = recordZoneViolation(db, {
    studentId: opts.studentId,
    classId: opts.classId,
    zone,
    hint: opts.hint,
  });

  const action = zone.studentUnauthorized;
  const clientKey = String(opts.clientId || opts.studentId).trim();
  const connector = getShieldConnector();
  if (clientKey && (action === 'deny' || action === 'kick')) {
    const ref = {
      clientKey,
      classId: opts.classId,
      studentId: opts.studentId,
    };
    if (action === 'kick') await connector.kickClient(ref);
    else {
      await connector.authorizeClient({
        ...ref,
        mode: 'deny',
        allowlistHosts: [],
      });
    }
  }

  return { zone, unauthorized: true, action, violation };
}

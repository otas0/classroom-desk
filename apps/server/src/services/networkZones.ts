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
  /** staff_zone | never_student_net */
  reason: string;
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

/** Staff-style zones (no student): force portal hint + at least deny on mis-entry. */
export function applyStaffVerificationDefaults(zones: NetworkZone[]): NetworkZone[] {
  return zones.map((z) => {
    if (z.allowedRoles.includes('student')) return z;
    return {
      ...z,
      requirePortal: true,
      studentUnauthorized: z.studentUnauthorized === 'kick' ? 'kick' : 'deny',
    };
  });
}

export function saveNetworkZones(
  db: DatabaseSync,
  zones: NetworkZone[],
  actor?: { actorUserId?: string; actorRole?: string; clientIp?: string },
): NetworkZone[] {
  const next = applyStaffVerificationDefaults(normalizeNetworkZones(zones));
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

/** Firewall/controller export: SSID / CIDR → VLAN (+ roles). LAN-safe public snapshot. */
export function exportNetworkZonesFirewallMap(db: DatabaseSync) {
  const zones = getNetworkZones(db).filter((z) => z.enabled);
  const rows = zones.map((z) => ({
    id: z.id,
    label: z.label,
    ssidIncludes: z.ssidIncludes,
    cidrs: z.cidrs,
    vlan: z.vlan || null,
    allowedRoles: z.allowedRoles,
    defaultNetMode: z.defaultNetMode,
    requirePortal: z.requirePortal,
    studentUnauthorized: z.studentUnauthorized,
  }));
  return {
    type: 'network_zones_export' as const,
    at: new Date().toISOString(),
    rows,
    /** Flat rules for OPNsense/UniFi scripting. */
    rules: rows.flatMap((z) => {
      const out: Array<{
        zoneId: string;
        match: 'ssid' | 'cidr';
        value: string;
        vlan: string | null;
        allowedRoles: string[];
      }> = [];
      for (const s of z.ssidIncludes) {
        out.push({
          zoneId: z.id,
          match: 'ssid',
          value: s,
          vlan: z.vlan,
          allowedRoles: z.allowedRoles,
        });
      }
      for (const c of z.cidrs) {
        out.push({
          zoneId: z.id,
          match: 'cidr',
          value: c,
          vlan: z.vlan,
          allowedRoles: z.allowedRoles,
        });
      }
      return out;
    }),
  };
}

export function resolveZoneForHint(db: DatabaseSync, hint: NetworkHint | null | undefined) {
  return matchNetworkZone(getNetworkZones(db), hint);
}

export function getEverStudentZone(db: DatabaseSync, studentId: string): boolean {
  const row = db
    .prepare(`SELECT net_ever_student_zone AS v FROM users WHERE id = ?`)
    .get(studentId) as { v?: number } | undefined;
  return Number(row?.v ?? 0) === 1;
}

export function markEverStudentZone(db: DatabaseSync, studentId: string) {
  db.prepare(`UPDATE users SET net_ever_student_zone = 1 WHERE id = ? AND role = 'student'`).run(
    studentId,
  );
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
    action: NetworkZoneUnauthorizedAction;
    reason: string;
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
      action: opts.action,
      reason: opts.reason,
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
      action: opts.action,
      reason: opts.reason,
      count: 1,
      lastAt: at,
    };
    list.push(row);
  }
  saveZoneViolations(db, list);
  return row;
}

/** Never seen on student-allowed zone → always block (deny min). */
export function resolveUnauthorizedAction(
  zone: NetworkZone,
  everStudentZone: boolean,
): { action: NetworkZoneUnauthorizedAction; reason: string } {
  if (!everStudentZone) {
    return {
      action: zone.studentUnauthorized === 'kick' ? 'kick' : 'deny',
      reason: 'never_student_net',
    };
  }
  return { action: zone.studentUnauthorized, reason: 'staff_zone' };
}

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
  reason: string | null;
  everStudentZone: boolean;
  violation: ZoneViolation | null;
}> {
  const zone = resolveZoneForHint(db, opts.hint);
  let everStudentZone = getEverStudentZone(db, opts.studentId);

  if (zone && zone.allowedRoles.includes('student')) {
    if (!everStudentZone) {
      markEverStudentZone(db, opts.studentId);
      everStudentZone = true;
    }
    return {
      zone,
      unauthorized: false,
      action: null,
      reason: null,
      everStudentZone,
      violation: null,
    };
  }

  const unauthorized = studentUnauthorizedOnZone(zone);
  if (!zone || !unauthorized) {
    return {
      zone,
      unauthorized: false,
      action: null,
      reason: null,
      everStudentZone,
      violation: null,
    };
  }

  const resolved = resolveUnauthorizedAction(zone, everStudentZone);
  const violation = recordZoneViolation(db, {
    studentId: opts.studentId,
    classId: opts.classId,
    zone,
    hint: opts.hint,
    action: resolved.action,
    reason: resolved.reason,
  });

  const clientKey = String(opts.clientId || opts.studentId).trim();
  const connector = getShieldConnector();
  if (clientKey && (resolved.action === 'deny' || resolved.action === 'kick')) {
    const ref = {
      clientKey,
      classId: opts.classId,
      studentId: opts.studentId,
    };
    if (resolved.action === 'kick') await connector.kickClient(ref);
    else {
      await connector.authorizeClient({
        ...ref,
        mode: 'deny',
        allowlistHosts: [],
      });
    }
  }

  return {
    zone,
    unauthorized: true,
    action: resolved.action,
    reason: resolved.reason,
    everStudentZone,
    violation,
  };
}

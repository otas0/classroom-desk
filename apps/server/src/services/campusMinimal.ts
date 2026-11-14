import type { DatabaseSync } from 'node:sqlite';
import type { NetworkZone } from '@classroom-desk/shared';
import { getSetting } from '../db/migrate.js';
import { upsertSetting } from './exitLock.js';
import { writeAudit } from './audit.js';
import { KEY_NETWORK_ZONES, getNetworkZones, saveNetworkZones } from './networkZones.js';
import { KEY_PORTAL_SSID_REQUIRE_SIG } from './portalSsidSign.js';
import { reloadShieldConnectorFromEnv } from './shield/registry.js';

export type CampusPresetMode = 'soft' | 'hard';

/** Soft campus zones: school renames SSID substrings once; empty CIDR = ignore IP. */
export function defaultCampusZones(): NetworkZone[] {
  return [
    {
      id: 'campus-student',
      label: '学生网',
      ssidIncludes: ['Student', '学生', 'Learn', '教学'],
      cidrs: [],
      allowedRoles: ['student', 'teacher'],
      defaultNetMode: 'allow',
      defaultAllowlistHosts: [],
      studentUnauthorized: 'flag',
      requirePortal: false,
      enabled: true,
    },
    {
      id: 'campus-staff',
      label: '教工网',
      ssidIncludes: ['Staff', 'Teacher', 'Faculty', '教工', '办公'],
      cidrs: [],
      allowedRoles: ['teacher', 'staff'],
      defaultNetMode: 'allow',
      defaultAllowlistHosts: [],
      studentUnauthorized: 'deny',
      requirePortal: true,
      enabled: true,
    },
  ];
}

/**
 * Software-side campus pack in one shot.
 * soft (default): private-device portal + zone templates; SSID sig OFF (less school IT).
 * hard: + force portal SSID signature (needs Captive sign-ssid).
 */
export function applyCampusMinimalPreset(
  db: DatabaseSync,
  opts?: {
    mode?: CampusPresetMode;
    replaceZones?: boolean;
    actor?: { actorUserId?: string; actorRole?: string; clientIp?: string };
  },
): {
  mode: CampusPresetMode;
  zones: number;
  privateDevicePortalOnly: boolean;
  portalSsidRequireSig: boolean;
  shieldHint: string;
} {
  const mode: CampusPresetMode = opts?.mode === 'hard' ? 'hard' : 'soft';
  upsertSetting(db, 'private_device_portal_only', '1');
  upsertSetting(db, KEY_PORTAL_SSID_REQUIRE_SIG, mode === 'hard' ? '1' : '0');
  upsertSetting(db, 'deskdns_follow_deeplock', '1');

  const existing = getNetworkZones(db);
  const replace = opts?.replaceZones !== false;
  let zones = existing;
  if (replace || existing.length === 0) {
    zones = saveNetworkZones(db, defaultCampusZones(), opts?.actor);
  }

  // If env already has a gateway, persist adapter so UI leaves "off".
  const shieldHint = syncShieldAdapterFromEnv(db);

  writeAudit(
    {
      action: 'settings.campus_preset',
      actorUserId: opts?.actor?.actorUserId,
      actorRole: opts?.actor?.actorRole,
      classId: null,
      detail: {
        mode,
        zones: zones.length,
        private_device_portal_only: '1',
        portal_ssid_require_sig: mode === 'hard' ? '1' : '0',
        shieldHint,
      },
      clientIp: opts?.actor?.clientIp,
    },
    db,
  );

  return {
    mode,
    zones: zones.length,
    privateDevicePortalOnly: true,
    portalSsidRequireSig: mode === 'hard',
    shieldHint,
  };
}

/** Map CLASSROOM_DESK_SHIELD / OPNSENSE_* / UNIFI_* into settings.shield_adapter. */
export function syncShieldAdapterFromEnv(db: DatabaseSync): string {
  const kind = String(process.env.CLASSROOM_DESK_SHIELD ?? '')
    .trim()
    .toLowerCase();
  if (kind === 'opnsense' || kind === 'unifi' || kind === 'http' || kind === 'lab') {
    upsertSetting(db, 'shield_adapter', kind === 'lab' ? 'http' : kind);
    if (kind === 'http' || kind === 'lab') {
      const url = String(process.env.CLASSROOM_DESK_SHIELD_URL ?? '').trim();
      if (url) upsertSetting(db, 'shield_http_url', url);
    }
    try {
      reloadShieldConnectorFromEnv();
    } catch {
      /* ignore */
    }
    return `adapter=${kind}`;
  }
  if (process.env.OPNSENSE_URL?.trim() && process.env.OPNSENSE_API_KEY?.trim()) {
    upsertSetting(db, 'shield_adapter', 'opnsense');
    process.env.CLASSROOM_DESK_SHIELD = 'opnsense';
    try {
      reloadShieldConnectorFromEnv();
    } catch {
      /* ignore */
    }
    return 'adapter=opnsense(from OPNSENSE_URL)';
  }
  if (process.env.UNIFI_URL?.trim() && process.env.UNIFI_USER?.trim()) {
    upsertSetting(db, 'shield_adapter', 'unifi');
    process.env.CLASSROOM_DESK_SHIELD = 'unifi';
    try {
      reloadShieldConnectorFromEnv();
    } catch {
      /* ignore */
    }
    return 'adapter=unifi(from UNIFI_URL)';
  }
  const current = String(getSetting(db, 'shield_adapter') ?? '').trim() || 'off';
  return `adapter=${current || 'off'}(unchanged)`;
}

/** Boot hook: CLASSROOM_DESK_CAMPUS=1 → soft preset once if zones empty. */
export function maybeApplyCampusOnBoot(db: DatabaseSync): void {
  const on =
    process.env.CLASSROOM_DESK_CAMPUS === '1' ||
    process.env.CLASSROOM_DESK_CAMPUS === 'true';
  if (!on) {
    syncShieldAdapterFromEnv(db);
    return;
  }
  const raw = getSetting(db, KEY_NETWORK_ZONES);
  const empty = !raw || raw === '[]';
  if (empty) {
    applyCampusMinimalPreset(db, { mode: 'soft', replaceZones: true });
  } else {
    syncShieldAdapterFromEnv(db);
  }
}

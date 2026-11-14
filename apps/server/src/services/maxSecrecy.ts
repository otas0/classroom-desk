import type { DatabaseSync } from 'node:sqlite';
import { getSetting } from '../db/migrate.js';
import { upsertSetting } from './exitLock.js';
import { evaluateNetPathsArmed, securityTierSEnabled } from './securityTier.js';
import { getDeskDnsStatus } from './deskDns.js';
import { getShieldConnector } from './shield/registry.js';
import { writeAudit } from './audit.js';
import { kickStudents } from './sessionKick.js';
import { resealPlaintextSecrets } from './secretAtRest.js';

const KEY_DEEP_LOCK = 'deep_lock_store';

/** Product max-secrecy (school highest). NOT national 绝密. */
export function maxSecrecyEnabled(db: DatabaseSync): boolean {
  const v = getSetting(db, 'max_secrecy_mode');
  if (v == null || v === '') return true;
  return v === '1' || v === 'true';
}

/** Stale Shield heartbeat threshold during exam lock (seconds). Default 60 (more aggressive). */
export function maxSecHeartbeatStaleSec(db: DatabaseSync): number {
  const n = Math.trunc(Number(getSetting(db, 'max_secrecy_heartbeat_stale_sec') ?? 60));
  if (!Number.isFinite(n) || n < 20) return 60;
  return Math.min(n, 3600);
}

/** Staff JWT lifetime under max secrecy (seconds). Default 15 minutes. */
export function maxSecrecyJwtTtlSec(db: DatabaseSync): number {
  const n = Math.trunc(Number(getSetting(db, 'max_secrecy_jwt_ttl_sec') ?? 900));
  if (!Number.isFinite(n) || n < 120) return 900;
  return Math.min(n, 3600);
}

/** Air-gap: no GitHub poll, mDNS, beacon, federation announce. */
export function maxSecrecyAirgap(db: DatabaseSync): boolean {
  if (!maxSecrecyEnabled(db)) return false;
  const v = getSetting(db, 'max_secrecy_airgap');
  if (v == null || v === '') return true;
  return v === '1' || v === 'true';
}

/** Production + max secrecy: refuse staff login without TLS (or loopback). */
export function maxSecrecyRequireTls(db: DatabaseSync): boolean {
  if (!maxSecrecyEnabled(db)) return false;
  if (process.env.NODE_ENV === 'production') return true;
  const v = getSetting(db, 'max_secrecy_require_tls');
  return v === '1' || v === 'true';
}

/**
 * Max-secrecy freeze/exam/kick: BOTH Shield≠off AND DeskDNS running.
 */
export function evaluateDualPathRequired(db: DatabaseSync): {
  required: boolean;
  ok: boolean;
  detail: string;
} {
  if (!maxSecrecyEnabled(db)) {
    return { required: false, ok: true, detail: 'max_secrecy_off' };
  }
  const paths = evaluateNetPathsArmed();
  const ok = paths.shieldArmed && paths.deskDnsArmed;
  return {
    required: true,
    ok,
    detail: `dual_path_required;${paths.detail}`,
  };
}

/** Apply forced posture when enabling max secrecy (idempotent). */
export function applyMaxSecrecyPosture(db: DatabaseSync): Record<string, string> {
  const forced: Record<string, string> = {
    security_tier_s: '1',
    strict_net_fail_closed: '1',
    private_device_portal_only: '1',
    portal_ssid_require_sig: '1',
    student_easy_join: '0',
    student_easy_join_class_id: '',
    deskdns_follow_deeplock: '1',
    max_secrecy_airgap: '1',
    max_secrecy_heartbeat_stale_sec: '60',
    max_secrecy_jwt_ttl_sec: '900',
    federation_hub_url: '',
    student_auto_update: '0',
  };
  for (const [k, v] of Object.entries(forced)) {
    upsertSetting(db, k, v);
  }
  const resealed = resealPlaintextSecrets(db);
  return { ...forced, _resealedSecrets: String(resealed) };
}

export function setMaxSecrecyMode(db: DatabaseSync, on: boolean): void {
  upsertSetting(db, 'max_secrecy_mode', on ? '1' : '0');
  if (on) applyMaxSecrecyPosture(db);
}

function deepLockTight(db: DatabaseSync): boolean {
  const raw = getSetting(db, KEY_DEEP_LOCK);
  if (!raw) return false;
  try {
    const store = JSON.parse(raw) as {
      global?: { frozen?: boolean; netMode?: string };
      byClass?: Record<string, { frozen?: boolean; netMode?: string }>;
    };
    const check = (s?: { frozen?: boolean; netMode?: string }) =>
      Boolean(s?.frozen || s?.netMode === 'deny' || s?.netMode === 'allowlist');
    if (check(store.global)) return true;
    for (const s of Object.values(store.byClass ?? {})) {
      if (check(s)) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function deepenFreezeStore(db: DatabaseSync): void {
  const raw = getSetting(db, KEY_DEEP_LOCK);
  let store: {
    global: Record<string, unknown>;
    byClass: Record<string, Record<string, unknown>>;
  } = {
    global: {},
    byClass: {},
  };
  try {
    if (raw) store = JSON.parse(raw);
  } catch {
    /* keep empty */
  }
  const harden = (s: Record<string, unknown>) => ({
    ...s,
    frozen: true,
    netMode: 'deny',
    killForeignBrowsers: true,
    killDistractions: true,
    focusFreeze: true,
    updatedAt: new Date().toISOString(),
  });
  store.global = harden(store.global ?? {});
  for (const [k, v] of Object.entries(store.byClass ?? {})) {
    store.byClass[k] = harden(v ?? {});
  }
  upsertSetting(db, KEY_DEEP_LOCK, JSON.stringify(store));
}

function kickAllPresentStudents(db: DatabaseSync): number {
  const rows = db
    .prepare(`SELECT DISTINCT student_id AS id FROM presence_heartbeats`)
    .all() as Array<{ id: string }>;
  const ids = rows.map((r) => r.id).filter(Boolean);
  return kickStudents(ids, db);
}

/**
 * During max-secrecy exam lock: if Shield heartbeat stale or DeskDNS died →
 * lockdown + deepen freeze + kick all students.
 */
export function tickMaxSecrecyWatchdog(db: DatabaseSync): {
  lockdown: boolean;
  reason: string | null;
  kicked?: number;
} {
  if (!maxSecrecyEnabled(db) || !securityTierSEnabled(db)) {
    return { lockdown: false, reason: null };
  }
  if (!deepLockTight(db)) return { lockdown: false, reason: null };

  const reasons: string[] = [];
  const shield = getShieldConnector();
  if (shield.id !== 'off') {
    const hb = String(getSetting(db, 'shield_last_heartbeat_at') ?? '').trim();
    const staleSec = maxSecHeartbeatStaleSec(db);
    if (!hb) {
      reasons.push('shield_heartbeat_missing');
    } else {
      const age = (Date.now() - Date.parse(hb)) / 1000;
      if (!Number.isFinite(age) || age > staleSec) {
        reasons.push(`shield_heartbeat_stale:${Math.trunc(age)}s`);
      }
    }
  }
  const dns = getDeskDnsStatus();
  if (!dns.enabled || !dns.running) {
    reasons.push('deskdns_down_during_lock');
  }

  if (!reasons.length) {
    upsertSetting(db, 'max_secrecy_lockdown', '0');
    return { lockdown: false, reason: null };
  }

  const reason = reasons.join(';');
  const prev = getSetting(db, 'max_secrecy_lockdown') === '1';
  upsertSetting(db, 'max_secrecy_lockdown', '1');
  upsertSetting(db, 'max_secrecy_lockdown_reason', reason);

  let kicked = 0;
  if (!prev) {
    deepenFreezeStore(db);
    kicked = kickAllPresentStudents(db);
    writeAudit(
      {
        action: 'maxsec.heartbeat_fail_lockdown',
        detail: { reason, dual: evaluateNetPathsArmed(), kicked, deepened: true },
      },
      db,
    );
  }
  return { lockdown: true, reason, kicked };
}

export function maxSecrecyLockdownActive(db: DatabaseSync): boolean {
  return maxSecrecyEnabled(db) && getSetting(db, 'max_secrecy_lockdown') === '1';
}

/** Client IP binding required for staff JWTs under max secrecy. */
export function maxSecrecyBindIp(db: DatabaseSync): boolean {
  if (!maxSecrecyEnabled(db)) return false;
  const v = getSetting(db, 'max_secrecy_bind_ip');
  if (v == null || v === '') return true;
  return v === '1' || v === 'true';
}

import type { DatabaseSync } from 'node:sqlite';
import { getSetting } from '../db/migrate.js';
import { upsertSetting } from './exitLock.js';
import { evaluateNetPathsArmed, securityTierSEnabled } from './securityTier.js';
import { getDeskDnsStatus } from './deskDns.js';
import { getShieldConnector } from './shield/registry.js';
import { writeAudit } from './audit.js';

const KEY_DEEP_LOCK = 'deep_lock_store';

/** Product max-secrecy (school highest). NOT national 绝密. */
export function maxSecrecyEnabled(db: DatabaseSync): boolean {
  const v = getSetting(db, 'max_secrecy_mode');
  if (v == null || v === '') return true; // aggressive default with S-tier
  return v === '1' || v === 'true';
}

/** Stale Shield heartbeat threshold during exam lock (seconds). */
export function maxSecHeartbeatStaleSec(db: DatabaseSync): number {
  const n = Math.trunc(Number(getSetting(db, 'max_secrecy_heartbeat_stale_sec') ?? 120));
  if (!Number.isFinite(n) || n < 30) return 120;
  return Math.min(n, 3600);
}

/**
 * Max-secrecy freeze/exam/kick: BOTH Shield≠off AND DeskDNS running.
 * Single-path schools must turn max_secrecy_mode off (S-tier OR-path remains).
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
  };
  for (const [k, v] of Object.entries(forced)) {
    upsertSetting(db, k, v);
  }
  return forced;
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

/**
 * During max-secrecy exam lock: if Shield heartbeat stale or DeskDNS died →
 * record lockdown audit (caller may refuse allow_net). Returns true if locked down.
 */
export function tickMaxSecrecyWatchdog(db: DatabaseSync): {
  lockdown: boolean;
  reason: string | null;
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
  if (!prev) {
    writeAudit(
      {
        action: 'maxsec.heartbeat_fail_lockdown',
        detail: { reason, dual: evaluateNetPathsArmed() },
      },
      db,
    );
  }
  return { lockdown: true, reason };
}

export function maxSecrecyLockdownActive(db: DatabaseSync): boolean {
  return maxSecrecyEnabled(db) && getSetting(db, 'max_secrecy_lockdown') === '1';
}

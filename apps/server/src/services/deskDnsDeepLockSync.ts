import type { DatabaseSync } from 'node:sqlite';
import { getSetting } from '../db/migrate.js';
import { upsertSetting } from './exitLock.js';
import { writeAudit } from './audit.js';

const PROFILE_KEY = 'deskdns_profile';
const FOLLOW_KEY = 'deskdns_follow_deeplock';
const STASH_KEY = 'deskdns_profile_before_lock';

/** Default on: deep-lock freeze/exam/kick forces DeskDNS exam; end/allow restores. */
export function deskDnsFollowDeepLock(db: DatabaseSync): boolean {
  const v = getSetting(db, FOLLOW_KEY);
  if (v == null || v === '') return true;
  return v === '1' || v === 'true';
}

export function setDeskDnsFollowDeepLock(db: DatabaseSync, on: boolean) {
  upsertSetting(db, FOLLOW_KEY, on ? '1' : '0');
}

/**
 * When deep lock tightens net, force DeskDNS profile=exam (DNS path + campus path parallel).
 * Stashes prior profile once so end/allow can restore.
 */
export function syncDeskDnsOnDeepLockTighten(
  db: DatabaseSync,
  meta?: { actorUserId?: string; actorRole?: string; clientIp?: string; classId?: string | null },
): { applied: boolean; from: string; to: string } {
  if (!deskDnsFollowDeepLock(db)) {
    return { applied: false, from: '', to: '' };
  }
  const from = getSetting(db, PROFILE_KEY) || 'normal';
  if (from !== 'exam') {
    const existingStash = getSetting(db, STASH_KEY);
    if (!existingStash) upsertSetting(db, STASH_KEY, from);
  }
  upsertSetting(db, PROFILE_KEY, 'exam');
  writeAudit({
    actorUserId: meta?.actorUserId ?? null,
    actorRole: meta?.actorRole ?? 'system',
    action: 'deskdns.follow_deeplock_exam',
    classId: meta?.classId ?? null,
    detail: { from, to: 'exam' },
    clientIp: meta?.clientIp,
  });
  return { applied: true, from, to: 'exam' };
}

/** Restore stashed DeskDNS profile after deep-lock end / allow_net. */
export function syncDeskDnsOnDeepLockRelease(
  db: DatabaseSync,
  meta?: { actorUserId?: string; actorRole?: string; clientIp?: string; classId?: string | null },
): { applied: boolean; restored: string } {
  if (!deskDnsFollowDeepLock(db)) {
    return { applied: false, restored: '' };
  }
  const stash = getSetting(db, STASH_KEY);
  const restored = stash && stash !== 'exam' ? stash : 'normal';
  upsertSetting(db, PROFILE_KEY, restored);
  upsertSetting(db, STASH_KEY, '');
  writeAudit({
    actorUserId: meta?.actorUserId ?? null,
    actorRole: meta?.actorRole ?? 'system',
    action: 'deskdns.follow_deeplock_restore',
    classId: meta?.classId ?? null,
    detail: { restored },
    clientIp: meta?.clientIp,
  });
  return { applied: true, restored };
}

import type { DatabaseSync } from 'node:sqlite';
import {
  deepLockAggressive,
  EMPTY_DEEP_LOCK_STATE,
  normalizeDeepLockState,
  normalizeDeepLockStore,
  resolveDeepLockState,
  type DeepLockNetMode,
  type DeepLockState,
  type DeepLockStore,
} from '@classroom-desk/shared';
import { getSetting } from '../db/migrate.js';
import { nowIso } from '../utils/id.js';
import { writeAudit } from './audit.js';
import { relockClientExit, upsertSetting } from './exitLock.js';
import {
  applyExamModeInputLock,
  restoreExamModeInputLock,
} from './inputLock.js';
import { getShieldConnector } from './shield/registry.js';
import { recordShieldLastError } from './shield/lastError.js';
import {
  revokeGatewayAccessForClass,
  type GatewayAllowEntry,
} from './gatewayAllowlist.js';
import { clearPortalSessionsOnLessonEnd } from './portalSessionRevoke.js';
import {
  syncDeskDnsOnDeepLockRelease,
  syncDeskDnsOnDeepLockTighten,
} from './deskDnsDeepLockSync.js';
import {
  evaluateNetPathsArmed,
  strictNetFailClosed,
} from './securityTier.js';
import {
  evaluateDualPathRequired,
  maxSecrecyEnabled,
  maxSecrecyLockdownActive,
} from './maxSecrecy.js';

export const KEY_DEEP_LOCK = 'deep_lock_store';
export const KEY_DEEP_LOCK_VIOLATIONS = 'deep_lock_violations';

export type DeepLockAction =
  | 'freeze'
  | 'exam_net'
  | 'allow_net'
  | 'kick_class'
  | 'end'
  | 'patch';

export type DeepLockActor = {
  actorUserId?: string;
  actorRole?: string;
  clientIp?: string;
};

export type FocusViolation = {
  studentId: string;
  classId: string;
  count: number;
  lastAt: string;
};

function emptyStore(): DeepLockStore {
  return { global: EMPTY_DEEP_LOCK_STATE(), byClass: {} };
}

export function getDeepLockStore(db: DatabaseSync): DeepLockStore {
  const raw = getSetting(db, KEY_DEEP_LOCK);
  if (!raw) return emptyStore();
  try {
    return normalizeDeepLockStore(JSON.parse(raw));
  } catch {
    return emptyStore();
  }
}

export function saveDeepLockStore(db: DatabaseSync, store: DeepLockStore) {
  upsertSetting(db, KEY_DEEP_LOCK, JSON.stringify(store));
}

export function getDeepLockForClass(db: DatabaseSync, classId?: string | null): DeepLockState {
  return resolveDeepLockState(getDeepLockStore(db), classId);
}

function writeState(
  db: DatabaseSync,
  classId: string | null,
  state: DeepLockState,
): DeepLockStore {
  const store = getDeepLockStore(db);
  const next = normalizeDeepLockState({ ...state, updatedAt: nowIso() });
  if (classId) store.byClass[classId] = next;
  else store.global = next;
  saveDeepLockStore(db, store);
  return store;
}

function parseHosts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((h) =>
      String(h ?? '')
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, ''),
    )
    .filter(Boolean)
    .slice(0, 64);
}

export type ShieldPushSummary = {
  attempted: number;
  failed: number;
  shieldId: string;
  details: string[];
};

async function pushShieldForClass(
  db: DatabaseSync,
  classId: string | null,
  state: DeepLockState,
  kick = false,
): Promise<ShieldPushSummary> {
  const connector = getShieldConnector();
  const summary: ShieldPushSummary = {
    attempted: 0,
    failed: 0,
    shieldId: connector.id,
    details: [],
  };
  const rows = (
    classId
      ? db
          .prepare(
            `SELECT student_id, client_id FROM presence_heartbeats WHERE class_id = ?`,
          )
          .all(classId)
      : db.prepare(`SELECT student_id, client_id FROM presence_heartbeats`).all()
  ) as Array<{ student_id?: string; client_id?: string }>;

  const noteFail = (op: string, clientKey: string, detail?: string) => {
    const msg = `shield.${op} failed · ${clientKey} · ${detail ?? 'ok=false'}`;
    recordShieldLastError(msg);
    summary.failed += 1;
    if (summary.details.length < 12) summary.details.push(msg);
    writeAudit(
      {
        action: `shield.${op}_fail`,
        actorUserId: null,
        actorRole: 'system',
        classId,
        detail: msg,
      },
      db,
    );
  };

  for (const row of rows) {
    const clientKey = String(row.client_id ?? '').trim() || String(row.student_id ?? '').trim();
    if (!clientKey) continue;
    summary.attempted += 1;
    const ref = {
      clientKey,
      classId: classId || undefined,
      studentId: String(row.student_id ?? '') || undefined,
    };
    if (kick) {
      const kicked = await connector.kickClient(ref);
      if (kicked && kicked.ok === false) noteFail('kickClient', clientKey, kicked.detail);
      continue;
    }
    if (state.netMode === 'allow' && !deepLockAggressive(state)) {
      const revoked = await connector.revokeClient(ref);
      if (revoked && revoked.ok === false) noteFail('revokeClient', clientKey, revoked.detail);
    } else {
      const authorized = await connector.authorizeClient({
        ...ref,
        mode: state.netMode,
        allowlistHosts: state.allowlistHosts,
      });
      if (authorized && authorized.ok === false) {
        noteFail('authorizeClient', clientKey, authorized.detail);
      }
    }
  }

  // Honest empty push when shield off during deny/freeze (no clients still worth recording).
  if (
    connector.id === 'off' &&
    (state.frozen || state.netMode === 'deny' || state.netMode === 'allowlist')
  ) {
    const msg = 'shield_not_configured · gateway path will not cut net';
    recordShieldLastError(msg);
    if (!summary.details.includes(msg)) summary.details.push(msg);
    writeAudit(
      {
        action: 'shield.not_configured_during_deeplock',
        actorUserId: null,
        actorRole: 'system',
        classId,
        detail: { frozen: state.frozen, netMode: state.netMode, attempted: summary.attempted },
      },
      db,
    );
  }

  return summary;
}

/** After per-class gateway revoke — drop those IPs/MACs from Shield allow aliases. */
async function syncShieldRemoveAllowEntries(
  db: DatabaseSync,
  classId: string | null,
  removed: GatewayAllowEntry[],
) {
  if (!removed.length) return;
  const connector = getShieldConnector();
  for (const e of removed) {
    const keys = [e.mac, e.ip, e.clientKey].map((x) => String(x ?? '').trim()).filter(Boolean);
    const seen = new Set<string>();
    for (const clientKey of keys) {
      if (seen.has(clientKey)) continue;
      seen.add(clientKey);
      const ref = {
        clientKey,
        classId: classId || e.classId || undefined,
        studentId: e.studentId,
      };
      try {
        const result = connector.releaseClient
          ? await connector.releaseClient(ref)
          : await connector.revokeClient(ref);
        if (result && result.ok === false) {
          const msg = `shield.releaseClient failed · ${clientKey} · ${result.detail ?? 'ok=false'}`;
          recordShieldLastError(msg);
          writeAudit(
            {
              action: 'shield.release_client_fail',
              actorUserId: null,
              actorRole: 'system',
              classId,
              detail: msg,
            },
            db,
          );
        }
      } catch (err) {
        const msg = `shield.releaseClient error · ${clientKey} · ${
          err instanceof Error ? err.message : String(err)
        }`;
        recordShieldLastError(msg);
        writeAudit(
          {
            action: 'shield.release_client_fail',
            actorUserId: null,
            actorRole: 'system',
            classId,
            detail: msg,
          },
          db,
        );
      }
    }
  }
}

export async function applyDeepLockAction(
  db: DatabaseSync,
  opts: {
    action: DeepLockAction;
    classId?: string | null;
    examUrl?: string;
    allowlistHosts?: string[];
    patch?: Partial<DeepLockState>;
  },
  actor?: DeepLockActor,
): Promise<{ store: DeepLockStore; state: DeepLockState; shieldPush: ShieldPushSummary }> {
  const classId = String(opts.classId ?? '').trim() || null;
  const current = getDeepLockForClass(db, classId);
  let next: DeepLockState = { ...current };
  let alsoExamInput = false;
  let restoreExamInput = false;
  let kick = false;

  // Max-secrecy: BOTH Shield and DeskDNS must be armed for tighten.
  if (
    (opts.action === 'freeze' ||
      opts.action === 'exam_net' ||
      opts.action === 'kick_class') &&
    maxSecrecyEnabled(db)
  ) {
    const dual = evaluateDualPathRequired(db);
    if (!dual.ok) {
      writeAudit(
        {
          action: 'deep_lock.maxsec_dual_refuse',
          actorUserId: actor?.actorUserId,
          actorRole: actor?.actorRole,
          classId,
          detail: { action: opts.action, ...dual },
          clientIp: actor?.clientIp,
        },
        db,
      );
      throw new Error(
        `max_secrecy_dual_path: 最高保密档要求 Shield≠off 且 DeskDNS 同时运行后再深锁收紧。(${dual.detail})`,
      );
    }
  } else if (
    (opts.action === 'freeze' ||
      opts.action === 'exam_net' ||
      opts.action === 'kick_class') &&
    strictNetFailClosed(db)
  ) {
    // S-tier (max secrecy off): at least one path armed.
    const paths = evaluateNetPathsArmed();
    if (!paths.anyArmed) {
      writeAudit(
        {
          action: 'deep_lock.strict_refuse',
          actorUserId: actor?.actorUserId,
          actorRole: actor?.actorRole,
          classId,
          detail: { action: opts.action, ...paths },
          clientIp: actor?.clientIp,
        },
        db,
      );
      throw new Error(
        `strict_net_fail_closed: 双线皆未武装（Shield=off 且 DeskDNS 未运行）。配置 OPNsense/UniFi/HTTP 或启用 DeskDNS 后再深锁收紧。(${paths.detail})`,
      );
    }
  }

  // Heartbeat-fail lockdown: refuse allow_net until paths recover (end still needs reauth at route).
  if (opts.action === 'allow_net' && maxSecrecyLockdownActive(db)) {
    writeAudit(
      {
        action: 'deep_lock.maxsec_lockdown_refuse',
        actorUserId: actor?.actorUserId,
        actorRole: actor?.actorRole,
        classId,
        detail: { action: opts.action },
        clientIp: actor?.clientIp,
      },
      db,
    );
    throw new Error(
      'max_secrecy_lockdown: 考试态心跳失败已自动收紧，禁止放行上网直至 Shield 心跳恢复且 DeskDNS 运行（或管理员关闭最高保密档）',
    );
  }

  switch (opts.action) {
    case 'freeze':
      next = {
        ...next,
        frozen: true,
        netMode: 'deny',
        killForeignBrowsers: true,
        killDistractions: true,
        focusFreeze: true,
      };
      alsoExamInput = true;
      break;
    case 'exam_net': {
      const hosts = parseHosts(opts.allowlistHosts);
      let examUrl = String(opts.examUrl ?? next.examUrl ?? '').trim();
      if (examUrl && hosts.length === 0) {
        try {
          hosts.push(new URL(examUrl).hostname.toLowerCase());
        } catch {
          /* keep empty — teacher must supply hosts */
        }
      }
      next = {
        ...next,
        frozen: false,
        netMode: 'allowlist',
        allowlistHosts: hosts.length ? hosts : next.allowlistHosts,
        examUrl,
        killForeignBrowsers: true,
        killDistractions: true,
        focusFreeze: true,
      };
      alsoExamInput = true;
      break;
    }
    case 'allow_net':
      next = {
        ...next,
        frozen: false,
        netMode: 'allow',
        killForeignBrowsers: false,
        killDistractions: false,
        focusFreeze: false,
      };
      break;
    case 'kick_class':
      next = {
        ...next,
        frozen: true,
        netMode: 'deny',
        killForeignBrowsers: true,
        killDistractions: true,
        focusFreeze: true,
      };
      kick = true;
      alsoExamInput = true;
      break;
    case 'end':
      next = EMPTY_DEEP_LOCK_STATE();
      restoreExamInput = true;
      break;
    case 'patch':
      next = normalizeDeepLockState({
        ...next,
        ...(opts.patch ?? {}),
        allowlistHosts: opts.allowlistHosts ?? opts.patch?.allowlistHosts ?? next.allowlistHosts,
        examUrl: opts.examUrl ?? opts.patch?.examUrl ?? next.examUrl,
      });
      break;
    default:
      throw new Error('invalid_deep_lock_action');
  }

  const store = writeState(db, classId, next);
  const state = resolveDeepLockState(store, classId);

  if (alsoExamInput) {
    applyExamModeInputLock(db, { classId }, actor);
    relockClientExit(db, actor);
  }
  if (restoreExamInput) {
    restoreExamModeInputLock(db, actor);
  }
  let revokedGateway: GatewayAllowEntry[] = [];
  if (opts.action === 'end') {
    // Per-class epoch + allowlist so parallel classes keep their own sessions/IPs.
    clearPortalSessionsOnLessonEnd(db, classId);
    revokedGateway = revokeGatewayAccessForClass(db, classId);
  }

  // DeskDNS path: force exam on tighten; restore on end / allow_net.
  if (
    opts.action === 'freeze' ||
    opts.action === 'exam_net' ||
    opts.action === 'kick_class'
  ) {
    syncDeskDnsOnDeepLockTighten(db, {
      actorUserId: actor?.actorUserId,
      actorRole: actor?.actorRole,
      clientIp: actor?.clientIp,
      classId,
    });
  } else if (opts.action === 'end' || opts.action === 'allow_net') {
    syncDeskDnsOnDeepLockRelease(db, {
      actorUserId: actor?.actorUserId,
      actorRole: actor?.actorRole,
      clientIp: actor?.clientIp,
      classId,
    });
  }

  const shieldPush = await pushShieldForClass(db, classId, state, kick);
  if (opts.action === 'end' && revokedGateway.length) {
    await syncShieldRemoveAllowEntries(db, classId, revokedGateway);
  }

  writeAudit(
    {
      action: `deep_lock.${opts.action}`,
      actorUserId: actor?.actorUserId,
      actorRole: actor?.actorRole,
      classId,
      detail: {
        netMode: state.netMode,
        frozen: state.frozen,
        shieldId: shieldPush.shieldId,
        shieldAttempted: shieldPush.attempted,
        shieldFailed: shieldPush.failed,
      },
      clientIp: actor?.clientIp,
    },
    db,
  );

  return { store, state, shieldPush };
}

export function listFocusViolations(db: DatabaseSync): FocusViolation[] {
  const raw = getSetting(db, KEY_DEEP_LOCK_VIOLATIONS);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as FocusViolation[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function recordFocusViolation(
  db: DatabaseSync,
  opts: { studentId: string; classId: string },
): FocusViolation {
  const studentId = String(opts.studentId ?? '').trim();
  const classId = String(opts.classId ?? '').trim();
  const list = listFocusViolations(db);
  const idx = list.findIndex((v) => v.studentId === studentId && v.classId === classId);
  const at = nowIso();
  let row: FocusViolation;
  if (idx >= 0) {
    row = { ...list[idx]!, count: list[idx]!.count + 1, lastAt: at };
    list[idx] = row;
  } else {
    row = { studentId, classId, count: 1, lastAt: at };
    list.push(row);
  }
  // Cap retention
  const trimmed = list
    .sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)))
    .slice(0, 500);
  upsertSetting(db, KEY_DEEP_LOCK_VIOLATIONS, JSON.stringify(trimmed));
  return row;
}

export function clearFocusViolations(db: DatabaseSync, classId?: string | null) {
  const cid = String(classId ?? '').trim();
  if (!cid) {
    upsertSetting(db, KEY_DEEP_LOCK_VIOLATIONS, '[]');
    return;
  }
  const next = listFocusViolations(db).filter((v) => v.classId !== cid);
  upsertSetting(db, KEY_DEEP_LOCK_VIOLATIONS, JSON.stringify(next));
}

export function deepLockStatusLabel(state: DeepLockState): string {
  if (state.frozen && state.netMode === 'deny') return 'frozen_deny';
  if (state.netMode === 'allowlist') return 'exam_allowlist';
  if (state.netMode === 'deny') return 'net_deny';
  if (deepLockAggressive(state)) return 'partial';
  return 'idle';
}

export type { DeepLockNetMode, DeepLockState, DeepLockStore };

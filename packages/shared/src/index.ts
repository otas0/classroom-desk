/** Shared constants and DTO stubs for Classroom Desk */

export const APP_NAME = 'Classroom Desk';
export const APP_NOTICE =
  '本工具由学校部署，用于作业、留言和错题统计。';
export const ATTENDANCE_NOTICE =
  '签到仅记录本工具内的登录和在线状态。';

/** Bootstrap / lab passwords rejected for teacher accounts (single source for server + admin UI). */
export const WEAK_TEACHER_PASSWORDS = [
  'ChangeMe123',
  'TeacherPass123',
  'Classroom2026!',
  'Desk@179#2026',
  'AdminPass123',
  'password',
  '123456',
  'Password1',
  'password123',
] as const;

export function isWeakTeacherPassword(password: string, extra: readonly string[] = []): boolean {
  if ((WEAK_TEACHER_PASSWORDS as readonly string[]).includes(password)) return true;
  return extra.includes(password);
}

export const GITHUB_REPO = 'otas0/classroom-desk';
export const GITHUB_RELEASES_BASE = `https://github.com/${GITHUB_REPO}/releases`;
export const GITHUB_API_RELEASES_LATEST = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;


export const STUDENT_WINDOW = {
  width: 380,
  height: 560,
  collapsedHeight: 48,
} as const;

export type UserRole = 'student' | 'teacher' | 'admin' | 'assistant';

export type AttendanceStatus = 'present' | 'late' | 'absent' | 'leave';
export type PointRequestStatus = 'pending' | 'confirmed' | 'rejected' | 'expired';
export type PointsSource = 'request' | 'manual' | 'auto_rule';

/** Default soft-delete recycle retention (days). Overridable via settings.recycle_retention_days. */
export const RECYCLE_RETENTION_DAYS = 7;

export const RECYCLE_DAYS_LEFT_TESTID = 'recycle-days-left';

const MS_PER_DAY = 86_400_000;

export function recycleDaysLeft(
  deletedAt: unknown,
  retentionDays = RECYCLE_RETENTION_DAYS,
  nowMs = Date.now(),
): number | null {
  const deletedMs = Date.parse(String(deletedAt ?? ''));
  if (!Number.isFinite(deletedMs)) return null;
  const expiresAtMs = deletedMs + retentionDays * MS_PER_DAY;
  return Math.max(0, Math.ceil((expiresAtMs - nowMs) / MS_PER_DAY));
}

/** Unified copy for student & question recycle rows. Pass `t` from @classroom-desk/i18n when localizing. */
export function formatRecycleDaysLeft(
  daysLeft: number | null | undefined,
  t: (msgid: string, vars?: Record<string, string | number>) => string = (s, vars) => {
    if (!vars) return s;
    return s.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, k) => String(vars[k] ?? ''));
  },
): string | null {
  if (daysLeft == null || !Number.isFinite(Number(daysLeft))) return null;
  const n = Math.max(0, Math.floor(Number(daysLeft)));
  return n === 0 ? t('剩余不足 1 天') : t('剩余 {v0} 天', { v0: n });
}

/** Default days-left threshold for “即将 purge” highlight (inclusive). */
export const RECYCLE_URGENT_DAYS = 1;

/** True when UI should warn that purge is imminent. */
export function isRecycleUrgent(
  daysLeft: number | null | undefined,
  urgentWithinDays: number = RECYCLE_URGENT_DAYS,
): boolean {
  if (daysLeft == null || !Number.isFinite(Number(daysLeft))) return false;
  const thr = Math.max(0, Math.floor(Number(urgentWithinDays) || RECYCLE_URGENT_DAYS));
  return Math.max(0, Math.floor(Number(daysLeft))) <= thr;
}

/**
 * Deep lock / session net policy (brand-agnostic).
 * Inactive default stays permissive so existing labs keep working;
 * teacher "freeze / exam net" flips into aggressive modes.
 */
export type DeepLockNetMode = 'deny' | 'allowlist' | 'allow';

export type DeepLockState = {
  /** Black-screen freeze + input dead on lab-agent. */
  frozen: boolean;
  /** Network intent for shield/dns connectors (default allow when idle). */
  netMode: DeepLockNetMode;
  /** Hostnames allowed when netMode=allowlist (no scheme). */
  allowlistHosts: string[];
  /** Optional single exam URL for future exam shell. */
  examUrl: string;
  /** lab-agent may terminate non-allowlisted browsers while active. */
  killForeignBrowsers: boolean;
  /** lab-agent may terminate chat/game/distraction apps while freeze/exam. */
  killDistractions: boolean;
  /** lab-agent auto-freezes locally after window blur (reports violation). */
  focusFreeze: boolean;
  updatedAt: string;
};

export type DeepLockStore = {
  global: DeepLockState;
  byClass: Record<string, DeepLockState>;
};

export const EMPTY_DEEP_LOCK_STATE = (): DeepLockState => ({
  frozen: false,
  netMode: 'allow',
  allowlistHosts: [],
  examUrl: '',
  killForeignBrowsers: false,
  killDistractions: false,
  focusFreeze: false,
  updatedAt: new Date(0).toISOString(),
});

export function normalizeDeepLockState(raw: unknown): DeepLockState {
  const base = EMPTY_DEEP_LOCK_STATE();
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Partial<DeepLockState>;
  const net =
    o.netMode === 'deny' || o.netMode === 'allowlist' || o.netMode === 'allow'
      ? o.netMode
      : 'allow';
  const hosts = Array.isArray(o.allowlistHosts)
    ? o.allowlistHosts
        .map((h) =>
          String(h ?? '')
            .trim()
            .toLowerCase()
            .replace(/^https?:\/\//, '')
            .replace(/\/.*$/, ''),
        )
        .filter(Boolean)
    : [];
  return {
    frozen: Boolean(o.frozen),
    netMode: net,
    allowlistHosts: [...new Set(hosts)].slice(0, 64),
    examUrl: String(o.examUrl ?? '').trim().slice(0, 2000),
    killForeignBrowsers: Boolean(o.killForeignBrowsers),
    killDistractions: Boolean(o.killDistractions),
    focusFreeze: Boolean(o.focusFreeze),
    updatedAt: String(o.updatedAt ?? base.updatedAt),
  };
}

export function normalizeDeepLockStore(raw: unknown): DeepLockStore {
  if (!raw || typeof raw !== 'object') {
    return { global: EMPTY_DEEP_LOCK_STATE(), byClass: {} };
  }
  const o = raw as Partial<DeepLockStore>;
  const byClass: Record<string, DeepLockState> = {};
  for (const [k, v] of Object.entries(o.byClass ?? {})) {
    if (!k.trim()) continue;
    byClass[k] = normalizeDeepLockState(v);
  }
  return {
    global: normalizeDeepLockState(o.global),
    byClass,
  };
}

export function resolveDeepLockState(
  store: DeepLockStore,
  classId?: string | null,
): DeepLockState {
  const cid = String(classId ?? '').trim();
  if (cid && store.byClass[cid]) return { ...store.byClass[cid]! };
  return { ...store.global };
}

/** True when any aggressive control is on. */
export function deepLockAggressive(state: DeepLockState): boolean {
  return (
    state.frozen ||
    state.netMode === 'deny' ||
    state.netMode === 'allowlist' ||
    state.killForeignBrowsers ||
    state.killDistractions ||
    state.focusFreeze
  );
}

/**
 * School-defined network zone (SSID / subnet). Not hardcoded guest/teacher/student —
 * schools name zones and set who may use them + default net policy.
 */
export type NetworkZoneRole = 'student' | 'teacher' | 'staff' | 'guest';

export type NetworkZoneUnauthorizedAction = 'flag' | 'deny' | 'kick';

export type NetworkZone = {
  id: string;
  /** School-chosen label, e.g. "高中教学", "教工", "访客". */
  label: string;
  /** Optional SSID exact/substring match (case-insensitive). Empty = ignore SSID. */
  ssidIncludes: string[];
  /** IPv4 CIDRs, e.g. 10.20.0.0/16. Empty = ignore IP. */
  cidrs: string[];
  /** Who is allowed on this zone. Empty = anyone (not recommended). */
  allowedRoles: NetworkZoneRole[];
  /** Idle default when no deep-lock lesson override. */
  defaultNetMode: DeepLockNetMode;
  /** Optional idle allowlist when defaultNetMode=allowlist. */
  defaultAllowlistHosts: string[];
  /** When a student is seen on a zone that does not allow students. */
  studentUnauthorized: NetworkZoneUnauthorizedAction;
  /** IT hint: portal/802.1X recommended (leaked PSK still hits identity). */
  requirePortal: boolean;
  enabled: boolean;
};

export type NetworkHint = {
  ssid?: string;
  ipv4?: string;
  gateway?: string;
};

export function emptyNetworkZones(): NetworkZone[] {
  return [];
}

export function normalizeNetworkZone(raw: unknown): NetworkZone | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<NetworkZone>;
  const id = String(o.id ?? '').trim();
  const label = String(o.label ?? '').trim();
  if (!id || !label) return null;
  const net =
    o.defaultNetMode === 'deny' || o.defaultNetMode === 'allowlist' || o.defaultNetMode === 'allow'
      ? o.defaultNetMode
      : 'allow';
  const roles = Array.isArray(o.allowedRoles)
    ? o.allowedRoles
        .map((r) => String(r))
        .filter((r): r is NetworkZoneRole =>
          r === 'student' || r === 'teacher' || r === 'staff' || r === 'guest',
        )
    : [];
  const unauth: NetworkZoneUnauthorizedAction =
    o.studentUnauthorized === 'deny' || o.studentUnauthorized === 'kick'
      ? o.studentUnauthorized
      : 'flag';
  return {
    id: id.slice(0, 64),
    label: label.slice(0, 80),
    ssidIncludes: Array.isArray(o.ssidIncludes)
      ? o.ssidIncludes.map((s) => String(s).trim()).filter(Boolean).slice(0, 16)
      : [],
    cidrs: Array.isArray(o.cidrs)
      ? o.cidrs.map((s) => String(s).trim()).filter(Boolean).slice(0, 16)
      : [],
    allowedRoles: roles.slice(0, 8),
    defaultNetMode: net,
    defaultAllowlistHosts: Array.isArray(o.defaultAllowlistHosts)
      ? o.defaultAllowlistHosts
          .map((h) =>
            String(h ?? '')
              .trim()
              .toLowerCase()
              .replace(/^https?:\/\//, '')
              .replace(/\/.*$/, ''),
          )
          .filter(Boolean)
          .slice(0, 64)
      : [],
    studentUnauthorized: unauth,
    requirePortal: Boolean(o.requirePortal),
    enabled: o.enabled !== false,
  };
}

export function normalizeNetworkZones(raw: unknown): NetworkZone[] {
  if (!Array.isArray(raw)) return [];
  const out: NetworkZone[] = [];
  for (const row of raw) {
    const z = normalizeNetworkZone(row);
    if (z) out.push(z);
  }
  return out.slice(0, 32);
}

/** IPv4 + CIDR match (simple, no IPv6). */
export function ipv4InCidr(ipv4: string, cidr: string): boolean {
  const ip = String(ipv4 ?? '').trim();
  const c = String(cidr ?? '').trim();
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(c);
  const im = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m || !im) return false;
  const octets = [1, 2, 3, 4].map((i) => Number(im[i]));
  const base = [1, 2, 3, 4].map((i) => Number(m[i]));
  const prefix = Number(m[5]);
  if (octets.some((n) => n > 255) || base.some((n) => n > 255) || prefix > 32) return false;
  const ipNum =
    ((octets[0]! << 24) >>> 0) + (octets[1]! << 16) + (octets[2]! << 8) + octets[3]!;
  const baseNum =
    ((base[0]! << 24) >>> 0) + (base[1]! << 16) + (base[2]! << 8) + base[3]!;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipNum & mask) === (baseNum & mask);
}

export function matchNetworkZone(
  zones: NetworkZone[],
  hint: NetworkHint | null | undefined,
): NetworkZone | null {
  if (!hint) return null;
  const ssid = String(hint.ssid ?? '').trim().toLowerCase();
  const ipv4 = String(hint.ipv4 ?? '').trim();
  const enabled = zones.filter((z) => z.enabled);
  // Prefer SSID match, then CIDR; first match wins (school orders list).
  for (const z of enabled) {
    if (ssid && z.ssidIncludes.length) {
      if (z.ssidIncludes.some((s) => ssid.includes(String(s).toLowerCase()))) return z;
    }
  }
  for (const z of enabled) {
    if (ipv4 && z.cidrs.length) {
      if (z.cidrs.some((c) => ipv4InCidr(ipv4, c))) return z;
    }
  }
  return null;
}

/** Student on a zone that does not list "student" in allowedRoles. */
export function studentUnauthorizedOnZone(zone: NetworkZone | null): boolean {
  if (!zone) return false;
  if (!zone.allowedRoles.length) return false;
  return !zone.allowedRoles.includes('student');
}

/** Teacher policy when student lab-agent loses the teacher host. */
export type OfflineLockMode = 'hard_lock' | 'warn' | 'off';

export type OfflineLockPolicy = {
  mode: OfflineLockMode;
  /** Milliseconds without a successful health/API touch before offline action. */
  graceMs: number;
  /** Allow exit-unlock code to clear the offline hard lock (needs reachability unless hash cached). */
  unlockWithCode: boolean;
  /** After teacher host returns: snap widget to bottom-right. */
  collapseOnReconnect: boolean;
  /** Keep fullscreen until unlock code succeeds even after reconnect. */
  holdUntilUnlockCode: boolean;
};

export const DEFAULT_OFFLINE_LOCK_POLICY = (): OfflineLockPolicy => ({
  mode: 'hard_lock',
  graceMs: 8_000,
  unlockWithCode: true,
  collapseOnReconnect: true,
  holdUntilUnlockCode: false,
});

export function normalizeOfflineLockPolicy(raw: unknown): OfflineLockPolicy {
  const base = DEFAULT_OFFLINE_LOCK_POLICY();
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Partial<OfflineLockPolicy>;
  const mode: OfflineLockMode =
    o.mode === 'warn' || o.mode === 'off' || o.mode === 'hard_lock' ? o.mode : base.mode;
  const grace = Number(o.graceMs);
  return {
    mode,
    graceMs: Number.isFinite(grace) ? Math.min(120_000, Math.max(2_000, Math.round(grace))) : base.graceMs,
    unlockWithCode: o.unlockWithCode !== false,
    collapseOnReconnect: o.collapseOnReconnect !== false,
    holdUntilUnlockCode: Boolean(o.holdUntilUnlockCode),
  };
}

/** Always-on app/web blocks + one-shot open/close commands for lab-agent. */
export type DeviceControlPolicy = {
  blockedHosts: string[];
  /** Process image names (Windows .exe) or macOS app names. */
  blockedApps: string[];
};

export const EMPTY_DEVICE_CONTROL_POLICY = (): DeviceControlPolicy => ({
  blockedHosts: [],
  blockedApps: [],
});

export function normalizeDeviceControlPolicy(raw: unknown): DeviceControlPolicy {
  if (!raw || typeof raw !== 'object') return EMPTY_DEVICE_CONTROL_POLICY();
  const o = raw as Partial<DeviceControlPolicy>;
  const hosts = Array.isArray(o.blockedHosts)
    ? o.blockedHosts
        .map((h) =>
          String(h ?? '')
            .trim()
            .toLowerCase()
            .replace(/^https?:\/\//, '')
            .replace(/\/.*$/, ''),
        )
        .filter(Boolean)
    : [];
  const apps = Array.isArray(o.blockedApps)
    ? o.blockedApps.map((a) => String(a ?? '').trim()).filter(Boolean)
    : [];
  return {
    blockedHosts: [...new Set(hosts)].slice(0, 64),
    blockedApps: [...new Set(apps)].slice(0, 64),
  };
}

export type DeviceControlCommandKind = 'open_url' | 'open_app' | 'close_apps';

export type DeviceControlCommand = {
  id: string;
  at: string;
  classId: string;
  kind: DeviceControlCommandKind;
  url?: string;
  app?: string;
  apps?: string[];
};

export {
  encodeRoomCode,
  decodeRoomCode,
  roomCodeToApiBase,
  looksLikeRoomCode,
} from './roomCode.js';

export function normalizeDeviceControlCommand(raw: unknown): DeviceControlCommand | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<DeviceControlCommand>;
  const kind = o.kind;
  if (kind !== 'open_url' && kind !== 'open_app' && kind !== 'close_apps') return null;
  const id = String(o.id ?? '').trim() || `cmd_${Date.now()}`;
  const classId = String(o.classId ?? '').trim();
  const at = String(o.at ?? new Date().toISOString());
  const url = o.url != null ? String(o.url).trim().slice(0, 2000) : undefined;
  const app = o.app != null ? String(o.app).trim().slice(0, 120) : undefined;
  const apps = Array.isArray(o.apps)
    ? o.apps.map((a) => String(a).trim()).filter(Boolean).slice(0, 32)
    : undefined;
  return { id, at, classId, kind, url, app, apps };
}

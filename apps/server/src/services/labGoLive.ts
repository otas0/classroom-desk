import type { DatabaseSync } from 'node:sqlite';
import type { DeepLockState, OfflineLockPolicy } from '@classroom-desk/shared';
import { getSetting } from '../db/migrate.js';
import { getBackupStatus } from './backup.js';
import { getDeskDnsStatus } from './deskDns.js';
import { probeDeskDnsResolution } from './deskDnsProbe.js';
import { listDetectedLanIpv4s, resolveAdvertiseLanIp } from './lanNetwork.js';
import { listPresenceClients } from './presenceHub.js';
import { getShieldConnector } from './shield/registry.js';

export type LabGoLiveCheck = {
  id: string;
  ok: boolean;
  required: boolean;
  label: string;
  detail: string;
  fixHint: string;
};

export type LabGoLiveStatus = {
  type: 'lab_go_live';
  at: string;
  /** All required checks green — may arm 最高保密级 / 深锁断网. */
  readyForMaxSecrecy: boolean;
  blockReasons: string[];
  checks: LabGoLiveCheck[];
  deskDns: ReturnType<typeof getDeskDnsStatus>;
  shieldAdapter: string;
  advertiseLanIp: string;
  windows53: {
    port: number | null;
    /** When targeting 53 on win32, product recommends 5353 or Exam Box. */
    conflictLikely: boolean;
    recommendedPaths: string[];
  };
  ops: {
    fixedIpReady: boolean;
    avAllowlistReady: boolean;
    wifiNoIsolation: boolean;
  };
};

export class LabGoLiveBlockedError extends Error {
  readonly code = 'lab_go_live_blocked' as const;
  readonly blockReasons: string[];
  readonly labGoLive: LabGoLiveStatus;

  constructor(status: LabGoLiveStatus) {
    super(
      `未达机房上线门禁：${status.blockReasons.join('；') || '见 /api/v1/ops/lab-go-live'}`,
    );
    this.name = 'LabGoLiveBlockedError';
    this.blockReasons = status.blockReasons;
    this.labGoLive = status;
  }
}

const PROD_SHIELD = new Set(['http', 'opnsense', 'unifi']);

const WIN53_PATHS = [
  'DeskDNS 用 5353，路由器 DHCP 填教师 IP + 非标端口（若支持）',
  'Linux / Exam Box 旁路机绑定 UDP/53，DHCP 指该机',
  'IT 评估停用冲突服务后以管理员绑 53（少见）',
];

function flag(db: DatabaseSync, key: string): boolean {
  return (getSetting(db, key) ?? '0') === '1';
}

/**
 * One-click「最高保密级」preset signature (grace ≤1s + custody flags).
 * Default day-to-day policy uses grace 1500ms and is not gated by this alone.
 */
export function looksLikeMaxSecrecyArm(policy: OfflineLockPolicy): boolean {
  return (
    policy.mode === 'hard_lock' &&
    policy.graceMs <= 1_000 &&
    policy.holdUntilUnlockCode === true &&
    policy.custodyFullscreen === true &&
    policy.killEscapesOnOffline === true
  );
}

/** Class-wide peer-drop 连坐 + hard custody — same production bar as max-secrecy arm. */
export function offlinePolicyRequiresLabGoLive(policy: OfflineLockPolicy): boolean {
  if (looksLikeMaxSecrecyArm(policy)) return true;
  return (
    policy.mode === 'hard_lock' &&
    policy.freezeClassOnPeerDrop === true &&
    policy.custodyFullscreen === true &&
    policy.killEscapesOnOffline === true
  );
}

export function isProductionShieldAdapter(id: string): boolean {
  return PROD_SHIELD.has(String(id ?? '').toLowerCase());
}

export function allowShieldMock(): boolean {
  return (
    process.env.CLASSROOM_DESK_ALLOW_SHIELD_MOCK === '1' ||
    process.env.NODE_ENV === 'test'
  );
}

function shieldHttpUrlConfigured(db: DatabaseSync): boolean {
  const fromEnv = String(process.env.CLASSROOM_DESK_SHIELD_URL ?? '').trim();
  if (fromEnv) return true;
  return Boolean(String(getSetting(db, 'shield_http_url') ?? '').trim());
}

/** Shared DeskDNS path probe for ops UI + arm/deep-lock enforcement. */
export async function resolveDeskDnsPathForGoLive(db: DatabaseSync): Promise<{
  deskDnsPathOk: boolean;
  deskDnsHint: string;
}> {
  const deskDns = getDeskDnsStatus();
  if (!deskDns.enabled) {
    return { deskDnsPathOk: false, deskDnsHint: '未启用' };
  }
  if (!deskDns.running) {
    return {
      deskDnsPathOk: false,
      deskDnsHint: deskDns.error ? `未绑定：${deskDns.error}` : '未绑定',
    };
  }
  const probeHost = String(getSetting(db, 'deskdns_probe_hostname') ?? '').trim();
  let storedHost = '';
  try {
    const base = getSetting(db, 'classroom_api_base')?.replace(/\/$/, '') ?? '';
    if (base) storedHost = new URL(base).hostname;
  } catch {
    storedHost = '';
  }
  const resolveHost =
    probeHost || (/^\d{1,3}(\.\d{1,3}){3}$/.test(storedHost) ? '' : storedHost);
  const teacherIps = [
    ...new Set(
      [resolveAdvertiseLanIp(db), ...listDetectedLanIpv4s()]
        .map((ip) => String(ip ?? '').trim())
        .filter(Boolean),
    ),
  ];
  if (resolveHost) {
    const resolution = await probeDeskDnsResolution({
      hostname: resolveHost,
      teacherIps,
    });
    const ok = resolution.pointsAtTeacher === true;
    return {
      deskDnsPathOk: ok,
      deskDnsHint: ok
        ? `解析 ${resolveHost} → 讲台`
        : `解析 ${resolveHost} 未指向讲台 LAN（${teacherIps.join(', ') || '无 IP'}）`,
    };
  }
  return {
    deskDnsPathOk: true,
    deskDnsHint:
      '已监听 — 请确认 DHCP DNS 指讲台（或校网 deny）；可设 deskdnsProbeHostname 做解析探针',
  };
}

/** Production always enforces. Tests set SKIP=1 or run with NODE_ENV=test (unless ENFORCE=1). */
export function labGoLiveEnforced(): boolean {
  if (process.env.CLASSROOM_DESK_ENFORCE_LAB_GO_LIVE === '1') return true;
  if (process.env.CLASSROOM_DESK_SKIP_LAB_GO_LIVE === '1') return false;
  if (process.env.NODE_ENV === 'test') return false;
  return true;
}

export async function assertLabGoLiveReady(
  db: DatabaseSync,
  classId?: string | null,
): Promise<LabGoLiveStatus> {
  if (!labGoLiveEnforced()) {
    return {
      type: 'lab_go_live',
      at: new Date().toISOString(),
      readyForMaxSecrecy: true,
      blockReasons: [],
      checks: [],
      deskDns: getDeskDnsStatus(),
      shieldAdapter: String(getShieldConnector().id ?? 'off'),
      advertiseLanIp: '',
      windows53: { port: null, conflictLikely: false, recommendedPaths: [...WIN53_PATHS] },
      ops: { fixedIpReady: true, avAllowlistReady: true, wifiNoIsolation: true },
    };
  }
  const path = await resolveDeskDnsPathForGoLive(db);
  const status = evaluateLabGoLive(db, {
    classId: classId ?? null,
    deskDnsPathOk: path.deskDnsPathOk,
    deskDnsHint: path.deskDnsHint,
  });
  if (!status.readyForMaxSecrecy) {
    throw new LabGoLiveBlockedError(status);
  }
  return status;
}

function deepLockAggressive(state: DeepLockState): boolean {
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
 * Gate first transition into deep-lock custody. Re-assert / peer-drop while
 * already deny/frozen/allowlist skips the gate so mid-lesson ops flips don't
 * strand an already-armed class.
 */
export function deepLockActionRequiresLabGoLive(
  prev: DeepLockState,
  next: DeepLockState,
  action: string,
): boolean {
  if (action === 'end' || action === 'allow_net') return false;
  if (!deepLockAggressive(next)) return false;
  const prevAlready =
    prev.frozen || prev.netMode === 'deny' || prev.netMode === 'allowlist';
  if (prevAlready) return false;
  return true;
}

/**
 * Production lab readiness for highest-security claims.
 * App alone cannot close AA; this gate refuses to pretend otherwise.
 */
export function evaluateLabGoLive(
  db: DatabaseSync,
  opts?: {
    classId?: string | null;
    /** Optional precomputed DeskDNS path probe (bind + DHCP resolve). */
    deskDnsPathOk?: boolean | null;
    deskDnsHint?: string | null;
  },
): LabGoLiveStatus {
  const deskDns = getDeskDnsStatus();
  const shield = getShieldConnector();
  const shieldId = String(shield.id ?? 'off').toLowerCase() || 'off';
  const advertiseLanIp = resolveAdvertiseLanIp(db) || '';
  const backup = getBackupStatus(getSetting(db, 'last_auto_backup_at'));
  const backupFresh =
    backup.ageHours != null && Number.isFinite(backup.ageHours) && backup.ageHours <= 24 * 7;

  const aaReady = flag(db, 'assigned_access_ready');
  const opsFixedIp = flag(db, 'lab_ops_fixed_ip_ready');
  const opsAv = flag(db, 'lab_ops_av_allowlist_ready');
  const opsWifi = flag(db, 'lab_ops_wifi_no_isolation');

  const classId = String(opts?.classId ?? '').trim();
  let hardenedOk = false;
  let hardenDetail = '未选班级';
  if (classId) {
    const clients = listPresenceClients(classId);
    const online = clients.length;
    const hard = clients.filter((c) => c.hardened).length;
    const unhard = Math.max(0, online - hard);
    hardenedOk = online > 0 && unhard === 0;
    hardenDetail =
      online === 0
        ? '本班无在线学生机'
        : unhard > 0
          ? `在线 ${online} · 未加固 ${unhard}`
          : `在线 ${online} 台均已报告加固`;
  }

  const deskDnsListening = deskDns.enabled && deskDns.running;
  const deskDnsPathOk =
    opts?.deskDnsPathOk != null ? Boolean(opts.deskDnsPathOk) : deskDnsListening;
  const deskDnsDetail = !deskDns.enabled
    ? '未启用 DeskDNS'
    : !deskDns.running
      ? `已启用但未绑定${deskDns.error ? `（${deskDns.error}）` : ''}`
      : opts?.deskDnsHint
        ? `监听 udp/${deskDns.port} · ${opts.deskDnsHint}`
        : `监听 udp/${deskDns.port}${opts?.deskDnsPathOk === false ? ' · DHCP/解析未指向讲台' : ''}`;

  const win53Target =
    process.platform === 'win32' && deskDns.enabled && Number(deskDns.port) === 53;
  const win53Ok = !win53Target || deskDns.running;

  let shieldProd = isProductionShieldAdapter(shieldId);
  let shieldDetail =
    shieldId === 'mock'
      ? 'mock 禁止当生产'
      : shieldId === 'off' || !shieldId
        ? '未配置（off）— 深锁不会真断网'
        : `适配器 ${shieldId}`;
  if (shieldId === 'http' && !shieldHttpUrlConfigured(db)) {
    shieldProd = false;
    shieldDetail = 'http 适配器未配置 URL';
  }

  const checks: LabGoLiveCheck[] = [
    {
      id: 'aa_l3',
      ok: aaReady,
      required: true,
      label: 'Assigned Access / Intune（L3）',
      detail: aaReady ? '教师已声明机房 AA/Intune 就绪' : '未声明 L3',
      fixHint: '上课页红条勾选声明 · docs/EXIT_LOCK_MDM.md',
    },
    {
      id: 'fleet_hardened',
      ok: hardenedOk,
      required: true,
      label: '在线学生机均已加固',
      detail: hardenDetail,
      fixHint: '展台账户 + assigned-access.ready / CD_ASSIGNED_ACCESS=1',
    },
    {
      id: 'deskdns_path',
      ok: deskDnsPathOk,
      required: true,
      label: 'DeskDNS/防火墙真进路径',
      detail: deskDnsDetail,
      fixHint: '上课页「部署 DeskDNS」启用并检测；DHCP DNS 指讲台或校网 deny',
    },
    {
      id: 'windows_53',
      ok: win53Ok,
      required: win53Target,
      label: 'Windows :53 策略',
      detail: win53Target
        ? deskDns.running
          ? '目标端口 53 且已绑定（Windows 仍易与系统 DNS 冲突，建议 5353/Exam Box）'
          : '目标端口 53 但未绑定 — Windows 常被系统 DNS 占用'
        : deskDns.port === 5353 || !deskDns.enabled
          ? '使用 5353 或未启用 — 按推荐路径即可'
          : `端口 ${deskDns.port}`,
      fixHint: WIN53_PATHS.join('；'),
    },
    {
      id: 'shield_prod',
      ok: shieldProd,
      required: true,
      label: 'Shield 真网关',
      detail: shieldDetail,
      fixHint: '设置 → Shield 选 opnsense / unifi / http（禁止 mock；http 须填 URL）',
    },
    {
      id: 'fixed_ip',
      ok: opsFixedIp && Boolean(advertiseLanIp),
      required: true,
      label: '教师机固定 IP',
      detail: advertiseLanIp
        ? opsFixedIp
          ? `广播 IP ${advertiseLanIp} · 已声明固定`
          : `广播 IP ${advertiseLanIp} · 未勾选「已固定」`
        : '未设置广播 LAN IP',
      fixHint: 'scripts/windows-set-fixed-ip.ps1 · 设置 advertiseLanIp · 勾选运维声明',
    },
    {
      id: 'av_allowlist',
      ok: opsAv,
      required: true,
      label: '杀软放行（不关 Defender）',
      detail: opsAv ? '已声明放行 ClassroomDesk 目录' : '未声明',
      fixHint: '放行 C:\\ClassroomDesk\\ 与 Setup；勿关 Defender',
    },
    {
      id: 'backup',
      ok: backupFresh,
      required: true,
      label: '数据库备份',
      detail:
        backup.latestAt != null
          ? `最近备份约 ${backup.ageHours?.toFixed?.(1) ?? '?'} 小时前`
          : '无备份文件',
      fixHint: '设置 → 立即备份 · 或拷贝 apps/server/data/classroom.db',
    },
    {
      id: 'wifi_isolation',
      ok: opsWifi,
      required: true,
      label: '非访客隔离 Wi‑Fi',
      detail: opsWifi ? '已确认学生↔教师 TCP 8787 可达' : '未确认（访客隔离会断连班）',
      fixHint: '教师机优先有线；禁用 guest isolation / 手机热点上课',
    },
  ];

  const blockReasons = checks.filter((c) => c.required && !c.ok).map((c) => c.label);
  return {
    type: 'lab_go_live',
    at: new Date().toISOString(),
    readyForMaxSecrecy: blockReasons.length === 0,
    blockReasons,
    checks,
    deskDns,
    shieldAdapter: shieldId,
    advertiseLanIp,
    windows53: {
      port: deskDns.port,
      conflictLikely: Boolean(win53Target),
      recommendedPaths: WIN53_PATHS,
    },
    ops: {
      fixedIpReady: opsFixedIp,
      avAllowlistReady: opsAv,
      wifiNoIsolation: opsWifi,
    },
  };
}

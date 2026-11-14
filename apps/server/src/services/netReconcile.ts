import type { DatabaseSync } from 'node:sqlite';
import { getSetting } from '../db/migrate.js';
import { productCapabilities } from './portalAuth.js';
import { listGatewayAccess } from './gatewayAllowlist.js';
import { getDeepLockForClass, deepLockStatusLabel } from './deepLock.js';
import { getShieldConnector, formatShieldActiveLabel } from './shield/registry.js';
import { resolveAuditRetentionDays, countAuditLog } from './audit.js';

export type NetReconcileFinding = {
  code: string;
  severity: 'info' | 'warn' | 'critical';
  message: string;
};

export type NetReconcileReport = {
  at: string;
  classId: string | null;
  paths: {
    campus: {
      shieldId: string;
      shieldLabel: string;
      shieldConfigured: boolean;
      lastError: string | null;
      lastHeartbeatAt: string | null;
      allowlistCount: number;
    };
    deskDns: {
      enabledEnv: boolean;
      profile: string;
      running: boolean;
      port: number | null;
    };
  };
  deepLock: {
    status: string;
    frozen: boolean;
    netMode: string;
  };
  audit: {
    retentionDays: number;
    rowCount: number;
  };
  capabilities: ReturnType<typeof productCapabilities>;
  findings: NetReconcileFinding[];
  failClosedOk: boolean;
};

/**
 * Dual-path network security reconcile for 等保/密评 evidence + teacher ops.
 * Does not call external firewall APIs (read-only local truth + last known Shield error).
 */
export function buildNetReconcileReport(
  db: DatabaseSync,
  classId?: string | null,
): NetReconcileReport {
  const cid = String(classId ?? '').trim() || null;
  const connector = getShieldConnector();
  const shieldConfigured = connector.id !== 'off';
  const lastError = getSetting(db, 'shield_last_error') || null;
  const hb = getSetting(db, 'shield_last_heartbeat_at') || null;
  const allow = listGatewayAccess(db);
  const allowlistCount = cid
    ? allow.filter((e) => String(e.classId ?? '') === cid).length
    : allow.length;

  const enabledEnv =
    process.env.CLASSROOM_DESK_DNS === '1' || getSetting(db, 'desk_dns_enabled') === '1';
  const profile = getSetting(db, 'deskdns_profile') || 'normal';
  const port = enabledEnv
    ? Number(process.env.CLASSROOM_DESK_DNS_PORT || getSetting(db, 'desk_dns_port') || 5353)
    : null;

  const state = getDeepLockForClass(db, cid);
  const findings: NetReconcileFinding[] = [];

  if (state.frozen || state.netMode === 'deny' || state.netMode === 'allowlist') {
    if (!shieldConfigured) {
      findings.push({
        code: 'shield_off_while_deeplock',
        severity: 'critical',
        message:
          '深锁已收紧客户端，但 Shield 未配置：网关线未断网。请配置 OPNsense/UniFi/HTTP，或改用 DeskDNS exam 档。',
      });
    } else if (lastError) {
      findings.push({
        code: 'shield_last_error',
        severity: 'warn',
        message: `Shield 最近失败：${lastError}`,
      });
    }
    if (!enabledEnv && profile === 'exam') {
      findings.push({
        code: 'deskdns_exam_not_running',
        severity: 'critical',
        message: 'DeskDNS profile=exam 但进程未启用（CLASSROOM_DESK_DNS≠1）：DNS 线未生效。',
      });
    } else if (!enabledEnv) {
      findings.push({
        code: 'deskdns_idle',
        severity: 'info',
        message: 'DeskDNS 未启用；仅校园网包（Shield）可断网。',
      });
    }
  }

  if (shieldConfigured && !hb && !lastError) {
    findings.push({
      code: 'shield_no_heartbeat',
      severity: 'info',
      message: 'Shield 已配置但尚无心跳记录；请在向导中点「测连通」。',
    });
  }

  if (allowlistCount > 0 && (state.netMode === 'deny' || state.frozen)) {
    findings.push({
      code: 'allowlist_during_deny',
      severity: 'warn',
      message: `深锁为拒绝/冻结时仍有 ${allowlistCount} 条门户放行表条目；确认是否应下课收工或手动清空。`,
    });
  }

  const follow =
    (getSetting(db, 'deskdns_follow_deeplock') ?? '1') === '1' ||
    (getSetting(db, 'deskdns_follow_deeplock') ?? '1') === 'true';
  if (
    follow &&
    (state.frozen || state.netMode === 'deny' || state.netMode === 'allowlist') &&
    profile !== 'exam'
  ) {
    findings.push({
      code: 'deskdns_follow_drift',
      severity: 'warn',
      message: '已开启 DeskDNS 跟随深锁，但 profile 不是 exam；请检查联动或手动切考试档。',
    });
  }

  const caps = productCapabilities();
  const failClosedOk = !findings.some((f) => f.severity === 'critical');

  return {
    at: new Date().toISOString(),
    classId: cid,
    paths: {
      campus: {
        shieldId: connector.id,
        shieldLabel: formatShieldActiveLabel(connector.id),
        shieldConfigured,
        lastError,
        lastHeartbeatAt: hb,
        allowlistCount,
      },
      deskDns: {
        enabledEnv,
        profile,
        running: enabledEnv,
        port: Number.isFinite(port as number) ? (port as number) : null,
      },
    },
    deepLock: {
      status: deepLockStatusLabel(state),
      frozen: Boolean(state.frozen),
      netMode: String(state.netMode),
    },
    audit: {
      retentionDays: resolveAuditRetentionDays(db),
      rowCount: countAuditLog(db),
    },
    capabilities: caps,
    findings,
    failClosedOk,
  };
}

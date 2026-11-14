import type { DatabaseSync } from 'node:sqlite';
import { listGatewayAccess } from './gatewayAllowlist.js';
import { getShieldConnector } from './shield/registry.js';

export type AliasReconcileReport = {
  at: string;
  shieldId: string;
  remoteReadable: boolean;
  localAllowKeys: string[];
  remoteAllow: string[];
  remoteBlock: string[];
  /** Local allowlist keys missing from remote allow alias (campus path drift). */
  missingOnGateway: string[];
  /** Remote allow members not in local allowlist (orphan / stale). */
  extraOnGateway: string[];
  detail: string;
  ok: boolean;
};

function normKey(s: string): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, ':');
}

/**
 * Compare local portal gateway allowlist vs Shield firewall membership (OPNsense aliases / UniFi).
 */
export async function reconcileGatewayAliases(
  db: DatabaseSync,
  classId?: string | null,
): Promise<AliasReconcileReport> {
  const cid = String(classId ?? '').trim() || null;
  const connector = getShieldConnector();
  const local = listGatewayAccess(db)
    .filter((e) => !cid || String(e.classId ?? '') === cid)
    .flatMap((e) => [e.ip, e.mac, e.clientKey].map((x) => String(x ?? '').trim()).filter(Boolean));
  const localAllowKeys = [...new Set(local.map(normKey).filter(Boolean))];

  if (connector.id === 'off' || !connector.listFirewallMembers) {
    return {
      at: new Date().toISOString(),
      shieldId: connector.id,
      remoteReadable: false,
      localAllowKeys,
      remoteAllow: [],
      remoteBlock: [],
      missingOnGateway: localAllowKeys,
      extraOnGateway: [],
      detail:
        connector.id === 'off'
          ? 'shield_off — cannot read gateway aliases'
          : 'connector_no_listFirewallMembers',
      ok: connector.id === 'off' ? localAllowKeys.length === 0 : false,
    };
  }

  const allowR = await connector.listFirewallMembers('allow');
  const blockR = await connector.listFirewallMembers('block');
  const remoteAllow = [...new Set((allowR.members ?? []).map(normKey).filter(Boolean))];
  const remoteBlock = [...new Set((blockR.members ?? []).map(normKey).filter(Boolean))];
  const remoteReadable = Boolean(allowR.remoteReadable || blockR.remoteReadable);

  // When UniFi has no allow alias, only compare block overlaps / local presence honesty.
  const missingOnGateway =
    allowR.remoteReadable === false && connector.id === 'unifi'
      ? []
      : localAllowKeys.filter((k) => !remoteAllow.includes(k));
  const extraOnGateway =
    allowR.remoteReadable === false && connector.id === 'unifi'
      ? []
      : remoteAllow.filter((k) => !localAllowKeys.includes(k));

  const detail = [allowR.detail, blockR.detail].filter(Boolean).join(' · ');
  const ok =
    remoteReadable &&
    missingOnGateway.length === 0 &&
    (connector.id !== 'opnsense' || allowR.ok);

  return {
    at: new Date().toISOString(),
    shieldId: connector.id,
    remoteReadable,
    localAllowKeys,
    remoteAllow,
    remoteBlock,
    missingOnGateway,
    extraOnGateway,
    detail,
    ok,
  };
}

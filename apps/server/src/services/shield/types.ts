/** net-shield connector contract (gateway API / firewall per-client). */

export type ShieldNetMode = 'deny' | 'allowlist' | 'allow';

export type ShieldClientRef = {
  /** Stable key: presence clientId, MAC, or IP depending on adapter. */
  clientKey: string;
  classId?: string;
  studentId?: string;
};

export type ShieldAuthorizeOpts = ShieldClientRef & {
  mode: ShieldNetMode;
  allowlistHosts?: string[];
};

export interface ShieldConnector {
  readonly id: string;
  readonly displayName: string;
  authorizeClient(opts: ShieldAuthorizeOpts): Promise<{ ok: boolean; detail?: string }>;
  revokeClient(opts: ShieldClientRef): Promise<{ ok: boolean; detail?: string }>;
  kickClient(opts: ShieldClientRef): Promise<{ ok: boolean; detail?: string }>;
  /**
   * Drop admission without leaving a permanent block (lesson end / class revoke).
   * OPNsense: remove from allow+block aliases. Defaults to revokeClient when omitted.
   */
  releaseClient?(opts: ShieldClientRef): Promise<{ ok: boolean; detail?: string }>;
  /** Optional health probe for IT wizard. */
  health?(): Promise<{ ok: boolean; detail?: string }>;
}

import type { ShieldClientRef, ShieldConnector, ShieldAuthorizeOpts } from './types.js';

/**
 * HTTP gateway adapter for school firewall / captive portal APIs.
 * Env:
 *   CLASSROOM_DESK_SHIELD_URL=https://shield.school.local/api
 *   CLASSROOM_DESK_SHIELD_TOKEN=...
 * Endpoints expected (POST JSON):
 *   {base}/authorize  { clientKey, classId?, studentId?, mode, allowlistHosts? }
 *   {base}/revoke     { clientKey, classId?, studentId? }
 *   {base}/kick       { clientKey, classId?, studentId? }
 *   {base}/health     GET → { ok: boolean }
 */
export class HttpShieldConnector implements ShieldConnector {
  readonly id = 'http';
  readonly displayName: string;
  private readonly base: string;
  private readonly token: string;

  constructor(baseUrl: string, token = '') {
    this.base = String(baseUrl ?? '')
      .trim()
      .replace(/\/$/, '');
    this.token = String(token ?? '').trim();
    this.displayName = `HTTP Shield (${this.base || 'unset'})`;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  private async post(path: string, body: unknown): Promise<{ ok: boolean; detail?: string }> {
    if (!this.base) return { ok: false, detail: 'shield_url_unset' };
    try {
      const res = await fetch(`${this.base}${path}`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body ?? {}),
      });
      const text = await res.text();
      if (!res.ok) return { ok: false, detail: `http_${res.status}:${text.slice(0, 200)}` };
      return { ok: true, detail: text.slice(0, 200) || `http_${res.status}` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : 'shield_fetch_failed' };
    }
  }

  async authorizeClient(opts: ShieldAuthorizeOpts) {
    return this.post('/authorize', {
      clientKey: opts.clientKey,
      classId: opts.classId,
      studentId: opts.studentId,
      mode: opts.mode,
      allowlistHosts: opts.allowlistHosts ?? [],
    });
  }

  async revokeClient(opts: ShieldClientRef) {
    return this.post('/revoke', {
      clientKey: opts.clientKey,
      classId: opts.classId,
      studentId: opts.studentId,
    });
  }

  async kickClient(opts: ShieldClientRef) {
    return this.post('/kick', {
      clientKey: opts.clientKey,
      classId: opts.classId,
      studentId: opts.studentId,
    });
  }

  async health() {
    if (!this.base) return { ok: false, detail: 'shield_url_unset' };
    try {
      const res = await fetch(`${this.base}/health`, {
        method: 'GET',
        headers: this.headers(),
      });
      return { ok: res.ok, detail: `http_${res.status}` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : 'shield_health_failed' };
    }
  }
}

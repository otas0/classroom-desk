/**
 * Shared allowlist state for the lab HTTP Shield gateway.
 * File-backed allowlist state for the lab HTTP Shield gateway.
 */
import fs from 'node:fs';
import path from 'node:path';

export function createLabShieldStore(opts = {}) {
  const statePath = opts.statePath
    ? path.resolve(opts.statePath)
    : path.join(process.cwd(), 'tmp', 'lab-shield-state.json');
  /** @type {Map<string, { mode: string, allowlistHosts: string[], updatedAt: string }>} */
  const clients = new Map();
  const kicks = [];
  let failRelease = Boolean(opts.failRelease);

  function load() {
    try {
      if (!fs.existsSync(statePath)) return;
      const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      clients.clear();
      for (const [k, v] of Object.entries(raw.clients ?? {})) clients.set(k, v);
      kicks.length = 0;
      kicks.push(...(raw.kicks ?? []));
    } catch {
      /* empty */
    }
  }

  function save() {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          clients: Object.fromEntries(clients),
          kicks,
        },
        null,
        2,
      ),
    );
  }

  load();

  return {
    statePath,
    clients,
    kicks,
    setFailRelease(on) {
      failRelease = Boolean(on);
    },
    authorize(body) {
      const key = String(body?.clientKey ?? '').trim();
      if (!key) return { ok: false, detail: 'missing_client_key', status: 400 };
      clients.set(key, {
        mode: String(body?.mode ?? 'allowlist'),
        allowlistHosts: Array.isArray(body?.allowlistHosts) ? body.allowlistHosts.map(String) : [],
        updatedAt: new Date().toISOString(),
      });
      save();
      return { ok: true, detail: `lab_authorized_${key}`, status: 200 };
    },
    revoke(body) {
      const key = String(body?.clientKey ?? '').trim();
      if (!key) return { ok: false, detail: 'missing_client_key', status: 400 };
      clients.delete(key);
      save();
      return { ok: true, detail: `lab_revoked_${key}`, status: 200 };
    },
    kick(body) {
      const key = String(body?.clientKey ?? '').trim();
      if (!key) return { ok: false, detail: 'missing_client_key', status: 400 };
      clients.delete(key);
      kicks.push(key);
      save();
      return { ok: true, detail: `lab_kicked_${key}`, status: 200 };
    },
    release(body) {
      if (failRelease) {
        return { ok: false, detail: 'lab_release_boom', status: 500 };
      }
      return this.revoke(body);
    },
    snapshot() {
      return {
        ok: true,
        clientCount: clients.size,
        clients: Object.fromEntries(clients),
        kicks: [...kicks],
        statePath,
      };
    },
  };
}

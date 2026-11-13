#!/usr/bin/env node
/**
 * OPNsense alias allow/block acceptance.
 * Default: deploy/lab-opnsense-api (runnable program).
 * Live: OPNSENSE_LIVE=1 + OPNSENSE_* against school controller.
 *
 *   npm run lab:opnsense   # or auto-start below
 *   npx tsx scripts/opnsense-alias-acceptance.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpnsenseShieldConnector } from '../apps/server/src/services/shield/opnsenseConnector.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIVE = process.env.OPNSENSE_LIVE === '1';

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

async function waitHealth(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${url}/health`);
      if (r.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function withLab(fn) {
  const existing = String(process.env.OPNSENSE_URL || '').replace(/\/$/, '');
  if (existing && process.env.OPNSENSE_API_KEY) {
    await fn(existing);
    return;
  }
  const port = 18792 + Math.floor(Math.random() * 200);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(root, 'deploy/lab-opnsense-api/server.mjs')], {
    cwd: root,
    env: {
      ...process.env,
      LAB_OPNSENSE_PORT: String(port),
      LAB_OPNSENSE_STATE: path.join(root, 'tmp', `lab-opnsense-${port}.json`),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert(await waitHealth(base), 'lab-opnsense-api health');
  try {
    process.env.OPNSENSE_URL = base;
    process.env.OPNSENSE_API_KEY = process.env.OPNSENSE_API_KEY || 'lab';
    process.env.OPNSENSE_API_SECRET = process.env.OPNSENSE_API_SECRET || 'lab';
    await fn(base);
  } finally {
    child.kill();
  }
}

async function runLab() {
  await withLab(async (base) => {
    const op = new OpnsenseShieldConnector({
      baseUrl: base,
      apiKey: 'lab',
      apiSecret: 'lab',
      alias: 'classroom_desk_block',
      allowAlias: 'classroom_desk_allow',
    });
    const deny = await op.authorizeClient({ clientKey: '10.9.9.9', mode: 'deny' });
    assert(deny.ok, 'deny ok');
    assert(op.isBlocked('10.9.9.9'), 'local block set');
    const allow = await op.authorizeClient({ clientKey: '10.9.9.9', mode: 'allowlist' });
    assert(allow.ok, 'allowlist ok');
    assert(op.isAllowed('10.9.9.9'), 'local allow set');
    assert(!op.isBlocked('10.9.9.9'), 'cleared block');

    const snap = await (await fetch(`${base}/snapshot`)).json();
    const urls = (snap.calls || []).map((c) => c.url);
    assert(
      urls.some((u) => u.includes('/api/firewall/alias_util/add/classroom_desk_block')),
      'deny adds block alias',
    );
    assert(
      urls.some((u) => u.includes('/api/firewall/alias_util/delete/classroom_desk_allow')),
      'deny removes allow alias',
    );
    assert(
      urls.some((u) => u.includes('/api/firewall/alias_util/add/classroom_desk_allow')),
      'allowlist adds allow alias',
    );
    assert(
      urls.some((u) => u.includes('/api/firewall/alias_util/delete/classroom_desk_block')),
      'allowlist removes block alias',
    );
    assert(urls.filter((u) => u.includes('/api/firewall/alias/reconfigure')).length >= 2, 'reconfigure');
    console.log('opnsense-alias-acceptance lab OK', { calls: urls.length, base });
  });
}

async function runLive() {
  const op = new OpnsenseShieldConnector();
  const h = await op.health();
  console.log('live health', h);
  const ip = process.env.OPNSENSE_TEST_IP || '10.255.255.254';
  const deny = await op.authorizeClient({ clientKey: ip, mode: 'deny' });
  console.log('deny', deny);
  const allow = await op.authorizeClient({ clientKey: ip, mode: 'allow' });
  console.log('allow', allow);
  assert(deny.ok && allow.ok, 'live authorize');
  console.log('opnsense-alias-acceptance live OK', { lastApiCalls: op.lastApiCalls });
}

void (LIVE ? runLive() : runLab());

#!/usr/bin/env node
/**
 * UniFi login + block-sta acceptance.
 * Default: deploy/lab-unifi-api (runnable program).
 * Live: UNIFI_LIVE=1 + UNIFI_URL/USER/PASS (+ optional UNIFI_TEST_MAC).
 *
 *   npm run lab:unifi
 *   npx tsx scripts/unifi-auth-acceptance.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UnifiShieldConnector } from '../apps/server/src/services/shield/unifiConnector.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIVE = process.env.UNIFI_LIVE === '1';

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
  const existing = String(process.env.UNIFI_URL || '').replace(/\/$/, '');
  if (existing && process.env.UNIFI_USER) {
    await fn(existing);
    return;
  }
  const port = 18793 + Math.floor(Math.random() * 200);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(root, 'deploy/lab-unifi-api/server.mjs')], {
    cwd: root,
    env: {
      ...process.env,
      LAB_UNIFI_PORT: String(port),
      LAB_UNIFI_USER: 'lab',
      LAB_UNIFI_PASS: 'lab',
      LAB_UNIFI_STATE: path.join(root, 'tmp', `lab-unifi-${port}.json`),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert(await waitHealth(base), 'lab-unifi-api health');
  try {
    process.env.UNIFI_URL = base;
    process.env.UNIFI_USER = 'lab';
    process.env.UNIFI_PASS = 'lab';
    await fn(base);
  } finally {
    child.kill();
  }
}

async function runLab() {
  await withLab(async (base) => {
    const uni = new UnifiShieldConnector({
      baseUrl: base,
      user: 'lab',
      pass: 'lab',
      site: 'default',
    });
    const h = await uni.health();
    assert(h.ok, 'health');
    assert(uni.getLoginPathUsed() === '/api/auth/login', 'UniFi OS path');
    const deny = await uni.authorizeClient({
      clientKey: 'aa:bb:cc:dd:ee:ff',
      mode: 'deny',
    });
    assert(deny.ok, 'block-sta');
    const snap = await (await fetch(`${base}/snapshot`)).json();
    assert((snap.hits || []).some((x) => String(x).includes('/cmd/stamgr')), 'stamgr called');
    assert((snap.hits || []).some((x) => String(x).includes('block-sta')), 'block-sta cmd');
    console.log('unifi-auth-acceptance lab OK', {
      hits: (snap.hits || []).length,
      path: uni.getLoginPathUsed(),
      base,
    });
  });
}

async function runLive() {
  const uni = new UnifiShieldConnector();
  const h = await uni.health();
  console.log('live health', h);
  assert(h.ok, 'live login');
  assert(
    String(h.detail).includes('/api/auth/login') || String(h.detail).includes('/api/login'),
    'login path recorded',
  );
  const mac = String(process.env.UNIFI_TEST_MAC ?? '').trim();
  if (mac) {
    const deny = await uni.authorizeClient({ clientKey: mac, mode: 'deny' });
    console.log('block-sta', deny);
    const allow = await uni.authorizeClient({ clientKey: mac, mode: 'allow' });
    console.log('unblock-sta', allow);
    assert(deny.ok && allow.ok, 'live stamgr');
  } else {
    console.log('skip stamgr (set UNIFI_TEST_MAC=aa:bb:… to exercise block-sta)');
  }
  console.log('unifi-auth-acceptance live OK', { login: uni.getLoginPathUsed() });
}

void (LIVE ? runLive() : runLab());

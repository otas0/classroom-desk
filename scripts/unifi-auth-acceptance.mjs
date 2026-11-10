#!/usr/bin/env node
/**
 * UniFi login + block-sta acceptance.
 * Default: mock UniFi OS /api/auth/login + stamgr.
 * Live: UNIFI_LIVE=1 + UNIFI_URL/USER/PASS (+ optional UNIFI_TEST_MAC).
 *
 * Run: npx tsx scripts/unifi-auth-acceptance.mjs
 */
import http from 'node:http';
import { UnifiShieldConnector } from '../apps/server/src/services/shield/unifiConnector.ts';

const LIVE = process.env.UNIFI_LIVE === '1';

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

async function runMock() {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if (req.url === '/api/auth/login') {
      res.setHeader('Set-Cookie', ['TOKEN=csrf-live; Path=/', 'unifises=abc; Path=/']);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"meta":{"rc":"ok"}}');
      return;
    }
    if (req.url === '/api/login') {
      res.writeHead(404);
      res.end('legacy');
      return;
    }
    if (String(req.url).includes('/cmd/stamgr')) {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        hits.push(`body:${body}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"meta":{"rc":"ok"}}');
      });
      return;
    }
    res.writeHead(404);
    res.end('no');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const uni = new UnifiShieldConnector({
    baseUrl: `http://127.0.0.1:${port}`,
    user: 'admin',
    pass: 'pass',
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
  assert(hits.some((x) => x.includes('/cmd/stamgr')), 'stamgr called');
  assert(hits.some((x) => x.includes('block-sta')), 'block-sta cmd');
  await new Promise((r) => server.close(r));
  console.log('unifi-auth-acceptance mock OK', { hits: hits.length, path: uni.getLoginPathUsed() });
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

void (LIVE ? runLive() : runMock());

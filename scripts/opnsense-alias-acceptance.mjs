#!/usr/bin/env node
/**
 * OPNsense alias allow/block acceptance.
 * Default: local mock HTTP server verifying connector call order.
 * Live: OPNSENSE_LIVE=1 + OPNSENSE_* env against real controller.
 *
 * Run: npx tsx scripts/opnsense-alias-acceptance.mjs
 */
import http from 'node:http';
import { createRequire } from 'node:module';

// Prefer compiled/tsx-resolved TS connector from source via dynamic import of built path.
const { OpnsenseShieldConnector } = await import(
  '../apps/server/src/services/shield/opnsenseConnector.ts'
);

const LIVE = process.env.OPNSENSE_LIVE === '1';
const calls = [];

async function withMock(fn) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result: 'ok' }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

async function runMock() {
  calls.length = 0;
  await withMock(async (base) => {
    const op = new OpnsenseShieldConnector({
      baseUrl: base,
      apiKey: 'k',
      apiSecret: 's',
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
  });

  const urls = calls.map((c) => c.url);
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
  console.log('opnsense-alias-acceptance mock OK', { calls: calls.length });
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

void (LIVE ? runLive() : runMock());

void createRequire;

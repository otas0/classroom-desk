#!/usr/bin/env node
/**
 * Lab OPNsense API — ready for local/CI deploy (alias_util + reconfigure).
 *
 *   npm run lab:opnsense
 *   OPNSENSE_URL=http://127.0.0.1:8792 OPNSENSE_API_KEY=lab OPNSENSE_API_SECRET=lab
 *
 * Not a full firewall; implements the Classroom Desk connector contract for acceptance.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.env.LAB_OPNSENSE_PORT || 8792);
const statePath =
  process.env.LAB_OPNSENSE_STATE ||
  path.join(process.cwd(), 'tmp', 'lab-opnsense-state.json');

/** @type {{ calls: Array<{method:string,url:string,body:string}>, aliases: Record<string,string[]> }} */
const state = { calls: [], aliases: {} };

function load() {
  try {
    if (!fs.existsSync(statePath)) return;
    Object.assign(state, JSON.parse(fs.readFileSync(statePath, 'utf8')));
  } catch {
    /* empty */
  }
}
function save() {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}
load();

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

const server = http.createServer(async (req, res) => {
  const body = await readBody(req);
  const url = String(req.url || '');
  state.calls.push({ method: req.method || 'GET', url, body });
  if (state.calls.length > 200) state.calls.shift();

  const add = /^\/api\/firewall\/alias_util\/add\/([^/?]+)/.exec(url);
  const del = /^\/api\/firewall\/alias_util\/delete\/([^/?]+)/.exec(url);
  if (add && req.method === 'POST') {
    const alias = decodeURIComponent(add[1]);
    let address = '';
    try {
      address = String(JSON.parse(body || '{}').address || '');
    } catch {
      address = '';
    }
    if (!state.aliases[alias]) state.aliases[alias] = [];
    if (address && !state.aliases[alias].includes(address)) state.aliases[alias].push(address);
    save();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ result: 'ok', alias, address }));
    return;
  }
  if (del && req.method === 'POST') {
    const alias = decodeURIComponent(del[1]);
    let address = '';
    try {
      address = String(JSON.parse(body || '{}').address || '');
    } catch {
      address = '';
    }
    state.aliases[alias] = (state.aliases[alias] || []).filter((a) => a !== address);
    save();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ result: 'ok', alias, address }));
    return;
  }
  const list = /^\/api\/firewall\/alias_util\/list\/([^/?]+)/.exec(url);
  if (list && req.method === 'GET') {
    const alias = decodeURIComponent(list[1]);
    const addresses = state.aliases[alias] || [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ alias, addresses, rows: addresses.map((address) => ({ address })) }));
    return;
  }
  if (url.startsWith('/api/firewall/alias/reconfigure') && req.method === 'POST') {
    save();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (url === '/health' || url === '/api/core/firmware/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, product: 'lab-opnsense-api' }));
    return;
  }
  if (url === '/snapshot') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(port, '127.0.0.1', () => {
  console.log(
    JSON.stringify({
      ok: true,
      listen: `http://127.0.0.1:${port}`,
      hint: 'OPNSENSE_URL=http://127.0.0.1:' + port + ' OPNSENSE_API_KEY=lab OPNSENSE_API_SECRET=lab',
      statePath,
    }),
  );
});

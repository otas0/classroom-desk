#!/usr/bin/env node
/**
 * Lab UniFi Network API — ready for local/CI deploy (login + stamgr).
 *
 *   npm run lab:unifi
 *   UNIFI_URL=http://127.0.0.1:8793 UNIFI_USER=lab UNIFI_PASS=lab
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.env.LAB_UNIFI_PORT || 8793);
const user = String(process.env.LAB_UNIFI_USER || 'lab');
const pass = String(process.env.LAB_UNIFI_PASS || 'lab');
const statePath =
  process.env.LAB_UNIFI_STATE || path.join(process.cwd(), 'tmp', 'lab-unifi-state.json');

const state = { hits: [], blocked: [] };

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
  const url = String(req.url || '');
  const body = await readBody(req);
  state.hits.push(`${req.method} ${url}`);
  if (body) state.hits.push(`body:${body.slice(0, 200)}`);
  if (state.hits.length > 200) state.hits.splice(0, state.hits.length - 200);

  if (url === '/api/auth/login' && req.method === 'POST') {
    let cred = {};
    try {
      cred = JSON.parse(body || '{}');
    } catch {
      cred = {};
    }
    if (String(cred.username) === user && String(cred.password) === pass) {
      res.setHeader('Set-Cookie', ['TOKEN=lab-csrf; Path=/', 'unifises=lab-session; Path=/']);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ meta: { rc: 'ok' } }));
      save();
      return;
    }
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ meta: { rc: 'error' } }));
    return;
  }
  if (url === '/api/login') {
    res.writeHead(404);
    res.end('legacy_disabled_on_lab');
    return;
  }
  if (String(url).includes('/cmd/stamgr') && req.method === 'POST') {
    let cmd = {};
    try {
      cmd = JSON.parse(body || '{}');
    } catch {
      cmd = {};
    }
    const mac = String(cmd.mac || cmd.macs?.[0] || '');
    if (cmd.cmd === 'block-sta' && mac) {
      if (!state.blocked.includes(mac)) state.blocked.push(mac);
    }
    if (cmd.cmd === 'unblock-sta' && mac) {
      state.blocked = state.blocked.filter((m) => m !== mac);
    }
    save();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ meta: { rc: 'ok' } }));
    return;
  }
  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, product: 'lab-unifi-api' }));
    return;
  }
  if (url === '/snapshot') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state));
    return;
  }

  res.writeHead(404);
  res.end('no');
});

server.listen(port, '127.0.0.1', () => {
  console.log(
    JSON.stringify({
      ok: true,
      listen: `http://127.0.0.1:${port}`,
      hint: `UNIFI_URL=http://127.0.0.1:${port} UNIFI_USER=${user} UNIFI_PASS=${pass}`,
      statePath,
    }),
  );
});

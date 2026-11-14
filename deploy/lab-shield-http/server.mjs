#!/usr/bin/env node
/**
 * Runnable lab HTTP Shield + captive evidence pages (deployable local gateway).
 *
 *   node deploy/lab-shield-http/server.mjs
 *   CLASSROOM_DESK_SHIELD=http CLASSROOM_DESK_SHIELD_URL=http://127.0.0.1:8791
 *
 * Endpoints (HttpShieldConnector contract):
 *   POST /authorize|/revoke|/kick|/release
 *   GET  /health
 * Captive evidence (screenshotable):
 *   GET /evidence/deny|/evidence/allow|/evidence/fas
 *   GET /ui
 */
import http from 'node:http';
import { createLabShieldStore } from './store.mjs';

const port = Number(process.env.LAB_SHIELD_PORT || 8791);
const token = String(process.env.LAB_SHIELD_TOKEN || '').trim();
const store = createLabShieldStore({
  statePath: process.env.LAB_SHIELD_STATE,
  failRelease: process.env.LAB_SHIELD_FAIL_RELEASE === '1',
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function authOk(req) {
  if (!token) return true;
  const h = String(req.headers.authorization || '');
  return h === `Bearer ${token}`;
}

function htmlPage(title, body) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"/><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px;color:#1a2332}
.box{border:1px solid #c5ced9;padding:20px;border-radius:8px}.ok{border-color:#2f6f4e}.deny{border-color:#a33}
h1{font-size:1.25rem}.meta{color:#5a6575;font-size:.9rem}</style></head><body>
${body}<p class="meta">Classroom Desk lab-shield-http · 本地联调页（非学校生产网关）</p></body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
  const pathName = url.pathname.replace(/\/$/, '') || '/';

  if (pathName === '/health' && req.method === 'GET') {
    const snap = store.snapshot();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, detail: `lab_clients=${snap.clientCount}` }));
    return;
  }

  if (pathName === '/snapshot' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(store.snapshot()));
    return;
  }

  if (pathName === '/ui' && req.method === 'GET') {
    const snap = store.snapshot();
    const rows = Object.entries(snap.clients)
      .map(([k, v]) => `<tr><td>${k}</td><td>${v.mode}</td><td>${v.updatedAt}</td></tr>`)
      .join('');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      htmlPage(
        'Lab Shield 状态',
        `<h1>Lab Shield 放行表</h1><div class="box ok"><p>clients=${snap.clientCount}</p>
<table><thead><tr><th>clientKey</th><th>mode</th><th>at</th></tr></thead><tbody>${rows || '<tr><td colspan=3>—</td></tr>'}</tbody></table></div>`,
      ),
    );
    return;
  }

  if (pathName === '/evidence/deny' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      htmlPage(
        'openNDS deny',
        `<div class="box deny" data-testid="lab-opennds-deny"><h1>未授权 · 围墙拒绝</h1>
<p>模拟 openNDS deny：仅 /portal 可达。请到门户认证。</p></div>`,
      ),
    );
    return;
  }
  if (pathName === '/evidence/allow' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      htmlPage(
        'openNDS allow',
        `<div class="box ok" data-testid="lab-opennds-allow"><h1>已授权 · allow</h1>
<p>模拟 openNDS auth 成功：IP 已在放行表。</p></div>`,
      ),
    );
    return;
  }
  if (pathName === '/evidence/fas' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      htmlPage(
        'openNDS FAS',
        `<div class="box" data-testid="lab-opennds-fas"><h1>FAS 跳转</h1>
<p>模拟 openNDS FAS → 教师机 /portal?ssid=…</p>
<p class="meta">下一步：POST /api/v1/gateway/sign-ssid → 门户 admit</p></div>`,
      ),
    );
    return;
  }

  if (!authOk(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, detail: 'unauthorized' }));
    return;
  }

  if (req.method === 'POST') {
    let body = {};
    try {
      body = await readBody(req);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, detail: 'invalid_json' }));
      return;
    }
    if (req.headers['x-lab-fail-release'] === '1') store.setFailRelease(true);
    let result;
    if (pathName === '/authorize') result = store.authorize(body);
    else if (pathName === '/revoke') result = store.revoke(body);
    else if (pathName === '/kick') result = store.kick(body);
    else if (pathName === '/release') result = store.release(body);
    else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, detail: 'not_found' }));
      return;
    }
    res.writeHead(result.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: result.ok, detail: result.detail }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, detail: 'not_found' }));
});

server.listen(port, '127.0.0.1', () => {
  console.log(
    JSON.stringify({
      ok: true,
      listen: `http://127.0.0.1:${port}`,
      hint: 'CLASSROOM_DESK_SHIELD=http CLASSROOM_DESK_SHIELD_URL=http://127.0.0.1:' + port,
      evidence: ['/evidence/deny', '/evidence/allow', '/evidence/fas', '/ui'],
      statePath: store.statePath,
    }),
  );
});

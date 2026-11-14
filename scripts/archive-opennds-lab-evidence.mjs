#!/usr/bin/env node
/**
 * Capture openNDS-style allow/deny/FAS evidence from the local lab-shield-http program.
 *
 *   npm run lab:shield   # optional if LAB_SHIELD_AUTO=1
 *   npm run archive:opennds-lab
 *
 * Prefers Playwright PNG screenshots; falls back to saved HTML when browsers are missing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const day = new Date().toISOString().slice(0, 10);
const outDir = path.join(root, 'tmp/live-evidence', day);
const shots = path.join(outDir, 'screenshots');
fs.mkdirSync(shots, { recursive: true });

const auto = process.env.LAB_SHIELD_AUTO !== '0';
const baseEnv = String(process.env.LAB_SHIELD_URL || '').replace(/\/$/, '');
let base = baseEnv;
let child = null;

async function waitHealth(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${url}/health`);
      if (r.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

if (!base && auto) {
  const port = 8791 + Math.floor(Math.random() * 200);
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(root, 'deploy/lab-shield-http/server.mjs')], {
    cwd: root,
    env: { ...process.env, LAB_SHIELD_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ok = await waitHealth(base);
  if (!ok) {
    console.error('lab-shield-http failed to start');
    child?.kill();
    process.exit(1);
  }
}

if (!base) {
  console.error('Set LAB_SHIELD_URL or leave LAB_SHIELD_AUTO=1');
  process.exit(1);
}

const pages = [
  ['deny', `${base}/evidence/deny`],
  ['allow', `${base}/evidence/allow`],
  ['fas', `${base}/evidence/fas`],
  ['ui', `${base}/ui`],
];
const saved = [];
let mode = 'html';

try {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  for (const [name, url] of pages) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    const dest = path.join(shots, `opennds-lab-${name}.png`);
    await page.screenshot({ path: dest, fullPage: true });
    saved.push(path.relative(root, dest));
  }
  await browser.close();
  mode = 'png';
} catch (e) {
  console.warn('[archive-opennds-lab] Playwright unavailable, saving HTML:', e instanceof Error ? e.message : e);
  for (const [name, url] of pages) {
    const res = await fetch(url);
    const html = await res.text();
    const dest = path.join(shots, `opennds-lab-${name}.html`);
    fs.writeFileSync(dest, html);
    saved.push(path.relative(root, dest));
  }
}

const auth = await fetch(`${base}/authorize`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ clientKey: 'lab-evidence-client', mode: 'allowlist' }),
});
const authBody = await auth.text();

const manifest = {
  at: new Date().toISOString(),
  kind: 'opennds-lab',
  base,
  captureMode: mode,
  screenshots: saved,
  authorizeOk: auth.ok,
  authorizeDetail: authBody.slice(0, 200),
  note: 'Local runnable lab-shield-http evidence (not school production AP). Sanitize before sharing.',
};
fs.writeFileSync(path.join(outDir, 'opennds-lab-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));

if (child) child.kill();
if (!auth.ok) process.exit(1);

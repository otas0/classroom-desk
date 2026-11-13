#!/usr/bin/env node
/**
 * Archive OPNsense / UniFi live acceptance evidence under tmp/live-evidence/.
 * Without credentials, writes a SKIPPED manifest (CI-safe).
 *
 *   node scripts/archive-live-shield-evidence.mjs
 *   OPNSENSE_LIVE=1 … node scripts/archive-live-shield-evidence.mjs
 *   UNIFI_LIVE=1 … node scripts/archive-live-shield-evidence.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'tmp/live-evidence', new Date().toISOString().slice(0, 10));
fs.mkdirSync(outDir, { recursive: true });

const manifest = {
  at: new Date().toISOString(),
  opnsense: { attempted: false, ok: false, detail: '' },
  unifi: { attempted: false, ok: false, detail: '' },
  screenshotsDir: path.join(outDir, 'screenshots'),
  notes: [
    'Place firewall/UI screenshots in screenshots/ (do not commit secrets or public IPs).',
    'See docs/OPNSENSE_ACCEPTANCE.md and docs/UNIFI_ACCEPTANCE.md',
  ],
};

fs.mkdirSync(manifest.screenshotsDir, { recursive: true });

function run(cmd, args, envExtra = {}) {
  return spawnSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...envExtra },
  });
}

const hasOpn =
  process.env.OPNSENSE_LIVE === '1' &&
  process.env.OPNSENSE_URL &&
  process.env.OPNSENSE_API_KEY;
const hasUni =
  process.env.UNIFI_LIVE === '1' && process.env.UNIFI_URL && process.env.UNIFI_USER;

if (hasOpn) {
  manifest.opnsense.attempted = true;
  const r = run('npx', ['tsx', 'scripts/opnsense-alias-acceptance.mjs'], {
    OPNSENSE_LIVE: '1',
  });
  fs.writeFileSync(path.join(outDir, 'opnsense-stdout.txt'), r.stdout || '');
  fs.writeFileSync(path.join(outDir, 'opnsense-stderr.txt'), r.stderr || '');
  manifest.opnsense.ok = r.status === 0;
  manifest.opnsense.detail = r.status === 0 ? 'live_ok' : `exit_${r.status}`;
} else {
  manifest.opnsense.detail = 'SKIPPED: set OPNSENSE_LIVE=1 and OPNSENSE_URL/API_KEY/SECRET';
  fs.writeFileSync(
    path.join(outDir, 'opnsense-SKIPPED.txt'),
    manifest.opnsense.detail + '\n',
  );
}

if (hasUni) {
  manifest.unifi.attempted = true;
  const r = run('npx', ['tsx', 'scripts/unifi-auth-acceptance.mjs'], {
    UNIFI_LIVE: '1',
  });
  fs.writeFileSync(path.join(outDir, 'unifi-stdout.txt'), r.stdout || '');
  fs.writeFileSync(path.join(outDir, 'unifi-stderr.txt'), r.stderr || '');
  manifest.unifi.ok = r.status === 0;
  manifest.unifi.detail = r.status === 0 ? 'live_ok' : `exit_${r.status}`;
} else {
  manifest.unifi.detail =
    'SKIPPED: set UNIFI_LIVE=1 and UNIFI_URL/USER/PASS (optional UNIFI_TEST_MAC)';
  fs.writeFileSync(path.join(outDir, 'unifi-SKIPPED.txt'), manifest.unifi.detail + '\n');
}

// Always try local openNDS lab evidence (runnable program; no school creds).
manifest.openndsLab = { attempted: true, ok: false, detail: '' };
{
  const r = run(process.execPath, [path.join(root, 'scripts/archive-opennds-lab-evidence.mjs')], {
    LAB_SHIELD_AUTO: '1',
  });
  fs.writeFileSync(path.join(outDir, 'opennds-lab-stdout.txt'), r.stdout || '');
  fs.writeFileSync(path.join(outDir, 'opennds-lab-stderr.txt'), r.stderr || '');
  manifest.openndsLab.ok = r.status === 0;
  manifest.openndsLab.detail = r.status === 0 ? 'lab_screenshots_ok' : `exit_${r.status}`;
}

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ outDir, ...manifest }, null, 2));

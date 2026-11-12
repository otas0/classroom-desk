#!/usr/bin/env node
/**
 * Fixture tests for check-live-evidence-sanitized.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts/check-live-evidence-sanitized.mjs');

function run(dir, extraArgs = []) {
  return spawnSync(process.execPath, [script, ...extraArgs, dir], {
    encoding: 'utf8',
    cwd: root,
  });
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-evidence-'));
const clean = path.join(base, 'clean');
const dirty = path.join(base, 'dirty');
const rfc = path.join(base, 'rfc');
fs.mkdirSync(clean, { recursive: true });
fs.mkdirSync(dirty, { recursive: true });
fs.mkdirSync(rfc, { recursive: true });

fs.writeFileSync(path.join(clean, 'notes.txt'), 'SKIPPED: set OPNSENSE_LIVE=1 and OPNSENSE_URL/API_KEY/SECRET\n');
fs.writeFileSync(
  path.join(dirty, 'leak.txt'),
  'password=SuperSecretValue99\napi_key=abcdefghijklmnop\n',
);
fs.writeFileSync(
  path.join(rfc, 'mgmt.txt'),
  'Open https://192.168.1.1/ui for OPNsense admin\n',
);

{
  const r = run(clean);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, true);
}

{
  const r = run(dirty);
  assert.equal(r.status, 2);
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, false);
  assert.ok(j.findings.some((f) => f.kind === 'secret_pattern'));
}

{
  const r = run(rfc);
  assert.equal(r.status, 0, 'rfc1918 alone should pass without flag');
}

{
  const r = run(rfc, ['--fail-on-rfc1918-leak']);
  assert.equal(r.status, 2);
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, false);
  assert.ok(j.findings.some((f) => f.kind === 'rfc1918_leak'));
}

fs.rmSync(base, { recursive: true, force: true });
console.log('check-live-evidence-sanitized.test.mjs ok');

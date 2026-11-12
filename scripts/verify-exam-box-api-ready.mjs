#!/usr/bin/env node
/**
 * Exam Box compose must fail when CD_API_BASE is unreachable (api-ready exit ≠ 0).
 *
 *   node scripts/verify-exam-box-api-ready.mjs
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const composeDir = path.join(root, 'deploy/exam-box');

const r = spawnSync(
  'docker',
  [
    'compose',
    'run',
    '--rm',
    '--no-deps',
    '-e',
    'CD_API_BASE=http://127.0.0.1:1',
    'api-ready',
  ],
  {
    cwd: composeDir,
    encoding: 'utf8',
    env: { ...process.env, CD_API_BASE: 'http://127.0.0.1:1' },
  },
);

const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
if (r.error && /ENOENT|not found/i.test(String(r.error))) {
  console.log(JSON.stringify({ ok: true, skipped: true, detail: 'docker_unavailable' }));
  process.exit(0);
}

const failed = r.status !== 0;
console.log(
  JSON.stringify({
    ok: failed,
    status: r.status,
    detail: failed ? 'api-ready_failed_as_expected' : 'api-ready_unexpectedly_ok',
    sample: out.slice(0, 400),
  }),
);
process.exit(failed ? 0 : 2);

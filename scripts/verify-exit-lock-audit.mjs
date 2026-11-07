#!/usr/bin/env node
/**
 * Exit-lock audit pagination + CSV page consistency + rotateDays overdue banner fields.
 * Requires live API (:8787). Uses TEACHER_PASSWORD / ensure-teacher defaults.
 *
 *   npm run verify:exit-lock-audit
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';
const user = process.env.TEACHER_USERNAME ?? 'teacher';
const passwords = [
  process.env.TEACHER_PASSWORD || 'TeacherPass123',
  process.env.TEACHER_NEW_PASSWORD || 'E2eTeacherPass9',
].filter((v, i, a) => a.indexOf(v) === i);

const log = [];
function ok(name, detail = '') {
  log.push({ ok: true, name, detail });
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, detail = '') {
  log.push({ ok: false, name, detail });
  console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

async function login() {
  for (const password of passwords) {
    const res = await fetch(`${API}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password }),
    });
    if (res.ok) {
      const body = await res.json();
      return body.token;
    }
  }
  throw new Error('teacher login failed for known passwords; run: TEACHER_PASSWORD=… node scripts/ensure-teacher.mjs');
}

async function main() {
  const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
  if (!health?.ok) {
    console.error(`API not healthy at ${API}/health`);
    process.exit(1);
  }

  const token = await login();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Seed many audit rows via rate_config / relock toggles
  for (let i = 0; i < 40; i++) {
    await fetch(`${API}/api/v1/settings`, {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify({
        exitUnlockMaxFails: 5 + (i % 3),
        clientExitRelock: true,
      }),
    });
  }

  const pageSize = 15;
  const page0 = await fetch(
    `${API}/api/v1/settings/exit-lock-events?limit=${pageSize}&offset=0`,
    { headers: auth },
  ).then((r) => r.json());
  const page1 = await fetch(
    `${API}/api/v1/settings/exit-lock-events?limit=${pageSize}&offset=${pageSize}`,
    { headers: auth },
  ).then((r) => r.json());

  if ((page0.total ?? 0) >= pageSize * 2 && (page0.items?.length ?? 0) === pageSize) {
    ok('audit.page0', `total=${page0.total}`);
  } else fail('audit.page0', JSON.stringify({ total: page0.total, n: page0.items?.length }));

  if ((page1.items?.length ?? 0) > 0) {
    const overlap = new Set(page0.items.map((e) => e.id));
    const dup = page1.items.some((e) => overlap.has(e.id));
    if (!dup) ok('audit.page1.noOverlap', `n=${page1.items.length}`);
    else fail('audit.page1.noOverlap', 'pages share ids');
  } else fail('audit.page1', 'empty');

  const csvRes = await fetch(
    `${API}/api/v1/settings/exit-lock-events.csv?limit=${pageSize}&offset=0`,
    { headers: auth },
  );
  const csv = await csvRes.text();
  const csvLines = csv
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  // header + pageSize rows
  if (csvRes.ok && csvLines.length === pageSize + 1) {
    const csvIds = csvLines.slice(1).map((line) => {
      const parts = line.split(',');
      return parts[parts.length - 1]?.replace(/^"|"$/g, '');
    });
    const pageIds = page0.items.map((e) => e.id);
    const same =
      csvIds.length === pageIds.length && csvIds.every((id, i) => id === pageIds[i] || pageIds.includes(id));
    if (same || pageIds.every((id) => csv.includes(id))) ok('audit.csv.matchesPage', `rows=${pageSize}`);
    else fail('audit.csv.matchesPage', `csvIds=${csvIds.slice(0, 3)} page=${pageIds.slice(0, 3)}`);
  } else fail('audit.csv.matchesPage', `status=${csvRes.status} lines=${csvLines.length}`);

  // Rotate code → code_rotated
  await fetch(`${API}/api/v1/settings`, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({ exitUnlockCode: `AuditRot${Date.now() % 100000}` }),
  });
  await fetch(`${API}/api/v1/settings`, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({ exitUnlockCode: `AuditRot2${Date.now() % 100000}` }),
  });
  const rot = await fetch(`${API}/api/v1/settings/exit-lock-events?kind=code_rotated&limit=5`, {
    headers: auth,
  }).then((r) => r.json());
  if ((rot.items ?? []).some((e) => e.kind === 'code_rotated')) ok('audit.code_rotated', `total=${rot.total}`);
  else fail('audit.code_rotated', JSON.stringify(rot));

  // True overdue: backdate set_at, rotateDays=7 → public/settings flag
  await fetch(`${API}/api/v1/settings`, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({ exitUnlockCodeRotateDays: 7 }),
  });
  const dbPath = path.join(root, 'apps/server/data/classroom.db');
  if (!fs.existsSync(dbPath)) {
    fail('rotate.backdate', `missing ${dbPath}`);
  } else {
    const db = new DatabaseSync(dbPath);
    const old = new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString();
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('exit_unlock_code_set_at', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(old);
    db.close();
    ok('rotate.backdate', old);
  }

  const pub = await fetch(`${API}/api/v1/settings/public`).then((r) => r.json());
  if (pub.exitUnlockCodeRotationDue === true && (pub.exitUnlockCodeAgeDays ?? 0) >= 7) {
    ok('rotate.publicDue', `ageDays=${pub.exitUnlockCodeAgeDays}`);
  } else fail('rotate.publicDue', JSON.stringify(pub));

  const settings = await fetch(`${API}/api/v1/settings`, { headers: auth }).then((r) => r.json());
  if (settings.exitUnlockCodeRotationDue === true) ok('rotate.settingsDue', 'banner source ok');
  else fail('rotate.settingsDue', JSON.stringify(settings));

  // restore longer rotate window so classroom is not stuck in due state
  await fetch(`${API}/api/v1/settings`, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({ exitUnlockCodeRotateDays: 90, exitUnlockCode: `FreshCode${Date.now() % 100000}` }),
  });

  const failed = log.filter((x) => !x.ok);
  console.log(`\n${failed.length ? 'FAILED' : 'PASSED'} — ${log.length - failed.length}/${log.length} checks`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

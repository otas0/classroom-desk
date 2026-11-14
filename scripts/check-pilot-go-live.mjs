#!/usr/bin/env node
/**
 * Pilot go-live gate: secrets strength, TLS hint, Shield/DeskDNS honesty, marketing bans.
 * Usage: node scripts/check-pilot-go-live.mjs [path/to.env]
 * Exit 0 = ok for Pilot checklist; 1 = hard fail; 2 = warnings only (still ok with notes).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, '.env');

const fails = [];
const warns = [];
const oks = [];

function loadEnvFile(p) {
  const out = { ...process.env };
  if (!fs.existsSync(p)) {
    warns.push(`env file missing: ${p} (checking process.env only)`);
    return out;
  }
  const text = fs.readFileSync(p, 'utf8');
  for (const line of text.split(/\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  oks.push(`loaded env: ${p}`);
  return out;
}

const env = loadEnvFile(envPath);
const jwt = String(env.JWT_SECRET ?? '').trim();
const audit = String(env.AUDIT_HMAC_KEY ?? '').trim();
const weakRe = /replace|change-me|dev-secret|please-change|classroom-desk-secret|secret123/i;

if (!jwt) {
  fails.push('JWT_SECRET missing — production will refuse to start');
} else if (jwt.length < 32) {
  fails.push(`JWT_SECRET too short (${jwt.length} < 32)`);
} else if (weakRe.test(jwt)) {
  fails.push('JWT_SECRET looks like a placeholder — generate with: openssl rand -hex 32');
} else {
  oks.push('JWT_SECRET present and length ≥ 32');
}

if (!audit) {
  warns.push(
    'AUDIT_HMAC_KEY unset — audit HMAC falls back to JWT_SECRET (set a separate key for Pilot/compliance)',
  );
} else if (audit.length < 32) {
  fails.push(`AUDIT_HMAC_KEY too short (${audit.length} < 32)`);
} else if (weakRe.test(audit)) {
  fails.push('AUDIT_HMAC_KEY looks like a placeholder');
} else if (audit === jwt) {
  warns.push('AUDIT_HMAC_KEY equals JWT_SECRET — prefer independent keys');
} else {
  oks.push('AUDIT_HMAC_KEY present and distinct');
}

const shield = String(env.CLASSROOM_DESK_SHIELD ?? '')
  .trim()
  .toLowerCase();
const dnsOn =
  env.CLASSROOM_DESK_DNS === '1' ||
  env.CLASSROOM_DESK_DNS === 'true';
if (!shield || shield === 'off') {
  warns.push(
    'Shield=off (or unset): UI must show 网关未断 — do not claim gateway cut. Campus SKU needs opnsense|unifi|http.',
  );
} else if (!['http', 'opnsense', 'unifi', 'lab'].includes(shield)) {
  fails.push(`CLASSROOM_DESK_SHIELD=${shield} invalid (use off|http|opnsense|unifi)`);
} else {
  oks.push(`Shield adapter: ${shield}`);
}
if (dnsOn) oks.push('DeskDNS env enabled (CLASSROOM_DESK_DNS=1)');
else warns.push('DeskDNS not enabled via env — OK for campus Shield SKU; required for 单网校包');

warns.push(
  'HTTPS: terminate TLS at Caddy/nginx (docs/TLS_REVERSE_PROXY.md); max_secrecy production rejects non-TLS staff login',
);
warns.push(
  'Marketing ban: do not claim GA / 绝密 / 安全局最高机密 — Pilot only (docs/PILOT_SKU.md, docs/PILOT_GO_LIVE.md)',
);

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
oks.push(`package version ${pkg.version} (Pilot narrative; gaReady=false until school live evidence)`);

console.log('=== Pilot go-live check ===\n');
for (const x of oks) console.log(`OK   ${x}`);
for (const x of warns) console.log(`WARN ${x}`);
for (const x of fails) console.log(`FAIL ${x}`);
console.log('');
if (fails.length) {
  console.log(`Result: FAIL (${fails.length} hard)`);
  process.exit(1);
}
console.log(
  warns.length
    ? `Result: PASS with ${warns.length} warning(s) — review before classroom cutover`
    : 'Result: PASS',
);
process.exit(0);

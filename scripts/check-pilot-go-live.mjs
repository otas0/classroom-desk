#!/usr/bin/env node
/**
 * Pilot go-live gate.
 *   node scripts/check-pilot-go-live.mjs [--minimal] [path/to.env]
 * --minimal: Shield off / no DeskDNS / no HTTPS are OK (default classroom path).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const minimal = argv.includes('--minimal');
const envArg = argv.find((a) => !a.startsWith('--'));
const envPath = envArg ? path.resolve(envArg) : path.join(root, '.env');

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
  if (minimal) {
    warns.push('JWT_SECRET missing — run: npm run ensure:minimal-env');
  } else {
    fails.push('JWT_SECRET missing — production will refuse to start');
  }
} else if (jwt.length < 32) {
  fails.push(`JWT_SECRET too short (${jwt.length} < 32)`);
} else if (weakRe.test(jwt)) {
  fails.push('JWT_SECRET looks like a placeholder — npm run ensure:minimal-env -- --force');
} else {
  oks.push('JWT_SECRET present and length ≥ 32');
}

if (!audit) {
  warns.push(
    minimal
      ? 'AUDIT_HMAC_KEY unset — ensure:minimal-env writes both keys; ok if JWT alone for lab'
      : 'AUDIT_HMAC_KEY unset — prefer separate key',
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
const dnsOn = env.CLASSROOM_DESK_DNS === '1' || env.CLASSROOM_DESK_DNS === 'true';

if (minimal) {
  oks.push('profile=minimal — no gateway/TLS/DeskDNS required');
  if (!shield || shield === 'off') {
    oks.push('Shield off — UI must show 网关未断 (honest)');
  } else {
    oks.push(`Shield adapter: ${shield}`);
  }
  if (dnsOn) oks.push('DeskDNS enabled (optional add-on)');
} else {
  if (!shield || shield === 'off') {
    warns.push(
      'Shield=off — campus SKU needs opnsense|unifi|http; minimal classroom OK (docs/MINIMAL_DEPLOY.md)',
    );
  } else if (!['http', 'opnsense', 'unifi', 'lab'].includes(shield)) {
    fails.push(`CLASSROOM_DESK_SHIELD=${shield} invalid`);
  } else {
    oks.push(`Shield adapter: ${shield}`);
  }
  if (dnsOn) oks.push('DeskDNS env enabled');
  else warns.push('DeskDNS not enabled — OK unless 单网校包');
  warns.push('HTTPS: optional unless max_secrecy in production (docs/TLS_REVERSE_PROXY.md)');
}

warns.push(
  'Marketing ban: do not claim GA / 绝密 / 安全局最高机密 — Pilot only',
);

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
oks.push(`package ${pkg.version} · gaReady=false`);

console.log(`=== Pilot go-live check${minimal ? ' (minimal)' : ''} ===\n`);
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
    ? `Result: PASS with ${warns.length} warning(s)`
    : 'Result: PASS',
);
process.exit(0);

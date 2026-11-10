#!/usr/bin/env node
/**
 * Scan tmp/live-evidence for secrets / public IPs before sharing.
 *   node scripts/check-live-evidence-sanitized.mjs [dir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.resolve(process.argv[2] || path.join(root, 'tmp/live-evidence'));

// Require assignment-like forms so env-name hints (API_KEY/SECRET) are not false positives.
const SECRET_RE =
  /(?:api[_-]?key|api[_-]?secret|password|passwd|token)\s*[:=]\s*["']?[^\s"'`,;/]{8,}|bearer\s+[a-z0-9._-]{16,}|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/i;
const PUBLIC_IP_RE =
  /\b(?!10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)((?:\d{1,3}\.){3}\d{1,3})\b/g;

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    if (name === '.DS_Store') continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(txt|md|json|log|csv|yml|yaml|html)$/i.test(name)) acc.push(p);
  }
  return acc;
}

if (!fs.existsSync(target)) {
  console.log(JSON.stringify({ ok: true, skipped: true, target, detail: 'dir_missing' }));
  process.exit(0);
}

const findings = [];
for (const file of walk(target)) {
  const text = fs.readFileSync(file, 'utf8');
  if (SECRET_RE.test(text)) {
    findings.push({ file: path.relative(root, file), kind: 'secret_pattern' });
  }
  const ips = [...text.matchAll(PUBLIC_IP_RE)].map((m) => m[1]);
  const uniq = [...new Set(ips)].filter((ip) => {
    const parts = ip.split('.').map(Number);
    return parts.length === 4 && parts.every((n) => n >= 0 && n <= 255);
  });
  if (uniq.length) {
    findings.push({
      file: path.relative(root, file),
      kind: 'public_ip',
      samples: uniq.slice(0, 5),
    });
  }
}

const ok = findings.length === 0;
console.log(JSON.stringify({ ok, target: path.relative(root, target), findings }, null, 2));
process.exit(ok ? 0 : 2);

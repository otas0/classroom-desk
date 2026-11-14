#!/usr/bin/env node
/**
 * Build a sanitized 等保/密评-oriented evidence folder (local / pilot).
 * Does not claim formal MLPS certification. Strips tokens/passwords from snapshots.
 *
 * Usage:
 *   npm run export:compliance-evidence
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(
  root,
  'tmp',
  'compliance-evidence',
  new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19),
);

function redact(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value
      .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1***')
      .replace(/(token|password|secret|api[_-]?key)(["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, '$1$2***');
  }
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(value)) {
      if (/token|password|secret|apiKey|api_key/i.test(k)) o[k] = '***';
      else o[k] = redact(v);
    }
    return o;
  }
  return value;
}

fs.mkdirSync(outDir, { recursive: true });

const snap = spawnSync(
  'npx',
  ['tsx', path.join(root, 'scripts/compliance-evidence-snapshot.mjs')],
  { cwd: root, encoding: 'utf8', env: process.env },
);

let report = null;
let auditMeta = null;
if (snap.status === 0 && snap.stdout.trim()) {
  try {
    const parsed = JSON.parse(snap.stdout.trim());
    report = parsed.reconcile;
    auditMeta = parsed.audit;
  } catch (e) {
    fs.writeFileSync(
      path.join(outDir, 'reconcile-error.txt'),
      `json_parse: ${e}\n${snap.stdout.slice(0, 4000)}`,
    );
  }
} else {
  fs.writeFileSync(
    path.join(outDir, 'reconcile-error.txt'),
    (snap.stderr || snap.stdout || 'snapshot_failed').slice(0, 8000),
  );
}

const manifest = {
  generatedAt: new Date().toISOString(),
  purpose:
    'classroom-desk dual-path network compliance evidence (Pilot; not formal MLPS cert)',
  docs: [
    'docs/COMPLIANCE_MLPS.md',
    'docs/SECURITY.md',
    'docs/PERMISSIONS.md',
    'docs/NETWORK.md',
  ],
  paths: ['campus_shield_portal_zones', 'deskdns'],
  note: 'School live OPNsense/UniFi screenshots still required for GA narrative.',
};

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
if (report) {
  fs.writeFileSync(path.join(outDir, 'net-reconcile.json'), JSON.stringify(redact(report), null, 2));
}
if (auditMeta) {
  fs.writeFileSync(
    path.join(outDir, 'audit-sample.json'),
    JSON.stringify(redact(auditMeta), null, 2),
  );
}
for (const name of ['COMPLIANCE_MLPS.md', 'PERMISSIONS.md']) {
  const src = path.join(root, 'docs', name);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outDir, name));
}

fs.writeFileSync(
  path.join(outDir, 'README.md'),
  `# Compliance evidence pack

Generated: ${manifest.generatedAt}

- manifest.json
- net-reconcile.json (dual-path findings; failClosedOk)
- audit-sample.json (retention + last 50 rows, redacted)
- COMPLIANCE_MLPS.md / PERMISSIONS.md

Not a formal 等保 certificate. Attach school topology + live gateway screenshots separately.
`,
);

console.log(outDir);
if (!report) process.exitCode = 1;

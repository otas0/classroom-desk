#!/usr/bin/env node
/**
 * Gate checklist for a full Classroom Desk GitHub Release bundle.
 *
 *   npm run check:release-bundle
 *   npm run check:release-bundle -- --tag v0.1.11
 *   npm run check:release-bundle -- --local
 *   npm run check:release-bundle -- --json
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = String(pkg.version || '0.0.0');
const args = process.argv.slice(2);
const wantJson = args.includes('--json');
const localOnly = args.includes('--local');
const tagIdx = args.indexOf('--tag');
const tagArg = tagIdx >= 0 ? args[tagIdx + 1] : '';

function requiredPatterns(ver) {
  return [
    { id: 'student-x64', re: new RegExp(`^ClassroomDesk-Setup-${escapeRe(ver)}-x64\\.exe$`, 'i'), also: [/^ClassroomDesk-Setup-.*-x64\.exe$/i, /^Student-Setup\.exe$/i] },
    { id: 'student-arm64', re: new RegExp(`^ClassroomDesk-Setup-${escapeRe(ver)}-arm64\\.exe$`, 'i'), also: [/^ClassroomDesk-Setup-.*-arm64\.exe$/i] },
    { id: 'teacher-setup', re: new RegExp(`^ClassroomDesk-Teacher-Setup-${escapeRe(ver)}-x64\\.exe$`, 'i'), also: [/^ClassroomDesk-Teacher-Setup-x64\.exe$/i, /^Teacher-Setup\.exe$/i] },
    { id: 'teacher-bootstrap', re: new RegExp(`^ClassroomDesk-Teacher-Bootstrap-${escapeRe(ver)}-x64\\.exe$`, 'i'), also: [/^ClassroomDesk-Teacher-Bootstrap-x64\.exe$/i, /^Teacher-Bootstrap\.exe$/i] },
    { id: 'service-fix', re: new RegExp(`^ClassroomDesk-Service-Fix-${escapeRe(ver)}-x64\\.exe$`, 'i'), also: [/^ClassroomDesk-Service-Fix-x64\.exe$/i, /^Service-Fix\.exe$/i] },
    { id: 'product-zip', re: new RegExp(`^ClassroomDesk-${escapeRe(ver)}-win-x64\\.zip$`, 'i'), also: [/^ClassroomDesk-.*-win-x64\.zip$/i] },
    { id: 'config-example', re: /^config\.example\.json$/i, also: [] },
  ];
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function listLocalNames() {
  const names = new Set();
  const dirs = [
    path.join(root, 'Give-To-Teacher'),
    path.join(root, 'ClassroomDesk-Dist'),
    path.join(root, 'apps/student-desktop/release'),
    path.join(root, 'dist'),
    root,
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const n of fs.readdirSync(dir)) {
      if (n.startsWith('.')) continue;
      names.add(n);
      if (n.endsWith('.sha256')) names.add(n.replace(/\.sha256$/i, ''));
    }
  }
  // nested Dist files
  const dist = path.join(root, 'ClassroomDesk-Dist');
  if (fs.existsSync(dist)) {
    for (const n of fs.readdirSync(dist)) names.add(n);
  }
  return [...names];
}

function listReleaseAssets(tag) {
  const r = spawnSync(
    'gh',
    ['release', 'view', tag, '--repo', 'otas0/classroom-desk', '--json', 'assets,tagName', '--jq', '{tag:.tagName, names:[.assets[].name]}'],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) {
    throw new Error(`gh release view failed: ${r.stderr || r.stdout}`);
  }
  return JSON.parse(r.stdout);
}

function matchAsset(names, spec) {
  const hit = names.find((n) => spec.re.test(n) || spec.also.some((r) => r.test(n)));
  return hit || null;
}

function resolveTag() {
  if (tagArg) return tagArg.startsWith('v') ? tagArg : `v${tagArg}`;
  if (localOnly) return `v${version} (local)`;
  const r = spawnSync('gh', ['release', 'list', '--repo', 'otas0/classroom-desk', '--limit', '1', '--json', 'tagName'], {
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(r.stderr || 'gh release list failed');
  const arr = JSON.parse(r.stdout);
  return arr[0]?.tagName || `v${version}`;
}

const productGates = [
  {
    id: 'monorepo-work-desk',
    ok: fs.existsSync(path.join(root, 'products/work-desk/package.json')),
    detail: 'products/work-desk in repo',
  },
  {
    id: 'monorepo-brand-family',
    ok: fs.existsSync(path.join(root, 'products/brand-family/package.json')),
    detail: 'products/brand-family in repo',
  },
  {
    id: 'student-get-route',
    ok: fs.readFileSync(path.join(root, 'apps/server/src/routes/upgrades.ts'), 'utf8').includes("upgradesRouter.get('/get'"),
    detail: 'GET /get student download page',
  },
  {
    id: 'pack-script',
    ok: fs.existsSync(path.join(root, 'scripts/pack.mjs')),
    detail: 'npm run pack product Dist',
  },
  {
    id: 'pack-teacher-host',
    ok: fs.existsSync(path.join(root, 'scripts/pack-teacher-host.mjs')),
    detail: 'npm run pack:teacher-host (optional slim host)',
  },
  {
    id: 'ga-not-claimed',
    ok: true,
    detail: 'gaReady must stay false until school live evidence (docs/PILOT_SKU.md)',
    soft: true,
  },
];

const tag = resolveTag();
const verFromTag = String(tag).replace(/^v/i, '').replace(/\s.*/g, '') || version;
let names = [];
let source = 'local';
if (localOnly) {
  names = listLocalNames();
  source = 'local-files';
} else {
  const rel = listReleaseAssets(tag.startsWith('v') ? tag.split(/\s/)[0] : `v${verFromTag}`);
  names = rel.names || [];
  source = `github:${rel.tag}`;
}

const specs = requiredPatterns(verFromTag);
const assetRows = specs.map((spec) => {
  const found = matchAsset(names, spec);
  const sha = found && names.some((n) => n === `${found}.sha256` || n.toLowerCase() === `${found.toLowerCase()}.sha256`);
  return {
    id: spec.id,
    ok: Boolean(found),
    found: found || null,
    sha256: spec.id === 'config-example' ? null : Boolean(sha),
  };
});

const missing = assetRows.filter((r) => !r.ok);
const report = {
  version: verFromTag,
  tag: source,
  assets: assetRows,
  products: productGates,
  missingAssetIds: missing.map((m) => m.id),
  meetFullBundle: missing.length === 0,
  nextReleaseHint: missing.length
    ? `Next full bundle must still publish: ${missing.map((m) => m.id).join(', ')}`
    : 'Asset set complete for full Classroom Desk bundle',
};

if (wantJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Release bundle check · ${source} · package ${version}`);
  console.log('');
  console.log('Assets:');
  for (const row of assetRows) {
    const mark = row.ok ? 'PASS' : 'FAIL';
    const sha =
      row.sha256 == null ? '' : row.sha256 ? ' +sha' : ' (no .sha256)';
    console.log(`  [${mark}] ${row.id}${row.found ? ` → ${row.found}${sha}` : ''}`);
  }
  console.log('');
  console.log('Product / code gates:');
  for (const g of productGates) {
    console.log(`  [${g.ok ? 'PASS' : 'FAIL'}] ${g.id} — ${g.detail}`);
  }
  console.log('');
  if (report.meetFullBundle) {
    console.log('OK: full Classroom Desk asset set present.');
  } else {
    console.log(`NOT MEET: ${report.nextReleaseHint}`);
    console.log('See docs/RELEASE_BUNDLE.md');
  }
}

process.exit(report.meetFullBundle && productGates.every((g) => g.ok || g.soft) ? 0 : 1);

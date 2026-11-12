#!/usr/bin/env node
/**
 * Diff deploy/opnsense/walled-garden.template.json against a live export JSON.
 *
 * Live export sources (pick one):
 *   1) GET /api/v1/gateway/walled-garden-template  (canonical template via API)
 *   2) File dumped from OPNsense automation / manual mapping
 *
 *   node scripts/opnsense-walled-garden-diff.mjs
 *   node scripts/opnsense-walled-garden-diff.mjs --live path/to/live.json
 *   CD_API_BASE=http://127.0.0.1:8787 CD_STAFF_TOKEN=… node scripts/opnsense-walled-garden-diff.mjs --fetch
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templatePath = path.join(root, 'deploy/opnsense/walled-garden.template.json');
const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));

function normRules(doc) {
  const rules = Array.isArray(doc?.rules) ? doc.rules : [];
  return rules
    .map((r) => ({
      id: String(r.id ?? r.description ?? ''),
      action: String(r.action ?? ''),
      source: String(r.source ?? ''),
      destination: String(r.destination ?? ''),
      destinationPort: Array.isArray(r.destinationPort)
        ? [...r.destinationPort].map(String).sort().join(',')
        : String(r.destinationPort ?? ''),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function normAliases(doc) {
  const aliases = Array.isArray(doc?.aliases) ? doc.aliases : [];
  return aliases
    .map((a) => ({ name: String(a.name ?? ''), type: String(a.type ?? '') }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function diffLists(kind, expected, actual) {
  const expKeys = new Set(expected.map((x) => x.id || x.name));
  const actKeys = new Set(actual.map((x) => x.id || x.name));
  const missing = [...expKeys].filter((k) => !actKeys.has(k));
  const extra = [...actKeys].filter((k) => !expKeys.has(k));
  const changed = [];
  for (const e of expected) {
    const key = e.id || e.name;
    const a = actual.find((x) => (x.id || x.name) === key);
    if (!a) continue;
    const ej = JSON.stringify(e);
    const aj = JSON.stringify(a);
    if (ej !== aj) changed.push({ key, expected: e, actual: a });
  }
  return { kind, missing, extra, changed };
}

async function loadLive() {
  const args = process.argv.slice(2);
  const liveIdx = args.indexOf('--live');
  if (liveIdx >= 0 && args[liveIdx + 1]) {
    return JSON.parse(fs.readFileSync(path.resolve(args[liveIdx + 1]), 'utf8'));
  }
  if (args.includes('--fetch')) {
    const base = String(process.env.CD_API_BASE ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
    const token = String(process.env.CD_STAFF_TOKEN ?? '').trim();
    if (!token) throw new Error('CD_STAFF_TOKEN required for --fetch');
    const res = await fetch(`${base}/api/v1/gateway/walled-garden-template`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`fetch failed http_${res.status}`);
    const body = await res.json();
    return body.template ?? body;
  }
  // Self-diff (sanity): template vs itself → empty
  return template;
}

const live = await loadLive();
const aliasDiff = diffLists('aliases', normAliases(template), normAliases(live.template ?? live));
const ruleDiff = diffLists('rules', normRules(template), normRules(live.template ?? live));

const report = {
  template: path.relative(root, templatePath),
  aliasDiff,
  ruleDiff,
  ok: !aliasDiff.missing.length && !aliasDiff.extra.length && !aliasDiff.changed.length
    && !ruleDiff.missing.length && !ruleDiff.extra.length && !ruleDiff.changed.length,
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(2);

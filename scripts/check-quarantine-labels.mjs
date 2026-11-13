#!/usr/bin/env node
/**
 * When e2e/quarantine.txt has entries, require a sibling note that canary:* labels
 * must be applied on nightly Issues (CI already stamps canary:full).
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const qPath = path.join(root, 'e2e/quarantine.txt');
if (!fs.existsSync(qPath)) {
  console.log(JSON.stringify({ ok: true, entries: 0 }));
  process.exit(0);
}
const lines = fs
  .readFileSync(qPath, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));
const header = fs.readFileSync(qPath, 'utf8');
const mentionsCanary = /canary:/i.test(header);
if (lines.length > 0 && !mentionsCanary) {
  console.error(
    JSON.stringify({
      ok: false,
      detail: 'quarantine_entries_require_canary_comment',
      hint: 'Add a # comment mentioning canary:* + owner when quarantining specs.',
      entries: lines,
    }),
  );
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, entries: lines.length, canaryMentioned: mentionsCanary }));

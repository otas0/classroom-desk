#!/usr/bin/env node
/**
 * Count consecutive successful e2e-nightly runs, split cron vs workflow_dispatch.
 * After 2026-11-14: if cron streak ≥ --need, exit 0 (safe to delete flake row).
 *
 *   node scripts/check-nightly-flake.mjs
 *   node scripts/check-nightly-flake.mjs --need 7 --md
 *   node scripts/check-nightly-flake.mjs --after 2026-11-14
 */
import { execSync } from 'node:child_process';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1] && !String(process.argv[i + 1]).startsWith('--')) {
    return process.argv[i + 1];
  }
  return fallback;
}

const need = Math.max(1, Number(arg('--need', '7')) || 7);
const wantMd = process.argv.includes('--md');
const afterRaw = arg('--after', '2026-11-14');
const afterMs = Date.parse(`${afterRaw}T00:00:00Z`);

function ghJson(args) {
  const out = execSync(`gh ${args}`, { encoding: 'utf8' });
  return JSON.parse(out);
}

const runs = ghJson(
  `run list --workflow=e2e-nightly.yml --limit 40 --json databaseId,conclusion,event,createdAt,displayTitle,status,url`,
);

const completed = runs.filter((r) => r.status === 'completed');

function streak(predicate) {
  let n = 0;
  for (const r of completed) {
    if (!predicate(r)) continue;
    if (r.conclusion === 'success') n += 1;
    else break;
  }
  return n;
}

const cronStreak = streak((r) => r.event === 'schedule');
const dispatchStreak = streak((r) => r.event === 'workflow_dispatch');
const anyStreak = streak(() => true);

const recent = completed.slice(0, 14).map((r) => ({
  id: r.databaseId,
  event: r.event,
  conclusion: r.conclusion,
  at: r.createdAt,
  url: r.url,
}));

const today = new Date().toISOString().slice(0, 10);
const afterDatePassed = Number.isFinite(afterMs) ? Date.now() >= afterMs : true;
const canDelete = afterDatePassed && cronStreak >= need;

const mdTable = [
  `| 计数器 | 值 | 阈值 |`,
  `|---|---:|---:|`,
  `| cron (\`schedule\`) 连续绿 | ${cronStreak} | ${need} |`,
  `| workflow_dispatch 连续绿（勿凑数） | ${dispatchStreak} | ${need} |`,
  `| 混跑 anyStreak（参考） | ${anyStreak} | — |`,
  `| 观察日起点 | ${afterRaw} | 今日 ${today} ${afterDatePassed ? '已过' : '未到'} |`,
  `| 删 flake 行 | ${canDelete ? '**可以**' : '否'} | cron≥${need} 且 ≥${afterRaw} |`,
  ``,
  `| run | event | conclusion | at |`,
  `|---|---|---|---|`,
  ...recent.map(
    (r) =>
      `| [${r.id}](${r.url}) | \`${r.event}\` | ${r.conclusion} | ${String(r.at).slice(0, 19)} |`,
  ),
].join('\n');

if (wantMd) {
  console.log('<!-- paste into docs/E2E_FLAKE_BOARD.md -->');
  console.log(mdTable);
} else {
  console.log(JSON.stringify({ need, afterRaw, cronStreak, dispatchStreak, anyStreak, canDelete, recent }, null, 2));
  console.log('\n--- Markdown（可 --md 只输出）---\n');
  console.log(mdTable);
}

console.log('\n--- 结论 ---');
if (canDelete) {
  console.log(`OK: ≥${afterRaw} 且 cron≥${need} → 可删 docs/E2E_FLAKE_BOARD.md 的 audit-jump 行并 commit。`);
  process.exit(0);
}
if (!afterDatePassed) {
  console.log(`KEEP: 未到观察日 ${afterRaw}（今日 ${today}）。勿删 flake 行。`);
} else {
  console.log(`KEEP: 已过 ${afterRaw} 但 cron 仅 ${cronStreak}/${need}。勿删 flake 行。`);
}
process.exit(2);

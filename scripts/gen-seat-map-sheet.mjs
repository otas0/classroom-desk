#!/usr/bin/env node
/**
 * Generate a printable seat_map.id对照表 (empty + seated) with offline-friendly QR SVGs.
 *
 * Usage:
 *   CD_API_BASE=http://127.0.0.1:8787 CD_TOKEN=<teacherJWT> CD_CLASS_ID=<id> \
 *     node scripts/gen-seat-map-sheet.mjs [out.html]
 *
 * Or: node scripts/gen-seat-map-sheet.mjs --api URL --token JWT --class ID [--out path] [--filter all|empty|seated]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
/** Prefer workspace-hoisted `qrcode` (offline SVG); no network at print time. */
const QRCode = require('qrcode');

function arg(name, env) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env[env] ?? '';
}

const API = String(arg('--api', 'CD_API_BASE') || 'http://127.0.0.1:8787').replace(/\/$/, '');
const TOKEN = arg('--token', 'CD_TOKEN');
const CLASS_ID = arg('--class', 'CD_CLASS_ID');
/** Filter: all | empty | seated — also CD_SEAT_FILTER / --filter */
const FILTER_RAW = String(arg('--filter', 'CD_SEAT_FILTER') || 'all').toLowerCase();
const FILTER =
  FILTER_RAW === 'empty' || FILTER_RAW === '空座'
    ? 'empty'
    : FILTER_RAW === 'seated' || FILTER_RAW === '已排'
      ? 'seated'
      : 'all';
const OUT =
  arg('--out', 'CD_SEAT_SHEET_OUT') ||
  process.argv.find((a) => a.endsWith('.html')) ||
  'SEAT-MAP-ID-SHEET.html';

if (!TOKEN || !CLASS_ID) {
  console.error('Need CD_TOKEN + CD_CLASS_ID (or --token / --class). Skip sheet generation.');
  process.exit(2);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Inline SVG QR — printable offline (no CDN / quickchart). */
async function qrSvg(text, size = 120) {
  const raw = await QRCode.toString(String(text), {
    type: 'svg',
    margin: 1,
    width: size,
    errorCorrectionLevel: 'M',
  });
  // Strip XML prolog if present; keep a single <svg>…</svg>
  const svg = String(raw).replace(/<\?xml[^>]*>\s*/i, '').trim();
  return `<div class="qr-wrap" aria-label="QR ${escapeHtml(text)}">${svg}</div>`;
}

const headers = { Authorization: `Bearer ${TOKEN}` };
const seatsRes = await fetch(`${API}/api/v1/classes/${encodeURIComponent(CLASS_ID)}/seats`, {
  headers,
});
if (!seatsRes.ok) {
  console.error('seats fetch failed', seatsRes.status, await seatsRes.text());
  process.exit(1);
}
const seatsBody = await seatsRes.json();
/** Always embed all seats so on-page 仅空座/仅已排 toggles work; --filter only sets initial mode. */
const allItems = Array.isArray(seatsBody.items) ? seatsBody.items : [];
const items = allItems;
let className = CLASS_ID;
try {
  const classesRes = await fetch(`${API}/api/v1/classes`, { headers });
  if (classesRes.ok) {
    const classesBody = await classesRes.json();
    const hit = (classesBody.items ?? []).find((c) => c.id === CLASS_ID);
    if (hit?.name) className = String(hit.name);
  }
} catch {
  /* keep CLASS_ID */
}

const rowHtml = await Promise.all(
  items.map(async (s) => {
    const id = String(s.id ?? '');
    const label = String(s.label ?? '');
    const who = s.displayName
      ? `${s.displayName}${s.studentNo ? ` (${s.studentNo})` : ''}`
      : '空座';
    const status = s.studentId ? '已排' : '空座';
    const qr = id ? await qrSvg(id) : '';
    return `<tr data-status="${escapeHtml(status)}">
  <td>${escapeHtml(label)}</td>
  <td>${escapeHtml(status)}</td>
  <td>${escapeHtml(who)}</td>
  <td><code class="seat-id">${escapeHtml(id)}</code></td>
  <td class="qr">${qr}</td>
</tr>`;
  }),
);
const rows = rowHtml.join('\n');
const visibleCount =
  FILTER === 'empty'
    ? allItems.filter((s) => !s.studentId).length
    : FILTER === 'seated'
      ? allItems.filter((s) => Boolean(s.studentId)).length
      : allItems.length;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>座位 seat_map.id 对照表 · ${escapeHtml(className)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 1.5rem; color: #111; }
  h1 { font-size: 1.25rem; }
  .hint { color: #444; font-size: 0.9rem; }
  .filters { margin: 0.75rem 0; display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .filters button { padding: 0.35rem 0.75rem; cursor: pointer; }
  .filters button.active { font-weight: 700; outline: 2px solid #333; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  th, td { border: 1px solid #ccc; padding: 0.5rem; vertical-align: middle; text-align: left; }
  th { background: #f4f4f4; }
  code.seat-id { font-size: 0.85rem; word-break: break-all; }
  .qr-wrap svg { display: block; width: 120px; height: 120px; }
  table.hide-empty tr[data-status="空座"] { display: none; }
  table.hide-seated tr[data-status="已排"] { display: none; }
  @media print {
    body { margin: 0.5rem; }
    a, .filters { display: none; }
    #seat-filter-live { display: none !important; }
  }
</style>
</head>
<body>
<h1>座位 seat_map.id 对照表</h1>
<p class="hint">班级：${escapeHtml(className)}（${escapeHtml(CLASS_ID)}）· 主键为 seat_map.id（非学号）· 空座/已排均可扫码对账</p>
<p class="hint">生成于 ${new Date().toISOString()} · 初始筛选「${FILTER === 'all' ? '全部' : FILTER === 'empty' ? '仅空座' : '仅已排'}」· 可见约 ${visibleCount} / ${allItems.length} 座 · QR 为内嵌 SVG，离线打印可用（打印前可再点筛选）</p>
<p class="hint" id="seat-filter-hint">
  筛选说明：点下方按钮只显示对应行，再打印；打印时按钮会隐藏。键盘：Tab 聚焦后 Enter/Space 切换。
</p>
<p class="hint" id="seat-filter-live" role="status" aria-live="polite" aria-atomic="true"></p>
<div class="filters" role="group" aria-labelledby="seat-filter-hint" aria-label="座位对照表打印筛选：全部、仅空座、仅已排">
  <button type="button" class="${FILTER === 'all' ? 'active' : ''}" data-filter="all" aria-pressed="${FILTER === 'all' ? 'true' : 'false'}" title="显示全部座位后打印">全部</button>
  <button type="button" class="${FILTER === 'empty' ? 'active' : ''}" data-filter="empty" aria-pressed="${FILTER === 'empty' ? 'true' : 'false'}" title="只显示空座后打印">仅空座</button>
  <button type="button" class="${FILTER === 'seated' ? 'active' : ''}" data-filter="seated" aria-pressed="${FILTER === 'seated' ? 'true' : 'false'}" title="只显示已排座后打印">仅已排</button>
</div>
<table id="seat-sheet">
  <thead><tr><th>座位 label</th><th>状态</th><th>学生</th><th>seat_map.id</th><th>扫码</th></tr></thead>
  <tbody>
${rows || '<tr><td colspan="5">本班尚无座位网格（或当前筛选无结果）</td></tr>'}
  </tbody>
</table>
<script>
(function () {
  var table = document.getElementById('seat-sheet');
  var buttons = document.querySelectorAll('.filters button');
  var live = document.getElementById('seat-filter-live');
  var labels = { all: '全部座位', empty: '仅空座', seated: '仅已排' };
  function apply(mode) {
    table.classList.remove('hide-empty', 'hide-seated');
    if (mode === 'empty') table.classList.add('hide-seated');
    if (mode === 'seated') table.classList.add('hide-empty');
    buttons.forEach(function (b) {
      var on = b.getAttribute('data-filter') === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (live) {
      live.textContent = '当前筛选：' + (labels[mode] || mode) + '（可打印）';
    }
  }
  buttons.forEach(function (b) {
    b.addEventListener('click', function () {
      apply(b.getAttribute('data-filter') || 'all');
    });
  });
  apply(${JSON.stringify(FILTER)});
})();
</script>
</body>
</html>
`;

const outPath = path.resolve(OUT);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html, 'utf8');
console.log(`Wrote ${outPath} (${allItems.length} seats, initialFilter=${FILTER})`);

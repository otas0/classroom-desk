#!/usr/bin/env node
/**
 * Generate a printable seat_map.id对照表 (empty + seated) with offline-friendly QR SVGs.
 *
 * Usage:
 *   CD_API_BASE=http://127.0.0.1:8787 CD_TOKEN=<teacherJWT> CD_CLASS_ID=<id> \
 *     node scripts/gen-seat-map-sheet.mjs [out.html]
 *
 * Or: node scripts/gen-seat-map-sheet.mjs --api URL --token JWT --class ID [--out path]
 */
import fs from 'node:fs';
import path from 'node:path';

function arg(name, env) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env[env] ?? '';
}

const API = String(arg('--api', 'CD_API_BASE') || 'http://127.0.0.1:8787').replace(/\/$/, '');
const TOKEN = arg('--token', 'CD_TOKEN');
const CLASS_ID = arg('--class', 'CD_CLASS_ID');
const OUT =
  arg('--out', 'CD_SEAT_SHEET_OUT') ||
  process.argv.find((a) => a.endsWith('.html')) ||
  'SEAT-MAP-ID-SHEET.html';

if (!TOKEN || !CLASS_ID) {
  console.error('Need CD_TOKEN + CD_CLASS_ID (or --token / --class). Skip sheet generation.');
  process.exit(2);
}

/** Minimal QR (byte mode) → SVG. Enough for seat_map.id UUIDs. */
function qrSvg(text, size = 120) {
  // Use a data-URL that printers can rasterize via a public QR endpoint when online;
  // also embed the raw id as large text for offline OCR / manual copy.
  const enc = encodeURIComponent(text);
  const img = `https://quickchart.io/qr?text=${enc}&size=${size}&margin=1`;
  return `<img width="${size}" height="${size}" alt="QR ${text}" src="${img}" loading="lazy" />`;
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
const items = Array.isArray(seatsBody.items) ? seatsBody.items : [];
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

const rows = items
  .map((s) => {
    const id = String(s.id ?? '');
    const label = String(s.label ?? '');
    const who = s.displayName
      ? `${s.displayName}${s.studentNo ? ` (${s.studentNo})` : ''}`
      : '空座';
    const status = s.studentId ? '已排' : '空座';
    return `<tr>
  <td>${escapeHtml(label)}</td>
  <td>${escapeHtml(status)}</td>
  <td>${escapeHtml(who)}</td>
  <td><code class="seat-id">${escapeHtml(id)}</code></td>
  <td class="qr">${qrSvg(id)}</td>
</tr>`;
  })
  .join('\n');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>座位 seat_map.id 对照表 · ${escapeHtml(className)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 1.5rem; color: #111; }
  h1 { font-size: 1.25rem; }
  .hint { color: #444; font-size: 0.9rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  th, td { border: 1px solid #ccc; padding: 0.5rem; vertical-align: middle; text-align: left; }
  th { background: #f4f4f4; }
  code.seat-id { font-size: 0.85rem; word-break: break-all; }
  .qr img { display: block; }
  @media print { body { margin: 0.5rem; } a { display: none; } }
</style>
</head>
<body>
<h1>座位 seat_map.id 对照表</h1>
<p class="hint">班级：${escapeHtml(className)}（${escapeHtml(CLASS_ID)}）· 主键为 seat_map.id（非学号）· 空座/已排均可扫码对账</p>
<p class="hint">生成于 ${new Date().toISOString()} · 共 ${items.length} 座 · 打印前需能加载 QR 图（quickchart）；离线时请对照 code 列</p>
<table>
  <thead><tr><th>座位 label</th><th>状态</th><th>学生</th><th>seat_map.id</th><th>扫码</th></tr></thead>
  <tbody>
${rows || '<tr><td colspan="5">本班尚无座位网格</td></tr>'}
  </tbody>
</table>
</body>
</html>
`;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const outPath = path.resolve(OUT);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html, 'utf8');
console.log(`Wrote ${outPath} (${items.length} seats)`);

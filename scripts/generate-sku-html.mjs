#!/usr/bin/env node
/**
 * Generate docs/SKU_CAPABILITIES.html from docs/SKU_CAPABILITIES.md (single source).
 *   npm run generate:sku-html
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mdPath = path.join(root, 'docs/SKU_CAPABILITIES.md');
const outPath = path.join(root, 'docs/SKU_CAPABILITIES.html');

const md = fs.readFileSync(mdPath, 'utf8');

function parseTable(src) {
  const lines = src.split(/\r?\n/);
  const start = lines.findIndex((l) => l.includes('| 能力旗标') || l.includes('|`productCapabilities`') || /^\|\s*能力旗标/.test(l));
  if (start < 0) return [];
  const rows = [];
  for (let i = start + 2; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.startsWith('|')) break;
    const cols = line.split('|').map((c) => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
    if (cols.length >= 3) rows.push(cols);
  }
  return rows;
}

function parsePacks(src) {
  const m = src.match(/## 打包建议\n+([\s\S]*?)(?:\n## |\n*$)/);
  if (!m) return [];
  return m[1]
    .split('\n')
    .map((l) => l.replace(/^\d+\.\s*/, '').trim())
    .filter((l) => l && !l.startsWith('#'));
}

const rows = parseTable(md);
const packs = parsePacks(md);

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

const tableRows = rows
  .map(
    ([a, b, c]) =>
      `<tr><td>${esc(a)}</td><td>${esc(b)}</td><td>${esc(c)}</td></tr>`,
  )
  .join('\n        ');

const packLis = packs.map((p) => `<li>${esc(p)}</li>`).join('\n        ');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Classroom Desk · 能力旗标 ↔ SKU</title>
  <meta name="generator" content="scripts/generate-sku-html.mjs" />
  <style>
    :root { color-scheme: light; font-family: "PingFang SC", "Noto Sans SC", "Segoe UI", sans-serif; }
    body { margin: 0; padding: 2rem; background: linear-gradient(160deg, #eef4f7, #f7f3ea); color: #1a1a1a; }
    main { max-width: 52rem; margin: 0 auto; background: #fff; padding: 2rem; border: 1px solid #d7d0c4; border-radius: 12px; }
    h1 { margin: 0 0 .4rem; font-size: 1.75rem; }
    .sub { color: #555; margin: 0 0 1.25rem; }
    table { width: 100%; border-collapse: collapse; font-size: .95rem; }
    th, td { border-bottom: 1px solid #e5e0d6; padding: .55rem .4rem; text-align: left; vertical-align: top; }
    th { font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; color: #666; }
    code { background: #f4f1ea; padding: .1rem .3rem; border-radius: .25rem; font-size: .85em; }
    .packs { margin-top: 1.5rem; }
    .packs li { margin: .35rem 0; }
    .actions { margin-top: 1.5rem; display: flex; gap: .75rem; flex-wrap: wrap; }
    button, a.btn { font: inherit; padding: .55rem 1rem; border: 0; border-radius: 8px; background: #0b4f6c; color: #fff; cursor: pointer; text-decoration: none; }
    @media print {
      body { background: #fff; padding: 0; }
      .actions { display: none; }
      main { border: 0; box-shadow: none; }
    }
  </style>
</head>
<body>
  <main>
    <h1>Classroom Desk · 能力旗标 ↔ SKU</h1>
    <p class="sub">销售一页纸 · 打印或「另存为 PDF」。由 Markdown 自动生成，勿手改本文件。</p>
    <table>
      <thead>
        <tr><th>能力旗标</th><th>SKU / 交付物</th><th>学校前置</th></tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
    <div class="packs">
      <strong>打包建议</strong>
      <ol>
        ${packLis}
      </ol>
    </div>
    <div class="actions">
      <button type="button" onclick="window.print()">打印 / 另存 PDF</button>
      <a class="btn" href="./SKU_CAPABILITIES.md">打开 Markdown</a>
    </div>
  </main>
</body>
</html>
`;

if (!rows.length) {
  console.error('FAIL: could not parse capability table from SKU_CAPABILITIES.md');
  process.exit(1);
}

fs.writeFileSync(outPath, html);
console.log(`OK: wrote ${path.relative(root, outPath)} (${rows.length} rows)`);

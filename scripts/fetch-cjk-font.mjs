#!/usr/bin/env node
/**
 * Download Noto Sans SC (OFL) into apps/server/assets/fonts for offline PDF.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destDir = path.join(root, 'apps/server/assets/fonts');
const dest = path.join(destDir, 'NotoSansSC-VF.ttf');

const URLS = [
  'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf',
  'https://github.com/googlefonts/noto-cjk/raw/main/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf',
];

if (fs.existsSync(dest) && fs.statSync(dest).size > 50_000) {
  console.log(`[fetch-cjk-font] already present ${dest} (${fs.statSync(dest).size} bytes)`);
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
let lastErr = '';
for (const url of URLS) {
  try {
    console.log(`[fetch-cjk-font] GET ${url}`);
    const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 50_000) throw new Error(`too small ${buf.length}`);
    fs.writeFileSync(dest, buf);
    console.log(`[fetch-cjk-font] wrote ${dest} (${buf.length} bytes)`);
    process.exit(0);
  } catch (e) {
    lastErr = e instanceof Error ? e.message : String(e);
    console.warn(`[fetch-cjk-font] failed: ${lastErr}`);
  }
}
console.error(`[fetch-cjk-font] all mirrors failed: ${lastErr}`);
process.exit(1);

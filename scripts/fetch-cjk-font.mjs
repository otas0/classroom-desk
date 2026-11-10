#!/usr/bin/env node
/**
 * Download Noto Sans SC/JP/KR (OFL) subsets for offline PDF + Electron/teacher UI.
 *
 *   npm run fonts:cjk
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FILES = [
  {
    name: 'NotoSansSC-VF.ttf',
    urls: [
      'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf',
      'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf',
      'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf',
    ],
  },
  {
    name: 'NotoSansJP-VF.ttf',
    urls: [
      'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/Variable/TTF/Subset/NotoSansJP-VF.ttf',
      'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/Variable/TTF/Subset/NotoSansJP-VF.ttf',
      'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/Variable/TTF/Subset/NotoSansJP-VF.ttf',
      // gstatic static TTF (proxy-friendly fallback; filename kept for @font-face)
      'https://fonts.gstatic.com/s/notosansjp/v57/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFBEj75s.ttf',
    ],
  },
  {
    name: 'NotoSansKR-VF.ttf',
    urls: [
      'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/Variable/TTF/Subset/NotoSansKR-VF.ttf',
      'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/Variable/TTF/Subset/NotoSansKR-VF.ttf',
      'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/Variable/TTF/Subset/NotoSansKR-VF.ttf',
      'https://fonts.gstatic.com/s/notosanskr/v40/PbyxFmXiEBPT4ITbgNA5Cgms3VYcOA-vvnIzzuoyeLQ.ttf',
    ],
  },
];

const DEST_DIRS = [
  path.join(root, 'apps/server/assets/fonts'),
  path.join(root, 'apps/teacher-web/public/fonts'),
  path.join(root, 'apps/student-desktop/public/fonts'),
];

async function fetchOne(file, destPath) {
  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 50_000) {
    console.log(`[fonts:cjk] keep ${destPath} (${fs.statSync(destPath).size} bytes)`);
    return true;
  }
  let lastErr = '';
  for (const url of file.urls) {
    try {
      console.log(`[fonts:cjk] GET ${url}`);
      const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 50_000) throw new Error(`too small ${buf.length}`);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, buf);
      console.log(`[fonts:cjk] wrote ${destPath} (${buf.length} bytes)`);
      return true;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      console.warn(`[fonts:cjk] failed: ${lastErr}`);
    }
  }
  console.error(`[fonts:cjk] ${file.name}: ${lastErr}`);
  return false;
}

let ok = true;
for (const file of FILES) {
  const primary = path.join(DEST_DIRS[0], file.name);
  const got = await fetchOne(file, primary);
  if (!got) {
    ok = false;
    continue;
  }
  for (const dir of DEST_DIRS.slice(1)) {
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, file.name);
    if (dest !== primary) {
      fs.copyFileSync(primary, dest);
      console.log(`[fonts:cjk] copy → ${dest}`);
    }
  }
}

process.exit(ok ? 0 : 1);

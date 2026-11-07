import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, rgb } from 'pdf-lib';
import { getDataDir } from '../db/client.js';
import { buildSimpleTablePdf } from './simplePdf.js';

const FONT_URLS = [
  'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf',
];

const BUNDLE_CANDIDATES = [
  'NotoSansSC-VF.ttf',
  'NotoSansSC-Regular.otf',
  'NotoSansSC-Regular.ttf',
];

function bundledFontPath(): string | null {
  const assetsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../assets/fonts');
  for (const name of BUNDLE_CANDIDATES) {
    const p = path.join(assetsDir, name);
    try {
      if (fs.existsSync(p) && fs.statSync(p).size > 10_000) return p;
    } catch {
      /* next */
    }
  }
  return null;
}

function cacheFontPath(): string {
  const env = process.env.CLASSROOM_DESK_CJK_FONT?.trim();
  if (env) return path.resolve(env);
  return path.join(getDataDir(), 'fonts', 'NotoSansSC-VF.ttf');
}

async function ensureCjkFont(): Promise<Buffer | null> {
  const bundled = bundledFontPath();
  if (bundled) {
    try {
      return fs.readFileSync(bundled);
    } catch {
      /* fall through */
    }
  }
  const dest = cacheFontPath();
  try {
    if (fs.existsSync(dest) && fs.statSync(dest).size > 10_000) {
      return fs.readFileSync(dest);
    }
  } catch {
    /* continue */
  }
  if (process.env.CLASSROOM_DESK_SKIP_CJK_FONT_FETCH === '1') return null;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  for (const url of FONT_URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 10_000) continue;
      fs.writeFileSync(dest, buf);
      // Also copy into bundle dir when writable (dev / first-run seed)
      try {
        const assetsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../assets/fonts');
        fs.mkdirSync(assetsDir, { recursive: true });
        const seed = path.join(assetsDir, 'NotoSansSC-VF.ttf');
        if (!fs.existsSync(seed)) fs.copyFileSync(dest, seed);
      } catch {
        /* ignore */
      }
      return buf;
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function buildParentReportPdf(opts: {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: string[][];
}): Promise<Buffer> {
  const fontBytes = await ensureCjkFont();
  if (!fontBytes) {
    return buildSimpleTablePdf(opts);
  }
  try {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(fontBytes, { subset: true });
    let page = doc.addPage([612, 792]);
    let y = 760;
    const draw = (text: string, size = 11) => {
      const line = String(text ?? '').slice(0, 120);
      if (y < 48) {
        page = doc.addPage([612, 792]);
        y = 760;
      }
      page.drawText(line || ' ', {
        x: 40,
        y,
        size,
        font,
        color: rgb(0.1, 0.12, 0.16),
      });
      y -= size + 6;
    };
    draw(opts.title, 14);
    if (opts.subtitle) draw(opts.subtitle, 10);
    y -= 4;
    draw(opts.headers.join('  ·  '), 10);
    draw('─'.repeat(40), 10);
    for (const row of opts.rows.slice(0, 200)) {
      draw(row.map((c) => String(c ?? '')).join('  ·  '), 10);
    }
    const pdf = await doc.save();
    return Buffer.from(pdf);
  } catch (e) {
    console.warn('[pdf] CJK embed failed, ASCII fallback:', e instanceof Error ? e.message : e);
    return buildSimpleTablePdf(opts);
  }
}

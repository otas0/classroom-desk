import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, rgb } from 'pdf-lib';
import { getDataDir } from '../db/client.js';
import { buildSimpleTablePdf } from './simplePdf.js';

const FONT_URLS = [
  // Open-source CJK (SIL OFL): Noto Sans SC via jsDelivr (googlefonts/noto-cjk)
  'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/OTF/SimplifiedChinese/NotoSansSC-Regular.otf',
];

function fontCachePath(): string {
  const env = process.env.CLASSROOM_DESK_CJK_FONT?.trim();
  if (env) return path.resolve(env);
  return path.join(getDataDir(), 'fonts', 'NotoSansSC-Regular.otf');
}

async function ensureCjkFont(): Promise<Buffer | null> {
  const dest = fontCachePath();
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
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 10_000) continue;
      fs.writeFileSync(dest, buf);
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

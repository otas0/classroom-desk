import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import * as XLSX from 'xlsx';
import type { Response } from 'express';
import { toCsv } from './csv.js';
import { newId } from './id.js';

export type ExportFormat = 'csv' | 'xlsx' | 'json' | 'tsv';

/** Prefer streaming when row count is large. */
const STREAM_THRESHOLD = 200;

export function parseFormat(raw: unknown): ExportFormat {
  const f = String(raw ?? 'csv').toLowerCase();
  if (f === 'xlsx' || f === 'json' || f === 'tsv' || f === 'csv') return f;
  return 'csv';
}

function escapeCsvCell(v: string | number | null | undefined): string {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

/** Stream CSV/TSV in chunks to avoid building one giant string. */
export function streamCsvExport(
  res: Response,
  opts: {
    format: 'csv' | 'tsv';
    filenameBase: string;
    headers: string[];
    rows: Array<Array<string | number | null | undefined>>;
  },
): void {
  const { format, filenameBase, headers, rows } = opts;
  const sep = format === 'tsv' ? '\t' : ',';
  const escape =
    format === 'tsv'
      ? (v: string | number | null | undefined) => String(v ?? '').replaceAll('\t', ' ')
      : escapeCsvCell;
  res.setHeader(
    'Content-Type',
    format === 'tsv'
      ? 'text/tab-separated-values; charset=utf-8'
      : 'text/csv; charset=utf-8',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.${format}"`);
  res.write('\uFEFF');
  res.write(headers.map(escape).join(sep) + '\n');
  const chunkSize = 100;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const slice = rows.slice(i, i + chunkSize);
    res.write(slice.map((r) => r.map(escape).join(sep)).join('\n') + '\n');
  }
  res.end();
}

/** Write xlsx to a temp file then stream to response (avoids holding full Buffer in heap for large sheets). */
export async function streamXlsxExport(
  res: Response,
  opts: {
    filenameBase: string;
    headers: string[];
    rows: Array<Array<string | number | null | undefined>>;
  },
): Promise<void> {
  const { filenameBase, headers, rows } = opts;
  const aoa = [headers, ...rows.map((r) => r.map((c) => (c == null ? '' : c)))];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'export');
  const tmp = path.join(os.tmpdir(), `cd-export-${newId()}.xlsx`);
  try {
    XLSX.writeFile(wb, tmp);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.xlsx"`);
    await pipeline(fs.createReadStream(tmp), res);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

export function sendTableExport(
  res: Response,
  opts: {
    format: ExportFormat;
    filenameBase: string;
    headers: string[];
    rows: Array<Array<string | number | null | undefined>>;
  },
): void {
  const { format, filenameBase, headers, rows } = opts;
  if (format === 'json') {
    const items = rows.map((row) =>
      Object.fromEntries(headers.map((h, i) => [h, row[i] ?? null])),
    );
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.json"`);
    res.send(JSON.stringify({ headers, items }, null, 2));
    return;
  }
  if ((format === 'csv' || format === 'tsv') && rows.length >= STREAM_THRESHOLD) {
    streamCsvExport(res, { format, filenameBase, headers, rows });
    return;
  }
  if (format === 'tsv') {
    streamCsvExport(res, { format: 'tsv', filenameBase, headers, rows });
    return;
  }
  if (format === 'xlsx') {
    void streamXlsxExport(res, { filenameBase, headers, rows }).catch((err) => {
      console.error('[export] xlsx stream failed', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'export_failed', message: '导出失败' });
      } else {
        res.end();
      }
    });
    return;
  }
  const csv = toCsv(headers, rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.csv"`);
  res.send('\uFEFF' + csv);
}

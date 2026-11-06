import * as XLSX from 'xlsx';
import type { Response } from 'express';
import { toCsv } from './csv.js';

export type ExportFormat = 'csv' | 'xlsx' | 'json' | 'tsv';

export function parseFormat(raw: unknown): ExportFormat {
  const f = String(raw ?? 'csv').toLowerCase();
  if (f === 'xlsx' || f === 'json' || f === 'tsv' || f === 'csv') return f;
  return 'csv';
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
  if (format === 'tsv') {
    const escape = (v: string | number | null | undefined) => String(v ?? '').replaceAll('\t', ' ');
    const body = [headers.map(escape).join('\t'), ...rows.map((r) => r.map(escape).join('\t'))].join('\n');
    res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.tsv"`);
    res.send('\uFEFF' + body);
    return;
  }
  if (format === 'xlsx') {
    const aoa = [headers, ...rows.map((r) => r.map((c) => (c == null ? '' : c)))];
    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'export');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.xlsx"`);
    res.send(buf);
    return;
  }
  const csv = toCsv(headers, rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.csv"`);
  res.send('\uFEFF' + csv);
}

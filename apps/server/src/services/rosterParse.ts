export type ImportRow = { name: string; studentNo: string | null; line: number };

const NAME_HEADER =
  /^(姓名|名字|学生姓名|学员姓名|学生|name|display_?name|student_?name)$/i;
const NO_HEADER =
  /^(学号|学籍号|考号|编号|学生学号|student_?no|studentno|student_?id|id|no|number)$/i;
const JUNK_HEADER = /^(序号|班级|性别|备注|说明|index|class|sex|备注信息|#)$/i;

function normalizeCell(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Excel often stores student numbers as numeric (e.g. 2026001 or 2.026001e6)
    if (Number.isInteger(raw) || Math.abs(raw - Math.round(raw)) < 1e-9) {
      return String(Math.round(raw));
    }
    const asInt = Math.round(raw);
    if (Math.abs(raw - asInt) < 1e-6 && String(asInt).length >= 4) return String(asInt);
    return String(raw).trim();
  }
  return String(raw)
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b\ufeff]/g, '')
    .trim();
}

function looksLikeName(s: string): boolean {
  if (!s || s.length > 40) return false;
  if (NAME_HEADER.test(s) || NO_HEADER.test(s) || JUNK_HEADER.test(s)) return false;
  // Chinese / Latin names; reject pure digits
  if (/^\d+$/.test(s)) return false;
  return /^[\u4e00-\u9fffA-Za-z·•\s._-]{1,40}$/.test(s);
}

function looksLikeStudentNo(s: string): boolean {
  if (!s || s.length > 32) return false;
  const cleaned = s.replace(/[.．]/g, '');
  // allow excel float leftovers already normalized
  return /^[A-Za-z0-9_-]{1,32}$/.test(cleaned) && /\d/.test(cleaned);
}

function splitLooseLine(line: string): string[] {
  const normalized = line
    .replace(/\u00a0/g, ' ')
    .replace(/，/g, ',')
    .replace(/；/g, ';')
    .replace(/、/g, ',')
    .replace(/\t+/g, '\t')
    .trim();
  if (!normalized) return [];

  if (normalized.includes('\t')) {
    return normalized.split('\t').map((p) => p.trim()).filter(Boolean);
  }
  if (normalized.includes(';')) {
    return normalized.split(';').map((p) => p.trim()).filter(Boolean);
  }
  if (normalized.includes(',')) {
    return normalized.split(',').map((p) => p.trim()).filter(Boolean);
  }
  // "张三 2026001" / "2026001 张三" / multiple spaces
  const spaced = normalized.split(/\s+/).filter(Boolean);
  if (spaced.length >= 2) return spaced;
  return [normalized];
}

/** Pull name + studentNo from an unordered pair of cells. */
export function detectNameAndNo(cells: string[]): { name: string; studentNo: string | null } | null {
  const parts = cells.map(normalizeCell).filter(Boolean);
  if (parts.length === 0) return null;

  if (parts.length === 1) {
    const only = parts[0]!;
    // "张三2026001" glued
    const glued = only.match(/^([\u4e00-\u9fffA-Za-z·•]{1,20})([A-Za-z0-9_-]{4,32})$/);
    if (glued && looksLikeName(glued[1]!) && looksLikeStudentNo(glued[2]!)) {
      return { name: glued[1]!, studentNo: glued[2]! };
    }
    if (looksLikeName(only)) return { name: only, studentNo: null };
    return null;
  }

  // Prefer explicit name-looking + no-looking
  let name: string | null = null;
  let studentNo: string | null = null;
  for (const p of parts) {
    if (!name && looksLikeName(p) && !looksLikeStudentNo(p)) name = p;
    else if (!studentNo && looksLikeStudentNo(p)) studentNo = p;
  }
  if (name) return { name, studentNo };

  // Fallback: first non-numeric-ish as name, first numeric-ish as no
  const nameCand = parts.find((p) => looksLikeName(p));
  const noCand = parts.find((p) => looksLikeStudentNo(p));
  if (nameCand) return { name: nameCand, studentNo: noCand ?? null };

  // last resort: col0 name, col1 no (even if weak)
  if (parts[0] && looksLikeName(parts[0])) {
    return {
      name: parts[0],
      studentNo: parts[1] && looksLikeStudentNo(parts[1]) ? parts[1] : parts[1] || null,
    };
  }
  return null;
}

function isHeaderRow(cells: string[]): boolean {
  const joined = cells.map((c) => c.trim()).filter(Boolean);
  if (joined.length === 0) return false;
  return joined.some((c) => NAME_HEADER.test(c) || NO_HEADER.test(c));
}

export function parseDelimitedTextToRows(text: string): ImportRow[] {
  const rows: ImportRow[] = [];
  const rawLines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i]?.trim() ?? '';
    if (!line) continue;
    const parts = splitLooseLine(line);
    if (isHeaderRow(parts)) continue;
    const detected = detectNameAndNo(parts);
    if (!detected) continue;
    rows.push({
      name: detected.name,
      studentNo: detected.studentNo,
      line: i + 1,
    });
  }
  return rows;
}

type SheetLike = {
  SheetNames: string[];
  Sheets: Record<string, unknown>;
};

export function parseSheetMatrixToRows(
  matrix: unknown[][],
): ImportRow[] {
  if (!matrix.length) return [];
  const rows: ImportRow[] = [];

  // Find header row within first 5 rows
  let headerIdx = -1;
  let nameCol = -1;
  let noCol = -1;
  for (let r = 0; r < Math.min(5, matrix.length); r += 1) {
    const row = (matrix[r] ?? []).map(normalizeCell);
    const nIdx = row.findIndex((c) => NAME_HEADER.test(c));
    const sIdx = row.findIndex((c) => NO_HEADER.test(c));
    if (nIdx >= 0 || sIdx >= 0) {
      headerIdx = r;
      nameCol = nIdx;
      noCol = sIdx;
      break;
    }
  }

  if (headerIdx >= 0) {
    for (let r = headerIdx + 1; r < matrix.length; r += 1) {
      const row = (matrix[r] ?? []).map(normalizeCell);
      const fromCols: string[] = [];
      if (nameCol >= 0 && row[nameCol]) fromCols.push(row[nameCol]!);
      if (noCol >= 0 && row[noCol]) fromCols.push(row[noCol]!);
      // also scan other cells if missing
      if (fromCols.length < 2) {
        for (let c = 0; c < row.length; c += 1) {
          if (c === nameCol || c === noCol) continue;
          if (row[c]) fromCols.push(row[c]!);
        }
      }
      const detected = detectNameAndNo(fromCols.length ? fromCols : row);
      if (!detected) continue;
      rows.push({ name: detected.name, studentNo: detected.studentNo, line: r + 1 });
    }
    return rows;
  }

  // No header: score first two columns — which looks more like student numbers?
  const sample = matrix.slice(0, 20);
  let col0No = 0;
  let col1No = 0;
  let col0Name = 0;
  let col1Name = 0;
  for (const raw of sample) {
    const row = (raw ?? []).map(normalizeCell);
    if (looksLikeStudentNo(row[0] ?? '')) col0No += 1;
    if (looksLikeStudentNo(row[1] ?? '')) col1No += 1;
    if (looksLikeName(row[0] ?? '')) col0Name += 1;
    if (looksLikeName(row[1] ?? '')) col1Name += 1;
  }
  const preferNoFirst = col0No > col1No && col0No >= col0Name;

  for (let r = 0; r < matrix.length; r += 1) {
    const row = (matrix[r] ?? []).map(normalizeCell).filter(Boolean);
    if (!row.length) continue;
    if (isHeaderRow(row)) continue;
    let ordered = row;
    if (preferNoFirst && row.length >= 2) {
      ordered = [row[1]!, row[0]!, ...row.slice(2)];
    }
    const detected = detectNameAndNo(ordered);
    if (!detected) continue;
    rows.push({ name: detected.name, studentNo: detected.studentNo, line: r + 1 });
  }
  return rows;
}

/** Used by unit tests / callers that already have xlsx sheet_to_json aoa. */
export function parseCsvToRows(csvText: string): ImportRow[] {
  return parseDelimitedTextToRows(csvText);
}

export function isHeaderName(name: string): boolean {
  return NAME_HEADER.test(name.trim());
}

// re-export for sheet readers that pass SheetLike via xlsx
export type { SheetLike };

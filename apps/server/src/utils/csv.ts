export function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const escape = (value: string | number | null | undefined) => {
    const raw = value == null ? '' : String(value);
    if (/[",\n\r]/.test(raw)) {
      return `"${raw.replaceAll('"', '""')}"`;
    }
    return raw;
  };
  return [headers.map(escape).join(','), ...rows.map((row) => row.map(escape).join(','))].join('\n');
}

export function monthRange(month: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error('invalid_month');
  }
  const start = `${month}-01T00:00:00.000Z`;
  const [y, m] = month.split('-').map(Number);
  const endDate = new Date(Date.UTC(y, m, 1));
  return { start, end: endDate.toISOString() };
}

/** Natural calendar month in the server's local timezone (for classroom attendance). */
export function localMonthRange(month: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error('invalid_month');
  }
  const [y, m] = month.split('-').map(Number);
  const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const end = new Date(y, m, 1, 0, 0, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Local calendar week (Mon 00:00 → next Mon). */
export function localWeekRange(anchor = new Date()): { start: string; end: string; label: string } {
  const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const day = d.getDay(); // 0 Sun
  const diffToMon = day === 0 ? -6 : 1 - day;
  const start = new Date(d);
  start.setDate(d.getDate() + diffToMon);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  const y = start.getFullYear();
  const m = String(start.getMonth() + 1).padStart(2, '0');
  const dd = String(start.getDate()).padStart(2, '0');
  return { start: start.toISOString(), end: end.toISOString(), label: `${y}-W${m}${dd}` };
}

/**
 * School semester approx (local):
 * - Aug–Jan → fall semester starting Aug 1
 * - Feb–Jul → spring semester starting Feb 1
 */
export function localSemesterRange(anchor = new Date()): {
  start: string;
  end: string;
  label: string;
} {
  const y = anchor.getFullYear();
  const m = anchor.getMonth(); // 0-based
  let start: Date;
  let end: Date;
  let label: string;
  if (m >= 7) {
    // Aug–Dec: fall of this year → next Feb 1
    start = new Date(y, 7, 1, 0, 0, 0, 0);
    end = new Date(y + 1, 1, 1, 0, 0, 0, 0);
    label = `${y}-fall`;
  } else if (m >= 1) {
    // Feb–Jul: spring
    start = new Date(y, 1, 1, 0, 0, 0, 0);
    end = new Date(y, 7, 1, 0, 0, 0, 0);
    label = `${y}-spring`;
  } else {
    // January → still previous fall
    start = new Date(y - 1, 7, 1, 0, 0, 0, 0);
    end = new Date(y, 1, 1, 0, 0, 0, 0);
    label = `${y - 1}-fall`;
  }
  return { start: start.toISOString(), end: end.toISOString(), label };
}

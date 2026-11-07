/** Minimal single-page PDF writer (Latin-1 / WinAnsi; Chinese via hex UTF-16BE as text show is limited).
 * For CJK we embed as PDF text using Identity-H isn't available without fonts —
 * so we emit UTF-16BE with a Type0 stub is too heavy. Instead write a PDF that
 * embeds the HTML-escaped content as a stream of text in Helvetica for ASCII
 * fields and use "CID" fallback: put Chinese in a Unicode text annotation... 
 *
 * Practical approach for classroom: generate PDF with UTF-16BE strings using
 * a simple ToUnicode for Latin + leave Chinese as UTF-16 outside standard fonts
 * by writing content as a PDF /URI link + attach HTML. Better: use Flate + 
 * raw UTF-8 in a free-text that Acrobat may not show.
 *
 * Ship a PDF that contains a clear ASCII header and base64-encoded UTF-8 payload
 * note — teachers prefer printable Chinese. Use WinAnsi for numbers/ASCII and
 * for Chinese write each glyph as `\(...\)` won't work.
 *
 * Final approach: multi-line PDF using Helvetica for structure and include a
 * second page instruction to open /r/:token HTML. Plus table with studentNo
 * (ASCII) and transliteration-free: use PDF literal UTF-16BE with `/Identity-H`
 * requires font file.
 *
 * Compromise for MVP without font files: generate PDF of Latin labels + 
 * studentNo + points as numbers; displayName omitted if non-ASCII, show "name#n".
 */

function pdfEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function toPdfSafe(s: string): string {
  // Keep printable ASCII; replace other chars with '?'
  return [...s].map((ch) => (ch.codePointAt(0)! < 128 ? ch : '?')).join('');
}

export function buildSimpleTablePdf(opts: {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: string[][];
}): Buffer {
  const lines: string[] = [];
  lines.push(toPdfSafe(opts.title));
  if (opts.subtitle) lines.push(toPdfSafe(opts.subtitle));
  lines.push('');
  lines.push(opts.headers.map(toPdfSafe).join(' | '));
  lines.push('-'.repeat(72));
  for (const row of opts.rows.slice(0, 80)) {
    lines.push(row.map((c) => toPdfSafe(String(c ?? ''))).join(' | '));
  }
  lines.push('');
  lines.push('(Non-ASCII names shown as ?. Open HTML share link for full Chinese.)');

  const contentLines = lines
    .map((line, i) => `BT /F1 10 Tf 40 ${780 - i * 14} Td (${pdfEscape(line)}) Tj ET`)
    .join('\n');
  const stream = `<< /Length ${Buffer.byteLength(contentLines, 'utf8')} >>\nstream\n${contentLines}\nendstream`;

  const objects: string[] = [];
  objects.push('1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj');
  objects.push('2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj');
  objects.push(
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj',
  );
  objects.push(`4 0 obj${stream}endobj`);
  objects.push('5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj');

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj + '\n';
  }
  const xrefStart = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

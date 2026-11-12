#!/usr/bin/env node
/**
 * Automates checklist steps against a live :8787 API.
 * Physical Windows / USB / imaging remain manual (printed at end).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, execSync } from 'node:child_process';
import * as XLSX from 'xlsx';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.API_BASE || 'http://127.0.0.1:8787';
const CLASS_ID = process.env.CLASS_ID || '00d6b800-6628-4d20-a49c-9765325d9eef';
const OUT = path.join(ROOT, 'releases', '192.168.31.179', 'ops-verify');
const NEW_TEACHER_PASSWORD = process.env.NEW_TEACHER_PASSWORD || 'Desk@179#2026';
const OLD_TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || 'Classroom2026!';
const DB = path.join(ROOT, 'apps/server/data/classroom.db');

fs.mkdirSync(OUT, { recursive: true });

async function json(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(
      `${opts.method || 'GET'} ${url} → ${res.status} ${typeof body === 'string' ? body : JSON.stringify(body)}`,
    );
  }
  return body;
}

function multipart(fields, files) {
  const boundary = '----ops' + Date.now();
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  for (const f of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.filename}"\r\nContent-Type: ${f.mime}\r\n\r\n`,
      ),
    );
    chunks.push(f.buffer);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

function minimalPdf() {
  return Buffer.from('%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
}

function minimalPng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
}

function buildDocx() {
  const tmp = path.join(OUT, '_docx_src');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmp, '_rels'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'word'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, '[Content_Types].xml'),
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  fs.writeFileSync(
    path.join(tmp, '_rels', '.rels'),
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  fs.writeFileSync(
    path.join(tmp, 'word', 'document.xml'),
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>附件压测</w:t></w:r></w:p></w:body></w:document>`,
  );
  const out = path.join(OUT, 'attach-sample.docx');
  execFileSync('zip', ['-qr', out, '.'], { cwd: tmp });
  return fs.readFileSync(out);
}

function buildZip() {
  const tmp = path.join(OUT, '_zip_src');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'readme.txt'), 'attachment zip smoke\n');
  const out = path.join(OUT, 'attach-sample.zip');
  execFileSync('zip', ['-qr', out, 'readme.txt'], { cwd: tmp });
  return fs.readFileSync(out);
}

async function main() {
  const summary = [];
  const health = await json(`${API}/health`);
  summary.push(`health ok=${health.ok} lanIps=${JSON.stringify(health.lanIps)}`);

  let login;
  try {
    login = await json(`${API}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'teacher', password: OLD_TEACHER_PASSWORD }),
    });
  } catch {
    login = await json(`${API}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'teacher', password: NEW_TEACHER_PASSWORD }),
    });
  }
  const tok = login.token;
  const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };

  execSync(
    `sqlite3 "${DB}" "UPDATE classes SET name='[归档-勿选] 8A' WHERE id='55f9a43d-ae45-4065-a2dc-1b23ebf8e2de'; UPDATE classes SET name='[归档-勿选] 8B' WHERE id='3da09615-1077-45c6-9074-1a0951770c22';"`,
  );
  summary.push('archived 8A/8B → [归档-勿选]');

  await json(`${API}/api/v1/settings`, {
    method: 'PATCH',
    headers: H,
    body: JSON.stringify({ messagesEnabled: false }),
  });
  const pub = await json(`${API}/api/v1/settings/public`);
  summary.push(`messagesEnabled=${pub.messagesEnabled}`);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['姓名', '学号'],
      ['张三', '2026001'],
      ['李四', '2026002'],
      ['王五', '2026003'],
    ]),
    'roster',
  );
  const xlsxPath = path.join(OUT, '正式班-花名册.xlsx');
  XLSX.writeFile(wb, xlsxPath);
  const mp = multipart({ replace: '1' }, [
    {
      field: 'file',
      filename: '正式班-花名册.xlsx',
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: fs.readFileSync(xlsxPath),
    },
  ]);
  const imp = await json(`${API}/api/v1/classes/${CLASS_ID}/students/import-file?replace=1`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': mp.contentType },
    body: mp.body,
  });
  summary.push(`replace import created=${imp.created} replaced=${imp.replaced} skipped=${imp.skipped}`);

  const roster = await json(`${API}/api/v1/classes/${CLASS_ID}/roster?client=lab-agent`);
  const students = roster.students || roster.items || [];
  const names = [];
  for (const s of students) {
    await json(`${API}/api/v1/auth/student-select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classId: CLASS_ID, studentId: s.id }),
    });
    names.push(s.displayName || s.name);
  }
  summary.push(`student-select x${names.length}: ${names.join(',')}`);

  if (students[0]) {
    const sel = await json(`${API}/api/v1/auth/student-select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classId: CLASS_ID, studentId: students[0].id }),
    });
    const msgRes = await fetch(`${API}/api/v1/messages?classId=${CLASS_ID}`, {
      headers: { Authorization: `Bearer ${sel.token}` },
    });
    summary.push(`student messages GET → ${msgRes.status} ${(await msgRes.text()).slice(0, 120)}`);
  }

  const files = [
    { field: 'files', filename: 'a.pdf', mime: 'application/pdf', buffer: minimalPdf() },
    {
      field: 'files',
      filename: 'b.docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: buildDocx(),
    },
    { field: 'files', filename: 'c.png', mime: 'image/png', buffer: minimalPng() },
    { field: 'files', filename: 'd.zip', mime: 'application/zip', buffer: buildZip() },
  ];
  const up = multipart({}, files);
  const batch = await json(`${API}/api/v1/uploads/batch`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': up.contentType },
    body: up.body,
  });
  summary.push(
    `uploads/batch items=${batch.items?.length} names=${(batch.items || []).map((i) => i.originalName).join(',')}`,
  );

  await json(`${API}/api/v1/questions`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      classId: CLASS_ID,
      title: '附件压测题',
      stem: '打开四个附件确认类型',
      type: 'single',
      options: ['A 可见', 'B'],
      answerKey: 'A 可见',
      points: 1,
      published: true,
      attachments: batch.items,
    }),
  });
  summary.push('question with 4 attachments published');

  const month = new Date().toISOString().slice(0, 7);
  for (const format of ['csv', 'xlsx', 'json', 'tsv']) {
    for (const kind of ['attendance', 'attendance-summary', 'points', 'questions']) {
      const url =
        kind === 'questions'
          ? `${API}/api/v1/exports/questions?classId=${CLASS_ID}&format=${format}`
          : kind === 'points'
            ? `${API}/api/v1/exports/points?month=${month}&format=${format}`
            : `${API}/api/v1/exports/${kind}?month=${month}&classId=${CLASS_ID}&format=${format}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(path.join(OUT, `${kind}-${month}.${format === 'xlsx' ? 'xlsx' : format}`), buf);
      if (!res.ok) throw new Error(`export ${kind} ${format} → ${res.status}`);
    }
  }
  summary.push(`exports written under ${OUT} (4 formats × 4 kinds)`);

  try {
    await json(`${API}/api/v1/auth/change-password`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ currentPassword: OLD_TEACHER_PASSWORD, newPassword: NEW_TEACHER_PASSWORD }),
    });
    summary.push(`teacher password changed → use ${NEW_TEACHER_PASSWORD}`);
  } catch (e) {
    summary.push(`password change skipped: ${e instanceof Error ? e.message : e}`);
  }

  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'releases/192.168.31.179/config.json'), 'utf8'));
  summary.push(`config.json apiBase=${cfg.apiBase} classId=${cfg.classId}`);

  const report = summary.join('\n');
  fs.writeFileSync(path.join(OUT, 'CHECKLIST-RESULT.txt'), `${report}\n`);
  console.log(report);
  console.log('\nMANUAL_LEFT:');
  console.log('- Windows: windows-set-fixed-ip.ps1 → windows-teacher-host.ps1 → windows-autostart-server.ps1');
  console.log('- USB: copy Actions windows-pack exe into releases/192.168.31.179/');
  console.log('- Sample PC: install + config.json; click roster; confirm no 留言 Tab');
  console.log('- Print: releases/192.168.31.179/PRINT_DESK_CARD.md');
  console.log('- After sample OK: imaging flash remaining PCs');
  console.log('- Month boundary: re-export attendance on month end/start');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

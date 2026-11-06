#!/usr/bin/env node
/**
 * Local 1+1 API verification (teacher + one student) against running server.
 * Usage: node scripts/local-1plus1-verify.mjs [API_BASE]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/$/, '');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'artifacts/exports-verify');
fs.mkdirSync(outDir, { recursive: true });

const log = [];
function ok(name, detail = '') {
  log.push({ ok: true, name, detail });
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, detail) {
  log.push({ ok: false, name, detail });
  console.error(`✗ ${name} — ${detail}`);
}

async function req(method, urlPath, { token, body, formData, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let bodyInit = undefined;
  if (formData) {
    bodyInit = formData;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    bodyInit = JSON.stringify(body);
  }
  const res = await fetch(`${API}${urlPath}`, { method, headers, body: bodyInit });
  if (raw) return res;
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text };
  }
  return { res, json, text };
}

function monthStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function main() {
  // 0. health
  {
    const { res, json } = await req('GET', '/health');
    if (!res.ok || !json?.ok) fail('health', JSON.stringify(json));
    else if (json.backup?.lastError) fail('health.lastError', JSON.stringify(json.backup.lastError));
    else ok('health', `lastError=null backup=${json.backup?.latestAt ?? 'none'}`);
  }

  // 1. teacher login
  const login = await req('POST', '/api/v1/auth/login', {
    body: { username: 'teacher', password: 'TeacherPass123' },
  });
  if (!login.res.ok) {
    // try admin
    const admin = await req('POST', '/api/v1/auth/login', {
      body: { username: 'admin', password: 'AdminPass123' },
    });
    if (!admin.res.ok) {
      fail('teacher.login', login.text || admin.text);
      throw new Error('login failed');
    }
    login.json = admin.json;
    login.res = admin.res;
  }
  const teacherToken = login.json.token;
  ok('teacher.login', login.json.user?.displayName ?? login.json.user?.username);

  // 2. class + roster
  let classes = await req('GET', '/api/v1/classes', { token: teacherToken });
  let classId = classes.json?.items?.[0]?.id;
  if (!classId) {
    const created = await req('POST', '/api/v1/classes', {
      token: teacherToken,
      body: { name: `联调班-${Date.now()}` },
    });
    classId = created.json?.id;
  }
  if (!classId) {
    fail('class', 'no classId');
    throw new Error('no class');
  }
  ok('class', classId);

  // ensure 1 primary student (1班+1生); second peer only for DM
  const csv = `姓名,学号\n联调甲,L001\n联调乙,L002\n`;
  const imp = await req('POST', `/api/v1/classes/${classId}/students/import`, {
    token: teacherToken,
    body: { csv },
  });
  ok(
    'roster.import.csv',
    `created=${imp.json?.created} skipped=${imp.json?.skipped} failures=${imp.json?.failures?.length ?? 0}`,
  );

  const students = await req('GET', `/api/v1/classes/${classId}/students`, { token: teacherToken });
  const items = students.json?.items ?? students.json ?? [];
  const studentRow = items.find((s) => s.studentNo === 'L001') ?? items[0];
  const peerRow = items.find((s) => s.studentNo === 'L002') ?? items.find((s) => s.id !== studentRow?.id);
  if (!studentRow?.id) {
    fail('roster.student', JSON.stringify(students.json));
    throw new Error('no student');
  }
  ok('roster.1plus1', `class=${classId} student=${studentRow.displayName}/${studentRow.studentNo}`);

  // 3. student select (点名)
  const sel = await req('POST', '/api/v1/auth/student-select', {
    body: { classId, studentId: studentRow.id },
  });
  if (!sel.res.ok) {
    fail('student.select', sel.text);
    throw new Error('student select failed');
  }
  const studentToken = sel.json.token;
  ok('student.select', sel.json.user?.displayName);

  // 3b. student tabs surface (API each tab needs)
  {
    const roster = await req('GET', `/api/v1/classes/${classId}/students`, { token: studentToken });
    if (!roster.res.ok) fail('tab.points.roster', roster.text);
    else ok('tab.points.roster', `n=${(roster.json?.items ?? roster.json ?? []).length}`);

    const pub = await req('GET', '/api/v1/settings/public');
    if (!pub.res.ok) fail('tab.settings.public', pub.text);
    else ok('tab.settings.public', `messagesEnabled=${pub.json?.messagesEnabled}`);

    const qlist = await req('GET', `/api/v1/questions?classId=${classId}`, { token: studentToken });
    if (!qlist.res.ok) fail('tab.quiz.list', qlist.text);
    else ok('tab.quiz.list', `n=${(qlist.json?.items ?? []).length}`);

    const unread = await req('GET', '/api/v1/messages/unread-count', { token: studentToken });
    if (!unread.res.ok) fail('tab.messages.unread', unread.text);
    else ok('tab.messages.unread', `count=${unread.json?.count ?? 0}`);
  }

  // 4. 点名加分：有理由 + 空理由（可选）
  const pr = await req('POST', '/api/v1/point-requests', {
    token: studentToken,
    body: { points: 2, reason: '1+1联调发言' },
  });
  if (!pr.res.ok) fail('points.request', pr.text);
  else {
    const pending = await req('GET', '/api/v1/point-requests/pending', { token: teacherToken });
    const item = (pending.json?.items ?? []).find((x) => x.id === pr.json.id) ?? pending.json?.items?.[0];
    if (!item) fail('points.pending', JSON.stringify(pending.json));
    else {
      const conf = await req('POST', `/api/v1/point-requests/${item.id}/confirm`, {
        token: teacherToken,
        body: {},
      });
      if (!conf.res.ok) fail('points.confirm', conf.text);
      else ok('points.confirm', `+${item.points ?? 2} reason=${item.reason || '（有理由）'}`);
    }
  }

  const prEmpty = await req('POST', '/api/v1/point-requests', {
    token: studentToken,
    body: { points: 1, reason: '' },
  });
  if (!prEmpty.res.ok) fail('points.request.emptyReason', prEmpty.text);
  else {
    const pending = await req('GET', '/api/v1/point-requests/pending', { token: teacherToken });
    const item =
      (pending.json?.items ?? []).find((x) => x.id === prEmpty.json.id) ??
      (pending.json?.items ?? []).find((x) => !x.reason || String(x.reason).trim() === '');
    if (!item) fail('points.pending.emptyReason', JSON.stringify(pending.json));
    else {
      const shown = String(item.reason || '').trim() === '' ? '（无理由）' : item.reason;
      const conf = await req('POST', `/api/v1/point-requests/${item.id}/confirm`, {
        token: teacherToken,
        body: {},
      });
      if (!conf.res.ok) fail('points.confirm.emptyReason', conf.text);
      else ok('points.optionalReason', `teacher sees ${shown}`);
    }
  }

  // 4b. messages: to teacher + peer DM + teacher reply
  {
    await req('PATCH', '/api/v1/settings', {
      token: teacherToken,
      body: { messagesEnabled: true },
    });

    const toTeacher = await req('POST', '/api/v1/messages', {
      token: studentToken,
      body: { body: '联调给老师', toStudentId: null },
    });
    if (!toTeacher.res.ok) fail('messages.toTeacher', toTeacher.text);
    else ok('messages.toTeacher', toTeacher.json?.id);

    const teacherInbox = await req('GET', `/api/v1/messages?classId=${classId}`, { token: teacherToken });
    const teacherMsg = (teacherInbox.json?.items ?? []).find((m) => m.id === toTeacher.json?.id);
    if (!teacherMsg) fail('messages.teacherInbox', JSON.stringify(teacherInbox.json)?.slice(0, 200));
    else {
      const reply = await req('POST', `/api/v1/messages/${teacherMsg.id}/replies`, {
        token: teacherToken,
        body: { body: '老师已收到' },
      });
      if (!reply.res.ok) fail('messages.teacherReply', reply.text);
      else ok('messages.teacherReply', reply.json?.id ?? 'ok');
    }

    if (!peerRow?.id) {
      fail('messages.peer', 'need second student L002');
    } else {
      const peerSel = await req('POST', '/api/v1/auth/student-select', {
        body: { classId, studentId: peerRow.id },
      });
      if (!peerSel.res.ok) fail('messages.peer.select', peerSel.text);
      else {
        const peerToken = peerSel.json.token;
        const dm = await req('POST', '/api/v1/messages', {
          token: studentToken,
          body: { body: '联调同学私信', toStudentId: peerRow.id },
        });
        if (!dm.res.ok) fail('messages.peer.dm', dm.text);
        else {
          const peerBox = await req('GET', '/api/v1/messages', { token: peerToken });
          const found = (peerBox.json?.items ?? []).find((m) => m.id === dm.json?.id);
          if (!found) fail('messages.peer.inbox', 'dm not visible to peer');
          else ok('messages.peer.e2e', `${studentRow.studentNo}→${peerRow.studentNo}`);
        }
      }
    }
  }

  // 5. 迟到阈值设置 + 签到
  const setLate = await req('PATCH', '/api/v1/settings', {
    token: teacherToken,
    body: { attendanceClassStartTime: '08:00', attendanceLateAfterMinutes: 15 },
  });
  if (!setLate.res.ok) fail('settings.late', setLate.text);
  else ok('settings.late', '08:00 + 15min');

  const settings = await req('GET', '/api/v1/settings', { token: teacherToken });
  ok(
    'settings.read',
    `start=${settings.json?.attendanceClassStartTime} late=${settings.json?.attendanceLateAfterMinutes}`,
  );

  const checkIn = await req('POST', '/api/v1/attendance/check-in', { token: studentToken, body: {} });
  if (checkIn.res.status === 409) ok('attendance.check-in', 'already_checked_in (ok)');
  else if (!checkIn.res.ok) fail('attendance.check-in', checkIn.text);
  else ok('attendance.check-in', `status=${checkIn.json?.status} lateAfter=${checkIn.json?.lateAfterMinutes}`);

  const month = monthStr();
  const stats = await req('GET', `/api/v1/attendance/stats?classId=${classId}&month=${month}`, {
    token: teacherToken,
  });
  if (!stats.res.ok) fail('attendance.stats', stats.text);
  else ok('attendance.stats', `sessions=${stats.json.sessionCount} rate=${stats.json.classAttendanceRate}`);

  // 6. 跨月末边界：本地自然月 range 逻辑抽查（本月 vs 上月）
  const prev = new Date();
  prev.setMonth(prev.getMonth() - 1);
  const prevMonth = monthStr(prev);
  const statsPrev = await req('GET', `/api/v1/attendance/stats?classId=${classId}&month=${prevMonth}`, {
    token: teacherToken,
  });
  if (!statsPrev.res.ok) fail('attendance.stats.prevMonth', statsPrev.text);
  else {
    ok(
      'attendance.stats.localMonth',
      `curr=${month} sess=${stats.json.sessionCount}; prev=${prevMonth} sess=${statsPrev.json.sessionCount}`,
    );
  }

  // 7. 发题 + 作答 + 正确率
  const qCreate = await req('POST', '/api/v1/questions', {
    token: teacherToken,
    body: {
      classId,
      title: '联调单选',
      stem: '1+1=?',
      type: 'single',
      published: true,
      options: [
        { label: 'A', content: '2', isCorrect: true },
        { label: 'B', content: '3', isCorrect: false },
      ],
    },
  });
  if (!qCreate.res.ok) fail('question.create', qCreate.text);
  else {
    const qid = qCreate.json.id;
    ok('question.create', qid);

    // load original options (teacher list)
    const list = await req('GET', `/api/v1/questions?classId=${classId}`, { token: teacherToken });
    const q = (list.json?.items ?? []).find((x) => x.id === qid);
    const opts = q?.options ?? [];
    if (opts.length >= 2 && String(opts[0].content) === '2') ok('question.originalOptions', JSON.stringify(opts.map((o) => o.content)));
    else fail('question.originalOptions', JSON.stringify(opts));

    // edit save
    const patch = await req('PATCH', `/api/v1/questions/${qid}`, {
      token: teacherToken,
      body: {
        title: '联调单选-已改',
        stem: '1+1=?',
        type: 'single',
        options: [
          { label: 'A', content: '2', isCorrect: true },
          { label: 'B', content: '3', isCorrect: false },
          { label: 'C', content: '11', isCorrect: false },
        ],
      },
    });
    if (!patch.res.ok) fail('question.editSave', patch.text);
    else ok('question.editSave', '3 options');

    const list2 = await req('GET', `/api/v1/questions?classId=${classId}`, { token: teacherToken });
    const q2 = (list2.json?.items ?? []).find((x) => x.id === qid);
    const correctOpt = (q2?.options ?? []).find((o) => o.isCorrect);
    const ans = await req('POST', `/api/v1/questions/${qid}/answer`, {
      token: studentToken,
      body: { optionIds: [correctOpt?.id], answerPayload: { optionIds: [correctOpt?.id] } },
    });
    if (!ans.res.ok) fail('question.answer', ans.text);
    else ok('question.answer', `isCorrect=${ans.json?.isCorrect}`);

    const qstats = await req('GET', `/api/v1/questions/${qid}/stats`, { token: teacherToken });
    if (!qstats.res.ok) fail('question.stats', qstats.text);
    else {
      const rate = 1 - Number(qstats.json.errorRate ?? 0);
      ok('question.accuracy', `answered=${qstats.json.answeredCount} correctRate≈${(rate * 100).toFixed(0)}%`);
    }
  }

  // 8. 关留言 → public settings
  const msgOff = await req('PATCH', '/api/v1/settings', {
    token: teacherToken,
    body: { messagesEnabled: false },
  });
  if (!msgOff.res.ok) fail('messages.off', msgOff.text);
  else {
    const pub = await req('GET', '/api/v1/settings/public');
    if (pub.json?.messagesEnabled === false) ok('messages.off.public', 'messagesEnabled=false → 学生端应隐藏留言 Tab');
    else fail('messages.off.public', JSON.stringify(pub.json));
  }

  // 9. 导出四格式
  const formats = ['csv', 'xlsx', 'json', 'tsv'];
  const endpoints = [
    [`attendance`, `/api/v1/exports/attendance?month=${month}&classId=${classId}`],
    [`attendance-summary`, `/api/v1/exports/attendance-summary?month=${month}&classId=${classId}`],
    [`points`, `/api/v1/exports/points?month=${month}`],
    [`questions`, `/api/v1/exports/questions?classId=${classId}`],
  ];
  for (const [name, base] of endpoints) {
    for (const fmt of formats) {
      const res = await req('GET', `${base}&format=${fmt}`, { token: teacherToken, raw: true });
      if (!res.ok) {
        fail(`export.${name}.${fmt}`, `HTTP ${res.status}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const file = path.join(outDir, `${name}.${fmt}`);
      fs.writeFileSync(file, buf);
      ok(`export.${name}.${fmt}`, `${buf.length} bytes → ${file}`);
    }
  }

  // spot-check csv headers / row counts
  for (const name of ['attendance', 'attendance-summary', 'points', 'questions']) {
    const file = path.join(outDir, `${name}.csv`);
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
    ok(`export.${name}.csv.rows`, `header=${lines[0]?.slice(0, 80)} dataRows=${Math.max(0, lines.length - 1)}`);
  }

  // 10. 坏 Excel / 空表 中文提示
  {
    const fd = new FormData();
    fd.append('file', new Blob([Buffer.from('not-an-excel')], { type: 'application/octet-stream' }), 'bad.xlsx');
    const bad = await req('POST', `/api/v1/classes/${classId}/students/import-file`, {
      token: teacherToken,
      formData: fd,
    });
    const msg = bad.json?.message || '';
    if (!bad.res.ok && /[\u4e00-\u9fff]/.test(msg)) ok('import.badExcel.zh', msg);
    else fail('import.badExcel.zh', `status=${bad.res.status} body=${bad.text?.slice(0, 200)}`);
  }
  {
    const fd = new FormData();
    // minimal empty-ish csv disguised as xlsx name won't parse as xlsx → parse_failed; also try empty csv
    fd.append('file', new Blob(['姓名,学号\n'], { type: 'text/csv' }), 'empty.csv');
    const empty = await req('POST', `/api/v1/classes/${classId}/students/import-file`, {
      token: teacherToken,
      formData: fd,
    });
    const msg = empty.json?.message || '';
    if (!empty.res.ok && /[\u4e00-\u9fff]/.test(msg)) ok('import.emptySheet.zh', msg);
    else fail('import.emptySheet.zh', `status=${empty.res.status} body=${empty.text?.slice(0, 200)}`);
  }

  // restore messages for other tests
  await req('PATCH', '/api/v1/settings', {
    token: teacherToken,
    body: { messagesEnabled: true },
  });

  // write classroom identity for pack / docs
  const identity = {
    apiBase: 'http://TEACHER_LAN_IP:8787',
    classId,
    note: '学生机禁止填 127.0.0.1；用教师机局域网 IP。',
    verifiedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(outDir, 'classroom-identity.json'), JSON.stringify(identity, null, 2) + '\n');
  ok('identity.written', path.join(outDir, 'classroom-identity.json'));

  const failed = log.filter((x) => !x.ok);
  fs.writeFileSync(path.join(outDir, 'verify-log.json'), JSON.stringify({ API, classId, log, failed: failed.length }, null, 2));
  console.log(`\n${failed.length ? 'FAILED' : 'PASSED'} — ${log.length - failed.length}/${log.length} checks`);
  console.log(`classId=${classId}`);
  console.log(`exports → ${outDir}`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

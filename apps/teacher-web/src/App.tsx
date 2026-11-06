import { useEffect, useState } from 'react';
import { APP_NAME } from '@classroom-desk/shared';
import { API_BASE, api, getToken, setToken } from './api';

type ClassItem = { id: string; name: string; classCode: string };
type Tab =
  | 'classes'
  | 'assignments'
  | 'requests'
  | 'attendance'
  | 'messages'
  | 'questions'
  | 'exports'
  | 'settings';

const WEEKDAYS = [
  { v: 1, label: '一' },
  { v: 2, label: '二' },
  { v: 3, label: '三' },
  { v: 4, label: '四' },
  { v: 5, label: '五' },
  { v: 6, label: '六' },
  { v: 7, label: '日' },
];

export function App() {
  const [tokenReady, setTokenReady] = useState(Boolean(getToken()));
  const [username, setUsername] = useState('teacher');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('assignments');
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [classId, setClassId] = useState('');

  async function loadClasses() {
    const res = await api<{ items: ClassItem[] }>('/api/v1/classes');
    setClasses(res.items);
    if (!classId && res.items[0]) setClassId(res.items[0].id);
  }

  useEffect(() => {
    if (!tokenReady) return;
    void loadClasses().catch((e) => setError(e instanceof Error ? e.message : 'load_failed'));
  }, [tokenReady]);

  async function login() {
    setError('');
    try {
      const res = await api<{ token: string }>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setToken(res.token);
      setTokenReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'login_failed');
    }
  }

  if (!tokenReady) {
    return (
      <div className="login">
        <h1>{APP_NAME} 教师后台</h1>
        <label>
          用户名
          <input value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          密码
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="button" onClick={() => void login()}>
          登录
        </button>
        <p className="hint">默认演示：teacher / TeacherPass123，班级码 DEMO01</p>
      </div>
    );
  }

  return (
    <div className="layout">
      <aside>
        <h1>{APP_NAME}</h1>
        <label>
          当前班级
          <select value={classId} onChange={(e) => setClassId(e.target.value)}>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.classCode})
              </option>
            ))}
          </select>
        </label>
        {(
          [
            ['classes', '班级'],
            ['assignments', '作业'],
            ['requests', '加分请求'],
            ['attendance', '签到'],
            ['messages', '留言'],
            ['questions', '发题'],
            ['exports', '导出'],
            ['settings', '设置'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? 'nav active' : 'nav'} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
        <button
          type="button"
          className="nav"
          onClick={() => {
            setToken(null);
            setTokenReady(false);
          }}
        >
          退出登录
        </button>
      </aside>
      <main>
        {tab === 'classes' && <ClassesPanel onChanged={() => void loadClasses()} />}
        {tab === 'assignments' && <AssignmentsPanel classId={classId} />}
        {tab === 'requests' && <RequestsPanel classId={classId} />}
        {tab === 'attendance' && <AttendancePanel classId={classId} />}
        {tab === 'messages' && <MessagesPanel classId={classId} />}
        {tab === 'questions' && <QuestionsPanel classId={classId} />}
        {tab === 'exports' && <ExportsPanel />}
        {tab === 'settings' && <SettingsPanel />}
      </main>
    </div>
  );
}

function ClassesPanel({ onChanged }: { onChanged: () => void }) {
  const [name, setName] = useState('');
  const [classId, setClassId] = useState('');
  const [csv, setCsv] = useState('张三,2026001\n李四,2026002\n王五,2026003');
  const [importResult, setImportResult] = useState('');
  const [classes, setClasses] = useState<ClassItem[]>([]);

  useEffect(() => {
    void api<{ items: ClassItem[] }>('/api/v1/classes').then((r) => {
      setClasses(r.items);
      if (!classId && r.items[0]) setClassId(r.items[0].id);
    });
  }, []);

  return (
    <section>
      <h2>创建班级</h2>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="班级名称" />
      <button
        type="button"
        onClick={() =>
          void api('/api/v1/classes', { method: 'POST', body: JSON.stringify({ name }) }).then(() => {
            setName('');
            onChanged();
            return api<{ items: ClassItem[] }>('/api/v1/classes').then((r) => setClasses(r.items));
          })
        }
      >
        创建
      </button>

      <h3>批量导入学生 CSV</h3>
      <p className="hint">支持「姓名」或「姓名,学号」；已存在同名/同学号会跳过。</p>
      <label>
        目标班级
        <select value={classId} onChange={(e) => setClassId(e.target.value)}>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.classCode})
            </option>
          ))}
        </select>
      </label>
      <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={6} />
      <button
        type="button"
        onClick={() =>
          void api<{ created: number; skipped: number }>(`/api/v1/classes/${classId}/students/import`, {
            method: 'POST',
            body: JSON.stringify({ csv }),
          }).then((r) => setImportResult(`新建 ${r.created}，跳过 ${r.skipped}`))
        }
      >
        导入
      </button>
      {importResult ? <p className="hint">{importResult}</p> : null}
    </section>
  );
}

function AssignmentsPanel({ classId }: { classId: string }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [selected, setSelected] = useState('');
  const [subs, setSubs] = useState<Array<Record<string, unknown>>>([]);

  async function load() {
    if (!classId) return;
    const r = await api<{ items: Array<Record<string, unknown>> }>(`/api/v1/assignments?classId=${classId}`);
    setItems(r.items);
  }

  useEffect(() => {
    void load().catch(() => setItems([]));
  }, [classId]);

  async function upload(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/v1/uploads`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: fd,
    });
    const data = (await res.json()) as { url?: string; error?: string };
    if (!res.ok) throw new Error(data.error ?? 'upload_failed');
    setAttachmentUrl(data.url ?? '');
  }

  async function create() {
    await api('/api/v1/assignments', {
      method: 'POST',
      body: JSON.stringify({ classId, title, description, maxPoints: 5, attachmentUrl: attachmentUrl || null }),
    });
    setTitle('');
    setDescription('');
    setAttachmentUrl('');
    await load();
  }

  async function loadSubs(id: string) {
    setSelected(id);
    const r = await api<{ items: Array<Record<string, unknown>> }>(`/api/v1/assignments/${id}/submissions`);
    setSubs(r.items);
  }

  async function review(studentId: string, status: 'approved' | 'rejected') {
    await api(`/api/v1/assignments/${selected}/review`, {
      method: 'POST',
      body: JSON.stringify({ studentId, status, pointsDelta: status === 'approved' ? 5 : 0, reason: '作业审核' }),
    });
    await loadSubs(selected);
    await load(); // refresh pendingReviewCount badges
  }

  return (
    <section>
      <h2>作业</h2>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题" />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="说明" />
      <input
        type="file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {attachmentUrl ? <p className="hint">附件：{attachmentUrl}</p> : null}
      <button type="button" onClick={() => void create()}>
        发布作业
      </button>
      <ul>
        {items.map((item) => (
          <li key={String(item.id)}>
            <button type="button" onClick={() => void loadSubs(String(item.id))}>
              {String(item.title)}
              {Number(item.pendingReviewCount) > 0 ? (
                <span className="pending-badge">待审 {String(item.pendingReviewCount)}</span>
              ) : null}
            </button>
            {item.attachmentUrl ? (
              <a href={`${API_BASE}${String(item.attachmentUrl)}`} target="_blank" rel="noreferrer">
                附件
              </a>
            ) : null}
          </li>
        ))}
      </ul>
      {subs.map((s) => (
        <div key={String(s.id)} className="row">
          <span>
            {String(s.studentName)} · {String(s.status)} · {String(s.note ?? '')}
          </span>
          <button type="button" onClick={() => void review(String(s.studentId), 'approved')}>
            通过+5
          </button>
          <button type="button" onClick={() => void review(String(s.studentId), 'rejected')}>
            驳回
          </button>
        </div>
      ))}
    </section>
  );
}

function RequestsPanel({ classId }: { classId: string }) {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);

  async function load() {
    const r = await api<{ items: Array<Record<string, unknown>> }>(
      `/api/v1/point-requests/pending?classId=${classId}`,
    );
    setItems(r.items);
  }

  useEffect(() => {
    void load().catch(() => setItems([]));
    const t = setInterval(() => void load().catch(() => undefined), 5000);
    return () => clearInterval(t);
  }, [classId]);

  return (
    <section>
      <h2>待确认加分请求</h2>
      {items.map((item) => (
        <div key={String(item.id)} className="row">
          <span>
            {String(item.studentName)} · {String(item.reason)} · {String(item.points)} 分 · 倒计时{' '}
            {String(item.countdownSeconds)}s
          </span>
          <button
            type="button"
            onClick={() =>
              void api(`/api/v1/point-requests/${String(item.id)}/confirm`, { method: 'POST', body: '{}' }).then(load)
            }
          >
            确认
          </button>
          <button
            type="button"
            onClick={() =>
              void api(`/api/v1/point-requests/${String(item.id)}/reject`, { method: 'POST', body: '{}' }).then(load)
            }
          >
            拒绝
          </button>
        </div>
      ))}
    </section>
  );
}

function AttendancePanel({ classId }: { classId: string }) {
  const [sessions, setSessions] = useState<Array<Record<string, unknown>>>([]);
  const [schedules, setSchedules] = useState<Array<Record<string, unknown>>>([]);
  const [holidays, setHolidays] = useState<Array<Record<string, unknown>>>([]);
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('08:15');
  const [lateAfterMinutes, setLateAfterMinutes] = useState(5);
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayName, setHolidayName] = useState('节假日');
  const [holidayCsv, setHolidayCsv] = useState('2026-10-01,国庆\n2026-10-02,国庆\n2026-10-03,国庆');
  const [holidayImportMsg, setHolidayImportMsg] = useState('');

  async function load() {
    const [s, sch, hol] = await Promise.all([
      api<{ items: Array<Record<string, unknown>> }>(`/api/v1/attendance/sessions?classId=${classId}`),
      api<{ items: Array<Record<string, unknown>> }>(`/api/v1/attendance/schedules?classId=${classId}`),
      api<{ items: Array<Record<string, unknown>> }>(`/api/v1/attendance/holidays?classId=${classId}`),
    ]);
    setSessions(s.items);
    setSchedules(sch.items);
    setHolidays(hol.items);
  }

  useEffect(() => {
    void load().catch(() => {
      setSessions([]);
      setSchedules([]);
      setHolidays([]);
    });
  }, [classId]);

  async function startManual() {
    await api('/api/v1/attendance/sessions', {
      method: 'POST',
      body: JSON.stringify({ classId, mode: 'manual', lateAfterMinutes: 5 }),
    });
    await load();
  }

  async function saveSchedule() {
    await api('/api/v1/attendance/schedules', {
      method: 'POST',
      body: JSON.stringify({ classId, weekdays, startTime, endTime, lateAfterMinutes }),
    });
    await load();
  }

  return (
    <section>
      <h2>签到</h2>
      <button type="button" onClick={() => void startManual()}>
        发起手动签到（15 分钟）
      </button>

      <h3>自动签到周历</h3>
      <p className="hint">仅依据学生端登录与应用内心跳，不截屏/不键鼠监控。</p>
      <div className="row">
        {WEEKDAYS.map((d) => (
          <label key={d.v} className="check">
            <input
              type="checkbox"
              checked={weekdays.includes(d.v)}
              onChange={() =>
                setWeekdays((prev) =>
                  prev.includes(d.v) ? prev.filter((x) => x !== d.v) : [...prev, d.v].sort(),
                )
              }
            />
            周{d.label}
          </label>
        ))}
      </div>
      <label>
        开始
        <input value={startTime} onChange={(e) => setStartTime(e.target.value)} placeholder="08:00" />
      </label>
      <label>
        结束
        <input value={endTime} onChange={(e) => setEndTime(e.target.value)} placeholder="08:15" />
      </label>
      <label>
        迟到阈值（分钟）
        <input
          type="number"
          value={lateAfterMinutes}
          onChange={(e) => setLateAfterMinutes(Number(e.target.value))}
        />
      </label>
      <button type="button" onClick={() => void saveSchedule()}>
        保存自动签到规则
      </button>
      <ul>
        {schedules.map((s) => (
          <li key={String(s.id)}>
            周{JSON.stringify(s.weekdays)} {String(s.startTime)}-{String(s.endTime)} 迟到
            {String(s.lateAfterMinutes)}分
            <button
              type="button"
              onClick={() =>
                void api(`/api/v1/attendance/schedules/${String(s.id)}`, { method: 'DELETE' }).then(load)
              }
            >
              删除
            </button>
          </li>
        ))}
      </ul>

      <h3>节假日例外</h3>
      <p className="hint">命中日期不会自动开签到场次。可单条添加，或批量导入校历 CSV（日期,名称）。</p>
      <input type="date" value={holidayDate} onChange={(e) => setHolidayDate(e.target.value)} />
      <input value={holidayName} onChange={(e) => setHolidayName(e.target.value)} placeholder="名称" />
      <button
        type="button"
        onClick={() =>
          void api('/api/v1/attendance/holidays', {
            method: 'POST',
            body: JSON.stringify({ classId, holidayDate, name: holidayName }),
          }).then(load)
        }
      >
        添加节假日
      </button>
      <textarea value={holidayCsv} onChange={(e) => setHolidayCsv(e.target.value)} rows={4} />
      <button
        type="button"
        onClick={() =>
          void api<{ created: number; skipped: number }>('/api/v1/attendance/holidays/import', {
            method: 'POST',
            body: JSON.stringify({ classId, csv: holidayCsv }),
          }).then((r) => {
            setHolidayImportMsg(`导入成功 ${r.created}，跳过 ${r.skipped}`);
            return load();
          })
        }
      >
        批量导入校历
      </button>
      {holidayImportMsg ? <p className="hint">{holidayImportMsg}</p> : null}
      <ul>
        {holidays.map((h) => (
          <li key={String(h.id)}>
            {String(h.holidayDate)} · {String(h.name)}
            <button
              type="button"
              onClick={() =>
                void api(`/api/v1/attendance/holidays/${String(h.id)}`, { method: 'DELETE' }).then(load)
              }
            >
              删除
            </button>
          </li>
        ))}
      </ul>

      <h3>场次</h3>
      <ul>
        {sessions.map((s) => (
          <li key={String(s.id)}>
            {String(s.mode)} · {String(s.status)} · {String(s.startAt)} → {String(s.endAt)}
          </li>
        ))}
      </ul>
    </section>
  );
}

function MessagesPanel({ classId }: { classId: string }) {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [reply, setReply] = useState<Record<string, string>>({});

  async function load() {
    const r = await api<{ items: Array<Record<string, unknown>> }>(`/api/v1/messages?classId=${classId}`);
    setItems(r.items);
  }

  useEffect(() => {
    void load().catch(() => setItems([]));
  }, [classId]);

  return (
    <section>
      <h2>留言</h2>
      {items.map((msg) => (
        <div key={String(msg.id)} className="card">
          <strong>{String(msg.studentName)}</strong>
          <p>{String(msg.body)}</p>
          <input
            value={reply[String(msg.id)] ?? ''}
            onChange={(e) => setReply((prev) => ({ ...prev, [String(msg.id)]: e.target.value }))}
            placeholder="回复"
          />
          <button
            type="button"
            onClick={() =>
              void api(`/api/v1/messages/${String(msg.id)}/replies`, {
                method: 'POST',
                body: JSON.stringify({ body: reply[String(msg.id)] ?? '' }),
              }).then(load)
            }
          >
            回复
          </button>
        </div>
      ))}
    </section>
  );
}

function QuestionsPanel({ classId }: { classId: string }) {
  const [title, setTitle] = useState('');
  const [stem, setStem] = useState('');
  const [type, setType] = useState<'single' | 'multi' | 'bool' | 'blank'>('single');
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [chart, setChart] = useState<{
    title: string;
    answered: number;
    wrong: number;
    rate: number;
    options: Array<{ label: string; content: string; chosenCount: number }>;
  } | null>(null);

  async function load() {
    const r = await api<{ items: Array<Record<string, unknown>> }>(`/api/v1/questions?classId=${classId}`);
    setItems(r.items);
  }

  useEffect(() => {
    void load().catch(() => setItems([]));
  }, [classId]);

  async function create() {
    const body =
      type === 'blank'
        ? { classId, title, stem, type, answerKey: '答案', options: [] }
        : type === 'bool'
          ? {
              classId,
              title,
              stem,
              type,
              options: [
                { label: 'A', content: '正确', isCorrect: true },
                { label: 'B', content: '错误', isCorrect: false },
              ],
            }
          : type === 'multi'
            ? {
                classId,
                title,
                stem,
                type,
                options: [
                  { label: 'A', content: '正确1', isCorrect: true },
                  { label: 'B', content: '正确2', isCorrect: true },
                  { label: 'C', content: '错误', isCorrect: false },
                ],
              }
            : {
                classId,
                title,
                stem,
                type,
                options: [
                  { label: 'A', content: '正确选项', isCorrect: true },
                  { label: 'B', content: '错误选项', isCorrect: false },
                ],
              };
    await api('/api/v1/questions', { method: 'POST', body: JSON.stringify(body) });
    setTitle('');
    setStem('');
    await load();
  }

  async function showStats(id: string, qTitle: string) {
    const stats = await api<{
      answeredCount: number;
      wrongCount: number;
      errorRate: number;
      optionDistribution: Array<{ label: string; content: string; chosenCount: number }>;
    }>(`/api/v1/questions/${id}/stats`);
    setChart({
      title: qTitle,
      answered: Number(stats.answeredCount),
      wrong: Number(stats.wrongCount),
      rate: Number(stats.errorRate),
      options: (stats.optionDistribution ?? []).map((o) => ({
        label: String(o.label),
        content: String(o.content),
        chosenCount: Number(o.chosenCount ?? 0),
      })),
    });
  }

  const correct = chart ? Math.max(0, chart.answered - chart.wrong) : 0;
  const wrongPct = chart && chart.answered > 0 ? (chart.wrong / chart.answered) * 100 : 0;
  const correctPct = chart && chart.answered > 0 ? (correct / chart.answered) * 100 : 0;

  return (
    <section>
      <h2>发题</h2>
      <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
        <option value="single">单选</option>
        <option value="multi">多选</option>
        <option value="bool">判断</option>
        <option value="blank">填空</option>
      </select>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="题目标题" />
      <textarea value={stem} onChange={(e) => setStem(e.target.value)} placeholder="题干" />
      <button type="button" onClick={() => void create()}>
        发布题目
      </button>
      <ul>
        {items.map((q) => (
          <li key={String(q.id)}>
            [{String(q.type)}] {String(q.title)}{' '}
            <button type="button" onClick={() => void showStats(String(q.id), String(q.title))}>
              错误率
            </button>
          </li>
        ))}
      </ul>
      {chart ? (
        <div className="chart">
          <h3>{chart.title}</h3>
          <p>
            作答 {chart.answered} · 错误 {chart.wrong} · 错误率 {(chart.rate * 100).toFixed(1)}%
          </p>
          <div className="bar-track">
            <div className="bar wrong" style={{ width: `${wrongPct}%` }} title="错误" />
            <div className="bar correct" style={{ width: `${correctPct}%` }} title="正确" />
          </div>
          <p className="hint">红：错误占比；绿：正确占比</p>
          <h4>选项分布</h4>
          {chart.options.map((opt) => {
            const max = Math.max(1, ...chart.options.map((o) => o.chosenCount));
            const pct = (opt.chosenCount / max) * 100;
            return (
              <div key={opt.label} className="option-row">
                <span>
                  {opt.label}. {opt.content}（{opt.chosenCount}）
                </span>
                <div className="bar-track thin">
                  <div className="bar option" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function ExportsPanel() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [mode, setMode] = useState('');
  const [source, setSource] = useState('');

  async function download(path: string, filename: string) {
    const csv = await api<string>(path);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const pointsQuery = new URLSearchParams({ month });
  if (mode) pointsQuery.set('mode', mode);
  if (source) pointsQuery.set('source', source);

  return (
    <section>
      <h2>按月导出</h2>
      <label>
        月份
        <input value={month} onChange={(e) => setMonth(e.target.value)} placeholder="YYYY-MM" />
      </label>
      <label>
        加分模式
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="">全部</option>
          <option value="manual">manual</option>
          <option value="auto">auto</option>
        </select>
      </label>
      <label>
        加分来源
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">全部</option>
          <option value="request">request</option>
          <option value="manual">manual</option>
          <option value="auto_rule">auto_rule</option>
        </select>
      </label>
      <button
        type="button"
        onClick={() => void download(`/api/v1/exports/attendance?month=${month}`, `attendance-${month}.csv`)}
      >
        导出签到 CSV
      </button>
      <button
        type="button"
        onClick={() =>
          void download(`/api/v1/exports/points?${pointsQuery.toString()}`, `points-${month}.csv`)
        }
      >
        导出加分 CSV
      </button>
    </section>
  );
}

function SettingsPanel() {
  const [ttl, setTtl] = useState(60);
  const [cleanupTime, setCleanupTime] = useState('02:00');
  const [note, setNote] = useState('');
  const [cleanupStats, setCleanupStats] = useState<Array<Record<string, unknown>>>([]);
  const [lastCleanupAt, setLastCleanupAt] = useState<string | null>(null);
  const [lastCleanupKind, setLastCleanupKind] = useState<string | null>(null);

  useEffect(() => {
    void api<{
      pointRequestTtlMinutes: number;
      pointRequestDailyCleanupTime: string;
      note: string;
      cleanupStats: Array<Record<string, unknown>>;
      lastCleanupAt: string | null;
      lastCleanupKind: string | null;
    }>('/api/v1/settings').then((s) => {
      setTtl(s.pointRequestTtlMinutes);
      setCleanupTime(s.pointRequestDailyCleanupTime);
      setNote(s.note);
      setCleanupStats(s.cleanupStats ?? []);
      setLastCleanupAt(s.lastCleanupAt);
      setLastCleanupKind(s.lastCleanupKind);
    });
  }, []);

  return (
    <section>
      <h2>设置</h2>
      <label>
        加分请求有效期（分钟，1–10080）
        <input type="number" value={ttl} onChange={(e) => setTtl(Number(e.target.value))} />
      </label>
      <button
        type="button"
        onClick={() =>
          void api('/api/v1/settings', {
            method: 'PATCH',
            body: JSON.stringify({ pointRequestTtlMinutes: ttl }),
          })
        }
      >
        保存 TTL
      </button>
      <p>每日清空时间（只读，不可关闭）：{cleanupTime}</p>
      <p>
        最近清理执行时间：{lastCleanupAt ?? '尚未执行'}
        {lastCleanupKind ? `（${lastCleanupKind}）` : ''}
      </p>
      <p className="hint">{note}</p>
      <h3>清理任务结果（只读）</h3>
      <ul>
        {cleanupStats.length === 0 ? <li>暂无记录</li> : null}
        {cleanupStats.map((row) => (
          <li key={String(row.id)}>
            {String(row.createdAt ?? row.cleanupDate)} · {String(row.kind)} · 清理{' '}
            {String(row.removedCount)} 条
          </li>
        ))}
      </ul>
    </section>
  );
}

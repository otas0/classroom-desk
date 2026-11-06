import { useEffect, useState } from 'react';
import { APP_NAME } from '@classroom-desk/shared';
import { API_BASE, api, getToken, setToken } from './api';

type ClassItem = { id: string; name: string; classCode: string };
type Tab = 'roster' | 'questions' | 'requests' | 'attendance' | 'exports' | 'messages' | 'assign' | 'settings';

const IMPORT_ERROR_ZH: Record<string, string> = {
  file_required: '未收到上传文件，请重新选择 Excel/CSV 后再试',
  unsupported_file_type: '仅支持 .xlsx / .xls / .csv，请检查文件后缀',
  parse_failed: '文件解析失败：可能不是有效表格、文件损坏或列名无法识别',
  corrupt_file: 'Excel 文件损坏或不是有效的 .xlsx/.xls，请用 WPS/Excel 另存后再导入',
  empty_sheet: '表格无有效数据行，请确认有「姓名」列且至少一行学生',
  empty_csv: 'CSV 为空',
  import_all_failed: '全班导入失败，请按行核对提示',
  class_not_found: '班级不存在',
  import_failed: '导入失败',
};

function preferClassroomId(items: ClassItem[], current: string): string {
  if (current && items.some((c) => c.id === current)) return current;
  const preferred =
    items.find((c) => c.name === '本教室') ??
    items.find((c) => c.name.includes('本教室')) ??
    items[0];
  return preferred?.id ?? '';
}

function monthString(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y!, (m! - 1) + delta, 1);
  return monthString(d);
}

export function App() {
  const [tokenReady, setTokenReady] = useState(Boolean(getToken()));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('roster');
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [classId, setClassId] = useState('');
  const [mustChangePassword, setMustChangePassword] = useState(
    () => sessionStorage.getItem('cd_must_change_password') === '1',
  );
  const [messagesEnabled, setMessagesEnabled] = useState(true);
  const [healthAlert, setHealthAlert] = useState('');

  async function loadClasses() {
    const res = await api<{ items: ClassItem[] }>('/api/v1/classes');
    setClasses(res.items);
    setClassId((prev) => preferClassroomId(res.items, prev));
  }

  useEffect(() => {
    if (!tokenReady) return;
    void loadClasses().catch((e) => setError(e instanceof Error ? e.message : 'load_failed'));
    void api<{ messagesEnabled?: boolean }>('/api/v1/settings')
      .then((s) => setMessagesEnabled(s.messagesEnabled !== false))
      .catch(() => undefined);
  }, [tokenReady]);

  useEffect(() => {
    if (!tokenReady) return;
    let cancelled = false;
    async function pollHealth() {
      try {
        const res = await fetch(`${API_BASE}/health`, { cache: 'no-store' });
        const body = (await res.json()) as {
          ok?: boolean;
          backup?: { lastError?: { message?: string } | null };
        };
        if (cancelled) return;
        const err = body.backup?.lastError;
        setHealthAlert(
          !body.ok
            ? '服务异常：/health 未就绪'
            : err
              ? `备份异常：${err.message ?? JSON.stringify(err)}（请在教师机运行 npm run backup:db）`
              : '',
        );
      } catch {
        if (!cancelled) setHealthAlert('无法读取 /health');
      }
    }
    void pollHealth();
    const t = window.setInterval(() => void pollHealth(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [tokenReady]);

  useEffect(() => {
    if (mustChangePassword) setTab('settings');
  }, [mustChangePassword]);

  async function login() {
    setError('');
    try {
      const res = await api<{ token: string; mustChangePassword?: boolean }>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setToken(res.token);
      const force = Boolean(res.mustChangePassword);
      setMustChangePassword(force);
      sessionStorage.setItem('cd_must_change_password', force ? '1' : '0');
      setTokenReady(true);
      if (force) setTab('settings');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'login_failed');
    }
  }

  if (!tokenReady) {
    return (
      <div className="login">
        <h1>{APP_NAME} 教师后台</h1>
        <p className="hint">使用教师账号登录。若仍是联调口令，登录后须先改个人密码。</p>
        <label>
          用户名
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label>
          密码
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="button" onClick={() => void login()}>
          登录
        </button>
      </div>
    );
  }

  const navItems = (
    [
      ['roster', '名单导入'],
      ['questions', '发题/正确率'],
      ['requests', '加分审核'],
      ['attendance', '签到统计'],
      ['exports', '导出'],
      ...(messagesEnabled ? ([['messages', '留言']] as const) : []),
      ['assign', '指派学生机'],
      ['settings', '设置'],
    ] as const
  ).filter((row) => !mustChangePassword || row[0] === 'settings');

  return (
    <div className="layout">
      <aside>
        <h1>{APP_NAME}</h1>
        {healthAlert ? <p className="banner-alert">{healthAlert}</p> : null}
        {mustChangePassword ? (
          <p className="banner-alert">请先修改个人密码（至少 8 位，含字母与数字）</p>
        ) : null}
        <label>
          当前班级
          <select
            value={classId}
            disabled={mustChangePassword}
            onChange={(e) => setClassId(e.target.value)}
          >
            {classes.length === 0 ? <option value="">（暂无班级）</option> : null}
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {navItems.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? 'nav active' : 'nav'}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
        {!messagesEnabled && !mustChangePassword ? (
          <p className="hint">留言已关闭（学生端无留言 Tab）</p>
        ) : null}
        <button
          type="button"
          className="nav"
          onClick={() => {
            setToken(null);
            setTokenReady(false);
            setMustChangePassword(false);
            sessionStorage.removeItem('cd_must_change_password');
          }}
        >
          退出登录
        </button>
      </aside>
      <main>
        {mustChangePassword ? (
          <SettingsPanel
            forcePasswordOnly
            onPasswordChanged={() => {
              setMustChangePassword(false);
              sessionStorage.setItem('cd_must_change_password', '0');
              setTab('roster');
            }}
          />
        ) : (
          <>
            {tab === 'roster' && <RosterPanel classId={classId} classes={classes} onClasses={loadClasses} />}
            {tab === 'questions' && <QuestionsPanel classId={classId} />}
            {tab === 'requests' && <RequestsPanel classId={classId} />}
            {tab === 'attendance' && <AttendancePanel classId={classId} />}
            {tab === 'exports' && <ExportsPanel classId={classId} />}
            {tab === 'messages' && messagesEnabled && (
              <MessagesPanel classId={classId} onEnabledChange={setMessagesEnabled} />
            )}
            {tab === 'assign' && <AssignPanel classId={classId} classes={classes} />}
            {tab === 'settings' && <SettingsPanel onMessagesChange={setMessagesEnabled} />}
          </>
        )}
      </main>
    </div>
  );
}

function RosterPanel({
  classId,
  classes,
  onClasses,
}: {
  classId: string;
  classes: ClassItem[];
  onClasses: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [csv, setCsv] = useState('');
  const [students, setStudents] = useState<Array<Record<string, unknown>>>([]);
  const [importResult, setImportResult] = useState('');
  const [search, setSearch] = useState('');
  const [replaceRoster, setReplaceRoster] = useState(false);

  async function loadStudents() {
    if (!classId) return;
    const r = await api<{ items: Array<Record<string, unknown>> }>(`/api/v1/classes/${classId}/students`);
    setStudents(r.items);
  }

  const filteredStudents = [...students]
    .sort((a, b) => String(a.studentNo ?? '').localeCompare(String(b.studentNo ?? ''), 'zh'))
    .filter((s) => {
      const key = search.trim().toLowerCase();
      if (!key) return true;
      return (
        String(s.displayName).toLowerCase().includes(key) ||
        String(s.studentNo ?? '')
          .toLowerCase()
          .includes(key)
      );
    });

  useEffect(() => {
    void loadStudents().catch(() => setStudents([]));
  }, [classId]);

  async function confirmBeforeImport(): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/health`, { cache: 'no-store' });
      const body = (await res.json()) as {
        backup?: { latestAt?: string | null; ageHours?: number | null; lastError?: unknown };
      };
      const age = body.backup?.ageHours;
      const stale = body.backup?.latestAt == null || (typeof age === 'number' && age > 24);
      const err = body.backup?.lastError;
      if (err || stale) {
        const ok = window.confirm(
          `${err ? '检测到备份异常。' : '近 24 小时内未见备份。'}导入前建议在教师机执行 npm run backup:db。\n仍要继续导入吗？`,
        );
        if (!ok) return false;
      }
    } catch {
      const ok = window.confirm('无法确认备份状态。仍要继续导入吗？');
      if (!ok) return false;
    }
    if (replaceRoster) {
      const n = students.length;
      return window.confirm(
        n > 0
          ? `覆盖导入将清空本班现有 ${n} 名学生，再写入表格。此操作不可撤销，确定继续？`
          : '将按覆盖模式导入（当前班暂无学生）。确定继续？',
      );
    }
    return true;
  }

  async function importFile(file: File) {
    if (!(await confirmBeforeImport())) return;
    const fd = new FormData();
    fd.append('file', file);
    if (replaceRoster) fd.append('replace', '1');
    const token = getToken();
    const q = replaceRoster ? '?replace=1' : '';
    const res = await fetch(`${API_BASE}/api/v1/classes/${classId}/students/import-file${q}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: fd,
    });
    const data = (await res.json()) as {
      created?: number;
      skipped?: number;
      replaced?: number;
      failures?: Array<{ line: number; name: string; reasonText?: string; reason: string }>;
      error?: string;
      message?: string;
    };
    if (!res.ok) {
      throw new Error(data.message ?? IMPORT_ERROR_ZH[data.error ?? ''] ?? data.error ?? '导入失败');
    }
    const fail = (data.failures ?? [])
      .map((f) => `第${f.line}行 ${f.name} → ${f.reasonText ?? f.reason}`)
      .join('；');
    setImportResult(
      `${replaceRoster ? `覆盖清除 ${data.replaced ?? 0} 人后，` : ''}新建 ${data.created}，跳过 ${data.skipped}${
        fail ? `。失败行：${fail}` : ''
      }`,
    );
    await loadStudents();
  }

  return (
    <section>
      <h2>班级与名单</h2>
      <div className="row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="新班级名称" />
        <button
          type="button"
          onClick={() =>
            void api('/api/v1/classes', { method: 'POST', body: JSON.stringify({ name }) }).then(() => {
              setName('');
              return onClasses();
            })
          }
        >
          创建班级
        </button>
      </div>

      <h3>批量导入（Excel / CSV）</h3>
      <p className="hint">支持 .xlsx / .xls / .csv，列：姓名、学号（学号可选）。导入后学生机名单即可点名加分。</p>
      <label className="row">
        <input type="checkbox" checked={replaceRoster} onChange={(e) => setReplaceRoster(e.target.checked)} />
        覆盖导入（先清空本班现有学生，再写入表格；请先 backup:db）
      </label>
      <label className="dropzone dropzone-wrap">
        <strong>点击选择文件</strong>
        <p className="hint">或拖入 Excel / CSV（真实上传到本班名单）</p>
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importFile(file).catch((err) => setImportResult(String(err.message ?? err)));
            e.target.value = '';
          }}
        />
      </label>
      <textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        rows={5}
        placeholder={'姓名,学号\n（粘贴真实名单）'}
      />
      <button
        type="button"
        onClick={() => {
          if (!csv.trim()) {
            setImportResult('请粘贴真实名单 CSV，或使用上方文件上传');
            return;
          }
          void (async () => {
            if (!(await confirmBeforeImport())) return;
            try {
              const r = await api<{
                created: number;
                skipped: number;
                replaced?: number;
                failures?: Array<{ line: number; name: string; reasonText?: string; reason: string }>;
              }>(`/api/v1/classes/${classId}/students/import`, {
                method: 'POST',
                body: JSON.stringify({ csv, replace: replaceRoster }),
              });
              const fail = (r.failures ?? [])
                .map((f) => `第${f.line}行 ${f.name} → ${f.reasonText ?? f.reason}`)
                .join('；');
              setImportResult(
                `${replaceRoster ? `覆盖清除 ${r.replaced ?? 0} 人后，` : ''}新建 ${r.created}，跳过 ${r.skipped}${
                  fail ? `。${fail}` : ''
                }`,
              );
              await loadStudents();
            } catch (err) {
              setImportResult(String(err instanceof Error ? err.message : err));
            }
          })();
        }}
      >
        从文本导入 CSV
      </button>
      {importResult ? <p className={/失败|错误|无效|损坏/.test(importResult) ? 'error' : 'hint'}>{importResult}</p> : null}

      <h3>当前班名单（{classes.find((c) => c.id === classId)?.name ?? ''}）· 按学号排序</h3>
      <p className="hint">可直接改姓名/学号并保存，或删除学生（相关签到/加分记录一并清除）。</p>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索姓名/学号" />
      <table className="data-table">
        <thead>
          <tr>
            <th>学号</th>
            <th>姓名</th>
            <th>积分</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {filteredStudents.map((s) => (
            <StudentRow
              key={String(s.id)}
              classId={classId}
              student={s}
              onChanged={() => void loadStudents()}
              onError={(msg) => setImportResult(msg)}
            />
          ))}
        </tbody>
      </table>
      {filteredStudents.length === 0 ? <p className="hint">暂无学生</p> : null}
    </section>
  );
}

function StudentRow({
  classId,
  student,
  onChanged,
  onError,
}: {
  classId: string;
  student: Record<string, unknown>;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const id = String(student.id);
  const [name, setName] = useState(String(student.displayName ?? ''));
  const [studentNo, setStudentNo] = useState(String(student.studentNo ?? ''));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(String(student.displayName ?? ''));
    setStudentNo(String(student.studentNo ?? ''));
  }, [student.displayName, student.studentNo, student.id]);

  async function save() {
    setBusy(true);
    try {
      await api(`/api/v1/classes/${classId}/students/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ displayName: name.trim(), studentNo: studentNo.trim() }),
      });
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`确定删除「${name || id}」？其签到与加分记录也会清除。`)) return;
    setBusy(true);
    try {
      await api(`/api/v1/classes/${classId}/students/${id}`, { method: 'DELETE' });
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td>
        <input
          value={studentNo}
          disabled={busy}
          onChange={(e) => setStudentNo(e.target.value)}
          placeholder="学号"
          aria-label="学号"
        />
      </td>
      <td>
        <input
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          placeholder="姓名"
          aria-label="姓名"
        />
      </td>
      <td>{String(student.totalPoints)}</td>
      <td>
        <button type="button" className="secondary" disabled={busy} onClick={() => void save()}>
          保存
        </button>{' '}
        <button type="button" disabled={busy} onClick={() => void remove()}>
          删除
        </button>
      </td>
    </tr>
  );
}

type QAttachment = { url: string; originalName: string; size?: number; mime?: string };

const QUESTION_FILE_ACCEPT =
  '.pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.mp3,.m4a,.wav,.mp4,.webm';

function QuestionsPanel({ classId }: { classId: string }) {
  const [title, setTitle] = useState('');
  const [stem, setStem] = useState('');
  const [type, setType] = useState<'single' | 'multi' | 'bool' | 'blank'>('single');
  const [optA, setOptA] = useState('');
  const [optB, setOptB] = useState('');
  const [optC, setOptC] = useState('');
  const [blankKey, setBlankKey] = useState('');
  const [attachments, setAttachments] = useState<QAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [createMsg, setCreateMsg] = useState('');
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [chart, setChart] = useState<{
    title: string;
    answered: number;
    wrong: number;
    rate: number;
    options: Array<{ label: string; content: string; chosenCount: number }>;
  } | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<Record<string, unknown> | null>(null);

  async function load() {
    const r = await api<{ items: Array<Record<string, unknown>> }>(`/api/v1/questions?classId=${classId}`);
    setItems(r.items);
  }

  useEffect(() => {
    void load().catch(() => setItems([]));
  }, [classId]);

  async function uploadFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    setUploading(true);
    setCreateMsg('');
    try {
      const fd = new FormData();
      Array.from(fileList).forEach((f) => fd.append('files', f));
      const res = await api<{ items: QAttachment[] }>('/api/v1/uploads/batch', {
        method: 'POST',
        body: fd,
      });
      setAttachments((prev) => [...prev, ...res.items]);
      setCreateMsg(`已上传 ${res.items.length} 个附件`);
    } catch (e) {
      setCreateMsg(e instanceof Error ? e.message : '上传失败');
    } finally {
      setUploading(false);
    }
  }

  async function create() {
    setCreateMsg('');
    if (!title.trim() || !stem.trim()) {
      setCreateMsg('请填写真实题目标题与题干');
      return;
    }
    let body: Record<string, unknown>;
    if (type === 'blank') {
      if (!blankKey.trim()) {
        setCreateMsg('请填写填空参考答案');
        return;
      }
      body = {
        classId,
        title: title.trim(),
        stem: stem.trim(),
        type,
        answerKey: blankKey.trim(),
        options: [],
        attachments,
      };
    } else if (type === 'bool') {
      body = {
        classId,
        title: title.trim(),
        stem: stem.trim(),
        type,
        attachments,
        options: [
          { label: 'A', content: '正确', isCorrect: true },
          { label: 'B', content: '错误', isCorrect: false },
        ],
      };
    } else if (type === 'multi') {
      if (!optA.trim() || !optB.trim() || !optC.trim()) {
        setCreateMsg('多选题请填写选项 A/B/C 真实内容（默认 A、B 为正确）');
        return;
      }
      body = {
        classId,
        title: title.trim(),
        stem: stem.trim(),
        type,
        attachments,
        options: [
          { label: 'A', content: optA.trim(), isCorrect: true },
          { label: 'B', content: optB.trim(), isCorrect: true },
          { label: 'C', content: optC.trim(), isCorrect: false },
        ],
      };
    } else {
      if (!optA.trim() || !optB.trim()) {
        setCreateMsg('单选题请填写选项 A/B 真实内容（默认 A 为正确）');
        return;
      }
      body = {
        classId,
        title: title.trim(),
        stem: stem.trim(),
        type,
        attachments,
        options: [
          { label: 'A', content: optA.trim(), isCorrect: true },
          { label: 'B', content: optB.trim(), isCorrect: false },
        ],
      };
    }
    await api('/api/v1/questions', { method: 'POST', body: JSON.stringify(body) });
    setTitle('');
    setStem('');
    setOptA('');
    setOptB('');
    setOptC('');
    setBlankKey('');
    setAttachments([]);
    setCreateMsg('已发布');
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
      <h2>发题 / 正确率 · 错误率</h2>
      <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
        <option value="single">单选</option>
        <option value="multi">多选</option>
        <option value="bool">判断</option>
        <option value="blank">填空</option>
      </select>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="题目标题（必填）" />
      <textarea value={stem} onChange={(e) => setStem(e.target.value)} placeholder="题干（必填）" />
      {type === 'blank' ? (
        <input value={blankKey} onChange={(e) => setBlankKey(e.target.value)} placeholder="参考答案（必填）" />
      ) : type === 'bool' ? (
        <p className="hint">判断题选项固定为「正确 / 错误」</p>
      ) : (
        <>
          <input value={optA} onChange={(e) => setOptA(e.target.value)} placeholder="选项 A（正确，必填）" />
          <input value={optB} onChange={(e) => setOptB(e.target.value)} placeholder="选项 B（必填）" />
          {type === 'multi' ? (
            <input value={optC} onChange={(e) => setOptC(e.target.value)} placeholder="选项 C（必填）" />
          ) : null}
        </>
      )}
      <label className="dropzone dropzone-wrap">
        <strong>{uploading ? '上传中…' : '题目附件（可多选）'}</strong>
        <p className="hint">pdf / 图片 / Word / Excel / PPT / 音视频 / zip / txt / md / csv，单文件 ≤10MB</p>
        <input
          type="file"
          multiple
          accept={QUESTION_FILE_ACCEPT}
          disabled={uploading}
          onChange={(e) => {
            void uploadFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </label>
      {attachments.length ? (
        <ul className="attach-list">
          {attachments.map((a) => (
            <li key={a.url}>
              <a href={`${API_BASE}${a.url}`} target="_blank" rel="noreferrer">
                {a.originalName}
              </a>{' '}
              <button type="button" className="secondary" onClick={() => setAttachments((prev) => prev.filter((x) => x.url !== a.url))}>
                移除
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <button type="button" onClick={() => void create()} disabled={uploading}>
        发布题目
      </button>
      {createMsg ? <p className="hint">{createMsg}</p> : null}
      <ul className="question-list">
        {items.map((q) => {
          const active = editingQuestion && String(editingQuestion.id) === String(q.id);
          return (
            <li
              key={String(q.id)}
              className={`question-item${active ? ' active' : ''}`}
              tabIndex={0}
              role="button"
              onClick={() => {
                setEditingQuestion(q);
                void showStats(String(q.id), String(q.title));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setEditingQuestion(q);
                  void showStats(String(q.id), String(q.title));
                }
              }}
            >
              <span className="title">
                [{String(q.type)}] {String(q.title)}
                {Array.isArray(q.attachments) && (q.attachments as unknown[]).length
                  ? ` · 附件${(q.attachments as unknown[]).length}`
                  : ''}
              </span>
              <button
                type="button"
                className="secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  void showStats(String(q.id), String(q.title));
                }}
              >
                正确率/错误率
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingQuestion(q);
                }}
              >
                编辑
              </button>
              <button
                type="button"
                className="secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!window.confirm(`确定删除题目「${String(q.title)}」？作答记录也会清除。`)) return;
                  void api(`/api/v1/questions/${String(q.id)}`, { method: 'DELETE' })
                    .then(async () => {
                      if (String(editingQuestion?.id) === String(q.id)) setEditingQuestion(null);
                      await load();
                    })
                    .catch((err) => setCreateMsg(err instanceof Error ? err.message : '删除失败'));
                }}
              >
                删除
              </button>
            </li>
          );
        })}
      </ul>
      <h3>编辑题目（加载原选项）</h3>
      <QuestionEditForm
        classId={classId}
        seed={editingQuestion}
        onSaved={async () => {
          setEditingQuestion(null);
          await load();
        }}
        onDeleted={async () => {
          setEditingQuestion(null);
          await load();
        }}
      />
      {chart ? (
        <div className="chart">
          <h3>{chart.title}</h3>
          <p>
            作答 {chart.answered} · 错误 {chart.wrong} · 错误率 {(chart.rate * 100).toFixed(1)}% · 正确率{' '}
            {(100 - chart.rate * 100).toFixed(1)}%
          </p>
          <div className="bar-track">
            <div className="bar wrong" style={{ width: `${wrongPct}%` }} />
            <div className="bar correct" style={{ width: `${correctPct}%` }} />
          </div>
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

function QuestionEditForm({
  classId,
  seed,
  onSaved,
  onDeleted,
}: {
  classId: string;
  seed: Record<string, unknown> | null;
  onSaved: () => Promise<void>;
  onDeleted?: () => Promise<void>;
}) {
  const [qid, setQid] = useState('');
  const [title, setTitle] = useState('');
  const [stem, setStem] = useState('');
  const [qType, setQType] = useState('single');
  const [options, setOptions] = useState<Array<{ label: string; content: string; isCorrect: boolean }>>([]);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!seed) return;
    setQid(String(seed.id ?? ''));
    setTitle(String(seed.title ?? ''));
    setStem(String(seed.stem ?? ''));
    setQType(String(seed.type ?? 'single'));
    const opts = (seed.options as Array<{ label: string; content: string; isCorrect?: number | boolean }>) ?? [];
    setOptions(
      opts.map((o) => ({
        label: String(o.label),
        content: String(o.content),
        isCorrect: Boolean(o.isCorrect),
      })),
    );
    setMsg(`已加载原题 ${String(seed.id ?? '')}`);
  }, [seed]);

  return (
    <div className="card">
      <p className="hint">点列表「编辑」加载选项；可改标题/题干/选项后保存，或删除。班级 {classId}</p>
      <input value={qid} onChange={(e) => setQid(e.target.value)} placeholder="题目 ID" readOnly />
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题" />
      <textarea value={stem} onChange={(e) => setStem(e.target.value)} placeholder="题干" />
      <p className="hint">类型：{qType}</p>
      {options.map((opt, idx) => (
        <div key={idx} className="row">
          <span>{opt.label}</span>
          <input
            value={opt.content}
            onChange={(e) =>
              setOptions((prev) => prev.map((o, i) => (i === idx ? { ...o, content: e.target.value } : o)))
            }
          />
          <label>
            <input
              type="checkbox"
              checked={opt.isCorrect}
              onChange={(e) =>
                setOptions((prev) =>
                  prev.map((o, i) => (i === idx ? { ...o, isCorrect: e.target.checked } : o)),
                )
              }
            />
            正确
          </label>
        </div>
      ))}
      <button
        type="button"
        disabled={!qid}
        onClick={() =>
          void api(`/api/v1/questions/${qid}`, {
            method: 'PATCH',
            body: JSON.stringify({
              title,
              stem,
              type: qType,
              options,
            }),
          })
            .then(() => {
              setMsg('已保存原题修改');
              return onSaved();
            })
            .catch((e) => setMsg(e instanceof Error ? e.message : '失败'))
        }
      >
        保存编辑
      </button>{' '}
      <button
        type="button"
        className="secondary"
        disabled={!qid}
        onClick={() => {
          if (!window.confirm(`确定删除题目「${title || qid}」？`)) return;
          void api(`/api/v1/questions/${qid}`, { method: 'DELETE' })
            .then(() => {
              setMsg('已删除');
              return onDeleted?.() ?? onSaved();
            })
            .catch((e) => setMsg(e instanceof Error ? e.message : '删除失败'));
        }}
      >
        删除题目
      </button>
      {msg ? <p className="hint">{msg}</p> : null}
    </div>
  );
}
function AttendancePanel({ classId }: { classId: string }) {
  const [month, setMonth] = useState(
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
  );
  const [stats, setStats] = useState<{
    sessionCount: number;
    classAttendanceRate: number;
    items: Array<{ displayName: string; studentNo: string | null; presentCount: number; attendanceRate: number }>;
  } | null>(null);

  async function load() {
    const r = await api<{
      sessionCount: number;
      classAttendanceRate: number;
      items: Array<{ displayName: string; studentNo: string | null; presentCount: number; attendanceRate: number }>;
    }>(`/api/v1/attendance/stats?classId=${classId}&month=${month}`);
    setStats(r);
  }

  useEffect(() => {
    void load().catch(() => setStats(null));
  }, [classId, month]);

  return (
    <section>
      <h2>签到统计（月）</h2>
      <p className="hint">
        按教师机本地时区自然月统计（非 UTC）。学生端点「签到」写入今日场次。
      </p>
      <input value={month} onChange={(e) => setMonth(e.target.value)} placeholder="YYYY-MM" />
      <button type="button" onClick={() => void load()}>
        刷新
      </button>
      {stats ? (
        <>
          <p>
            本月场次 {stats.sessionCount} · 班级出勤率 {(stats.classAttendanceRate * 100).toFixed(1)}%
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>学号</th>
                <th>姓名</th>
                <th>出勤次数</th>
                <th>出勤率</th>
              </tr>
            </thead>
            <tbody>
              {stats.items.map((s) => (
                <tr key={s.displayName + String(s.studentNo)}>
                  <td>{s.studentNo ?? '—'}</td>
                  <td>{s.displayName}</td>
                  <td>{s.presentCount}</td>
                  <td>{(s.attendanceRate * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  );
}

function ExportsPanel({ classId }: { classId: string }) {
  const [month, setMonth] = useState(monthString());
  const [format, setFormat] = useState<'csv' | 'xlsx' | 'json' | 'tsv'>('csv');

  async function download(path: string, filename: string) {
    const token = getToken();
    const res = await fetch(`${API_BASE}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) throw new Error('export_failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const ext = format;
  const thisMonth = monthString();
  const lastMonth = shiftMonth(thisMonth, -1);
  return (
    <section>
      <h2>导出（多格式）</h2>
      <div className="row">
        <button type="button" className="secondary" onClick={() => setMonth(lastMonth)}>
          上月（{lastMonth}）
        </button>
        <button type="button" className="secondary" onClick={() => setMonth(thisMonth)}>
          本月（{thisMonth}）
        </button>
      </div>
      <label>
        月份
        <input value={month} onChange={(e) => setMonth(e.target.value)} />
      </label>
      <label>
        格式
        <select value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
          <option value="csv">CSV</option>
          <option value="xlsx">Excel (.xlsx)</option>
          <option value="json">JSON</option>
          <option value="tsv">TSV</option>
        </select>
      </label>
      <div className="row">
        <button
          type="button"
          onClick={() =>
            void download(
              `/api/v1/exports/attendance?month=${month}&classId=${classId}&format=${format}`,
              `attendance-${month}.${ext}`,
            )
          }
        >
          签到明细
        </button>
        <button
          type="button"
          onClick={() =>
            void download(
              `/api/v1/exports/attendance-summary?month=${month}&classId=${classId}&format=${format}`,
              `attendance-summary-${month}.${ext}`,
            )
          }
        >
          月出勤汇总
        </button>
        <button
          type="button"
          onClick={() =>
            void download(`/api/v1/exports/points?month=${month}&format=${format}`, `points-${month}.${ext}`)
          }
        >
          加分
        </button>
        <button
          type="button"
          onClick={() =>
            void download(
              `/api/v1/exports/questions?classId=${classId}&format=${format}`,
              `questions.${ext}`,
            )
          }
        >
          题目正确率
        </button>
      </div>
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
    const t = window.setInterval(() => void load().catch(() => undefined), 5000);
    return () => window.clearInterval(t);
  }, [classId]);

  return (
    <section>
      <h2>加分请求审核</h2>
      <p className="hint">学生在名单点选姓名后提交请求；通过后写入积分。</p>
      {items.length === 0 ? <p>暂无待审请求</p> : null}
      {items.map((item) => (
        <div key={String(item.id)} className="row request-row">
          <span>
            {String(item.studentName)} · {String(item.reason || '（无理由）')} · {String(item.points)} 分
          </span>
          <button
            type="button"
            onClick={() =>
              void api(`/api/v1/point-requests/${String(item.id)}/confirm`, {
                method: 'POST',
                body: '{}',
              }).then(load)
            }
          >
            通过
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              void api(`/api/v1/point-requests/${String(item.id)}/reject`, {
                method: 'POST',
                body: '{}',
              }).then(load)
            }
          >
            拒绝
          </button>
        </div>
      ))}
    </section>
  );
}

function MessagesPanel({
  classId,
  onEnabledChange,
}: {
  classId: string;
  onEnabledChange?: (enabled: boolean) => void;
}) {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState(true);
  const [err, setErr] = useState('');

  async function load() {
    setErr('');
    const [msgs, settings] = await Promise.all([
      api<{ items: Array<Record<string, unknown>> }>(`/api/v1/messages?classId=${classId}`),
      api<{ messagesEnabled: boolean }>('/api/v1/settings'),
    ]);
    setItems(msgs.items);
    const on = settings.messagesEnabled !== false;
    setEnabled(on);
    onEnabledChange?.(on);
  }

  useEffect(() => {
    void load().catch((e) => setErr(e instanceof Error ? e.message : '加载失败'));
  }, [classId]);

  return (
    <section>
      <h2>留言</h2>
      <p className="hint">含学生→老师、学生↔学生；可回复任意一条。</p>
      {err ? <p className="error">{err}</p> : null}
      <label className="row">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) =>
            void api('/api/v1/settings', {
              method: 'PATCH',
              body: JSON.stringify({ messagesEnabled: e.target.checked }),
            })
              .then(() => {
                setEnabled(e.target.checked);
                onEnabledChange?.(e.target.checked);
              })
              .catch((ex) => setErr(ex instanceof Error ? ex.message : '保存失败'))
          }
        />
        允许学生留言（关闭后学生端与本侧「留言」入口一并隐藏）
      </label>
      <button type="button" className="secondary" onClick={() => void load().catch((e) => setErr(String(e)))}>
        刷新
      </button>
      {items.length === 0 ? <p className="hint">暂无留言</p> : null}
      {items.map((msg) => {
        const peer = Boolean(msg.toStudentId);
        const heading = peer
          ? `${String(msg.studentName)} → ${String(msg.toStudentName ?? '同学')}`
          : `${String(msg.studentName)} → 老师`;
        return (
          <div key={String(msg.id)} className="card">
            <strong>{heading}</strong>
            <p>{String(msg.body)}</p>
            <p className="hint">{msg.createdAt ? new Date(String(msg.createdAt)).toLocaleString() : ''}</p>
            {((msg.replies as Array<{ id?: string; authorName?: string; body: string }>) ?? []).map((r, i) => (
              <p key={r.id ?? i} className="hint">
                {r.authorName ?? '回复'}：{r.body}
              </p>
            ))}
            <input
              value={reply[String(msg.id)] ?? ''}
              onChange={(e) => setReply((prev) => ({ ...prev, [String(msg.id)]: e.target.value }))}
              placeholder="回复内容"
            />
            <button
              type="button"
              onClick={() => {
                const text = (reply[String(msg.id)] ?? '').trim();
                if (!text) {
                  setErr('回复不能为空');
                  return;
                }
                void api(`/api/v1/messages/${String(msg.id)}/replies`, {
                  method: 'POST',
                  body: JSON.stringify({ body: text }),
                })
                  .then(() => {
                    setReply((prev) => ({ ...prev, [String(msg.id)]: '' }));
                    return load();
                  })
                  .catch((ex) => setErr(ex instanceof Error ? ex.message : '回复失败'));
              }}
            >
              回复
            </button>
          </div>
        );
      })}
    </section>
  );
}

function AssignPanel({ classId, classes }: { classId: string; classes: ClassItem[] }) {
  const [apiBase, setApiBase] = useState('');
  const [lanIps, setLanIps] = useState<string[]>([]);
  const [healthHint, setHealthHint] = useState('');
  const klass = classes.find((c) => c.id === classId);

  useEffect(() => {
    void (async () => {
      const [settings, health] = await Promise.all([
        api<{ classroomApiBase?: string }>('/api/v1/settings'),
        fetch(`${API_BASE}/health`, { cache: 'no-store' }).then((r) => r.json()) as Promise<{
          lanIps?: string[];
          suggestedApiBase?: string;
          studentHealthUrl?: string;
        }>,
      ]);
      const suggested =
        settings.classroomApiBase ||
        health.suggestedApiBase ||
        (typeof window !== 'undefined' ? window.location.origin : '');
      setApiBase(String(suggested).replace(/\/$/, ''));
      setLanIps(health.lanIps ?? []);
      setHealthHint(health.studentHealthUrl ?? `${String(suggested).replace(/\/$/, '')}/health`);
    })().catch(() => {
      if (typeof window !== 'undefined') setApiBase(window.location.origin);
    });
  }, []);

  async function saveApiBase() {
    const base = apiBase.replace(/\/$/, '');
    await api('/api/v1/settings', {
      method: 'PATCH',
      body: JSON.stringify({ classroomApiBase: base }),
    });
    setHealthHint(`${base}/health`);
  }

  function configObject() {
    const base = apiBase.replace(/\/$/, '');
    return {
      apiBase: base,
      classId,
      comment: `本教室 ${klass?.name ?? classId}。学生机专用，禁止 127.0.0.1。`,
    };
  }

  function downloadConfig() {
    const base = apiBase.replace(/\/$/, '');
    if (/127\.0\.0\.1|localhost/i.test(base)) {
      window.alert('禁止使用 127.0.0.1 / localhost，请填教师机局域网 IP');
      return;
    }
    const cfg = configObject();
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `classroom-${klass?.name ?? 'class'}-config.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      window.alert(`已复制${label}`);
    } catch {
      window.prompt(`复制${label}：`, text);
    }
  }

  return (
    <section>
      <h2>上课前指派学生机</h2>
      <div className="help-bubble">
        每台学生机必须配置<strong>本教师机局域网地址</strong>与本班 <code>classId</code>。禁止 127.0.0.1。
        学生浏览器先打开下方 /health；通过后再装客户端或写入 config。
      </div>
      <p>
        当前班级：<strong>{klass?.name ?? '—'}</strong>
      </p>
      <p>
        classId：<code>{classId || '（请先选班）'}</code>{' '}
        <button
          type="button"
          className="secondary"
          disabled={!classId}
          onClick={() => void copyText('classId', classId)}
        >
          复制 classId
        </button>
      </p>
      <p>
        apiBase：<code>{apiBase || '—'}</code>{' '}
        <button
          type="button"
          className="secondary"
          disabled={!apiBase}
          onClick={() => void copyText('apiBase', apiBase.replace(/\/$/, ''))}
        >
          复制 apiBase
        </button>
      </p>
      {lanIps.length ? (
        <p className="hint">
          本机检测到局域网 IP：{lanIps.map((ip) => (
            <button
              key={ip}
              type="button"
              className="linkish"
              onClick={() => setApiBase(`http://${ip}:8787`)}
            >
              {ip}
            </button>
          ))}
          （点击填入）
        </p>
      ) : null}
      <label>
        教师机 apiBase（学生机用）
        <input value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="http://192.168.x.x:8787" />
      </label>
      <button type="button" onClick={() => void saveApiBase().catch((e) => window.alert(String(e)))}>
        保存为教室地址
      </button>{' '}
      <button type="button" disabled={!classId || !apiBase} onClick={downloadConfig}>
        下载本教室 config.json
      </button>{' '}
      <button
        type="button"
        className="secondary"
        disabled={!classId || !apiBase}
        onClick={() => void copyText('config.json', JSON.stringify(configObject(), null, 2))}
      >
        复制 config.json
      </button>
      <p className="hint">
        学生浏览器强制检测：{' '}
        <a href={healthHint} target="_blank" rel="noreferrer">
          {healthHint || '—'}
        </a>
      </p>
      <p className="hint">
        打本教室安装包：
        <code>
          node scripts/pack-classroom-config.mjs --apiBase {apiBase || 'http://教师IP:8787'} --classId{' '}
          {classId || '<id>'}
        </code>
      </p>
      <pre className="code-block">{`{\n  "apiBase": "${apiBase.replace(/\/$/, '')}",\n  "classId": "${classId}"\n}`}</pre>
    </section>
  );
}

function SettingsPanel({
  forcePasswordOnly = false,
  onPasswordChanged,
  onMessagesChange,
}: {
  forcePasswordOnly?: boolean;
  onPasswordChanged?: () => void;
  onMessagesChange?: (enabled: boolean) => void;
} = {}) {
  const [diag, setDiag] = useState('');
  const [ttl, setTtl] = useState(60);
  const [saveMsg, setSaveMsg] = useState('');
  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [pwdMsg, setPwdMsg] = useState('');
  const [messagesOn, setMessagesOn] = useState(true);

  useEffect(() => {
    void api<{ pointRequestTtlMinutes: number; messagesEnabled?: boolean }>('/api/v1/settings').then((s) => {
      setTtl(s.pointRequestTtlMinutes);
      setMessagesOn(s.messagesEnabled !== false);
    });
  }, []);

  async function runDiag() {
    const t0 = performance.now();
    try {
      const res = await fetch(`${API_BASE}/health`, { cache: 'no-store' });
      const ms = Math.round(performance.now() - t0);
      const body = (await res.json()) as {
        ok?: boolean;
        lanIps?: string[];
        suggestedApiBase?: string;
        backup?: { latestAt?: string | null; lastError?: { message?: string } | null };
      };
      const err = body.backup?.lastError;
      setDiag(
        body.ok
          ? `正常 ${ms}ms · LAN ${body.lanIps?.join(', ') || '—'} · ${body.suggestedApiBase ?? ''}${
              err ? ` · lastError：${err.message ?? JSON.stringify(err)}` : ' · lastError 无'
            }`
          : `失败 HTTP ${res.status}`,
      );
    } catch (e) {
      setDiag(e instanceof Error ? e.message : 'network_error');
    }
  }

  const pwdHint =
    newPwd.length === 0
      ? '至少 8 位，须含字母与数字；勿用 ChangeMe123 等联调口令'
      : newPwd.length < 8
        ? '还差字符：至少 8 位'
        : !/[A-Za-z]/.test(newPwd) || !/[0-9]/.test(newPwd)
          ? '还需同时包含字母与数字'
          : '强度看起来可以提交';

  return (
    <section>
      <h2>设置</h2>
      {forcePasswordOnly ? (
        <p className="error">首次/联调口令登录：必须先改成个人密码才能使用其它功能。</p>
      ) : null}
      {!forcePasswordOnly ? (
        <>
          <button type="button" onClick={() => void runDiag()}>
            一键检测 /health
          </button>
          {diag ? <p className="hint">{diag}</p> : null}
        </>
      ) : null}

      <h3>教师登录密码</h3>
      <p className="hint">{pwdHint}</p>
      <label>
        当前密码
        <input type="password" value={curPwd} onChange={(e) => setCurPwd(e.target.value)} autoComplete="current-password" />
      </label>
      <label>
        新密码
        <input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} autoComplete="new-password" />
      </label>
      <button
        type="button"
        onClick={() =>
          void api<{ message?: string }>('/api/v1/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({ currentPassword: curPwd, newPassword: newPwd }),
          })
            .then((r) => {
              setPwdMsg(r.message ?? '已更新');
              setCurPwd('');
              setNewPwd('');
              onPasswordChanged?.();
            })
            .catch((e) => setPwdMsg(e instanceof Error ? e.message : '改密失败'))
        }
      >
        修改登录密码
      </button>
      {pwdMsg ? <p className="hint">{pwdMsg}</p> : null}

      {forcePasswordOnly ? null : (
        <>
          <h3>留言</h3>
          <label className="row">
            <input
              type="checkbox"
              checked={messagesOn}
              onChange={(e) =>
                void api('/api/v1/settings', {
                  method: 'PATCH',
                  body: JSON.stringify({ messagesEnabled: e.target.checked }),
                })
                  .then(() => {
                    setMessagesOn(e.target.checked);
                    onMessagesChange?.(e.target.checked);
                  })
                  .catch((err) => setSaveMsg(err instanceof Error ? err.message : '保存失败'))
              }
            />
            允许学生留言（关闭后侧栏隐藏「留言」）
          </label>

          <h3>加分请求</h3>
          <label>
            有效期（分钟）
            <input type="number" value={ttl} onChange={(e) => setTtl(Number(e.target.value))} />
          </label>
          <button
            type="button"
            onClick={() =>
              void api('/api/v1/settings', {
                method: 'PATCH',
                body: JSON.stringify({ pointRequestTtlMinutes: ttl }),
              })
                .then(() => setSaveMsg('已保存'))
                .catch((e) => setSaveMsg(e instanceof Error ? e.message : '保存失败'))
            }
          >
            保存设置
          </button>
          {saveMsg ? <p className="hint">{saveMsg}</p> : null}
          <p className="hint">本地备份：教师机 `npm run backup:db`；确认 /health 无 lastError。</p>
        </>
      )}
    </section>
  );
}

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

export function App() {
  const [tokenReady, setTokenReady] = useState(Boolean(getToken()));
  const [username, setUsername] = useState('teacher');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('roster');
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
        <p className="hint">账号 teacher；登录后请到「设置」修改密码。</p>
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
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {(
          [
            ['roster', '花名册导入'],
            ['questions', '发题/正确率'],
            ['requests', '加分审核'],
            ['attendance', '签到统计'],
            ['exports', '导出'],
            ['messages', '留言'],
            ['assign', '指派学生机'],
            ['settings', '设置'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? 'nav active' : 'nav'}
            onClick={() => setTab(id)}
          >
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
        {tab === 'roster' && <RosterPanel classId={classId} classes={classes} onClasses={loadClasses} />}
        {tab === 'questions' && <QuestionsPanel classId={classId} />}
        {tab === 'requests' && <RequestsPanel classId={classId} />}
        {tab === 'attendance' && <AttendancePanel classId={classId} />}
        {tab === 'exports' && <ExportsPanel classId={classId} />}
        {tab === 'messages' && <MessagesPanel classId={classId} />}
        {tab === 'assign' && <AssignPanel classId={classId} classes={classes} />}
        {tab === 'settings' && <SettingsPanel />}
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
  const [csv, setCsv] = useState('姓名,学号\n张三,2026001\n李四,2026002');
  const [students, setStudents] = useState<Array<Record<string, unknown>>>([]);
  const [importResult, setImportResult] = useState('');
  const [search, setSearch] = useState('');

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

  async function importFile(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/v1/classes/${classId}/students/import-file`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: fd,
    });
    const data = (await res.json()) as {
      created?: number;
      skipped?: number;
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
    setImportResult(`新建 ${data.created}，跳过 ${data.skipped}${fail ? `。失败行：${fail}` : ''}`);
    await loadStudents();
  }

  return (
    <section>
      <h2>班级与花名册</h2>
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
      <p className="hint">支持 .xlsx / .xls / .csv，列：姓名、学号（学号可选）。导入后学生机花名册即可点名加分。</p>
      <label className="dropzone dropzone-wrap">
        <strong>点击选择文件</strong>
        <p className="hint">或拖入 Excel / CSV（真实上传到本班花名册）</p>
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
      <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={5} />
      <button
        type="button"
        onClick={() =>
          void api<{
            created: number;
            skipped: number;
            failures?: Array<{ line: number; name: string; reasonText?: string; reason: string }>;
          }>(`/api/v1/classes/${classId}/students/import`, {
            method: 'POST',
            body: JSON.stringify({ csv }),
          })
            .then((r) => {
              const fail = (r.failures ?? [])
                .map((f) => `第${f.line}行 ${f.name} → ${f.reasonText ?? f.reason}`)
                .join('；');
              setImportResult(`新建 ${r.created}，跳过 ${r.skipped}${fail ? `。${fail}` : ''}`);
              return loadStudents();
            })
            .catch((err) => setImportResult(String(err instanceof Error ? err.message : err)))
        }
      >
        从文本导入 CSV
      </button>
      {importResult ? <p className={/失败|错误|无效|损坏/.test(importResult) ? 'error' : 'hint'}>{importResult}</p> : null}

      <h3>当前班名单（{classes.find((c) => c.id === classId)?.name ?? ''}）· 按学号排序</h3>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索姓名/学号" />
      <table className="data-table">
        <thead>
          <tr>
            <th>学号</th>
            <th>姓名</th>
            <th>积分</th>
          </tr>
        </thead>
        <tbody>
          {filteredStudents.map((s) => (
            <tr key={String(s.id)}>
              <td>{String(s.studentNo ?? '—')}</td>
              <td>{String(s.displayName)}</td>
              <td>{String(s.totalPoints)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
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
                编辑原题
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
}: {
  classId: string;
  seed: Record<string, unknown> | null;
  onSaved: () => Promise<void>;
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
      <p className="hint">点列表「编辑原题」加载选项；可改标题/题干/选项后保存。班级 {classId}</p>
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
  const [month, setMonth] = useState(
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
  );
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
  return (
    <section>
      <h2>导出（多格式）</h2>
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
      <p className="hint">学生在花名册点选姓名后提交请求；通过后写入积分。</p>
      {items.length === 0 ? <p>暂无待审请求</p> : null}
      {items.map((item) => (
        <div key={String(item.id)} className="row request-row">
          <span>
            {String(item.studentName)} · {String(item.reason)} · {String(item.points)} 分
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

function MessagesPanel({ classId }: { classId: string }) {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState(true);

  async function load() {
    const [msgs, settings] = await Promise.all([
      api<{ items: Array<Record<string, unknown>> }>(`/api/v1/messages?classId=${classId}`),
      api<{ messagesEnabled: boolean }>('/api/v1/settings'),
    ]);
    setItems(msgs.items);
    setEnabled(settings.messagesEnabled !== false);
  }

  useEffect(() => {
    void load().catch(() => setItems([]));
  }, [classId]);

  return (
    <section>
      <h2>留言</h2>
      <label className="row">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) =>
            void api('/api/v1/settings', {
              method: 'PATCH',
              body: JSON.stringify({ messagesEnabled: e.target.checked }),
            }).then(() => setEnabled(e.target.checked))
          }
        />
        允许学生留言（关闭后学生端隐藏留言并禁止发送）
      </label>
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

  function downloadConfig() {
    const base = apiBase.replace(/\/$/, '');
    if (/127\.0\.0\.1|localhost/i.test(base)) {
      window.alert('禁止使用 127.0.0.1 / localhost，请填教师机局域网 IP');
      return;
    }
    const cfg = {
      apiBase: base,
      classId,
      comment: `本教室 ${klass?.name ?? classId}。学生机专用，禁止 127.0.0.1。`,
    };
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `classroom-${klass?.name ?? 'class'}-config.json`;
    a.click();
    URL.revokeObjectURL(url);
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
        classId：<code>{classId || '（请先选班）'}</code>
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

function SettingsPanel() {
  const [diag, setDiag] = useState('');
  const [ttl, setTtl] = useState(60);
  const [saveMsg, setSaveMsg] = useState('');
  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [pwdMsg, setPwdMsg] = useState('');

  useEffect(() => {
    void api<{ pointRequestTtlMinutes: number }>('/api/v1/settings').then((s) => {
      setTtl(s.pointRequestTtlMinutes);
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

  return (
    <section>
      <h2>设置</h2>
      <button type="button" onClick={() => void runDiag()}>
        一键检测 /health
      </button>
      {diag ? <p className="hint">{diag}</p> : null}

      <h3>教师登录密码</h3>
      <p className="hint">请改成自己的密码（至少 6 位），勿使用联调口令。</p>
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
            })
            .catch((e) => setPwdMsg(e instanceof Error ? e.message : '改密失败'))
        }
      >
        修改登录密码
      </button>
      {pwdMsg ? <p className="hint">{pwdMsg}</p> : null}

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
    </section>
  );
}

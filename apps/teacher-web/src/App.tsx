import { useEffect, useState } from 'react';
import { APP_NAME } from '@classroom-desk/shared';
import { API_BASE, api, getToken, setToken } from './api';

type ClassItem = { id: string; name: string; classCode: string };
type Tab = 'roster' | 'questions' | 'requests' | 'messages' | 'assign' | 'settings';

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

  async function loadStudents() {
    if (!classId) return;
    const r = await api<{ items: Array<Record<string, unknown>> }>(`/api/v1/classes/${classId}/students`);
    setStudents(r.items);
  }

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
    };
    if (!res.ok) throw new Error(data.error ?? 'import_failed');
    const fail = (data.failures ?? [])
      .map((f) => `第${f.line}行 ${f.name} → ${f.reasonText ?? f.reason}`)
      .join('；');
    setImportResult(`新建 ${data.created}，跳过 ${data.skipped}${fail ? `。${fail}` : ''}`);
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
      <input
        type="file"
        accept=".csv,.xlsx,.xls"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importFile(file).catch((err) => setImportResult(String(err.message ?? err)));
        }}
      />
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
          }).then((r) => {
            const fail = (r.failures ?? [])
              .map((f) => `第${f.line}行 ${f.name} → ${f.reasonText ?? f.reason}`)
              .join('；');
            setImportResult(`新建 ${r.created}，跳过 ${r.skipped}${fail ? `。${fail}` : ''}`);
            return loadStudents();
          })
        }
      >
        从文本导入 CSV
      </button>
      {importResult ? <p className="hint">{importResult}</p> : null}

      <h3>当前班名单（{classes.find((c) => c.id === classId)?.name ?? ''}）</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>姓名</th>
            <th>学号</th>
            <th>积分</th>
          </tr>
        </thead>
        <tbody>
          {students.map((s) => (
            <tr key={String(s.id)}>
              <td>{String(s.displayName)}</td>
              <td>{String(s.studentNo ?? '—')}</td>
              <td>{String(s.totalPoints)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
      <h2>发题 / 正确率 · 错误率</h2>
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
              正确率/错误率
            </button>
          </li>
        ))}
      </ul>
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
        <div key={String(item.id)} className="row">
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
  const [apiBase, setApiBase] = useState('http://192.168.1.50:8787');
  const klass = classes.find((c) => c.id === classId);

  function downloadConfig() {
    const cfg = {
      apiBase: apiBase.replace(/\/$/, ''),
      classId,
      comment: `Classroom pack for ${klass?.name ?? classId}. Install on student PCs.`,
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
        每台学生机必须配置教师机局域网地址与本班 <code>classId</code>。不要使用 127.0.0.1。
        可下载配置文件覆盖安装目录 resources/config.json，或在学生端「设置」用管理密码填写。
      </div>
      <p>
        当前班级：<strong>{klass?.name ?? '—'}</strong>
      </p>
      <p>
        classId：<code>{classId || '（请先选班）'}</code>
      </p>
      <label>
        教师机 apiBase
        <input value={apiBase} onChange={(e) => setApiBase(e.target.value)} />
      </label>
      <button type="button" disabled={!classId} onClick={downloadConfig}>
        下载本教室 config.json
      </button>
      <p className="hint">
        打包专用安装包：把下载的 JSON 写入 apps/student-desktop/resources/config.json 后执行 npm run
        dist:win。多教室按 IP/班级分目录存放安装包。
      </p>
      <pre className="code-block">{`{\n  "apiBase": "${apiBase.replace(/\/$/, '')}",\n  "classId": "${classId}"\n}`}</pre>
    </section>
  );
}

function SettingsPanel() {
  const [diag, setDiag] = useState('');
  const [ttl, setTtl] = useState(60);

  useEffect(() => {
    void api<{ pointRequestTtlMinutes: number }>('/api/v1/settings').then((s) =>
      setTtl(s.pointRequestTtlMinutes),
    );
  }, []);

  async function runDiag() {
    const t0 = performance.now();
    try {
      const res = await fetch(`${API_BASE}/health`, { cache: 'no-store' });
      const ms = Math.round(performance.now() - t0);
      const body = (await res.json()) as {
        ok?: boolean;
        backup?: { latestAt?: string | null; lastError?: { message?: string } | null };
      };
      setDiag(
        body.ok
          ? `正常 ${ms}ms · 备份 ${body.backup?.latestAt ?? '无'}${
              body.backup?.lastError ? ` · 错：${body.backup.lastError.message}` : ''
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
      <label>
        加分请求有效期（分钟）
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
        保存
      </button>
      <p className="hint">本地备份：教师机运行 npm run backup:db（暂不依赖 NAS）。</p>
    </section>
  );
}

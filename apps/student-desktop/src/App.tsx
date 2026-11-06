import { useCallback, useEffect, useMemo, useState } from 'react';
import { APP_NAME } from '@classroom-desk/shared';
import {
  ApiOfflineError,
  api,
  getApiBase,
  getToken,
  initApiBase,
  setApiBase,
  setToken,
} from './api';

type TabId = 'points' | 'attendance' | 'quiz' | 'messages' | 'admin';

type User = {
  id: string;
  role: string;
  displayName: string;
  classId: string | null;
  totalPoints: number;
};

type RosterRow = { id: string; displayName: string; studentNo: string | null; totalPoints: number };

const TABS: { id: TabId; label: string }[] = [
  { id: 'points', label: '积分' },
  { id: 'attendance', label: '签到' },
  { id: 'quiz', label: '答题' },
  { id: 'messages', label: '留言' },
  { id: 'admin', label: '设置' },
];

export function App() {
  const [tab, setTab] = useState<TabId>('points');
  const [collapsed, setCollapsed] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [className, setClassName] = useState('');
  const [classId, setClassId] = useState('');
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [messagesEnabled, setMessagesEnabled] = useState(true);
  const [unread, setUnread] = useState(0);
  const [offline, setOffline] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2200);
  }, []);

  const loadRoster = useCallback(async (cid: string) => {
    if (!cid) {
      setRoster([]);
      return;
    }
    const r = await api<{ class: { name: string }; items: RosterRow[] }>(
      `/api/v1/classes/${cid}/roster`,
    );
    setClassName(r.class.name);
    setRoster(r.items);
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const pub = await api<{ messagesEnabled?: boolean }>('/api/v1/settings/public');
      setMessagesEnabled(pub.messagesEnabled !== false);
      if (!getToken()) {
        setUser(null);
        setOffline(false);
        return;
      }
      const me = await api<{ user: User; class: { name: string; id: string } | null }>('/api/v1/auth/me');
      setUser(me.user);
      if (me.class) {
        setClassName(me.class.name);
        setClassId(me.class.id);
      }
      const unreadRes = await api<{ count: number }>('/api/v1/messages/unread-count');
      setUnread(unreadRes.count);
      setOffline(false);
    } catch (e) {
      if (e instanceof ApiOfflineError) setOffline(true);
      else setUser(null);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await initApiBase();
      let cid = '';
      try {
        const cfg = await window.classroomDesk?.getConfig?.();
        cid = String(cfg?.classId ?? '').trim();
        setClassId(cid);
      } catch {
        /* browser */
      }
      if (cid) {
        try {
          await loadRoster(cid);
        } catch {
          /* offline */
        }
      }
      await refreshMe();
      setReady(true);
    })();
  }, [loadRoster, refreshMe]);

  useEffect(() => {
    const t = window.setInterval(() => void refreshMe(), 8000);
    return () => window.clearInterval(t);
  }, [refreshMe]);

  async function selectStudent(row: RosterRow) {
    setError('');
    if (!classId) {
      setError('本机未指派班级，请教师在设置中写入 classId');
      return;
    }
    try {
      const res = await api<{ token: string; user: User; class: { name: string } }>(
        '/api/v1/auth/student-select',
        { method: 'POST', body: JSON.stringify({ classId, studentId: row.id }) },
      );
      setToken(res.token);
      setUser(res.user);
      setClassName(res.class.name);
      showToast(`已选择 ${res.user.displayName}`);
      setTab('points');
      await loadRoster(classId);
      await refreshMe();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'select_failed');
    }
  }

  const meta = useMemo(() => {
    if (!user) return className ? `${className} · 请点选自己的姓名` : '请教师指派班级';
    return `${className || '班级'} · ${user.displayName} · ${user.totalPoints} 分`;
  }, [user, className]);

  async function onToggleCollapse() {
    if (window.classroomDesk) {
      const next = await window.classroomDesk.toggleCollapse();
      setCollapsed(next);
    } else setCollapsed((c) => !c);
  }

  if (!ready) {
    return (
      <div className="shell">
        <p className="hint">加载中…</p>
      </div>
    );
  }

  if (collapsed) {
    return (
      <div className="shell collapsed">
        <header className="titlebar" data-drag>
          <div className="collapsed-meta">
            <span className="brand">{APP_NAME}</span>
            <span className="collapsed-stats">
              {offline ? '离线' : `积分 ${user?.totalPoints ?? '--'}`}
              {unread > 0 && messagesEnabled ? (
                <button
                  type="button"
                  className="badge clickable"
                  data-no-drag
                  aria-label={`未读留言 ${unread}`}
                  onClick={() => {
                    void (async () => {
                      if (window.classroomDesk) {
                        const still = await window.classroomDesk.getCollapsed();
                        if (still) await window.classroomDesk.toggleCollapse();
                      }
                      setCollapsed(false);
                      setTab('messages');
                    })();
                  }}
                >
                  {unread}
                </button>
              ) : null}
            </span>
          </div>
          <button type="button" className="icon-btn" onClick={() => void onToggleCollapse()}>
            展开
          </button>
        </header>
      </div>
    );
  }

  const visibleTabs = TABS.filter((t) => t.id !== 'messages' || messagesEnabled);

  return (
    <div className="shell">
      {offline ? (
        <div className="offline-banner" data-no-drag>
          无法连接服务器（{getApiBase()}）
          <button type="button" className="icon-btn" onClick={() => void refreshMe()}>
            重试
          </button>
        </div>
      ) : null}
      <header className="titlebar" data-drag>
        <div className="titlebar-main">
          <strong className="brand">{APP_NAME}</strong>
          <span className="meta">{meta}</span>
        </div>
        <div className="titlebar-actions" data-no-drag>
          <button type="button" className="icon-btn" onClick={() => void onToggleCollapse()}>
            折叠
          </button>
        </div>
      </header>

      <nav className="tabs" aria-label="主导航">
        {visibleTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? 'tab active' : 'tab'}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.id === 'messages' && unread > 0 ? <span className="badge">{unread}</span> : null}
          </button>
        ))}
      </nav>

      <main className="content">
        {tab === 'points' && (
          <PointsPanel
            roster={roster}
            user={user}
            error={error}
            onSelect={(row) => void selectStudent(row)}
            showToast={showToast}
            onRefresh={() => void loadRoster(classId)}
          />
        )}
        {tab === 'attendance' && user && (
          <AttendanceTab showToast={showToast} classId={classId} />
        )}
        {tab === 'attendance' && !user && <p className="hint">请先在「积分」页点选自己的姓名</p>}
        {tab === 'quiz' && user && <QuizTab onAnswered={showToast} />}
        {tab === 'quiz' && !user && <p className="hint">请先在「积分」页点选自己的姓名</p>}
        {tab === 'messages' && messagesEnabled && user && (
          <MessagesTab onRead={() => void refreshMe()} />
        )}
        {tab === 'admin' && (
          <AdminTab
            classId={classId}
            onSaved={async (next) => {
              setClassId(next.classId);
              await loadRoster(next.classId);
              showToast('本机配置已保存');
            }}
          />
        )}
      </main>

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

function PointsPanel({
  roster,
  user,
  error,
  onSelect,
  showToast,
  onRefresh,
}: {
  roster: RosterRow[];
  user: User | null;
  error: string;
  onSelect: (row: RosterRow) => void;
  showToast: (msg: string) => void;
  onRefresh: () => void;
}) {
  const [q, setQ] = useState('');
  const [reason, setReason] = useState('课堂积极');
  const [points, setPoints] = useState(1);

  const filtered = useMemo(() => {
    const key = q.trim().toLowerCase();
    const list = [...roster].sort((a, b) =>
      String(a.studentNo ?? '').localeCompare(String(b.studentNo ?? ''), 'zh'),
    );
    if (!key) return list;
    return list.filter(
      (r) =>
        r.displayName.toLowerCase().includes(key) ||
        String(r.studentNo ?? '')
          .toLowerCase()
          .includes(key),
    );
  }, [roster, q]);

  async function requestPoints() {
    if (!user) return;
    try {
      await api('/api/v1/point-requests', {
        method: 'POST',
        body: JSON.stringify({
          reason: reason.trim() || '课堂加分',
          category: 'student_request',
          points: Number(points) || 1,
        }),
      });
      showToast('已提交加分请求，等待老师确认');
    } catch (e) {
      showToast(e instanceof Error ? e.message : '请求失败');
    }
  }

  return (
    <section className="panel">
      <h1>积分花名册</h1>
      <p className="hint">按学号排序；搜索姓名/学号后点选自己，再填写分值与理由请求加分。</p>
      {error ? <p className="error">{error}</p> : null}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索姓名或学号" />
      {user ? (
        <div className="card-block">
          <p>
            当前：{user.displayName} · {user.totalPoints} 分
          </p>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="加分理由" />
          <input
            type="number"
            min={1}
            value={points}
            onChange={(e) => setPoints(Number(e.target.value))}
            placeholder="分值"
          />
          <button type="button" className="primary" onClick={() => void requestPoints()}>
            请求加分
          </button>
        </div>
      ) : null}
      <button type="button" className="secondary" onClick={onRefresh}>
        刷新名单
      </button>
      {filtered.length === 0 ? <p>暂无名单，请老师导入 Excel/CSV</p> : null}
      <table className="roster-table">
        <thead>
          <tr>
            <th>学号</th>
            <th>姓名</th>
            <th>积分</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((row) => {
            const mine = user?.id === row.id;
            return (
              <tr
                key={row.id}
                className={mine ? 'roster-row mine' : 'roster-row'}
                onClick={() => onSelect(row)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(row);
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`选择 ${row.displayName}`}
              >
                <td>{row.studentNo || '—'}</td>
                <td>
                  {row.displayName}
                  {mine ? '（我）' : ''}
                </td>
                <td>{row.totalPoints}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function AttendanceTab({
  showToast,
  classId,
}: {
  showToast: (msg: string) => void;
  classId: string;
}) {
  const [status, setStatus] = useState('none');
  const [monthStats, setMonthStats] = useState<{ presentCount: number; sessionCount: number; attendanceRate: number } | null>(
    null,
  );
  const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

  async function load() {
    const st = await api<{ status: string }>('/api/v1/attendance/my-status');
    setStatus(st.status);
    const stats = await api<{ items: Array<{ presentCount: number; sessionCount: number; attendanceRate: number }> }>(
      `/api/v1/attendance/stats?classId=${classId}&month=${month}`,
    );
    setMonthStats(stats.items[0] ?? null);
  }

  useEffect(() => {
    void load().catch(() => undefined);
  }, [classId]);

  async function checkIn() {
    try {
      const r = await api<{ status: string }>('/api/v1/attendance/check-in', {
        method: 'POST',
        body: '{}',
      });
      showToast(r.status === 'late' ? '签到成功（迟到）' : '签到成功');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '签到失败');
    }
  }

  return (
    <section className="panel">
      <h1>签到</h1>
      <p className="hint">今日状态：{status === 'absent' ? '未签到' : status}</p>
      <button type="button" className="primary" disabled={status === 'present' || status === 'late'} onClick={() => void checkIn()}>
        点击签到
      </button>
      {monthStats ? (
        <p className="hint">
          本月出勤 {monthStats.presentCount} / {monthStats.sessionCount} 次 · 出勤率{' '}
          {(monthStats.attendanceRate * 100).toFixed(1)}%
        </p>
      ) : null}
    </section>
  );
}
function AdminTab({
  classId,
  onSaved,
}: {
  classId: string;
  onSaved: (cfg: { apiBase: string; classId: string }) => Promise<void>;
}) {
  const [apiBase, setApiBaseLocal] = useState(getApiBase());
  const [cid, setCid] = useState(classId);
  const [adminPassword, setAdminPassword] = useState('');
  const [msg, setMsg] = useState('');

  async function save() {
    setMsg('');
    try {
      await api('/api/v1/auth/admin-unlock', {
        method: 'POST',
        body: JSON.stringify({ password: adminPassword }),
      });
      await setApiBase(apiBase);
      if (window.classroomDesk?.setConfig) {
        await window.classroomDesk.setConfig({ apiBase, classId: cid });
      }
      await onSaved({ apiBase, classId: cid.trim() });
      setMsg('已保存');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '保存失败');
    }
  }

  return (
    <section className="panel">
      <h1>本机指派（教师）</h1>
      <p className="hint">上课前由教师填写教室服务器地址与班级 ID（从教师后台复制）。</p>
      <label className="field">
        服务器 apiBase
        <input value={apiBase} onChange={(e) => setApiBaseLocal(e.target.value)} placeholder="http://192.168.1.50:8787" />
      </label>
      <label className="field">
        班级 classId
        <input value={cid} onChange={(e) => setCid(e.target.value)} placeholder="从教师后台复制" />
      </label>
      <label className="field">
        管理密码
        <input type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} />
      </label>
      <button type="button" className="primary" onClick={() => void save()}>
        保存本机配置
      </button>
      {msg ? <p className="hint">{msg}</p> : null}
    </section>
  );
}

function MessagesTab({ onRead }: { onRead: () => void }) {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [body, setBody] = useState('');

  async function load() {
    const r = await api<{ items: Array<Record<string, unknown>> }>('/api/v1/messages');
    setItems(r.items);
    for (const msg of r.items) {
      const replies = (msg.replies as Array<{ id: string; readAt?: string | null }>) ?? [];
      for (const reply of replies) {
        if (!reply.readAt) {
          await api(`/api/v1/messages/replies/${reply.id}/read`, { method: 'POST', body: '{}' });
        }
      }
    }
    onRead();
  }

  useEffect(() => {
    void load().catch(() => setItems([]));
  }, []);

  return (
    <section className="panel">
      <h1>留言</h1>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="给老师留言" />
      <button
        type="button"
        className="primary"
        onClick={() =>
          void api('/api/v1/messages', { method: 'POST', body: JSON.stringify({ body }) })
            .then(() => {
              setBody('');
              return load();
            })
            .catch(() => undefined)
        }
      >
        发送
      </button>
      {items.map((msg) => (
        <article key={String(msg.id)} className="card-block">
          <p>{String(msg.body)}</p>
          {((msg.replies as Array<{ body: string }>) ?? []).map((r, i) => (
            <p key={i} className="hint">
              老师：{r.body}
            </p>
          ))}
        </article>
      ))}
    </section>
  );
}

function QuizTab({ onAnswered }: { onAnswered: (msg: string) => void }) {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [multi, setMulti] = useState<Record<string, string[]>>({});
  const [blank, setBlank] = useState<Record<string, string>>({});

  useEffect(() => {
    void api<{ items: Array<Record<string, unknown>> }>('/api/v1/questions')
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, []);

  async function answer(id: string, payload: unknown) {
    const res = await api<{ isCorrect: boolean }>(`/api/v1/questions/${id}/answer`, {
      method: 'POST',
      body: JSON.stringify({ answerPayload: payload }),
    });
    onAnswered(res.isCorrect ? '回答正确' : '回答错误');
  }

  return (
    <section className="panel">
      <h1>答题</h1>
      {items.length === 0 ? <p>暂无题目</p> : null}
      {items.map((q) => {
        const id = String(q.id);
        const type = String(q.type);
        const opts = (q.options as Array<{ id: string; label: string; content: string }>) ?? [];
        return (
          <article key={id} className="card-block">
            <strong>
              [{type}] {String(q.title)}
            </strong>
            <p>{String(q.stem)}</p>
            {type === 'single' || type === 'bool'
              ? opts.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className="secondary"
                    onClick={() => void answer(id, { optionIds: [opt.id] })}
                  >
                    {opt.label}. {opt.content}
                  </button>
                ))
              : null}
            {type === 'multi' ? (
              <>
                {opts.map((opt) => {
                  const selected = (multi[id] ?? []).includes(opt.id);
                  return (
                    <label key={opt.id} className="check">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() =>
                          setMulti((prev) => {
                            const cur = new Set(prev[id] ?? []);
                            if (cur.has(opt.id)) cur.delete(opt.id);
                            else cur.add(opt.id);
                            return { ...prev, [id]: [...cur] };
                          })
                        }
                      />
                      {opt.label}. {opt.content}
                    </label>
                  );
                })}
                <button
                  type="button"
                  className="primary"
                  onClick={() => void answer(id, { optionIds: multi[id] ?? [] })}
                >
                  提交多选
                </button>
              </>
            ) : null}
            {type === 'blank' ? (
              <>
                <input
                  value={blank[id] ?? ''}
                  onChange={(e) => setBlank((prev) => ({ ...prev, [id]: e.target.value }))}
                  placeholder="填空答案"
                />
                <button
                  type="button"
                  className="primary"
                  onClick={() => void answer(id, { text: blank[id] ?? '' })}
                >
                  提交填空
                </button>
              </>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}

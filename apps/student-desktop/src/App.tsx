import { useCallback, useEffect, useMemo, useState } from 'react';
import { APP_NAME, APP_NOTICE, ATTENDANCE_NOTICE } from '@classroom-desk/shared';
import {
  ApiOfflineError,
  api,
  getApiBase,
  getToken,
  initApiBase,
  setApiBase,
  setToken,
} from './api';

type TabId = 'homework' | 'messages' | 'quiz' | 'me';

type User = {
  id: string;
  role: string;
  displayName: string;
  classId: string | null;
  totalPoints: number;
};

type PublicSettings = {
  noticeText: string;
  attendanceNoticeText: string;
  pointRequestTtlMinutes: number;
  pointRequestDailyCleanupTime: string;
};

const TABS: { id: TabId; label: string }[] = [
  { id: 'homework', label: '作业' },
  { id: 'messages', label: '留言' },
  { id: 'quiz', label: '答题' },
  { id: 'me', label: '我的' },
];

const NOTICE_KEY = 'classroom-desk.notice-accepted';

export function App() {
  const [tab, setTab] = useState<TabId>('homework');
  const [collapsed, setCollapsed] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [className, setClassName] = useState('');
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState('');
  const [classCode, setClassCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [toast, setToast] = useState('');
  const [lastPoints, setLastPoints] = useState<number | null>(null);
  const [pointsDelta, setPointsDelta] = useState(0);
  const [offline, setOffline] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2800);
  }, []);

  const refreshMe = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      return;
    }
    try {
      const me = await api<{ user: User; class: { name: string } | null }>('/api/v1/auth/me');
      if (lastPoints != null && me.user.totalPoints !== lastPoints) {
        const delta = me.user.totalPoints - lastPoints;
        setPointsDelta(delta);
        showToast(delta > 0 ? `积分 +${delta}` : `积分 ${delta}`);
      }
      setLastPoints(me.user.totalPoints);
      setUser(me.user);
      setClassName(me.class?.name ?? '');
      const unreadRes = await api<{ count: number }>('/api/v1/messages/unread-count');
      setUnread(unreadRes.count);
      await api('/api/v1/presence/heartbeat', { method: 'POST', body: '{}' });
      if (offline) {
        setOffline(false);
        showToast('已重新连接服务器');
      }
    } catch (e) {
      if (e instanceof ApiOfflineError) {
        setOffline(true);
        return;
      }
      throw e;
    }
  }, [lastPoints, offline, showToast]);

  useEffect(() => {
    const accepted = localStorage.getItem(NOTICE_KEY) === '1';
    setShowNotice(!accepted);
    void initApiBase()
      .then(() => api<PublicSettings>('/api/v1/settings/public'))
      .then((s) => {
        setSettings(s);
        setOffline(false);
      })
      .catch((e) => {
        if (e instanceof ApiOfflineError) setOffline(true);
        setSettings(null);
      });
    void refreshMe().catch(() => {
      setToken(null);
      setUser(null);
    });
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      void refreshMe().catch(() => undefined);
    }, offline ? 5000 : 12000);
    return () => clearInterval(timer);
  }, [user, refreshMe, offline]);

  async function onToggleCollapse() {
    if (!window.classroomDesk) return;
    const next = await window.classroomDesk.toggleCollapse();
    setCollapsed(next);
  }

  async function joinClass() {
    setError('');
    try {
      const res = await api<{ token: string; user: User; class: { name: string } }>(
        '/api/v1/auth/student-join',
        {
          method: 'POST',
          body: JSON.stringify({ classCode, displayName }),
        },
      );
      setToken(res.token);
      setLastPoints(res.user.totalPoints);
      setUser(res.user);
      setClassName(res.class.name);
      showToast('已进入班级');
      await refreshMe();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'join_failed');
    }
  }

  const meta = useMemo(() => {
    if (!user) return '未登录 · 积分 --';
    return `${className || '班级'} · ${user.displayName} · 积分 ${user.totalPoints}`;
  }, [user, className]);

  if (collapsed) {
    return (
      <div className="shell collapsed">
        <header className="titlebar" data-drag>
          <div className="collapsed-meta">
            <span className="brand">{APP_NAME}</span>
            <span className="collapsed-stats">
              {offline ? '离线' : `积分 ${user?.totalPoints ?? '--'}`}
              {pointsDelta !== 0 ? (
                <span className="delta">{pointsDelta > 0 ? `+${pointsDelta}` : pointsDelta}</span>
              ) : null}
              {unread > 0 ? (
                <button
                  type="button"
                  className="badge clickable"
                  data-no-drag
                  title="查看未读留言"
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
          <button type="button" className="icon-btn" onClick={onToggleCollapse}>
            展开
          </button>
        </header>
      </div>
    );
  }

  return (
    <div className="shell">
      {offline ? (
        <div className="offline-banner" data-no-drag>
          无法连接服务器（{getApiBase()}），正在重试…
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
          <button type="button" className="icon-btn" onClick={onToggleCollapse}>
            折叠
          </button>
        </div>
      </header>

      <nav className="tabs" aria-label="主导航">
        {TABS.map((item) => (
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
        {!user ? (
          <section className="panel">
            <h1>班级码进入</h1>
            <p className="hint">由教师提供班级码，填写姓名后进入课堂。</p>
            <label className="field">
              班级码
              <input value={classCode} onChange={(e) => setClassCode(e.target.value)} />
            </label>
            <label className="field">
              姓名
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </label>
            {error ? <p className="error">{error}</p> : null}
            <button type="button" className="primary" onClick={() => void joinClass()}>
              进入
            </button>
          </section>
        ) : (
          <>
            {tab === 'homework' && <HomeworkTab />}
            {tab === 'messages' && <MessagesTab onRead={() => void refreshMe()} />}
            {tab === 'quiz' && <QuizTab onAnswered={showToast} />}
            {tab === 'me' && (
              <MeTab user={user} onPointsChange={() => void refreshMe()} showToast={showToast} />
            )}
          </>
        )}
      </main>

      {toast ? <div className="toast">{toast}</div> : null}

      {showNotice && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h2>使用说明</h2>
            <p>{settings?.noticeText ?? APP_NOTICE}</p>
            <p className="hint">{settings?.attendanceNoticeText ?? ATTENDANCE_NOTICE}</p>
            <button
              type="button"
              className="primary"
              onClick={() => {
                localStorage.setItem(NOTICE_KEY, '1');
                setShowNotice(false);
              }}
            >
              我已知晓
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AttachmentPreview({ url }: { url: string }) {
  const lower = url.toLowerCase();
  const isImage = /\.(png|jpe?g|webp|gif)(\?|$)/.test(lower);
  const isPdf = /\.pdf(\?|$)/.test(lower);
  return (
    <div className="preview">
      <a className="link" href={url} target="_blank" rel="noreferrer">
        打开附件
      </a>
      {isImage ? <img src={url} alt="作业附件" className="preview-media" /> : null}
      {isPdf ? <iframe title="pdf-preview" src={url} className="preview-media pdf" /> : null}
    </div>
  );
}

function HomeworkTab() {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [note, setNote] = useState<Record<string, string>>({});

  useEffect(() => {
    void api<{ items: Array<Record<string, unknown>> }>('/api/v1/assignments')
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, []);

  async function submit(id: string) {
    await api(`/api/v1/assignments/${id}/submit`, {
      method: 'POST',
      body: JSON.stringify({ note: note[id] ?? '' }),
    });
    const r = await api<{ items: Array<Record<string, unknown>> }>('/api/v1/assignments');
    setItems(r.items);
  }

  return (
    <section className="panel">
      <h1>作业</h1>
      {items.length === 0 ? <p>暂无作业</p> : null}
      {items.map((item) => {
        const id = String(item.id);
        const submission = item.mySubmission as { status?: string } | null;
        const attachmentUrl = item.attachmentUrl ? String(item.attachmentUrl) : '';
        return (
          <article key={id} className="card-block">
            <strong>{String(item.title)}</strong>
            <p>{String(item.description ?? '')}</p>
            {attachmentUrl ? <AttachmentPreview url={`${getApiBase()}${attachmentUrl}`} /> : null}
            <p className="hint">状态：{submission?.status ?? '未提交'}</p>
            <input
              placeholder="提交说明"
              value={note[id] ?? ''}
              onChange={(e) => setNote((prev) => ({ ...prev, [id]: e.target.value }))}
            />
            <button type="button" className="secondary" onClick={() => void submit(id)}>
              提交
            </button>
          </article>
        );
      })}
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

  async function send() {
    await api('/api/v1/messages', { method: 'POST', body: JSON.stringify({ body }) });
    setBody('');
    await load();
  }

  return (
    <section className="panel">
      <h1>留言</h1>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="向教师提问…" />
      <button type="button" className="primary" onClick={() => void send()}>
        发送
      </button>
      {items.map((msg) => (
        <article key={String(msg.id)} className="card-block">
          <p>{String(msg.body)}</p>
          <p className="hint">{String(msg.createdAt)}</p>
          {((msg.replies as Array<{ id: string; body: string }>) ?? []).map((r) => (
            <p key={r.id} className="reply">
              教师回复：{r.body}
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
      body: JSON.stringify({ answer: payload }),
    });
    onAnswered(res.isCorrect ? '回答正确' : '回答错误');
    const r = await api<{ items: Array<Record<string, unknown>> }>('/api/v1/questions');
    setItems(r.items);
  }

  return (
    <section className="panel">
      <h1>答题</h1>
      {items.map((q) => {
        const id = String(q.id);
        const type = String(q.type);
        const options = (q.options as Array<{ id: string; label: string; content: string }>) ?? [];
        const mine = q.myAnswer as { isCorrect?: number } | null;
        return (
          <article key={id} className="card-block">
            <strong>
              [{type}] {String(q.title)}
            </strong>
            <p>{String(q.stem)}</p>
            {mine ? (
              <p className="hint">{mine.isCorrect ? '回答正确' : '回答错误'}</p>
            ) : (
              <>
                {(type === 'single' || type === 'bool') &&
                  options.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className="secondary"
                      onClick={() => void answer(id, { optionId: opt.id })}
                    >
                      {opt.label}. {opt.content}
                    </button>
                  ))}
                {type === 'multi' && (
                  <>
                    {options.map((opt) => {
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
                )}
                {type === 'blank' && (
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
                )}
              </>
            )}
          </article>
        );
      })}
    </section>
  );
}

function MeTab({
  user,
  onPointsChange,
  showToast,
}: {
  user: User;
  onPointsChange: () => void;
  showToast: (msg: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [points, setPoints] = useState(1);
  const [pending, setPending] = useState<Array<Record<string, unknown>>>([]);
  const [attendance, setAttendance] = useState<Record<string, unknown> | null>(null);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminMsg, setAdminMsg] = useState('');
  const [serverUrl, setServerUrl] = useState(getApiBase());

  async function load() {
    const [req, att] = await Promise.all([
      api<{ items: Array<Record<string, unknown>> }>('/api/v1/point-requests/pending'),
      api<Record<string, unknown>>('/api/v1/attendance/my-status'),
    ]);
    setPending(req.items);
    setAttendance(att);
  }

  useEffect(() => {
    void load().catch(() => undefined);
    const t = setInterval(() => void load().catch(() => undefined), 5000);
    return () => clearInterval(t);
  }, []);

  async function requestPoints() {
    await api('/api/v1/point-requests', {
      method: 'POST',
      body: JSON.stringify({ reason, category: 'student_request', points }),
    });
    setReason('');
    showToast('已提交加分请求');
    await load();
    onPointsChange();
  }

  async function checkIn() {
    const session = attendance?.session as { id?: string } | null;
    if (!session?.id) return;
    await api(`/api/v1/attendance/sessions/${session.id}/check-in`, { method: 'POST', body: '{}' });
    showToast('签到成功');
    await load();
  }

  async function adminAction(action: 'quit' | 'disable-autostart' | 'uninstall') {
    setAdminMsg('');
    try {
      await api('/api/v1/auth/admin-unlock', {
        method: 'POST',
        body: JSON.stringify({ password: adminPassword }),
      });
      if (!window.classroomDesk) {
        setAdminMsg('仅桌面端可用');
        return;
      }
      if (action === 'quit') await window.classroomDesk.adminQuit();
      if (action === 'disable-autostart') {
        await window.classroomDesk.setAutostart(false);
        setAdminMsg('已关闭开机自启');
      }
      if (action === 'uninstall') {
        const result = await window.classroomDesk.openUninstallGuide();
        setAdminMsg(
          result.platform === 'win32'
            ? '已打开 Windows「应用和功能」，请搜索 Classroom Desk 正常卸载（无防卸载）。'
            : '请在系统应用目录中卸载本程序。',
        );
      }
    } catch (e) {
      setAdminMsg(e instanceof Error ? e.message : 'admin_failed');
    }
  }

  return (
    <section className="panel">
      <h1>我的</h1>
      <p>积分：{user.totalPoints}</p>
      <p className="hint">签到状态：{String(attendance?.status ?? 'none')}</p>
      {attendance?.session ? (
        <button type="button" className="secondary" onClick={() => void checkIn()}>
          签到
        </button>
      ) : null}

      <h2>请求加分</h2>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="理由" />
      <input
        type="number"
        value={points}
        onChange={(e) => setPoints(Number(e.target.value))}
        placeholder="分值"
      />
      <button type="button" className="primary" onClick={() => void requestPoints()}>
        提交请求
      </button>
      {pending.map((p) => (
        <p key={String(p.id)} className="hint">
          待确认：{String(p.reason)} · 倒计时 {String(p.countdownSeconds)}s
        </p>
      ))}

      <h2>管理员</h2>
      <p className="hint">学生界面无退出按钮；仅管理员密码可退出、关自启、改服务器地址或打开系统卸载页。</p>
      <input
        type="password"
        value={adminPassword}
        onChange={(e) => setAdminPassword(e.target.value)}
        placeholder="管理员密码"
      />
      <input
        value={serverUrl}
        onChange={(e) => setServerUrl(e.target.value)}
        placeholder="服务器地址 http://10.0.0.5:8787"
      />
      <button
        type="button"
        className="secondary"
        onClick={() =>
          void (async () => {
            await api('/api/v1/auth/admin-unlock', {
              method: 'POST',
              body: JSON.stringify({ password: adminPassword }),
            });
            await setApiBase(serverUrl);
            setAdminMsg(`服务器地址已保存：${getApiBase()}`);
          })().catch((e) => setAdminMsg(e instanceof Error ? e.message : 'failed'))
        }
      >
        管理员保存服务器地址
      </button>
      <button type="button" className="secondary" onClick={() => void adminAction('quit')}>
        管理员退出程序
      </button>
      <button type="button" className="secondary" onClick={() => void adminAction('disable-autostart')}>
        管理员关闭开机自启
      </button>
      <button type="button" className="secondary" onClick={() => void adminAction('uninstall')}>
        管理员打开卸载引导
      </button>
      {adminMsg ? <p className="hint">{adminMsg}</p> : null}
    </section>
  );
}

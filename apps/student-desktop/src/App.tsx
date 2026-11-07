import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { APP_NAME } from '@classroom-desk/shared';
import {
  ApiOfflineError,
  api,
  getApiBase,
  getToken,
  initApiBase,
  isSessionEndedError,
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
  { id: 'points', label: '首页' },
  { id: 'attendance', label: '签到' },
  { id: 'quiz', label: '答题' },
  { id: 'messages', label: '留言' },
  { id: 'admin', label: '设置' },
];

function countOpenUnanswered(items: Array<Record<string, unknown>>): number {
  return items.filter((q) => {
    const mine = q.myAnswer as { answeredAt?: string } | null | undefined;
    return Boolean(q.acceptingAnswers) && !mine?.answeredAt;
  }).length;
}

function questionTypeZh(type: string): string {
  const map: Record<string, string> = {
    single: '单选',
    multi: '多选',
    bool: '判断',
    blank: '填空',
  };
  return map[type] ?? type;
}

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
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [healthDetail, setHealthDetail] = useState('');
  const [newQuizPulse, setNewQuizPulse] = useState(false);
  const [openQuizCount, setOpenQuizCount] = useState(0);
  const [pendingIdentity, setPendingIdentity] = useState<RosterRow | null>(null);
  const [switchIdentity, setSwitchIdentity] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [gateAdmin, setGateAdmin] = useState(false);
  const [needsFirstRun, setNeedsFirstRun] = useState(false);
  const [exitAllowed, setExitAllowed] = useState(false);
  const [exitUnlockUntil, setExitUnlockUntil] = useState<string | null>(null);
  const [quizConfirmSubmit, setQuizConfirmSubmit] = useState(true);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const knownQuestionIdsRef = useRef(new Set<string>());

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2200);
  }, []);

  const syncExitLock = useCallback(async (allowed: boolean) => {
    setExitAllowed(allowed);
    if (window.classroomDesk?.setExitAllowed) {
      const st = await window.classroomDesk.setExitAllowed(allowed);
      setExitAllowed(Boolean(st.exitAllowed));
    }
  }, []);

  useEffect(() => {
    if (!window.classroomDesk?.onBlockedClose) return;
    return window.classroomDesk.onBlockedClose(() => {
      showToast('课堂锁定中，找老师或输入解除码');
      setTab('admin');
    });
  }, [showToast]);

  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // Real-time exit-lock: WebSocket first; on close/error → SSE + toast; poll remains backup.
  useEffect(() => {
    if (!ready || healthOk === false) return;
    const base = getApiBase().replace(/\/$/, '');
    if (!base) return;
    let closed = false;
    let ws: WebSocket | null = null;
    let es: EventSource | null = null;
    let usingSse = false;

    function applyPayload(raw: unknown) {
      try {
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!data || data.type !== 'exit_lock') return;
        setExitUnlockUntil(data.clientExitUnlockUntil ?? null);
        void syncExitLock(data.clientExitAllowed === true);
      } catch {
        /* ignore */
      }
    }

    function startSse(reason: string) {
      if (closed || usingSse) return;
      usingSse = true;
      showToast(`实时通道已切到备用（${reason}）`);
      es = new EventSource(`${base}/api/v1/exit-lock/stream`);
      es.onmessage = (ev) => applyPayload(ev.data);
      es.onerror = () => {
        /* EventSource auto-reconnects; keep silent */
      };
    }

    try {
      const wsUrl = base.replace(/^http/i, 'ws') + '/api/v1/exit-lock/ws';
      ws = new WebSocket(wsUrl);
      ws.onmessage = (ev) => applyPayload(ev.data);
      ws.onopen = () => {
        /* connected */
      };
      const failOver = () => {
        if (closed) return;
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
        ws = null;
        startSse('WebSocket 断开');
      };
      ws.onerror = failOver;
      ws.onclose = () => {
        if (!closed && !usingSse) startSse('WebSocket 关闭');
      };
    } catch {
      startSse('WebSocket 不可用');
    }

    return () => {
      closed = true;
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      es?.close();
    };
  }, [ready, healthOk, syncExitLock, showToast]);

  const announceNewQuestions = useCallback(
    (items: Array<Record<string, unknown>>) => {
      const known = knownQuestionIdsRef.current;
      if (known.size === 0) {
        for (const q of items) known.add(String(q.id));
        return false;
      }
      const fresh = items.filter((q) => {
        const id = String(q.id);
        const mine = q.myAnswer as { answeredAt?: string } | null;
        const open = Boolean(q.acceptingAnswers) && !mine?.answeredAt;
        return open && !known.has(id);
      });
      for (const q of items) known.add(String(q.id));
      if (fresh.length === 0) return false;
      playNewQuestionChime();
      setNewQuizPulse(true);
      window.setTimeout(() => setNewQuizPulse(false), 1800);
      showToast(`新题：${String(fresh[0]?.title ?? '')}`);
      return true;
    },
    [showToast],
  );

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
      const pub = await api<{
        messagesEnabled?: boolean;
        quizConfirmSubmit?: boolean;
        clientExitAllowed?: boolean;
        clientExitUnlockUntil?: string | null;
      }>('/api/v1/settings/public');
      setMessagesEnabled(pub.messagesEnabled !== false);
      setQuizConfirmSubmit(pub.quizConfirmSubmit !== false);
      setExitUnlockUntil(pub.clientExitUnlockUntil ?? null);
      await syncExitLock(pub.clientExitAllowed === true);
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
      try {
        await api('/api/v1/presence/heartbeat', { method: 'POST', body: '{}' });
      } catch {
        /* optional */
      }
      const unreadRes = await api<{ count: number }>('/api/v1/messages/unread-count');
      setUnread(unreadRes.count);
      setOffline(false);
    } catch (e) {
      if (e instanceof ApiOfflineError) setOffline(true);
      else {
        if (isSessionEndedError(e)) {
          setToken(null);
          const msg = e instanceof Error ? e.message : '请重新选择身份';
          setToast(msg);
          window.setTimeout(() => setToast(''), 2200);
        }
        setUser(null);
      }
    }
  }, [syncExitLock]);

  const probeHealth = useCallback(async () => {
    const base = getApiBase();
    const t0 = performance.now();
    try {
      const res = await fetch(`${base}/health`, { cache: 'no-store' });
      const ms = Math.round(performance.now() - t0);
      if (!res.ok) {
        setHealthOk(false);
        setHealthDetail(`HTTP ${res.status}（${ms}ms）· ${base}`);
        return false;
      }
      const body = (await res.json()) as { ok?: boolean };
      if (!body.ok) {
        setHealthOk(false);
        setHealthDetail(`服务未就绪（${ms}ms）· ${base}`);
        return false;
      }
      setHealthOk(true);
      setHealthDetail(`正常 ${ms}ms · ${base}`);
      return true;
    } catch (e) {
      setHealthOk(false);
      setHealthDetail(`${e instanceof Error ? e.message : '无法连接'} · ${base}`);
      return false;
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await initApiBase();
      let cid = '';
      let firstRun = false;
      try {
        const desk = window.classroomDesk;
        const cfg = desk?.getConfig ? await desk.getConfig() : null;
        cid = String(cfg?.classId ?? '').trim();
        const apiBase = String(cfg?.apiBase ?? getApiBase()).replace(/\/$/, '');
        // First-run wizard only on Electron (can write userData/config.json).
        firstRun = Boolean(desk?.setConfig) && needsLocalConfigSetup(apiBase, cid);
        setClassId(cid);
      } catch {
        /* browser preview: skip first-run gate */
      }
      setNeedsFirstRun(firstRun);
      if (firstRun) {
        setReady(true);
        return;
      }
      const ok = await probeHealth();
      if (ok) {
        if (cid) {
          try {
            await loadRoster(cid);
          } catch {
            /* offline */
          }
        }
        await refreshMe();
      }
      setReady(true);
    })();
  }, [loadRoster, refreshMe, probeHealth]);

  useEffect(() => {
    const t = window.setInterval(() => void refreshMe(), 8000);
    return () => window.clearInterval(t);
  }, [refreshMe]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function pollQuestions() {
      try {
        const r = await api<{ items: Array<Record<string, unknown>> }>('/api/v1/questions');
        if (cancelled) return;
        setOpenQuizCount(countOpenUnanswered(r.items));
        announceNewQuestions(r.items);
      } catch {
        /* offline */
      }
    }
    void pollQuestions();
    const t = window.setInterval(() => void pollQuestions(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [user, announceNewQuestions]);

  useEffect(() => {
    if (!user) setOpenQuizCount(0);
  }, [user]);

  function beginSwitch() {
    setError('');
    setPendingIdentity(null);
    setGateAdmin(false);
    setSwitchIdentity(true);
  }

  async function expandCollapsed() {
    if (window.classroomDesk) {
      const still = await window.classroomDesk.getCollapsed();
      if (still) await window.classroomDesk.toggleCollapse();
    }
    setCollapsed(false);
  }

  async function expandTo(next: TabId) {
    await expandCollapsed();
    setSwitchIdentity(false);
    setPendingIdentity(null);
    setTab(next);
  }

  async function selectStudent(row: RosterRow) {
    setError('');
    if (!classId) {
      setError('本机未指派班级，请老师在「教师设置」里填写班级');
      return;
    }
    if (selecting) return;
    setSelecting(true);
    try {
      const res = await api<{ token: string; user: User; class: { name: string } }>(
        '/api/v1/auth/student-select',
        { method: 'POST', body: JSON.stringify({ classId, studentId: row.id }) },
      );
      setToken(res.token);
      setUser(res.user);
      setClassName(res.class.name);
      setPendingIdentity(null);
      setSwitchIdentity(false);
      setGateAdmin(false);
      showToast(`已选择 ${res.user.displayName}`);
      let openCount = 0;
      try {
        const qs = await api<{ items: Array<Record<string, unknown>> }>('/api/v1/questions');
        openCount = countOpenUnanswered(qs.items);
        setOpenQuizCount(openCount);
        for (const q of qs.items) knownQuestionIdsRef.current.add(String(q.id));
      } catch {
        setOpenQuizCount(0);
      }
      setTab(openCount > 0 ? 'quiz' : 'points');
      await loadRoster(classId);
      await refreshMe();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'select_failed');
    } finally {
      setSelecting(false);
    }
  }

  const meta = useMemo(() => {
    if (!user) return className ? `${className} · 请点选自己的姓名` : '请老师指派班级';
    return className ? `${className} · ${user.totalPoints} 分` : `${user.totalPoints} 分`;
  }, [user, className]);

  const exitLockLabel = useMemo(() => {
    void nowTick;
    if (!exitAllowed) return '已锁定';
    if (exitUnlockUntil) {
      const left = Math.max(0, Date.parse(exitUnlockUntil) - Date.now());
      if (left <= 0) return '已锁定';
      const sec = Math.ceil(left / 1000);
      const m = Math.floor(sec / 60);
      const s = String(sec % 60).padStart(2, '0');
      return `可退出 ${m}:${s}`;
    }
    return '可退出';
  }, [exitAllowed, exitUnlockUntil, nowTick]);

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
      <div className={`shell collapsed${newQuizPulse ? ' quiz-flash' : ''}`}>
        <header className="titlebar" data-drag>
          <div className="collapsed-meta">
            <span className="brand">{APP_NAME}</span>
            <span className="collapsed-stats">
              <span
                className={exitAllowed ? 'lock-badge unlocked' : 'lock-badge'}
                title="退出锁定状态"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {exitLockLabel}
              </span>
              {user ? (
                <button
                  type="button"
                  className="identity-chip"
                  data-no-drag
                  aria-label={`当前身份 ${user.displayName}，更换需确认`}
                  onClick={() => void expandCollapsed().then(() => beginSwitch())}
                >
                  <span className="chip-name">{user.displayName}</span>
                </button>
              ) : null}
              {offline ? '离线' : user ? `${user.totalPoints} 分` : '未登录'}
              {openQuizCount > 0 ? (
                <button
                  type="button"
                  className={`badge clickable unanswered-badge${newQuizPulse ? ' quiz-badge' : ''}`}
                  data-no-drag
                  aria-label={`未答 ${openQuizCount}`}
                  onClick={() => void expandTo('quiz')}
                >
                  未答 {openQuizCount}
                </button>
              ) : null}
              {unread > 0 && messagesEnabled ? (
                <button
                  type="button"
                  className="badge clickable"
                  data-no-drag
                  aria-label={`未读留言 ${unread}`}
                  onClick={() => void expandTo('messages')}
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

  if (ready && needsFirstRun) {
    return (
      <div className="shell">
        <header className="titlebar" data-drag>
          <div className="titlebar-main">
            <strong className="brand">{APP_NAME}</strong>
            <span className="meta">首次配置</span>
          </div>
        </header>
        <main className="content" data-no-drag>
          <FirstRunSetup
            onDone={async (next) => {
              setClassId(next.classId);
              setNeedsFirstRun(false);
              const ok = await probeHealth();
              if (ok) {
                try {
                  await loadRoster(next.classId);
                } catch {
                  /* roster may be empty */
                }
                await refreshMe();
              }
            }}
          />
        </main>
      </div>
    );
  }

  if (ready && healthOk === false) {
    return (
      <div className="shell">
        <header className="titlebar" data-drag>
          <div className="titlebar-main">
            <strong className="brand">{APP_NAME}</strong>
            <span className="meta">请找老师</span>
          </div>
        </header>
        <main className="content" data-no-drag>
          <section className="panel">
            <h1>连不上老师电脑</h1>
            <p className="lead">请找老师检查电脑和网络</p>
            <button
              type="button"
              className="primary"
              onClick={() =>
                void probeHealth().then(async (ok) => {
                  if (!ok) return;
                  if (classId) {
                    try {
                      await loadRoster(classId);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : '名单加载失败');
                    }
                  }
                  await refreshMe();
                })
              }
            >
              重试
            </button>
            <details className="teacher-debug">
              <summary>教师调试</summary>
              <p className="hint">{healthDetail}</p>
              <label className="field">
                临时改 apiBase（连通后再到设置里保存）
                <input
                  defaultValue={getApiBase()}
                  id="health-api-base"
                  placeholder="http://192.168.1.50:8787"
                />
              </label>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  const el = document.getElementById('health-api-base') as HTMLInputElement | null;
                  const next = String(el?.value ?? '').trim().replace(/\/$/, '');
                  if (!next) return;
                  void setApiBase(next).then(() => probeHealth());
                }}
              >
                应用并重测
              </button>
            </details>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="shell">
      {offline ? (
        <div className="offline-banner" data-no-drag>
          断线了 · 查网线 / 同一 Wi‑Fi · 找老师
          <button type="button" className="icon-btn" onClick={() => void refreshMe()}>
            重连
          </button>
        </div>
      ) : null}
      <header className="titlebar" data-drag>
        <div className="titlebar-main">
          <div className="titlebar-row">
            <strong className="brand">{APP_NAME}</strong>
          <span
            className={`lock-badge${exitAllowed ? ' unlocked' : ''}`}
            title="退出锁定状态"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {exitLockLabel}
          </span>
            {user ? (
              <button
                type="button"
                className="identity-chip"
                data-no-drag
                aria-label={`当前身份 ${user.displayName}，更换需确认`}
                onClick={beginSwitch}
              >
                <span className="chip-name">{user.displayName}</span>
                <span className="chip-action">换人</span>
              </button>
            ) : null}
          </div>
          <span className="meta">{meta}</span>
        </div>
        <div className="titlebar-actions" data-no-drag>
          <button type="button" className="icon-btn" onClick={() => void onToggleCollapse()}>
            折叠
          </button>
        </div>
      </header>

      {!user || switchIdentity ? (
        <main className="content" data-no-drag>
          {gateAdmin && !switchIdentity ? (
            <>
              <button type="button" className="secondary" onClick={() => setGateAdmin(false)}>
                返回选姓名
              </button>
              <AdminTab
                classId={classId}
                className={className}
                user={user}
                exitAllowed={exitAllowed}
                onExitAllowed={() => void syncExitLock(true)}
                onSwitchIdentity={beginSwitch}
                onSaved={async (next) => {
                  setClassId(next.classId);
                  await loadRoster(next.classId);
                  showToast('本机配置已保存');
                  await probeHealth();
                  await refreshMe();
                }}
              />
            </>
          ) : (
            <IdentityGate
              roster={roster}
              className={className}
              classId={classId}
              error={error}
              pending={pendingIdentity}
              selecting={selecting}
              switching={switchIdentity}
              onPick={setPendingIdentity}
              onConfirm={() => {
                if (pendingIdentity) void selectStudent(pendingIdentity);
              }}
              onCancelPending={() => setPendingIdentity(null)}
              onRefresh={() => void loadRoster(classId)}
              onOpenAdmin={() => {
                setPendingIdentity(null);
                setGateAdmin(true);
                setSwitchIdentity(false);
              }}
              onCancelSwitch={() => {
                setPendingIdentity(null);
                setSwitchIdentity(false);
              }}
            />
          )}
        </main>
      ) : (
        <>
          <nav className="tabs" aria-label="主导航">
            {visibleTabs.map((item) => (
              <button
                key={item.id}
                type="button"
                className={tab === item.id ? 'tab active' : 'tab'}
                onClick={() => setTab(item.id)}
              >
                {item.label}
                {item.id === 'quiz' && openQuizCount > 0 ? (
                  <span className="badge" aria-label={`未答 ${openQuizCount}`}>
                    {openQuizCount}
                  </span>
                ) : null}
                {item.id === 'messages' && unread > 0 ? <span className="badge">{unread}</span> : null}
              </button>
            ))}
          </nav>

          <main className="content">
            {tab === 'points' && (
              <HomePanel
                user={user}
                openQuizCount={openQuizCount}
                showToast={showToast}
                onGoAttendance={() => setTab('attendance')}
                onGoQuiz={() => setTab('quiz')}
              />
            )}
            {tab === 'attendance' && <AttendanceTab showToast={showToast} classId={classId} />}
            {tab === 'quiz' && (
              <QuizTab
                onAnswered={showToast}
                onOpenCount={setOpenQuizCount}
                confirmSubmit={quizConfirmSubmit}
              />
            )}
            {tab === 'messages' && messagesEnabled && (
              <MessagesTab userId={user.id} roster={roster} onRead={() => void refreshMe()} />
            )}
            {tab === 'admin' && (
              <AdminTab
                classId={classId}
                className={className}
                user={user}
                exitAllowed={exitAllowed}
                onExitAllowed={() => void syncExitLock(true)}
                onSwitchIdentity={beginSwitch}
                onSaved={async (next) => {
                  setClassId(next.classId);
                  await loadRoster(next.classId);
                  showToast('本机配置已保存');
                  await probeHealth();
                  await refreshMe();
                }}
              />
            )}
          </main>
        </>
      )}

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

function needsLocalConfigSetup(apiBase: string, classId: string): boolean {
  const base = apiBase.replace(/\/$/, '');
  if (!classId.trim()) return true;
  if (/127\.0\.0\.1|localhost/i.test(base)) return true;
  if (/YOUR_TEACHER_LAN_IP|YOUR_CLASS_ID/i.test(`${base} ${classId}`)) return true;
  return false;
}

function FirstRunSetup({
  onDone,
}: {
  onDone: (cfg: { apiBase: string; classId: string }) => Promise<void>;
}) {
  const [serverUrl, setServerUrl] = useState('');
  const [seat, setSeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function saveAndProbe() {
    setMsg('');
    const apiBase = serverUrl.trim().replace(/\/$/, '');
    const classId = seat.trim();
    if (!/^https?:\/\/[^/\s]+/i.test(apiBase)) {
      setMsg('请填写完整服务器地址，例如 http://192.168.1.50:8787');
      return;
    }
    if (/127\.0\.0\.1|localhost/i.test(apiBase)) {
      setMsg('学生机不可使用 127.0.0.1 / localhost，请填教师机局域网 IP');
      return;
    }
    if (!classId) {
      setMsg('请填写机位班级 ID（教师后台「指派学生机」复制的 classId）');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/health`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`健康检查失败 HTTP ${res.status}`);
      const body = (await res.json()) as { ok?: boolean; version?: string };
      if (!body.ok) throw new Error('服务未就绪（/health ok=false）');
      await setApiBase(apiBase);
      if (window.classroomDesk?.setConfig) {
        await window.classroomDesk.setConfig({ apiBase, classId });
      }
      setMsg(`已写入本机 config.json · 服务端 v${body.version ?? '—'} · 连通正常`);
      await onDone({ apiBase, classId });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '保存或连通失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h1>首次配置本机</h1>
      <p className="lead">安装后由老师填写本教室服务器与机位班级，写入本机 config.json 并校验连通。</p>
      <label className="field">
        服务器地址（serverUrl / apiBase）
        <input
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
          placeholder="http://教师机局域网IP:8787"
          autoComplete="off"
        />
      </label>
      <label className="field">
        机位班级（seat / classId）
        <input
          value={seat}
          onChange={(e) => setSeat(e.target.value)}
          placeholder="从教师后台「复制 classId」粘贴"
          autoComplete="off"
        />
      </label>
      <button type="button" className="primary" disabled={busy} onClick={() => void saveAndProbe()}>
        {busy ? '检测中…' : '保存并检测 /health'}
      </button>
      {msg ? <p className="hint">{msg}</p> : null}
      <p className="hint">禁止 127.0.0.1。配置保存在本机用户目录 config.json，可随时在「设置」修改。</p>
    </section>
  );
}

function statusZh(status: string): string {
  const map: Record<string, string> = {
    none: '无场次',
    absent: '未签到',
    present: '已到',
    late: '迟到',
    excused: '请假',
  };
  return map[status] ?? status;
}

function IdentityGate({
  roster,
  className,
  classId,
  error,
  pending,
  selecting,
  switching,
  onPick,
  onConfirm,
  onCancelPending,
  onRefresh,
  onOpenAdmin,
  onCancelSwitch,
}: {
  roster: RosterRow[];
  className: string;
  classId: string;
  error: string;
  pending: RosterRow | null;
  selecting: boolean;
  switching: boolean;
  onPick: (row: RosterRow) => void;
  onConfirm: () => void;
  onCancelPending: () => void;
  onRefresh: () => void;
  onOpenAdmin: () => void;
  onCancelSwitch: () => void;
}) {
  const [q, setQ] = useState('');
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

  return (
    <section className="panel identity-gate">
      <h1>{switching ? '更换身份' : '你是谁？'}</h1>
      <p className="hint">
        {className
          ? `${className} · 点自己的姓名，再点确认`
          : classId
            ? '点自己的姓名，再点确认'
            : '本机还没有班级，请老师先配置'}
      </p>
      {error ? <p className="error">{error}</p> : null}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索姓名或学号" />
      {pending ? (
        <div className="confirm-bar">
          <p>
            是 {pending.displayName}
            {pending.studentNo ? `（${pending.studentNo}）` : ''} 吗？
          </p>
          <button type="button" className="primary" disabled={selecting} onClick={onConfirm}>
            {selecting ? '确认中…' : '确认是我'}
          </button>
          <button type="button" className="secondary" disabled={selecting} onClick={onCancelPending}>
            重选
          </button>
        </div>
      ) : null}
      <button type="button" className="secondary" onClick={onRefresh}>
        刷新名单
      </button>
      {filtered.length === 0 ? <p className="hint">暂无名单 · 找老师导入名单</p> : null}
      <div className="identity-list">
        {filtered.map((row) => (
          <button
            key={row.id}
            type="button"
            className={pending?.id === row.id ? 'identity-btn selected' : 'identity-btn'}
            onClick={() => onPick(row)}
            aria-pressed={pending?.id === row.id}
          >
            <span>{row.displayName}</span>
            <span className="identity-no">{row.studentNo || '无学号'}</span>
          </button>
        ))}
      </div>
      {switching ? (
        <button type="button" className="secondary" onClick={onCancelSwitch}>
          取消更换
        </button>
      ) : (
        <button type="button" className={classId ? 'link-btn' : 'primary'} onClick={onOpenAdmin}>
          教师设置
        </button>
      )}
    </section>
  );
}

function HomePanel({
  user,
  openQuizCount,
  showToast,
  onGoAttendance,
  onGoQuiz,
}: {
  user: User;
  openQuizCount: number;
  showToast: (msg: string) => void;
  onGoAttendance: () => void;
  onGoQuiz: () => void;
}) {
  const [showPoints, setShowPoints] = useState(false);
  const [reason, setReason] = useState('');
  const [points, setPoints] = useState(1);
  const [busy, setBusy] = useState(false);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [myMonthPoints, setMyMonthPoints] = useState<number | null>(null);
  const [rankMonth, setRankMonth] = useState('');

  useEffect(() => {
    if (!showPoints || !user.classId) return;
    let cancelled = false;
    void api<{
      month: string;
      label?: string;
      myRank: number | null;
      myMonthPoints: number;
    }>(`/api/v1/points/leaderboard?classId=${user.classId}&period=month`)
      .then((r) => {
        if (cancelled) return;
        setMyRank(r.myRank);
        setMyMonthPoints(r.myMonthPoints);
        setRankMonth(r.label ?? r.month);
      })
      .catch((e) => {
        if (cancelled) return;
        setMyRank(null);
        setMyMonthPoints(null);
        showToast(e instanceof Error ? e.message : '积分排行加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [showPoints, user.classId, user.totalPoints, showToast]);

  async function requestPoints() {
    const pts = Math.trunc(Number(points));
    if (!Number.isFinite(pts) || pts < 1) {
      showToast('分值至少为 1');
      return;
    }
    setBusy(true);
    try {
      await api('/api/v1/point-requests', {
        method: 'POST',
        body: JSON.stringify({
          reason: reason.trim(),
          category: 'student_request',
          points: pts,
        }),
      });
      setReason('');
      setPoints(1);
      showToast('已提交，等待老师确认');
    } catch (e) {
      showToast(e instanceof Error ? e.message : '请求失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h1>你好，{user.displayName}</h1>
      <p className="hint">
        {openQuizCount > 0 ? `还有 ${openQuizCount} 道题没答` : '选一个下一步'}
      </p>
      <button type="button" className="primary" onClick={onGoAttendance}>
        去签到
      </button>
      <button type="button" className="primary" onClick={onGoQuiz}>
        等待老师出题
      </button>
      <button type="button" className="secondary" onClick={() => setShowPoints((v) => !v)}>
        {showPoints ? '收起积分' : '积分'}
      </button>
      {showPoints ? (
        <div className="card-block">
          <p>
            当前 {user.totalPoints} 分
          </p>
          {myRank != null ? (
            <p className="hint">
              {rankMonth} 月积分排行：第 {myRank} 名
              {myMonthPoints != null ? ` · 本月 ${myMonthPoints} 分` : ''}
              （仅自己可见）
            </p>
          ) : null}
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="加分理由（可选）" />
          <input
            type="number"
            min={1}
            value={points}
            onChange={(e) => setPoints(Number(e.target.value))}
            placeholder="分值"
          />
          <button type="button" className="primary" disabled={busy} onClick={() => void requestPoints()}>
            {busy ? '提交中…' : '请求加分'}
          </button>
        </div>
      ) : null}
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
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [monthStats, setMonthStats] = useState<{
    presentCount: number;
    sessionCount: number;
    attendanceRate: number;
  } | null>(null);
  const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

  async function load() {
    setErr('');
    const st = await api<{
      status: string;
      record?: { checkedAt?: string } | null;
    }>('/api/v1/attendance/my-status');
    setStatus(st.status);
    setCheckedAt(st.record?.checkedAt ?? null);
    const stats = await api<{
      items: Array<{ id: string; presentCount: number; sessionCount: number; attendanceRate: number }>;
    }>(`/api/v1/attendance/stats?classId=${encodeURIComponent(classId)}&month=${month}`);
    setMonthStats(stats.items[0] ?? { presentCount: 0, sessionCount: 0, attendanceRate: 0 });
  }

  useEffect(() => {
    void load().catch((e) => setErr(e instanceof Error ? e.message : '加载失败'));
  }, [classId]);

  async function checkIn() {
    setBusy(true);
    try {
      const r = await api<{ status: string; checkedAt: string }>('/api/v1/attendance/check-in', {
        method: 'POST',
        body: '{}',
      });
      showToast(r.status === 'late' ? '签到成功（迟到）' : '签到成功');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '签到失败');
    } finally {
      setBusy(false);
    }
  }

  const done = status === 'present' || status === 'late';

  return (
    <section className="panel">
      <h1>签到</h1>
      {err ? <p className="error">{err}</p> : null}
      <p>
        今日状态：<strong>{statusZh(status)}</strong>
        {checkedAt ? ` · ${new Date(checkedAt).toLocaleString()}` : ''}
      </p>
      <button type="button" className="primary" disabled={done || busy} onClick={() => void checkIn()}>
        {done ? '今日已签到' : busy ? '签到中…' : '点击签到'}
      </button>
      <button type="button" className="secondary" onClick={() => void load().catch((e) => setErr(String(e)))}>
        刷新
      </button>
      {monthStats ? (
        <p className="hint">
          {month} 出勤 {monthStats.presentCount} / {monthStats.sessionCount} 次 · 出勤率{' '}
          {(monthStats.attendanceRate * 100).toFixed(1)}%
        </p>
      ) : null}
    </section>
  );
}
function AdminTab({
  classId,
  className,
  user,
  exitAllowed,
  onExitAllowed,
  onSaved,
  onSwitchIdentity,
}: {
  classId: string;
  className: string;
  user: User | null;
  exitAllowed: boolean;
  onExitAllowed: () => void;
  onSaved: (cfg: { apiBase: string; classId: string }) => Promise<void>;
  onSwitchIdentity: () => void;
}) {
  const [apiBase, setApiBaseLocal] = useState(getApiBase());
  const [cid, setCid] = useState(classId);
  const [adminPassword, setAdminPassword] = useState('');
  const [exitCode, setExitCode] = useState('');
  const [msg, setMsg] = useState('');
  const [exitMsg, setExitMsg] = useState('');
  const [busyExit, setBusyExit] = useState(false);
  const [teacherOpen, setTeacherOpen] = useState(false);
  const [unlockBusy, setUnlockBusy] = useState(false);

  async function unlockConfig() {
    setMsg('');
    if (!adminPassword.trim()) {
      setMsg('请输入管理密码');
      return;
    }
    setUnlockBusy(true);
    try {
      await api('/api/v1/auth/admin-unlock', {
        method: 'POST',
        body: JSON.stringify({ password: adminPassword }),
      });
      setTeacherOpen(true);
      setMsg('已验证，可以修改教师配置');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '验证失败');
    } finally {
      setUnlockBusy(false);
    }
  }

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

  async function unlockAndQuit() {
    setExitMsg('');
    setBusyExit(true);
    try {
      if (!exitAllowed) {
        await api('/api/v1/auth/exit-unlock', {
          method: 'POST',
          body: JSON.stringify({ code: exitCode }),
        });
        onExitAllowed();
      }
      if (window.classroomDesk?.grantExitAndQuit) {
        const ok = await window.classroomDesk.grantExitAndQuit();
        if (!ok) setExitMsg('仍无法退出，请重试或找老师批量解除');
      } else {
        setExitMsg('浏览器预览无法强制退出；请用桌面端');
      }
      setExitCode('');
    } catch (e) {
      setExitMsg(e instanceof Error ? e.message : '解除失败');
    } finally {
      setBusyExit(false);
    }
  }

  return (
    <section className="panel">
      <h1>设置</h1>
      <h2>当前身份</h2>
      {user ? (
        <>
          <p>
            {user.displayName}
            {className ? ` · ${className}` : ''}
            {` · ${user.totalPoints} 分`}
          </p>
          <button type="button" className="secondary" onClick={onSwitchIdentity}>
            更换身份
          </button>
        </>
      ) : (
        <p className="hint">尚未选择姓名</p>
      )}

      <h2>退出锁定</h2>
      <p className="hint">
        {exitAllowed
          ? '当前已允许退出（教师批量解除或已输入解除码）。'
          : '课堂锁定中，找老师或输入解除码。'}
      </p>
      {!exitAllowed ? (
        <label className="field">
          解除码
          <input
            type="password"
            value={exitCode}
            onChange={(e) => setExitCode(e.target.value)}
            placeholder="教师设置的解除码或管理密码"
            autoComplete="off"
          />
        </label>
      ) : null}
      <button type="button" className="secondary" disabled={busyExit} onClick={() => void unlockAndQuit()}>
        {busyExit ? '处理中…' : exitAllowed ? '退出程序' : '验证解除码并退出'}
      </button>
      {exitMsg ? <p className="error">{exitMsg}</p> : null}

      <h2>教师配置</h2>
      {!teacherOpen ? (
        <>
          <p className="hint">服务器地址和班级由老师配置。直接展开后，保存仍需要管理密码。</p>
          <label className="field">
            管理密码
            <input
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              autoComplete="off"
            />
          </label>
          <button type="button" className="secondary" disabled={unlockBusy} onClick={() => void unlockConfig()}>
            {unlockBusy ? '验证中…' : '验证并展开'}
          </button>
          <button type="button" className="secondary" onClick={() => setTeacherOpen(true)}>
            展开教师配置
          </button>
          {msg ? <p className="hint">{msg}</p> : null}
        </>
      ) : (
        <>
          <p className="hint">上课前由老师填写教室服务器地址和班级 ID（从教师后台复制）。</p>
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
            <input
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              autoComplete="off"
            />
          </label>
          <button type="button" className="primary" onClick={() => void save()}>
            保存本机配置
          </button>
          <button type="button" className="secondary" onClick={() => setTeacherOpen(false)}>
            收起教师配置
          </button>
          {msg ? <p className="hint">{msg}</p> : null}
        </>
      )}
    </section>
  );
}

function MessagesTab({
  userId,
  roster,
  onRead,
}: {
  userId: string;
  roster: RosterRow[];
  onRead: () => void;
}) {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [body, setBody] = useState('');
  const [toId, setToId] = useState('teacher');
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const peers = useMemo(() => roster.filter((r) => r.id !== userId), [roster, userId]);

  async function load() {
    setErr('');
    const r = await api<{ items: Array<Record<string, unknown>> }>('/api/v1/messages');
    setItems(r.items);
    for (const msg of r.items) {
      if (String(msg.toStudentId ?? '') === userId && !msg.readAt) {
        try {
          await api(`/api/v1/messages/${String(msg.id)}/read`, { method: 'POST', body: '{}' });
        } catch (e) {
          setErr(e instanceof Error ? e.message : '标记已读失败');
        }
      }
      const replies = (msg.replies as Array<{ id: string; readAt?: string | null; authorId?: string }>) ?? [];
      for (const reply of replies) {
        if (!reply.readAt && reply.authorId !== userId) {
          try {
            await api(`/api/v1/messages/replies/${reply.id}/read`, { method: 'POST', body: '{}' });
          } catch (e) {
            setErr(e instanceof Error ? e.message : '标记回复已读失败');
          }
        }
      }
    }
    onRead();
  }

  useEffect(() => {
    void load().catch((e) => setErr(e instanceof Error ? e.message : '加载失败'));
  }, []);

  async function send() {
    const text = body.trim();
    if (!text) {
      setErr('请输入留言内容');
      return;
    }
    setBusy(true);
    try {
      await api('/api/v1/messages', {
        method: 'POST',
        body: JSON.stringify({
          body: text,
          toStudentId: toId === 'teacher' ? null : toId,
        }),
      });
      setBody('');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '发送失败');
    } finally {
      setBusy(false);
    }
  }

  async function sendReply(messageId: string) {
    const text = (replyDraft[messageId] ?? '').trim();
    if (!text) {
      setErr('回复不能为空');
      return;
    }
    setBusy(true);
    try {
      await api(`/api/v1/messages/${messageId}/replies`, {
        method: 'POST',
        body: JSON.stringify({ body: text }),
      });
      setReplyDraft((prev) => ({ ...prev, [messageId]: '' }));
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '回复失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h1>留言</h1>
      <p className="hint">可发给老师，或发给本班同学。</p>
      {err ? <p className="error">{err}</p> : null}
      <label className="field">
        发给
        <select value={toId} onChange={(e) => setToId(e.target.value)}>
          <option value="teacher">老师</option>
          {peers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
              {p.studentNo ? `（${p.studentNo}）` : ''}
            </option>
          ))}
        </select>
      </label>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="留言内容" />
      <button type="button" className="primary" disabled={busy} onClick={() => void send()}>
        {busy ? '发送中…' : '发送'}
      </button>
      <button type="button" className="secondary" onClick={() => void load().catch((e) => setErr(String(e)))}>
        刷新
      </button>
      {peers.length === 0 ? <p className="hint">本班暂无其他同学可私信（需老师先导入名单）。</p> : null}
      {items.length === 0 ? <p className="hint">暂无留言</p> : null}
      {items.map((msg) => {
        const fromMe = String(msg.studentId) === userId;
        const toPeer = Boolean(msg.toStudentId);
        const title = toPeer
          ? fromMe
            ? `我 → ${String(msg.toStudentName ?? '同学')}`
            : `${String(msg.studentName)} → 我`
          : fromMe
            ? '我 → 老师'
            : `${String(msg.studentName)} → 老师`;
        const mid = String(msg.id);
        return (
          <article key={mid} className="card-block">
            <strong>{title}</strong>
            <p>{String(msg.body)}</p>
            <p className="hint">{msg.createdAt ? new Date(String(msg.createdAt)).toLocaleString() : ''}</p>
            {((msg.replies as Array<{ id?: string; authorName?: string; authorRole?: string; body: string }>) ?? []).map(
              (r, i) => (
                <p key={r.id ?? i} className="reply">
                  {r.authorName ?? (r.authorRole === 'student' ? '同学' : '老师')}：{r.body}
                </p>
              ),
            )}
            <input
              value={replyDraft[mid] ?? ''}
              onChange={(e) => setReplyDraft((prev) => ({ ...prev, [mid]: e.target.value }))}
              placeholder="回复"
            />
            <button type="button" className="secondary" disabled={busy} onClick={() => void sendReply(mid)}>
              回复
            </button>
          </article>
        );
      })}
    </section>
  );
}

function playNewQuestionChime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.stop(ctx.currentTime + 0.4);
    window.setTimeout(() => void ctx.close(), 500);
  } catch {
    /* ignore audio failures */
  }
}

function optionQuestionSig(q: Record<string, unknown>): string {
  const opts = (q.options as Array<{ id?: string; label?: string; content?: string }>) ?? [];
  return `${String(q.stem ?? '')}|${opts
    .map((o) => `${String(o.id ?? '')}:${String(o.label ?? '')}:${String(o.content ?? '')}`)
    .join(',')}`;
}

function QuizTab({
  onAnswered,
  onOpenCount,
  confirmSubmit = true,
}: {
  onAnswered: (msg: string) => void;
  onOpenCount: (count: number) => void;
  confirmSubmit?: boolean;
}) {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [multi, setMulti] = useState<Record<string, string[]>>({});
  const [blank, setBlank] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Record<string, string>>({});
  const questionSigRef = useRef<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [onlyWrongRetry, setOnlyWrongRetry] = useState(false);

  async function load() {
    setErr('');
    const r = await api<{ items: Array<Record<string, unknown>> }>('/api/v1/questions');
    setItems(r.items);
    onOpenCount(countOpenUnanswered(r.items));
  }

  useEffect(() => {
    void load().catch((e) => setErr(e instanceof Error ? e.message : '加载失败'));
    const t = window.setInterval(() => {
      void load().catch((e) => setErr(e instanceof Error ? e.message : '加载失败'));
    }, 5000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    const nextSig: Record<string, string> = {};
    for (const q of items) nextSig[String(q.id)] = optionQuestionSig(q);
    setPicked((prev) => {
      let changed = false;
      const next: Record<string, string> = {};
      for (const [id, optId] of Object.entries(prev)) {
        const sig = nextSig[id];
        const prevSig = questionSigRef.current[id];
        const q = items.find((item) => String(item.id) === id);
        const opts = (q?.options as Array<{ id: string }>) ?? [];
        if (!sig || (prevSig && prevSig !== sig) || !opts.some((o) => o.id === optId)) {
          changed = true;
          continue;
        }
        next[id] = optId;
      }
      if (Object.keys(prev).length !== Object.keys(next).length) changed = true;
      return changed ? next : prev;
    });
    questionSigRef.current = nextSig;
  }, [items]);

  const ordered = useMemo(() => {
    let list = [...items];
    if (onlyWrongRetry) {
      list = list.filter((q) => Boolean(q.canRetryWrong));
    }
    list.sort((a, b) => {
      const aOpen = Boolean(a.acceptingAnswers);
      const bOpen = Boolean(b.acceptingAnswers);
      if (aOpen !== bOpen) return aOpen ? -1 : 1;
      return String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''));
    });
    return list;
  }, [items, onlyWrongRetry]);

  async function answer(id: string, payload: unknown) {
    setBusyId(id);
    try {
      const res = await api<{ isCorrect: boolean; retry?: boolean }>(`/api/v1/questions/${id}/answer`, {
        method: 'POST',
        body: JSON.stringify({ answerPayload: payload }),
      });
      onAnswered(
        res.retry
          ? res.isCorrect
            ? '重练正确'
            : '重练仍错误'
          : res.isCorrect
            ? '回答正确'
            : '回答错误',
      );
      setPicked((prev) => {
        if (prev[id] == null) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await load();
    } catch (e) {
      onAnswered(e instanceof Error ? e.message : '提交失败');
    } finally {
      setBusyId(null);
    }
  }

  const hasRetry = items.some((q) => Boolean(q.canRetryWrong));

  return (
    <section className="panel">
      <h1>答题</h1>
      {err ? <p className="error">{err}</p> : null}
      <div className="row">
        <button type="button" className="secondary" onClick={() => void load().catch((e) => setErr(String(e)))}>
          刷新题目
        </button>
        {hasRetry ? (
          <label className="check">
            <input
              type="checkbox"
              checked={onlyWrongRetry}
              onChange={(e) => setOnlyWrongRetry(e.target.checked)}
            />
            只看错题重练
          </label>
        ) : null}
      </div>
      {ordered.length === 0 ? (
        <p className="hint">{onlyWrongRetry ? '暂无开放的错题重练' : '暂无已发布题目'}</p>
      ) : null}
      {ordered.map((q) => {
        const id = String(q.id);
        const type = String(q.type);
        const opts = (q.options as Array<{ id: string; label: string; content: string }>) ?? [];
        const mine = q.myAnswer as { isCorrect?: boolean | number; answeredAt?: string } | null;
        const answered = Boolean(mine?.answeredAt || mine?.isCorrect != null);
        const canRetryWrong = Boolean(q.canRetryWrong);
        const closed = Boolean(q.closed);
        const canAnswer = Boolean(q.acceptingAnswers);
        const busy = busyId === id;
        const current = canAnswer && (!answered || canRetryWrong);
        return (
          <article key={id} className={`card-block${current ? ' current-question' : ''}`}>
            <strong>
              {current ? (canRetryWrong ? '【错题重练】' : '【当前题】') : ''}[{questionTypeZh(type)}] {String(q.title)}
              {closed && !canAnswer ? ' · 已截止' : ''}
            </strong>
            <p>{String(q.stem)}</p>
            {((q.attachments as Array<{ url: string; originalName: string; mime?: string }>) ?? []).map((a) => {
              const href = `${getApiBase()}${a.url}`;
              const isImg = (a.mime ?? '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(a.originalName);
              return (
                <div key={a.url} className="attach">
                  {isImg ? (
                    <a href={href} target="_blank" rel="noreferrer">
                      <img src={href} alt={a.originalName} className="attach-img" />
                    </a>
                  ) : (
                    <a href={href} target="_blank" rel="noreferrer">
                      附件：{a.originalName}
                    </a>
                  )}
                </div>
              );
            })}
            {answered && !canRetryWrong ? (
              <p className="hint">
                已作答 · {mine?.isCorrect ? '正确' : '错误'}
                {mine?.answeredAt ? ` · ${new Date(String(mine.answeredAt)).toLocaleString()}` : ''}
              </p>
            ) : null}
            {canRetryWrong ? <p className="hint">上次错误 · 可再答一次</p> : null}
            {closed && !canAnswer ? <p className="hint">已收卷，不能再交</p> : null}
            {(type === 'single' || type === 'bool') && canAnswer ? (
              <>
                {opts.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={picked[id] === opt.id ? 'option-btn selected' : 'option-btn'}
                    disabled={busy}
                    onClick={() => {
                      if (confirmSubmit) {
                        setPicked((prev) => ({ ...prev, [id]: opt.id }));
                        return;
                      }
                      void answer(id, { optionIds: [opt.id] });
                    }}
                  >
                    {opt.label}. {opt.content}
                  </button>
                ))}
                {confirmSubmit ? (
                  <button
                    type="button"
                    className="primary"
                    disabled={busy || !picked[id]}
                    onClick={() => void answer(id, { optionIds: [picked[id]!] })}
                  >
                    {busy ? '提交中…' : '确认提交'}
                  </button>
                ) : null}
              </>
            ) : null}
            {type === 'multi' && canAnswer ? (
              <>
                {opts.map((opt) => {
                  const selected = (multi[id] ?? []).includes(opt.id);
                  return (
                    <label key={opt.id} className="check option-line">
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
                  disabled={busy || (multi[id] ?? []).length === 0}
                  onClick={() => void answer(id, { optionIds: multi[id] ?? [] })}
                >
                  {busy ? '提交中…' : canRetryWrong ? '重练提交' : '提交多选'}
                </button>
              </>
            ) : null}
            {type === 'blank' && canAnswer ? (
              <>
                <input
                  value={blank[id] ?? ''}
                  onChange={(e) => setBlank((prev) => ({ ...prev, [id]: e.target.value }))}
                  placeholder="填空答案"
                />
                <button
                  type="button"
                  className="primary"
                  disabled={busy || !(blank[id] ?? '').trim()}
                  onClick={() => void answer(id, { text: (blank[id] ?? '').trim() })}
                >
                  {busy ? '提交中…' : canRetryWrong ? '重练提交' : '提交填空'}
                </button>
              </>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}

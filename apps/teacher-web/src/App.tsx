import { useEffect, useState } from 'react';
import { APP_NAME } from '@classroom-desk/shared';
import { API_BASE, api, getToken, setToken } from './api';
import { ClassroomConnect } from './components/ClassroomConnect';
import { LiveBoard } from './components/LiveBoard';
import { SessionHome } from './components/SessionHome';
import { SetupChecklist } from './components/SetupChecklist';
import {
  AttendancePanel,
  ExportsPanel,
  MessagesPanel,
  QuestionsPanel,
  RequestsPanel,
  RosterPanel,
  SettingsPanel,
} from './panels';
import {
  NAV_CLASS_KEY,
  NAV_PREP_KEY,
  NAV_TAB_KEY,
  readStoredPrepTab,
  readStoredTab,
  type TeacherPrepTab,
  type TeacherTab,
} from './navStorage';
import { preferClassroomId, type ClassItem } from './types';

type Tab = TeacherTab;
type PrepTab = TeacherPrepTab;

const PREP_ITEMS: Array<[PrepTab, string]> = [
  ['roster', '名单'],
  ['questions', '发题'],
  ['requests', '加分'],
  ['attendance', '出勤报表'],
  ['exports', '导出'],
  ['messages', '留言'],
  ['settings', '设置'],
];

export function App() {
  const [tokenReady, setTokenReady] = useState(Boolean(getToken()));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>(() => readStoredTab());
  const [prepTab, setPrepTab] = useState<PrepTab>(() => readStoredPrepTab());
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [classId, setClassId] = useState(() => localStorage.getItem(NAV_CLASS_KEY) ?? '');
  const [mustChangePassword, setMustChangePassword] = useState(
    () => sessionStorage.getItem('cd_must_change_password') === '1',
  );
  const [messagesEnabled, setMessagesEnabled] = useState(true);
  const [healthAlert, setHealthAlert] = useState('');
  const [healthLanIps, setHealthLanIps] = useState<string[]>([]);
  const [healthTick, setHealthTick] = useState(0);
  const [projectionMode, setProjectionMode] = useState(false);
  const [studentCount, setStudentCount] = useState(0);
  const [hasApiBase, setHasApiBase] = useState(false);
  const [setupTick, setSetupTick] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);

  async function loadClasses() {
    const res = await api<{ items: ClassItem[] }>('/api/v1/classes');
    setClasses(res.items);
    setClassId((prev) => preferClassroomId(res.items, prev));
  }

  useEffect(() => {
    if (!tokenReady) return;
    void loadClasses().catch((e) => setError(e instanceof Error ? e.message : 'load_failed'));
  }, [tokenReady]);

  useEffect(() => {
    if (!tokenReady) return;
    let cancelled = false;
    void api<{ messagesEnabled?: boolean; classroomApiBase?: string }>('/api/v1/settings')
      .then((s) => {
        if (cancelled) return;
        setMessagesEnabled(s.messagesEnabled !== false);
        const base = String(s.classroomApiBase ?? '').trim();
        setHasApiBase(Boolean(base) && !/127\.0\.0\.1|localhost/i.test(base));
      })
      .catch(() => {
        if (!cancelled) setHasApiBase(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tokenReady, tab, setupTick]);

  useEffect(() => {
    if (!tokenReady || !classId) {
      setStudentCount(0);
      return;
    }
    let cancelled = false;
    void api<{ items: unknown[] }>(`/api/v1/classes/${classId}/students`)
      .then((r) => {
        if (!cancelled) setStudentCount(r.items.length);
      })
      .catch(() => {
        if (!cancelled) setStudentCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [tokenReady, classId, tab, prepTab, setupTick]);

  useEffect(() => {
    if (!tokenReady || !classId || mustChangePassword) {
      setPendingCount(0);
      return;
    }
    let cancelled = false;
    async function loadPending() {
      try {
        const r = await api<{ items: unknown[] }>(
          `/api/v1/point-requests/pending?classId=${encodeURIComponent(classId)}`,
        );
        if (!cancelled) setPendingCount(r.items.length);
      } catch {
        if (!cancelled) setPendingCount(0);
      }
    }
    void loadPending();
    const t = window.setInterval(() => void loadPending(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [tokenReady, classId, mustChangePassword]);

  useEffect(() => {
    if (!tokenReady) return;
    let cancelled = false;
    async function pollHealth() {
      try {
        const res = await fetch(`${API_BASE}/health`, { cache: 'no-store' });
        const body = (await res.json()) as {
          ok?: boolean;
          lanIps?: string[];
          backup?: { lastError?: { message?: string } | null };
        };
        if (cancelled) return;
        setHealthLanIps(body.lanIps ?? []);
        const err = body.backup?.lastError;
        setHealthAlert(
          !body.ok
            ? '服务异常：/health 未就绪'
            : err
              ? `备份异常：${err.message ?? JSON.stringify(err)}（自动备份或 npm run backup:db）`
              : '',
        );
      } catch {
        if (!cancelled) {
          setHealthAlert('无法读取 /health');
          setHealthLanIps([]);
        }
      }
    }
    void pollHealth();
    const t = window.setInterval(() => void pollHealth(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [tokenReady, healthTick]);

  useEffect(() => {
    if (!mustChangePassword) return;
    setTab('settings');
    setProjectionMode(false);
  }, [mustChangePassword]);

  useEffect(() => {
    if (!tokenReady || mustChangePassword) return;
    localStorage.setItem(NAV_TAB_KEY, tab);
  }, [tokenReady, mustChangePassword, tab]);

  useEffect(() => {
    if (!tokenReady) return;
    localStorage.setItem(NAV_PREP_KEY, prepTab);
  }, [tokenReady, prepTab]);

  useEffect(() => {
    if (!classId) return;
    localStorage.setItem(NAV_CLASS_KEY, classId);
  }, [classId]);

  useEffect(() => {
    if (!messagesEnabled && prepTab === 'messages') setPrepTab('roster');
  }, [messagesEnabled, prepTab]);

  useEffect(() => {
    if (!projectionMode) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setProjectionMode(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [projectionMode]);

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
      setTab(force ? 'settings' : 'session');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'login_failed');
    }
  }

  function openDest(dest: 'prep' | 'assign' | 'session') {
    setProjectionMode(false);
    if (dest === 'prep') {
      setPrepTab('roster');
      setTab('prep');
      return;
    }
    if (dest === 'assign') {
      setTab('assign');
      return;
    }
    setTab('session');
    window.requestAnimationFrame(() => {
      document.getElementById('session-quick-publish')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
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

  const visiblePrep = PREP_ITEMS.filter(([id]) => id !== 'messages' || messagesEnabled);

  return (
    <div className={projectionMode ? 'layout projection-active' : 'layout'}>
      {projectionMode ? null : (
        <aside>
          <h1>{APP_NAME}</h1>
          {healthAlert ? (
            <div className="banner-alert">
              <p>{healthAlert}</p>
              {healthLanIps.length ? (
                <p className="hint light">局域网 IP：{healthLanIps.join(' · ')}</p>
              ) : null}
              <button type="button" className="secondary" onClick={() => setHealthTick((n) => n + 1)}>
                重试 /health
              </button>
            </div>
          ) : null}
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
          {!mustChangePassword
            ? (
                [
                  ['session', '上课'],
                  ['prep', '备课'],
                  ['assign', '指派学生机'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={tab === id ? 'nav active' : 'nav'}
                  onClick={() => {
                    setProjectionMode(false);
                    setTab(id);
                  }}
                >
                  {label}
                  {id === 'session' && pendingCount > 0 ? (
                    <span className="pending-badge">{pendingCount}</span>
                  ) : null}
                </button>
              ))
            : null}
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
              setProjectionMode(false);
              sessionStorage.removeItem('cd_must_change_password');
            }}
          >
            退出登录
          </button>
        </aside>
      )}
      <main>
        {mustChangePassword ? (
          <SettingsPanel
            forcePasswordOnly
            onPasswordChanged={() => {
              setMustChangePassword(false);
              sessionStorage.setItem('cd_must_change_password', '0');
              setTab('session');
            }}
          />
        ) : projectionMode ? (
          <LiveBoard
            classId={classId}
            projection
            onExitProjection={() => setProjectionMode(false)}
          />
        ) : (
          <>
            <SetupChecklist
              classId={classId}
              classes={classes}
              studentCount={studentCount}
              hasApiBase={hasApiBase}
              refreshTick={setupTick}
              onGo={openDest}
              onCreateClass={() => openDest('prep')}
            />
            {tab === 'session' && (
              <SessionHome
                classId={classId}
                onEnterProjection={() => setProjectionMode(true)}
                onGoPrep={() => {
                  setPrepTab('questions');
                  setTab('prep');
                }}
                onGoAssign={() => setTab('assign')}
                onSetupChanged={() => setSetupTick((n) => n + 1)}
              />
            )}
            {tab === 'assign' && (
              <ClassroomConnect
                classId={classId}
                classes={classes}
                onApiBaseSaved={() => setSetupTick((n) => n + 1)}
              />
            )}
            {tab === 'prep' && (
              <>
                <div className="prep-subnav">
                  {visiblePrep.map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={prepTab === id ? 'active' : undefined}
                      onClick={() => setPrepTab(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {prepTab === 'roster' && (
                  <RosterPanel
                    classId={classId}
                    classes={classes}
                    onClasses={loadClasses}
                    onRosterChanged={() => setSetupTick((n) => n + 1)}
                  />
                )}
                {prepTab === 'questions' && <QuestionsPanel classId={classId} />}
                {prepTab === 'requests' && <RequestsPanel classId={classId} />}
                {prepTab === 'attendance' && <AttendancePanel classId={classId} />}
                {prepTab === 'exports' && <ExportsPanel classId={classId} />}
                {prepTab === 'messages' && messagesEnabled && (
                  <MessagesPanel classId={classId} onEnabledChange={setMessagesEnabled} />
                )}
                {prepTab === 'settings' && <SettingsPanel onMessagesChange={setMessagesEnabled} />}
              </>
            )}
            {tab === 'settings' && <SettingsPanel onMessagesChange={setMessagesEnabled} />}
          </>
        )}
      </main>
    </div>
  );
}

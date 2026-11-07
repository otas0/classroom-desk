import { useEffect, useRef, useState } from 'react';
import { APP_NAME, GITHUB_RELEASES_BASE } from '@classroom-desk/shared';
import { API_BASE, api, getToken, setToken } from './api';
import { ClassroomConnect } from './components/ClassroomConnect';
import { LiveBoard } from './components/LiveBoard';
import { OpsDashboard } from './components/OpsDashboard';
import { PresenceClients } from './components/PresenceClients';
import { SeatMapPanel } from './components/SeatMapPanel';
import { SessionHome } from './components/SessionHome';
import { SetupChecklist, type SetupDest } from './components/SetupChecklist';
import { PacksPanel } from './components/PacksPanel';
import {
  AttendancePanel,
  ExportsPanel,
  MessagesPanel,
  QuestionRecyclePanel,
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
import { assistantPrepTabs, isAssistant, setStaffRole } from './authRole';
import { preferClassroomId, type ClassItem } from './types';

type Tab = TeacherTab;
type PrepTab = TeacherPrepTab;

const PREP_ITEMS: Array<[PrepTab, string]> = [
  ['roster', '名单'],
  ['questions', '发题'],
  ['q-recycle', '题目回收站'],
  ['requests', '加分'],
  ['attendance', '出勤报表'],
  ['presence', '在线机位'],
  ['seats', '座位图'],
  ['ops', '健康仪表盘'],
  ['packs', '题库包'],
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
  const [driftExpectedVersion, setDriftExpectedVersion] = useState('');
  const [healthLanIps, setHealthLanIps] = useState<string[]>([]);
  const [healthTick, setHealthTick] = useState(0);
  const [projectionMode, setProjectionMode] = useState(false);
  const [studentCount, setStudentCount] = useState(0);
  const [hasApiBase, setHasApiBase] = useState(false);
  const [setupTick, setSetupTick] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [codeRotationBanner, setCodeRotationBanner] = useState('');
  const [apiRestartTip, setApiRestartTip] = useState('');
  const healthWasDownRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void fetch(`${API_BASE}/api/v1/settings/public`)
      .then((r) => r.json())
      .then(
        (s: {
          exitUnlockCodeRotationDue?: boolean;
          exitUnlockCodeAgeDays?: number | null;
          exitUnlockCodeRotateDays?: number;
        }) => {
          if (cancelled) return;
          if (s.exitUnlockCodeRotationDue) {
            setCodeRotationBanner(
              tokenReady
                ? `解除码已使用 ${s.exitUnlockCodeAgeDays ?? '?'} 天（阈值 ${s.exitUnlockCodeRotateDays ?? 90} 天），请尽快更换。`
                : `解除码已使用 ${s.exitUnlockCodeAgeDays ?? '?'} 天（阈值 ${s.exitUnlockCodeRotateDays ?? 90} 天），登录后请在「设置」更换。`,
            );
          } else {
            setCodeRotationBanner('');
          }
        },
      )
      .catch(() => {
        if (!cancelled) setCodeRotationBanner('');
      });
    return () => {
      cancelled = true;
    };
  }, [tokenReady]);

  function openExitLockSettings() {
    if (isAssistant()) {
      setTab('settings');
    } else {
      setTab('prep');
      setPrepTab('settings');
    }
    window.requestAnimationFrame(() => {
      document.getElementById('exit-lock-settings')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }

  function openInputLockSettings() {
    if (isAssistant()) {
      setTab('settings');
    } else {
      setTab('prep');
      setPrepTab('settings');
    }
    window.requestAnimationFrame(() => {
      document.getElementById('input-lock-settings')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }

  useEffect(() => {
    if (!tokenReady) return;
    if (sessionStorage.getItem('cd_goto_exit_lock') === '1') {
      sessionStorage.removeItem('cd_goto_exit_lock');
      openExitLockSettings();
    }
    if (
      sessionStorage.getItem('cd_goto_input_lock') === '1' ||
      (typeof location !== 'undefined' && location.hash === '#input-lock-settings')
    ) {
      sessionStorage.removeItem('cd_goto_input_lock');
      openInputLockSettings();
    }
  }, [tokenReady]);

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
          degraded?: boolean;
          version?: string;
          studentDesktopVersion?: string;
          lanIps?: string[];
          backup?: { lastError?: { message?: string } | null };
          audit?: { lastError?: { message?: string } | null };
        };
        if (cancelled) return;
        setHealthLanIps(body.lanIps ?? []);
        const err = body.backup?.lastError;
        const auditErr = body.audit?.lastError;
        let drift = '';
        let expectedVer = '';
        if (classId && body.ok) {
          try {
            const clients = await api<{ versions: string[]; count: number }>(
              `/api/v1/presence/clients?classId=${encodeURIComponent(classId)}`,
            );
            const expected = String(body.studentDesktopVersion ?? body.version ?? '').trim();
            expectedVer = expected;
            const odd = (clients.versions ?? []).filter((v) => v && expected && v !== expected);
            if (odd.length) {
              drift = `班级版本漂移：已连 ${clients.count} 台，上报 ${[...new Set(odd)].join(' / ')}，应升级到 v${expected}`;
            }
            // 机房就绪埋点：扫码 CTA 后首次出现在线桌面端
            const ctaAt = Number(sessionStorage.getItem(`cd_assign_cta_at_${classId}`) || 0);
            const readyLogged = sessionStorage.getItem(`cd_classroom_ready_${classId}`) === '1';
            if (ctaAt > 0 && !readyLogged && clients.count > 0) {
              sessionStorage.setItem(`cd_classroom_ready_${classId}`, '1');
              const durationMs = Date.now() - ctaAt;
              void api('/api/v1/audit/events', {
                method: 'POST',
                body: JSON.stringify({
                  action: 'setup.classroom_ready',
                  classId,
                  detail: {
                    durationMs,
                    durationSec: Math.round(durationMs / 1000),
                    onlineCount: clients.count,
                    versions: clients.versions,
                  },
                }),
              }).catch(() => undefined);
            }
          } catch {
            /* presence optional */
          }
        }
        setDriftExpectedVersion(drift ? expectedVer : '');
        const down = !body.ok;
        if (down) {
          healthWasDownRef.current = true;
        } else if (healthWasDownRef.current) {
          healthWasDownRef.current = false;
          setApiRestartTip('API 刚恢复（看门狗/重启），实时通道已可用');
          const tipMs =
            (window as unknown as { __cdApiRestartTipMs?: number }).__cdApiRestartTipMs ?? 12_000;
          window.setTimeout(() => {
            if (!cancelled) setApiRestartTip('');
          }, tipMs);
        }
        setHealthAlert(
          down
            ? '服务异常：/health 未就绪'
            : auditErr
              ? `审计写入异常：${auditErr.message}`
              : err
                ? `备份异常：${err.message ?? JSON.stringify(err)}（自动备份或 npm run backup:db）`
                : drift,
        );
      } catch {
        if (!cancelled) {
          healthWasDownRef.current = true;
          setHealthAlert('无法读取 /health');
          setHealthLanIps([]);
        }
      }
    }
    void pollHealth();
    /** Override: localStorage `cd_health_poll_ms` or Vite `VITE_HEALTH_POLL_MS` (ms, 3s–120s). Prod default 30s; dev 8s. */
    const fromLs = Number(localStorage.getItem('cd_health_poll_ms') || '');
    const fromEnv = Number(import.meta.env.VITE_HEALTH_POLL_MS || '');
    const fallback = import.meta.env.PROD ? 30_000 : 8_000;
    const pollMs = Math.min(
      120_000,
      Math.max(
        3_000,
        Number.isFinite(fromLs) && fromLs > 0
          ? fromLs
          : Number.isFinite(fromEnv) && fromEnv > 0
            ? fromEnv
            : fallback,
      ),
    );
    const tipMsRaw = Number(localStorage.getItem('cd_api_restart_tip_ms') || import.meta.env.VITE_API_RESTART_TIP_MS || 12_000);
    const tipMs = Math.min(60_000, Math.max(3_000, Number.isFinite(tipMsRaw) && tipMsRaw > 0 ? tipMsRaw : 12_000));
    // Keep tip duration readable by restart handler via closure refresh each effect run
    (window as unknown as { __cdApiRestartTipMs?: number }).__cdApiRestartTipMs = tipMs;
    const t = window.setInterval(() => void pollHealth(), pollMs);
    const onPollChanged = () => setHealthTick((n) => n + 1);
    window.addEventListener('cd-health-poll-changed', onPollChanged);
    return () => {
      cancelled = true;
      window.clearInterval(t);
      window.removeEventListener('cd-health-poll-changed', onPollChanged);
    };
  }, [tokenReady, healthTick, classId]);

  useEffect(() => {
    if (!mustChangePassword) return;
    setTab('settings');
    setProjectionMode(false);
  }, [mustChangePassword]);

  useEffect(() => {
    if (!tokenReady || mustChangePassword || !isAssistant()) return;
    setTab('prep');
    const allowed = new Set([...assistantPrepTabs(), 'settings'] as string[]);
    if (!allowed.has(prepTab)) setPrepTab('attendance');
  }, [tokenReady, mustChangePassword]);

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
    const onSel = (e: Event) => {
      const id = (e as CustomEvent<{ classId?: string }>).detail?.classId;
      if (typeof id === 'string' && id.trim()) setClassId(id.trim());
    };
    window.addEventListener('cd-select-class', onSel);
    return () => window.removeEventListener('cd-select-class', onSel);
  }, []);

  useEffect(() => {
    if (!messagesEnabled && prepTab === 'messages') {
      setPrepTab(isAssistant() ? 'attendance' : 'roster');
    }
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
      const res = await api<{
        token: string;
        mustChangePassword?: boolean;
        user?: { role?: string };
      }>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setToken(res.token);
      setStaffRole(res.user?.role);
      const force = Boolean(res.mustChangePassword);
      setMustChangePassword(force);
      sessionStorage.setItem('cd_must_change_password', force ? '1' : '0');
      setTokenReady(true);
      if (force) {
        setTab('settings');
      } else if (res.user?.role === 'assistant') {
        setTab('prep');
        setPrepTab('attendance');
      } else {
        setTab('session');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'login_failed');
    }
  }

  function openDest(dest: SetupDest) {
    setProjectionMode(false);
    if (dest === 'prep' || dest === 'prep-roster') {
      setPrepTab('roster');
      setTab('prep');
      return;
    }
    if (dest === 'prep-questions') {
      setPrepTab('questions');
      setTab('prep');
      return;
    }
    if (dest === 'prep-presence') {
      setPrepTab('presence');
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
        {codeRotationBanner ? (
          <div className="banner-alert" role="status" aria-live="polite">
            <p>{codeRotationBanner}</p>
            <p className="hint">
              <button
                type="button"
                className="linkish"
                onClick={() => {
                  sessionStorage.setItem('cd_goto_exit_lock', '1');
                  setError('请先登录，登录后将打开「设置」更换解除码。');
                }}
              >
                去设置更换解除码
              </button>
            </p>
          </div>
        ) : null}
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

  const visiblePrep = (
    isAssistant()
      ? PREP_ITEMS.filter(([id]) =>
          (assistantPrepTabs() as string[]).includes(id) || id === 'settings',
        )
      : PREP_ITEMS
  ).filter(([id]) => id !== 'messages' || messagesEnabled);

  return (
    <div className={projectionMode ? 'layout projection-active' : 'layout'}>
      {projectionMode ? null : (
        <aside>
          <h1>{APP_NAME}</h1>
          {apiRestartTip ? (
            <div className="banner-alert" role="status" aria-live="polite">
              <p>{apiRestartTip}</p>
            </div>
          ) : null}
          {codeRotationBanner && tokenReady ? (
            <div className="banner-alert" role="status">
              <p>{codeRotationBanner}</p>
              <button type="button" className="linkish" onClick={() => openExitLockSettings()}>
                去设置更换解除码
              </button>
            </div>
          ) : null}
          {healthAlert ? (
            <div className="banner-alert">
              <p>{healthAlert}</p>
              {driftExpectedVersion ? (
                <p className="hint light">
                  <a
                    href={`${GITHUB_RELEASES_BASE}/tag/v${driftExpectedVersion}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    打开 Release v{driftExpectedVersion}
                  </a>
                  {' · '}
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => {
                      setPrepTab('presence');
                      setTab('prep');
                    }}
                  >
                    查看在线机位
                  </button>
                </p>
              ) : null}
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
                (
                  isAssistant()
                    ? ([['prep', '备课'], ['settings', '设置']] as const)
                    : ([
                        ['session', '上课'],
                        ['prep', '备课'],
                        ['assign', '指派学生机'],
                      ] as const)
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
            )
            : null}
          {!messagesEnabled && !mustChangePassword ? (
            <p className="hint">留言已关闭（学生端无留言 Tab）</p>
          ) : null}
          <button
            type="button"
            className="nav"
            onClick={() => {
              setToken(null);
              setStaffRole(null);
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
              if (isAssistant()) {
                setTab('prep');
                setPrepTab('attendance');
              } else {
                setTab('session');
              }
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
            {!isAssistant() ? (
              <SetupChecklist
                classId={classId}
                classes={classes}
                studentCount={studentCount}
                hasApiBase={hasApiBase}
                refreshTick={setupTick}
                onGo={openDest}
                onCreateClass={() => openDest('prep')}
              />
            ) : null}
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
                {prepTab === 'q-recycle' && <QuestionRecyclePanel classId={classId} />}
                {prepTab === 'requests' && <RequestsPanel classId={classId} />}
                {prepTab === 'attendance' && <AttendancePanel classId={classId} />}
                {prepTab === 'presence' && <PresenceClients classId={classId} />}
                {prepTab === 'seats' && <SeatMapPanel classId={classId} />}
                {prepTab === 'ops' && <OpsDashboard />}
                {prepTab === 'packs' && (
                  <PacksPanel
                    classId={classId}
                    onGoSession={isAssistant() ? undefined : () => setTab('session')}
                  />
                )}
                {prepTab === 'exports' && <ExportsPanel classId={classId} />}
                {prepTab === 'messages' && messagesEnabled && (
                  <MessagesPanel classId={classId} onEnabledChange={setMessagesEnabled} />
                )}
                {prepTab === 'settings' && <SettingsPanel onMessagesChange={setMessagesEnabled} />}
              </>
            )}
            {/* Assistant top-nav「设置」；教师走备课→设置，勿双挂载以免 settings-save-msg 重复 */}
            {tab === 'settings' && isAssistant() ? (
              <SettingsPanel onMessagesChange={setMessagesEnabled} />
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
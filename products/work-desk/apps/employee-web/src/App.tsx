import { useEffect, useState } from 'react';
import { APP_NAME, APP_NOTICE, type DayTimeSummary, type PublicUser } from '@work-desk/shared';
import { client, getToken, setToken } from './api';

function mins(n: number): string {
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

export function App() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [summary, setSummary] = useState<DayTimeSummary | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const me = await client.me();
        setUser(me.user);
        const today = await client.today();
        setSummary(today.summary);
      } catch {
        setToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!user) return;
    const tick = () => {
      void client
        .presence()
        .then((r) => setSummary(r.summary))
        .catch(() => undefined);
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [user]);

  if (loading) {
    return (
      <div className="shell">
        <p className="muted">加载中…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <Login
        onAuthed={async (token, next) => {
          setToken(token);
          setUser(next);
          const today = await client.today();
          setSummary(today.summary);
        }}
      />
    );
  }

  const clockedIn = Boolean(summary?.isClockedIn);

  return (
    <div className="shell">
      <header className="panel" style={{ gap: '0.35rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
          <h1 className="brand">{APP_NAME}</h1>
          <button
            type="button"
            onClick={() => {
              setToken(null);
              setUser(null);
              setSummary(null);
            }}
          >
            退出
          </button>
        </div>
        <p className="sub">{APP_NOTICE}</p>
        <p className="muted">
          {user.displayName}
          {user.departmentName ? ` · ${user.departmentName}` : ''}
        </p>
      </header>

      <section className="panel">
        <div className="stats">
          <div className="stat">
            <span className="muted">打卡工时</span>
            <b>{mins(summary?.punchedMinutes ?? 0)}</b>
          </div>
          <div className="stat">
            <span className="muted">在线（辅助）</span>
            <b>{mins(summary?.onlineMinutes ?? 0)}</b>
          </div>
          <div className="stat">
            <span className="muted">标准</span>
            <b>{mins(summary?.standardMinutes ?? 0)}</b>
          </div>
          <div className="stat">
            <span className="muted">加班</span>
            <b>
              {mins(summary?.overtimeMinutes ?? 0)}
              {summary?.overtimeStatus ? ` · ${summary.overtimeStatus}` : ''}
            </b>
          </div>
        </div>

        <p className="muted">
          上班：
          {summary?.clockInAt ? new Date(summary.clockInAt).toLocaleTimeString() : '未打卡'}
          {' · '}
          下班：
          {clockedIn
            ? '进行中'
            : summary?.clockOutAt
              ? new Date(summary.clockOutAt).toLocaleTimeString()
              : '—'}
        </p>

        <div className="actions">
          <button
            className="primary"
            type="button"
            disabled={busy || clockedIn}
            onClick={() => {
              setBusy(true);
              setError('');
              void client
                .clockIn()
                .then((r) => setSummary(r.summary))
                .catch((e) => setError(e instanceof Error ? e.message : 'clock_in_failed'))
                .finally(() => setBusy(false));
            }}
          >
            上班打卡
          </button>
          <button
            type="button"
            disabled={busy || !clockedIn}
            onClick={() => {
              setBusy(true);
              setError('');
              void client
                .clockOut()
                .then((r) => setSummary(r.summary))
                .catch((e) => setError(e instanceof Error ? e.message : 'clock_out_failed'))
                .finally(() => setBusy(false));
            }}
          >
            下班打卡
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </section>
    </div>
  );
}

function Login({
  onAuthed,
}: {
  onAuthed: (token: string, user: PublicUser) => Promise<void>;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div className="shell">
      <h1 className="brand">{APP_NAME}</h1>
      <p className="sub">员工打卡。在线时长仅作辅助，不替代打卡。</p>
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          void client
            .login({ username, password })
            .then((r) => onAuthed(r.token, r.user))
            .catch((err) => setError(err instanceof Error ? err.message : 'login_failed'))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          用户名
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          密码
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <button className="primary" type="submit" disabled={busy}>
          登录
        </button>
        {error ? <p className="error">{error}</p> : null}
      </form>
    </div>
  );
}

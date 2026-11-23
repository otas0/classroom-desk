import { useEffect, useState } from 'react';
import { APP_NAME, APP_NOTICE, type DayTimeSummary, type PublicUser, type Role } from '@work-desk/shared';
import { client, getToken, setToken } from './api';

type Tab = 'time' | 'people' | 'departments';

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function mins(n: number): string {
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export function App() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('time');

  useEffect(() => {
    void (async () => {
      try {
        const status = await client.bootstrapStatus();
        setNeedsBootstrap(status.needsBootstrap);
        if (getToken()) {
          const me = await client.me();
          setUser(me.user);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'load_failed');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="shell">
        <p className="muted">加载中…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <AuthScreen
        needsBootstrap={needsBootstrap}
        onAuthed={(token, next) => {
          setToken(token);
          setUser(next);
          setNeedsBootstrap(false);
        }}
      />
    );
  }

  return (
    <div className="shell">
      <header className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1 className="brand">{APP_NAME}</h1>
          <p className="sub">{APP_NOTICE}</p>
        </div>
        <div className="row">
          <span className="muted">
            {user.displayName} · {user.role}
          </span>
          <button
            type="button"
            onClick={() => {
              setToken(null);
              setUser(null);
            }}
          >
            退出
          </button>
        </div>
      </header>

      <nav className="tabs">
        {(
          [
            ['time', '当日工时'],
            ['people', '员工与权限'],
            ['departments', '部门'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {error ? <p className="error">{error}</p> : null}

      {tab === 'time' ? <TimePanel onError={setError} /> : null}
      {tab === 'people' ? <PeoplePanel user={user} onError={setError} /> : null}
      {tab === 'departments' ? <DepartmentsPanel user={user} onError={setError} /> : null}
    </div>
  );
}

function AuthScreen({
  needsBootstrap,
  onAuthed,
}: {
  needsBootstrap: boolean;
  onAuthed: (token: string, user: PublicUser) => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = needsBootstrap
        ? await client.bootstrap({ displayName, username, password })
        : await client.login({ username, password });
      onAuthed(res.token, res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'auth_failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell auth-box">
      <h1 className="brand">{APP_NAME}</h1>
      <p className="sub">
        {needsBootstrap ? '创建首位管理员以启用本系统。' : '管理员 / 主管登录。'}
      </p>
      <form className="panel grid-form" onSubmit={submit} style={{ gridTemplateColumns: '1fr' }}>
        {needsBootstrap ? (
          <label>
            显示名
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </label>
        ) : null}
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
          密码（至少 8 位）
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={needsBootstrap ? 'new-password' : 'current-password'}
            minLength={8}
            required
          />
        </label>
        <button className="primary" type="submit" disabled={busy}>
          {needsBootstrap ? '创建管理员' : '登录'}
        </button>
        {error ? <p className="error">{error}</p> : null}
      </form>
    </div>
  );
}

function TimePanel({ onError }: { onError: (msg: string) => void }) {
  const [date, setDate] = useState(todayLocal);
  const [rows, setRows] = useState<DayTimeSummary[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});

  async function reload() {
    try {
      const [day, people] = await Promise.all([client.daySummaries(date), client.employees()]);
      setRows(day.summaries);
      const map: Record<string, string> = {};
      for (const e of people.employees) map[e.id] = e.displayName;
      setNames(map);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'load_failed');
    }
  }

  useEffect(() => {
    void reload();
  }, [date]);

  return (
    <section className="panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>当日工时</h2>
        <label style={{ width: 'auto' }}>
          日期
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <p className="muted">打卡时长为考勤边界；在线时长仅辅助。加班超出标准工时后待确认。</p>
      {rows.length === 0 ? (
        <p className="empty">当日暂无员工工时记录。请先在「员工与权限」添加人员。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>员工</th>
              <th>上班</th>
              <th>下班</th>
              <th>打卡工时</th>
              <th>在线（辅助）</th>
              <th>标准</th>
              <th>加班</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employeeId}>
                <td>{names[r.employeeId] ?? r.employeeId}</td>
                <td>{r.clockInAt ? new Date(r.clockInAt).toLocaleTimeString() : '—'}</td>
                <td>{r.clockOutAt ? new Date(r.clockOutAt).toLocaleTimeString() : '—'}</td>
                <td>{mins(r.punchedMinutes)}</td>
                <td className="muted">{mins(r.onlineMinutes)}</td>
                <td>{mins(r.standardMinutes)}</td>
                <td>
                  {r.overtimeMinutes > 0 ? mins(r.overtimeMinutes) : '—'}{' '}
                  {r.overtimeStatus ? (
                    <span className={`badge ${r.overtimeStatus}`}>{r.overtimeStatus}</span>
                  ) : null}
                </td>
                <td>
                  {r.overtimeMinutes > 0 && r.overtimeStatus === 'pending' ? (
                    <span className="row">
                      <button
                        type="button"
                        className="primary"
                        onClick={() =>
                          void client
                            .reviewOvertime(r.employeeId, date, 'confirmed')
                            .then(reload)
                            .catch((e) => onError(e instanceof Error ? e.message : 'review_failed'))
                        }
                      >
                        确认加班
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void client
                            .reviewOvertime(r.employeeId, date, 'rejected')
                            .then(reload)
                            .catch((e) => onError(e instanceof Error ? e.message : 'review_failed'))
                        }
                      >
                        驳回
                      </button>
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function PeoplePanel({
  user,
  onError,
}: {
  user: PublicUser;
  onError: (msg: string) => void;
}) {
  const [employees, setEmployees] = useState<
    Awaited<ReturnType<typeof client.employees>>['employees']
  >([]);
  const [departments, setDepartments] = useState<
    Awaited<ReturnType<typeof client.departments>>['departments']
  >([]);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('employee');
  const [employeeNo, setEmployeeNo] = useState('');
  const [departmentId, setDepartmentId] = useState('');

  async function reload() {
    try {
      const [e, d] = await Promise.all([client.employees(), client.departments()]);
      setEmployees(e.employees);
      setDepartments(d.departments);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'load_failed');
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  if (user.role !== 'admin' && user.role !== 'manager') {
    return <p className="empty">无权限查看员工。</p>;
  }

  return (
    <section className="panel">
      <h2>员工与权限</h2>
      {user.role === 'admin' ? (
        <form
          className="grid-form"
          onSubmit={(e) => {
            e.preventDefault();
            void client
              .createEmployee({
                displayName,
                username,
                password,
                role,
                employeeNo: employeeNo || undefined,
                departmentId: departmentId || undefined,
              })
              .then(() => {
                setDisplayName('');
                setUsername('');
                setPassword('');
                setEmployeeNo('');
                return reload();
              })
              .catch((err) => onError(err instanceof Error ? err.message : 'create_failed'));
          }}
        >
          <label>
            姓名
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </label>
          <label>
            用户名
            <input value={username} onChange={(e) => setUsername(e.target.value)} required />
          </label>
          <label>
            初始密码
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>
          <label>
            工号
            <input
              value={employeeNo}
              onChange={(e) => setEmployeeNo(e.target.value)}
              placeholder="可选"
            />
          </label>
          <label>
            角色
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="employee">员工</option>
              <option value="manager">主管</option>
              <option value="admin">管理员</option>
            </select>
          </label>
          <label>
            部门
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">未分配</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" type="submit">
            添加
          </button>
        </form>
      ) : (
        <p className="muted">主管可查看本部门员工；添加账号需管理员。</p>
      )}

      {employees.length === 0 ? (
        <p className="empty">还没有员工账号。</p>
      ) : (
        <table style={{ marginTop: '1rem' }}>
          <thead>
            <tr>
              <th>姓名</th>
              <th>用户名</th>
              <th>工号</th>
              <th>角色</th>
              <th>部门</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id}>
                <td>{e.displayName}</td>
                <td>{e.username}</td>
                <td>{e.employeeNo || '—'}</td>
                <td>{e.role}</td>
                <td>{e.departmentName || '—'}</td>
                <td>{e.disabledAt ? '已停用' : '在职'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function DepartmentsPanel({
  user,
  onError,
}: {
  user: PublicUser;
  onError: (msg: string) => void;
}) {
  const [departments, setDepartments] = useState<
    Awaited<ReturnType<typeof client.departments>>['departments']
  >([]);
  const [name, setName] = useState('');
  const [standardMinutes, setStandardMinutes] = useState(480);

  async function reload() {
    try {
      const d = await client.departments();
      setDepartments(d.departments);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'load_failed');
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  return (
    <section className="panel">
      <h2>部门</h2>
      {user.role === 'admin' ? (
        <form
          className="grid-form"
          onSubmit={(e) => {
            e.preventDefault();
            void client
              .createDepartment({ name, standardMinutes })
              .then(() => {
                setName('');
                return reload();
              })
              .catch((err) => onError(err instanceof Error ? err.message : 'create_failed'));
          }}
        >
          <label>
            部门名称
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            标准工时（分钟）
            <input
              type="number"
              min={1}
              value={standardMinutes}
              onChange={(e) => setStandardMinutes(Number(e.target.value))}
              required
            />
          </label>
          <button className="primary" type="submit">
            新建部门
          </button>
        </form>
      ) : null}

      {departments.length === 0 ? (
        <p className="empty">还没有部门。先建部门再给员工分配。</p>
      ) : (
        <table style={{ marginTop: '1rem' }}>
          <thead>
            <tr>
              <th>名称</th>
              <th>标准工时</th>
              <th>人数</th>
            </tr>
          </thead>
          <tbody>
            {departments.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td>
                <td>{Math.floor(d.standardMinutes / 60)}h {d.standardMinutes % 60}m</td>
                <td>{d.memberCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

import { useEffect, useState } from 'react';
import {
  APP_NAME,
  APP_NOTICE,
  type AppRule,
  type ChildProfile,
  type DevicePlatform,
  type DeviceRecord,
  type PublicUser,
  type RuleAction,
  type WebRule,
} from '@brand-family/shared';
import { client, getToken, setToken } from './api';

type Tab = 'children' | 'devices' | 'web' | 'apps';

const PLATFORMS: DevicePlatform[] = ['ios', 'android', 'windows', 'macos', 'other'];

export function App() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('children');

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
            {user.displayName} · {user.username}
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

      {error ? <p className="error">{error}</p> : null}

      <nav className="tabs" aria-label="家长管控分区">
        {(
          [
            ['children', '孩子'],
            ['devices', '设备'],
            ['web', '网页'],
            ['apps', 'App'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'children' ? <ChildrenPanel onError={setError} /> : null}
      {tab === 'devices' ? <DevicesPanel onError={setError} /> : null}
      {tab === 'web' ? <WebPanel onError={setError} /> : null}
      {tab === 'apps' ? <AppsPanel onError={setError} /> : null}
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
      const result = needsBootstrap
        ? await client.bootstrap({ displayName, username, password })
        : await client.login({ username, password });
      onAuthed(result.token, result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'auth_failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell auth">
      <h1 className="brand">{APP_NAME}</h1>
      <p className="sub">{needsBootstrap ? '创建首位家长账号' : '家长登录'}</p>
      <form className="panel stack" onSubmit={submit} style={{ marginTop: '1.25rem' }}>
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
          密码{needsBootstrap ? '（至少 8 位）' : ''}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={needsBootstrap ? 'new-password' : 'current-password'}
            minLength={needsBootstrap ? 8 : undefined}
            required
          />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button className="primary" type="submit" disabled={busy}>
          {needsBootstrap ? '创建并进入' : '登录'}
        </button>
      </form>
    </div>
  );
}

function ChildrenPanel({ onError }: { onError: (msg: string) => void }) {
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function reload() {
    const res = await client.children();
    setChildren(res.children);
  }

  useEffect(() => {
    void reload().catch((e) => onError(e instanceof Error ? e.message : 'load_failed'));
  }, [onError]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError('');
    try {
      await client.createChild({ displayName, note: note || undefined });
      setDisplayName('');
      setNote('');
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'create_failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <form className="panel form-grid" onSubmit={add}>
        <label>
          孩子显示名
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="例如：小名或称呼"
            required
          />
        </label>
        <label>
          备注（可选）
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button className="primary" type="submit" disabled={busy}>
          添加孩子
        </button>
      </form>
      <div className="panel">
        {children.length === 0 ? (
          <p className="empty">还没有孩子档案。先添加一位孩子，再登记设备和策略。</p>
        ) : (
          <ul className="list">
            {children.map((c) => (
              <li key={c.id}>
                <div>
                  <strong>{c.displayName}</strong>
                  {c.note ? <div className="muted">{c.note}</div> : null}
                </div>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    void (async () => {
                      try {
                        await client.deleteChild(c.id);
                        await reload();
                      } catch (err) {
                        onError(err instanceof Error ? err.message : 'delete_failed');
                      }
                    })();
                  }}
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DevicesPanel({ onError }: { onError: (msg: string) => void }) {
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [childId, setChildId] = useState('');
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<DevicePlatform>('android');
  const [busy, setBusy] = useState(false);

  async function reload() {
    const [c, d] = await Promise.all([client.children(), client.devices()]);
    setChildren(c.children);
    setDevices(d.devices);
    if (!childId && c.children[0]) setChildId(c.children[0].id);
  }

  useEffect(() => {
    void reload().catch((e) => onError(e instanceof Error ? e.message : 'load_failed'));
  }, [onError]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError('');
    try {
      await client.createDevice({ childId, name, platform });
      setName('');
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'create_failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <form className="panel form-grid" onSubmit={add}>
        <label>
          孩子
          <select value={childId} onChange={(e) => setChildId(e.target.value)} required>
            <option value="" disabled>
              选择孩子
            </option>
            {children.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          设备名称
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：家里的平板"
            required
          />
        </label>
        <label>
          平台
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as DevicePlatform)}
          >
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" type="submit" disabled={busy || children.length === 0}>
          登记设备
        </button>
      </form>
      <div className="panel">
        {children.length === 0 ? (
          <p className="empty">请先在「孩子」里添加档案。</p>
        ) : devices.length === 0 ? (
          <p className="empty">还没有设备。登记后可在此查看归属与最近在线。</p>
        ) : (
          <ul className="list">
            {devices.map((d) => (
              <li key={d.id}>
                <div>
                  <strong>{d.name}</strong>
                  <div className="muted">
                    {d.childName} · {d.platform}
                    {d.lastSeenAt ? ` · 最近 ${d.lastSeenAt}` : ' · 尚未上线'}
                  </div>
                </div>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    void (async () => {
                      try {
                        await client.deleteDevice(d.id);
                        await reload();
                      } catch (err) {
                        onError(err instanceof Error ? err.message : 'delete_failed');
                      }
                    })();
                  }}
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function WebPanel({ onError }: { onError: (msg: string) => void }) {
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [rules, setRules] = useState<WebRule[]>([]);
  const [childId, setChildId] = useState('');
  const [domain, setDomain] = useState('');
  const [action, setAction] = useState<RuleAction>('block');
  const [busy, setBusy] = useState(false);

  async function reload() {
    const [c, r] = await Promise.all([client.children(), client.webRules()]);
    setChildren(c.children);
    setRules(r.rules);
    if (!childId && c.children[0]) setChildId(c.children[0].id);
  }

  useEffect(() => {
    void reload().catch((e) => onError(e instanceof Error ? e.message : 'load_failed'));
  }, [onError]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError('');
    try {
      await client.createWebRule({ childId, domain, action });
      setDomain('');
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'create_failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <form className="panel form-grid" onSubmit={add}>
        <label>
          孩子
          <select value={childId} onChange={(e) => setChildId(e.target.value)} required>
            <option value="" disabled>
              选择孩子
            </option>
            {children.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          域名
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="example.com"
            required
          />
        </label>
        <label>
          动作
          <select value={action} onChange={(e) => setAction(e.target.value as RuleAction)}>
            <option value="block">拦截</option>
            <option value="allow">允许</option>
          </select>
        </label>
        <button className="primary" type="submit" disabled={busy || children.length === 0}>
          添加网页规则
        </button>
      </form>
      <div className="panel">
        {children.length === 0 ? (
          <p className="empty">请先在「孩子」里添加档案。</p>
        ) : rules.length === 0 ? (
          <p className="empty">还没有网页规则。</p>
        ) : (
          <ul className="list">
            {rules.map((r) => (
              <li key={r.id}>
                <div>
                  <strong>{r.domain}</strong>
                  <div className="muted">
                    {r.childName} · {r.action === 'block' ? '拦截' : '允许'}
                  </div>
                </div>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    void (async () => {
                      try {
                        await client.deleteWebRule(r.id);
                        await reload();
                      } catch (err) {
                        onError(err instanceof Error ? err.message : 'delete_failed');
                      }
                    })();
                  }}
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AppsPanel({ onError }: { onError: (msg: string) => void }) {
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [rules, setRules] = useState<AppRule[]>([]);
  const [childId, setChildId] = useState('');
  const [appId, setAppId] = useState('');
  const [appLabel, setAppLabel] = useState('');
  const [action, setAction] = useState<RuleAction>('block');
  const [busy, setBusy] = useState(false);

  async function reload() {
    const [c, r] = await Promise.all([client.children(), client.appRules()]);
    setChildren(c.children);
    setRules(r.rules);
    if (!childId && c.children[0]) setChildId(c.children[0].id);
  }

  useEffect(() => {
    void reload().catch((e) => onError(e instanceof Error ? e.message : 'load_failed'));
  }, [onError]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError('');
    try {
      await client.createAppRule({
        childId,
        appId,
        appLabel: appLabel || undefined,
        action,
      });
      setAppId('');
      setAppLabel('');
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'create_failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <form className="panel form-grid" onSubmit={add}>
        <label>
          孩子
          <select value={childId} onChange={(e) => setChildId(e.target.value)} required>
            <option value="" disabled>
              选择孩子
            </option>
            {children.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          应用标识
          <input
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder="包名或 Bundle ID"
            required
          />
        </label>
        <label>
          显示名（可选）
          <input value={appLabel} onChange={(e) => setAppLabel(e.target.value)} />
        </label>
        <label>
          动作
          <select value={action} onChange={(e) => setAction(e.target.value as RuleAction)}>
            <option value="block">拦截</option>
            <option value="allow">允许</option>
          </select>
        </label>
        <button className="primary" type="submit" disabled={busy || children.length === 0}>
          添加 App 规则
        </button>
      </form>
      <div className="panel">
        {children.length === 0 ? (
          <p className="empty">请先在「孩子」里添加档案。</p>
        ) : rules.length === 0 ? (
          <p className="empty">还没有 App 规则。</p>
        ) : (
          <ul className="list">
            {rules.map((r) => (
              <li key={r.id}>
                <div>
                  <strong>{r.appLabel || r.appId}</strong>
                  <div className="muted">
                    {r.childName} · {r.appId} · {r.action === 'block' ? '拦截' : '允许'}
                  </div>
                </div>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    void (async () => {
                      try {
                        await client.deleteAppRule(r.id);
                        await reload();
                      } catch (err) {
                        onError(err instanceof Error ? err.message : 'delete_failed');
                      }
                    })();
                  }}
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

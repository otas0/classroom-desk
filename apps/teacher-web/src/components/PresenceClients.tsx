import { useEffect, useMemo, useState } from 'react';
import { GITHUB_RELEASES_BASE } from '@classroom-desk/shared';
import { API_BASE, api, getToken } from '../api';

type ClientRow = {
  studentId: string;
  displayName: string;
  studentNo: string | null;
  lastSeenAt: string;
  clientVersion: string;
  clientPlatform: string;
};

export function PresenceClients({ classId }: { classId: string }) {
  const [items, setItems] = useState<ClientRow[]>([]);
  const [versions, setVersions] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [expected, setExpected] = useState('');
  const [copyMsg, setCopyMsg] = useState('');
  const [live, setLive] = useState(false);

  async function loadHealthExpected() {
    const health = (await fetch('/health', { cache: 'no-store' })
      .then((r) => r.json())
      .catch(() => ({}))) as { studentDesktopVersion?: string; version?: string };
    setExpected(String(health.studentDesktopVersion ?? health.version ?? ''));
  }

  function applyClients(body: { items?: ClientRow[]; versions?: string[] }) {
    setItems(body.items ?? []);
    setVersions(body.versions ?? []);
  }

  async function loadOnce() {
    if (!classId) {
      setItems([]);
      return;
    }
    setErr('');
    const clients = await api<{ items: ClientRow[]; versions: string[]; count: number }>(
      `/api/v1/presence/clients?classId=${encodeURIComponent(classId)}`,
    );
    applyClients(clients);
    await loadHealthExpected();
  }

  useEffect(() => {
    if (!classId) {
      setItems([]);
      setLive(false);
      return;
    }
    let cancelled = false;
    let es: EventSource | null = null;
    let poll: number | undefined;

    void loadOnce().catch((e) => {
      if (!cancelled) setErr(e instanceof Error ? e.message : '加载失败');
    });

    const token = getToken();
    if (token && typeof EventSource !== 'undefined') {
      const url = `${API_BASE}/api/v1/presence/stream?classId=${encodeURIComponent(classId)}&token=${encodeURIComponent(token)}`;
      es = new EventSource(url);
      es.onopen = () => {
        if (!cancelled) setLive(true);
      };
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as {
            type?: string;
            items?: ClientRow[];
            versions?: string[];
          };
          if (data.type === 'presence') applyClients(data);
        } catch {
          /* ignore */
        }
      };
      es.onerror = () => {
        if (cancelled) return;
        setLive(false);
        es?.close();
        es = null;
        // Fallback poll if SSE drops
        if (poll == null) {
          poll = window.setInterval(() => void loadOnce().catch(() => undefined), 15_000);
        }
      };
    } else {
      poll = window.setInterval(() => void loadOnce().catch(() => undefined), 15_000);
    }

    return () => {
      cancelled = true;
      es?.close();
      if (poll != null) window.clearInterval(poll);
    };
  }, [classId]);

  const driftRows = useMemo(
    () =>
      items.filter(
        (row) => expected && row.clientVersion && row.clientVersion !== expected,
      ),
    [items, expected],
  );

  async function copyUpgradeTip() {
    setCopyMsg('');
    if (!expected) {
      setCopyMsg('尚无期望版本（/health）');
      return;
    }
    if (driftRows.length === 0) {
      setCopyMsg('当前无漂移机位');
      return;
    }
    const lines = [
      `【Classroom Desk 升级提示】请安装学生端 v${expected}`,
      `下载：${GITHUB_RELEASES_BASE}/tag/v${expected}`,
      `全部版本：${GITHUB_RELEASES_BASE}`,
      '',
      '需升级机位：',
      ...driftRows.map(
        (r) =>
          `- ${r.studentNo ? `${r.studentNo} ` : ''}${r.displayName}（当前 v${r.clientVersion || '未上报'}）`,
      ),
    ];
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopyMsg(`已复制 ${driftRows.length} 台漂移机位的升级提示`);
    } catch {
      setCopyMsg('剪贴板不可用，请手动选择下方文本');
      window.prompt('复制升级提示', text);
    }
  }

  return (
    <section>
      <h2>在线机位</h2>
      <p className="hint">
        按最近心跳列出本班学生桌面端（约 90 秒内）
        {live ? ' · SSE 实时' : ' · 轮询后备'}。期望安装包版本：v{expected || '—'}
        {versions.length ? ` · 已上报 ${versions.join(' / ')}` : ''}
      </p>
      <div className="row">
        <button type="button" className="secondary" onClick={() => void loadOnce().catch((e) => setErr(String(e)))}>
          刷新
        </button>
        <button
          type="button"
          className="secondary"
          disabled={driftRows.length === 0}
          onClick={() => void copyUpgradeTip()}
        >
          一键复制升级提示（{driftRows.length}）
        </button>
      </div>
      {copyMsg ? <p className="hint">{copyMsg}</p> : null}
      {err ? <p className="error">{err}</p> : null}
      {!classId ? <p className="hint">请先选择班级</p> : null}
      {classId && items.length === 0 ? (
        <p className="hint">暂无在线桌面端。请学生扫「指派学生机」QR 并完成首次配置。</p>
      ) : null}
      {items.length > 0 ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>学号</th>
              <th>姓名</th>
              <th>版本</th>
              <th>平台</th>
              <th>最后心跳</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => {
              const drift = expected && row.clientVersion && row.clientVersion !== expected;
              return (
                <tr key={row.studentId} className={drift ? 'row-warn' : undefined}>
                  <td>{row.studentNo ?? '—'}</td>
                  <td>{row.displayName}</td>
                  <td>
                    {row.clientVersion ? `v${row.clientVersion}` : '未上报'}
                    {drift ? ' · 漂移' : ''}
                  </td>
                  <td>{row.clientPlatform || '—'}</td>
                  <td>{new Date(row.lastSeenAt).toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

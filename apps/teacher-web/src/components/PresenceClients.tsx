import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_OFFLINE_LOCK_POLICY,
  GITHUB_RELEASES_BASE,
  normalizeOfflineLockPolicy,
  type OfflineLockPolicy,
} from '@classroom-desk/shared';
import { API_BASE, api, getToken } from '../api';
import { t } from '@classroom-desk/i18n';
import { ClassPresenceMatrix } from './ClassPresenceMatrix';

type ClientRow = {
  studentId: string;
  displayName: string;
  studentNo: string | null;
  lastSeenAt: string;
  clientVersion: string;
  clientPlatform: string;
  netSsid?: string;
  netZoneId?: string;
  netZoneUnauthorized?: boolean;
};

export function PresenceClients({ classId }: { classId: string }) {
  const [items, setItems] = useState<ClientRow[]>([]);
  const [versions, setVersions] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [expected, setExpected] = useState('');
  const [copyMsg, setCopyMsg] = useState('');
  const [live, setLive] = useState(false);
  const [lanTip, setLanTip] = useState('');
  const [offlinePolicy, setOfflinePolicy] = useState<OfflineLockPolicy>(() =>
    DEFAULT_OFFLINE_LOCK_POLICY(),
  );
  const offlinePolicyRef = useRef(offlinePolicy);
  offlinePolicyRef.current = offlinePolicy;
  const [peerDropMsg, setPeerDropMsg] = useState('');
  const prevIdsRef = useRef<Set<string>>(new Set());
  const primedRef = useRef(false);

  async function loadHealthExpected() {
    const health = (await fetch('/health', { cache: 'no-store' })
      .then((r) => r.json())
      .catch(() => ({}))) as { studentDesktopVersion?: string; version?: string };
    setExpected(String(health.studentDesktopVersion ?? health.version ?? ''));
  }

  function applyClients(body: { items?: ClientRow[]; versions?: string[] }) {
    const next = body.items ?? [];
    const nextIds = new Set(next.map((r) => r.studentId).filter(Boolean));
    if (primedRef.current && offlinePolicyRef.current.freezeClassOnPeerDrop === true && classId) {
      const dropped: string[] = [];
      for (const id of prevIdsRef.current) {
        if (!nextIds.has(id)) dropped.push(id);
      }
      // Ignore total wipe (SSE blip / class switch). Require partial drop while others remain,
      // or a single-seat room losing its only client.
      const partialDrop =
        dropped.length > 0 &&
        (nextIds.size > 0 || prevIdsRef.current.size === 1) &&
        dropped.length < prevIdsRef.current.size + (nextIds.size === 0 ? 0 : 1);
      const singleSeatDrop = prevIdsRef.current.size === 1 && dropped.length === 1 && nextIds.size === 0;
      if (partialDrop || singleSeatDrop) {
        setPeerDropMsg(
          t('检测到 {v0} 台掉线 → 已下发全班踢网+冻结（安全局）', { v0: String(dropped.length) }),
        );
        void api('/api/v1/deep-lock/action', {
          method: 'POST',
          body: JSON.stringify({ action: 'kick_class', classId }),
        }).catch(() => undefined);
      }
    }
    primedRef.current = true;
    prevIdsRef.current = nextIds;
    setItems(next);
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
    try {
      const u = await api<{ tipTemplate?: string }>('/api/v1/upgrades');
      setLanTip(u.tipTemplate ?? '');
    } catch {
      setLanTip('');
    }
    try {
      const q = classId ? `?classId=${encodeURIComponent(classId)}` : '';
      const dc = await api<{ offline?: OfflineLockPolicy }>(`/api/v1/device-control${q}`);
      setOfflinePolicy(normalizeOfflineLockPolicy(dc.offline));
    } catch {
      /* keep defaults */
    }
  }

  useEffect(() => {
    if (!classId) {
      setItems([]);
      setLive(false);
      primedRef.current = false;
      prevIdsRef.current = new Set();
      return;
    }
    primedRef.current = false;
    prevIdsRef.current = new Set();
    let cancelled = false;
    let es: EventSource | null = null;
    let poll: number | undefined;

    void loadOnce().catch((e) => {
      if (!cancelled) setErr(e instanceof Error ? e.message : t('加载失败'));
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
      setCopyMsg(t('尚无期望版本（/health）'));
      return;
    }
    if (driftRows.length === 0) {
      setCopyMsg(t('当前无漂移机位'));
      return;
    }
    const lines = [
      `【Classroom Desk 升级提示】请安装学生端 v${expected}`,
      lanTip || `下载：${GITHUB_RELEASES_BASE}/tag/v${expected}`,
      `GitHub：${GITHUB_RELEASES_BASE}/tag/v${expected}`,
      '',
      t('需升级机位：'),
      ...driftRows.map(
        (r) =>
          `- ${r.studentNo ? `${r.studentNo} ` : ''}${r.displayName}（当前 v${r.clientVersion || t('未上报')}）`,
      ),
    ];
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopyMsg(`已复制 ${driftRows.length} 台漂移机位的升级提示`);
    } catch {
      setCopyMsg(t('剪贴板不可用，请手动选择下方文本'));
      window.prompt('复制升级提示', text);
    }
  }

  return (
    <section data-testid="presence-clients">
      <ClassPresenceMatrix classId={classId} />
      <h2>{t('在线机位')}</h2>
      <p className="hint">
        {t('按最近心跳列出本班学生桌面端（约 90 秒内）')}
        {live ? t(' · SSE 实时') : t(' · 轮询后备')}
        {t('。期望安装包版本：')}v{expected || '—'}
        {versions.length ? ` · ${t('已上报')} ${versions.join(' / ')}` : ''}
      </p>
      <p className="hint">
        {t(
          '掉线机位：日常默认只锁该学生本机。武装「最高保密级」后会开启全班连坐；也可在下方「有学生掉线时」随时改回只锁该生。',
        )}
      </p>
      {peerDropMsg ? <p className="hint" data-testid="presence-peer-drop">{peerDropMsg}</p> : null}
      <div className="row">
        <button type="button" className="secondary" onClick={() => void loadOnce().catch((e) => setErr(String(e)))}>
          {t('刷新')}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={driftRows.length === 0}
          onClick={() => void copyUpgradeTip()}
        >
          {t('一键复制升级提示')}（{driftRows.length}）
        </button>
      </div>
      {copyMsg ? <p className="hint">{copyMsg}</p> : null}
      {err ? <p className="error">{err}</p> : null}
      {!classId ? <p className="hint">{t('请先选择班级')}</p> : null}
      {classId && items.length === 0 ? (
        <p className="hint">{t('暂无在线桌面端。请学生扫「指派学生机」QR 并完成首次配置。')}</p>
      ) : null}
      {items.length > 0 ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('学号')}</th>
              <th>{t('姓名')}</th>
              <th>{t('网络')}</th>
              <th>{t('版本')}</th>
              <th>{t('平台')}</th>
              <th>{t('最后心跳')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => {
              const drift = expected && row.clientVersion && row.clientVersion !== expected;
              const badNet = Boolean(row.netZoneUnauthorized);
              return (
                <tr
                  key={row.studentId}
                  className={badNet ? 'row-danger' : drift ? 'row-warn' : undefined}
                  data-testid={badNet ? 'presence-never-student-net' : undefined}
                >
                  <td>{row.studentNo ?? '—'}</td>
                  <td>{row.displayName}</td>
                  <td>
                    {badNet ? (
                      <span className="badge-danger" title={row.netSsid || ''}>
                        {t('未授权网')}
                        {row.netSsid ? ` · ${row.netSsid}` : ''}
                      </span>
                    ) : (
                      row.netSsid || '—'
                    )}
                  </td>
                  <td>
                    {row.clientVersion ? `v${row.clientVersion}` : t('未上报')}
                    {drift ? t(' · 漂移') : ''}
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

import { useEffect, useState } from 'react';
import { t } from '@classroom-desk/i18n';
import { api } from '../api';

type Live = {
  count: number;
  recent: Array<{ clientKey: string; ip?: string; decision?: string; at?: string }>;
  shield?: { active?: string; lastError?: string | null; healthy?: boolean; lastHeartbeatAt?: string };
};

/** Admit IP count + last allow/deny + adapter heartbeat for teacher Network page. */
export function ShieldAllowlistLive() {
  const [live, setLive] = useState<Live | null>(null);
  const [err, setErr] = useState('');
  const [exportMsg, setExportMsg] = useState('');

  async function load() {
    setErr('');
    const body = await api<Live>('/api/v1/gateway/allowlist-live');
    setLive(body);
  }

  useEffect(() => {
    void load().catch((e) => setErr(e instanceof Error ? e.message : t('加载失败')));
    const id = window.setInterval(() => void load().catch(() => undefined), 10_000);
    return () => window.clearInterval(id);
  }, []);

  async function exportEvidence() {
    setExportMsg('');
    try {
      const r = await api<{ ok: boolean; path?: string; detail?: string }>(
        '/api/v1/gateway/export-live-evidence',
        { method: 'POST', body: JSON.stringify({}) },
      );
      setExportMsg(r.path ? `${t('已写入')} ${r.path}` : r.detail || t('完成'));
    } catch (e) {
      setExportMsg(e instanceof Error ? e.message : t('失败'));
    }
  }

  return (
    <section data-testid="shield-allowlist-live">
      <h3>{t('放行表实况')}</h3>
      <p className="hint">
        {t('当前放行')} {live?.count ?? 0} · Shield {live?.shield?.active ?? '—'}
        {live?.shield?.healthy === false ? ` · ${t('心跳异常')}` : ''}
        {live?.shield?.lastError ? ` · ${live.shield.lastError}` : ''}
      </p>
      <div className="row">
        <button type="button" className="secondary" onClick={() => void load()}>
          {t('刷新')}
        </button>
        <button type="button" className="secondary" onClick={() => void exportEvidence()}>
          {t('导出脱敏证据包')}
        </button>
      </div>
      {exportMsg ? <p className="hint">{exportMsg}</p> : null}
      {err ? <p className="error">{err}</p> : null}
      <ul data-testid="shield-recent-decisions">
        {(live?.recent ?? []).slice(0, 5).map((row, i) => (
          <li key={`${row.clientKey}-${i}`}>
            {row.decision ?? 'allow'} · {row.ip || row.clientKey}
            {row.at ? ` · ${new Date(row.at).toLocaleTimeString()}` : ''}
          </li>
        ))}
      </ul>
    </section>
  );
}

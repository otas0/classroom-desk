import { useEffect, useState } from 'react';
import { t } from '@classroom-desk/i18n';
import { api, API_BASE, getToken } from '../api';
import { isAdmin, isAssistant } from '../authRole';

type Retention = {
  retentionDays: number;
  rowCount: number;
  minDays: number;
  maxDays: number;
  deskDnsFollowDeepLock?: boolean;
};

type AliasReport = {
  ok: boolean;
  remoteReadable: boolean;
  shieldId: string;
  missingOnGateway: string[];
  extraOnGateway: string[];
  detail: string;
};

/** Settings: audit retention, DeskDNS follow deep-lock, compliance export, live archive. */
export function ComplianceSettingsPanel() {
  const readonly = isAssistant();
  const admin = isAdmin();
  const [ret, setRet] = useState<Retention | null>(null);
  const [days, setDays] = useState(180);
  const [follow, setFollow] = useState(true);
  const [alias, setAlias] = useState<AliasReport | null>(null);
  const [chain, setChain] = useState<{ ok?: boolean; checked?: number; tip?: string } | null>(
    null,
  );
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const [r, a, c] = await Promise.all([
      api<Retention>('/api/v1/compliance/audit-retention'),
      api<AliasReport>('/api/v1/compliance/alias-reconcile').catch(() => null),
      api<{ ok?: boolean; checked?: number; tip?: string }>(
        '/api/v1/compliance/audit-chain',
      ).catch(() => null),
    ]);
    setRet(r);
    setDays(r.retentionDays);
    setFollow(r.deskDnsFollowDeepLock !== false);
    if (a) setAlias(a);
    if (c) setChain(c);
  }

  useEffect(() => {
    void load().catch(() => undefined);
  }, []);

  async function save() {
    if (readonly || !admin) {
      setMsg(t('留存与联动仅管理员可改'));
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const body = await api<Retention>('/api/v1/compliance/audit-retention', {
        method: 'PATCH',
        body: JSON.stringify({ retentionDays: days, deskDnsFollowDeepLock: follow }),
      });
      setRet(body);
      setMsg(t('已保存合规留存与 DeskDNS 联动'));
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('保存失败'));
    } finally {
      setBusy(false);
    }
  }

  async function exportPack() {
    if (readonly) return;
    setBusy(true);
    setMsg('');
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/api/v1/compliance/export-pack`, {
        method: 'POST',
        headers,
        body: '{}',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const m = /filename="([^"]+)"/.exec(cd);
      const name = m?.[1] || 'compliance-pack.json';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      setMsg(t('已下载合规证据包'));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('导出失败'));
    } finally {
      setBusy(false);
    }
  }

  async function archiveLive() {
    if (!admin) {
      setMsg(t('live 归档仅管理员'));
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const body = await api<{
        ok: boolean;
        path?: string;
        gaHardGate?: string;
        detail?: string;
      }>('/api/v1/compliance/archive-live-evidence', { method: 'POST', body: '{}' });
      setMsg(
        body.ok
          ? `${t('已触发 live 证据归档')} · ${body.path ?? ''}`
          : `${t('归档未完全成功')} · ${body.detail ?? ''}`,
      );
      if (body.gaHardGate) setMsg((m) => `${m}\n${body.gaHardGate}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('归档失败'));
    } finally {
      setBusy(false);
    }
  }

  async function refreshAlias() {
    setBusy(true);
    try {
      const a = await api<AliasReport>('/api/v1/compliance/alias-reconcile');
      setAlias(a);
      setMsg(
        a.ok
          ? t('网关 alias 对账一致')
          : t('网关 alias 对账有差异（见下方）'),
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('对账失败'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="compliance-settings-panel" data-testid="compliance-settings-panel">
      <h3>{t('等保 / 密评材料（网络双线）')}</h3>
      <p className="hint">
        {t(
          'S 档=学校最高硬化（非绝密）。控制矩阵见 docs/COMPLIANCE_MLPS.md。留存/live 归档仅管理员；教师可导出证据包与对账。GA 仍须学校真机 live。',
        )}
      </p>
      {chain ? (
        <p
          className={chain.ok ? 'hint' : 'error'}
          data-testid="compliance-audit-chain"
        >
          {t('审计哈希链')}：{chain.ok ? t('完好') : t('异常')}
          {chain.checked != null ? ` · ${chain.checked}` : ''}
          {chain.tip ? ` · ${chain.tip}` : ''}
        </p>
      ) : null}
      <label className="row">
        <span>{t('审计留存（天）')}</span>
        <input
          type="number"
          min={ret?.minDays ?? 30}
          max={ret?.maxDays ?? 730}
          value={days}
          disabled={readonly || !admin || busy}
          data-testid="compliance-retention-days"
          onChange={(e) => setDays(Number(e.target.value))}
        />
        <span className="hint">
          {t('当前约 {v0} 条', { v0: String(ret?.rowCount ?? 0) })}
        </span>
      </label>
      <label className="row">
        <input
          type="checkbox"
          checked={follow}
          disabled={readonly || !admin || busy}
          data-testid="compliance-deskdns-follow"
          onChange={(e) => setFollow(e.target.checked)}
        />
        <span>{t('DeskDNS 跟随深锁（冻结/试卷档强制 exam，下课恢复）')}</span>
      </label>
      {!readonly ? (
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {admin ? (
            <button type="button" disabled={busy} onClick={() => void save()}>
              {t('保存')}
            </button>
          ) : null}
          <button
            type="button"
            className="secondary"
            disabled={busy}
            data-testid="compliance-export-pack"
            onClick={() => void exportPack()}
          >
            {t('一键导出合规包')}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            data-testid="compliance-alias-reconcile"
            onClick={() => void refreshAlias()}
          >
            {t('网关 alias 对账')}
          </button>
          {admin ? (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              data-testid="compliance-archive-live"
              onClick={() => void archiveLive()}
            >
              {t('归档 live 证据')}
            </button>
          ) : null}
        </div>
      ) : (
        <p className="hint">{t('助教只读')}</p>
      )}
      {alias ? (
        <p
          className={alias.ok ? 'hint' : 'error'}
          data-testid="compliance-alias-summary"
        >
          Shield={alias.shieldId}
          {alias.remoteReadable ? '' : ` · ${t('远端只读不可用')}`}
          {alias.missingOnGateway?.length
            ? ` · ${t('网关缺失')} ${alias.missingOnGateway.length}`
            : ''}
          {alias.extraOnGateway?.length
            ? ` · ${t('网关多余')} ${alias.extraOnGateway.length}`
            : ''}
          {alias.detail ? ` · ${alias.detail}` : ''}
        </p>
      ) : null}
      {msg ? (
        <p className="hint" style={{ whiteSpace: 'pre-wrap' }} data-testid="compliance-settings-msg">
          {msg}
        </p>
      ) : null}
    </section>
  );
}

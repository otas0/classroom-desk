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
  maxSecrecyMode?: boolean;
  maxSecrecyLockdown?: boolean;
  maxSecrecyLockdownReason?: string | null;
  dualPath?: { required?: boolean; ok?: boolean; detail?: string };
  auditSealExists?: boolean;
};

type AliasReport = {
  ok: boolean;
  remoteReadable: boolean;
  shieldId: string;
  missingOnGateway: string[];
  extraOnGateway: string[];
  detail: string;
};

/** Settings: max-secrecy, audit retention, DeskDNS follow, compliance export, live archive. */
export function ComplianceSettingsPanel() {
  const readonly = isAssistant();
  const admin = isAdmin();
  const [ret, setRet] = useState<Retention | null>(null);
  const [days, setDays] = useState(180);
  const [follow, setFollow] = useState(true);
  const [maxSec, setMaxSec] = useState(true);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [secondPassword, setSecondPassword] = useState('');
  const [alias, setAlias] = useState<AliasReport | null>(null);
  const [chain, setChain] = useState<{
    ok?: boolean;
    checked?: number;
    tip?: string;
    keyed?: boolean;
    maxSecrecyMode?: boolean;
  } | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const [r, a, c] = await Promise.all([
      api<Retention>('/api/v1/compliance/audit-retention'),
      api<AliasReport>('/api/v1/compliance/alias-reconcile').catch(() => null),
      api<{
        ok?: boolean;
        checked?: number;
        tip?: string;
        keyed?: boolean;
        maxSecrecyMode?: boolean;
      }>('/api/v1/compliance/audit-chain').catch(() => null),
    ]);
    setRet(r);
    setDays(r.retentionDays);
    setFollow(r.deskDnsFollowDeepLock !== false);
    setMaxSec(r.maxSecrecyMode !== false);
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
        body: JSON.stringify({
          retentionDays: days,
          deskDnsFollowDeepLock: follow,
          confirmPassword: confirmPassword || undefined,
        }),
      });
      setRet(body);
      setMsg(t('已保存合规留存与 DeskDNS 联动'));
      setConfirmPassword('');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('保存失败'));
    } finally {
      setBusy(false);
    }
  }

  async function saveMaxSec() {
    if (!admin) {
      setMsg(t('最高保密档仅管理员可改'));
      return;
    }
    if (!confirmPassword.trim()) {
      setMsg(t('请先输入管理员密码再切换最高保密档'));
      return;
    }
    if (!maxSec && !secondPassword.trim()) {
      setMsg(t('关闭最高保密档须双人：再填教师口令（secondPassword）'));
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const body = await api<{
        maxSecrecyMode?: boolean;
        note?: string;
      }>('/api/v1/compliance/max-secrecy', {
        method: 'PATCH',
        body: JSON.stringify({
          maxSecrecyMode: maxSec,
          confirmPassword: confirmPassword.trim(),
          secondPassword: secondPassword.trim() || undefined,
        }),
      });
      setMsg(
        body.maxSecrecyMode
          ? t('已开启最高保密档（空域·双人·落盘加密·短会话）')
          : t('已关闭最高保密档（仍可用 S 档）'),
      );
      setConfirmPassword('');
      setSecondPassword('');
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('切换失败'));
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
      const hmac = res.headers.get('X-Pack-HMAC');
      setMsg(
        hmac
          ? `${t('已下载合规证据包')} · HMAC ${hmac.slice(0, 12)}…`
          : t('已下载合规证据包'),
      );
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
          '最高保密档=学校产品内最严机制（双线 AND、HMAC 审计密封、深锁再认证、心跳失败收紧）。不是国家绝密。GA 仍须学校真机 live。',
        )}
      </p>
      {chain ? (
        <p
          className={chain.ok ? 'hint' : 'error'}
          data-testid="compliance-audit-chain"
        >
          {t('审计哈希链')}：{chain.ok ? t('完好') : t('异常')}
          {chain.keyed ? ` · HMAC` : ''}
          {chain.checked != null ? ` · ${chain.checked}` : ''}
          {chain.tip ? ` · ${chain.tip}` : ''}
          {ret?.auditSealExists ? ` · ${t('密封镜像存在')}` : ''}
        </p>
      ) : null}
      {ret?.maxSecrecyLockdown ? (
        <p className="error" data-testid="compliance-maxsec-lockdown">
          {t('考试态心跳失败收紧中')}
          {ret.maxSecrecyLockdownReason ? ` · ${ret.maxSecrecyLockdownReason}` : ''}
        </p>
      ) : null}
      {ret?.dualPath?.required && !ret.dualPath.ok ? (
        <p className="error" data-testid="compliance-dual-path">
          {t('最高保密档要求 Shield 与 DeskDNS 同时武装')}
          {ret.dualPath.detail ? ` · ${ret.dualPath.detail}` : ''}
        </p>
      ) : null}
      {admin ? (
        <>
          <label className="row">
            <input
              type="checkbox"
              checked={maxSec}
              disabled={readonly || busy}
              data-testid="compliance-max-secrecy"
              onChange={(e) => setMaxSec(e.target.checked)}
            />
            <span>{t('最高保密档（max_secrecy_mode）')}</span>
          </label>
          <label className="row">
            <span>{t('管理员再认证密码')}</span>
            <input
              type="password"
              value={confirmPassword}
              disabled={busy}
              autoComplete="current-password"
              data-testid="compliance-confirm-password"
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </label>
          <label className="row">
            <span>{t('双人第二口令（关保密档须教师口令）')}</span>
            <input
              type="password"
              value={secondPassword}
              disabled={busy}
              autoComplete="off"
              data-testid="compliance-second-password"
              onChange={(e) => setSecondPassword(e.target.value)}
            />
          </label>
          <button type="button" disabled={busy} onClick={() => void saveMaxSec()}>
            {t('应用最高保密档')}
          </button>
        </>
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

import { useEffect, useState } from 'react';
import { t } from '@classroom-desk/i18n';
import { API_BASE, api } from '../api';

type HealthNet = {
  deskDns?: { enabled?: boolean; running?: boolean; port?: number | null; error?: string | null };
  shield?: {
    active?: string;
    displayName?: string;
    adapters?: string[];
    lastError?: { at?: string; message?: string } | null;
  };
};

type DeskDnsCheck = {
  ok?: boolean;
  listening53?: boolean | null;
  probeTool?: string;
  ssSample?: string[];
  hint?: string | null;
  deskDns?: HealthNet['deskDns'];
};

type SignHealth = {
  ok?: boolean;
  requireSsidSig?: boolean;
  signRoundTrip?: boolean;
  unsignedRejectedWhenRequired?: boolean | null;
  detail?: string;
  samplePath?: string;
};

/** Compact /health card for DeskDNS + Shield + sign-ssid self-check. */
export function HealthNetCard() {
  const [h, setH] = useState<HealthNet>({});
  const [err, setErr] = useState('');
  const [dnsCheck, setDnsCheck] = useState<DeskDnsCheck | null>(null);
  const [signHealth, setSignHealth] = useState<SignHealth | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function refreshHealth() {
    const res = await fetch(`${API_BASE}/health`, { cache: 'no-store' });
    const body = (await res.json()) as HealthNet;
    setH(body);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await refreshHealth();
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : t('加载失败'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function runDeskDnsCheck() {
    setBusy(true);
    setErr('');
    try {
      const r = await api<DeskDnsCheck>('/api/v1/health/deskdns-check');
      setDnsCheck(r);
      await refreshHealth();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('DeskDNS 检测失败'));
    } finally {
      setBusy(false);
    }
  }

  async function runSignHealth() {
    setBusy(true);
    setErr('');
    setCopied(false);
    try {
      const r = await api<SignHealth>('/api/v1/gateway/sign-ssid/health');
      setSignHealth(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('SSID 签名自检失败'));
    } finally {
      setBusy(false);
    }
  }

  async function copySamplePath() {
    const path = signHealth?.samplePath;
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
    } catch {
      setErr(t('复制失败'));
    }
  }

  async function clearShieldError() {
    setBusy(true);
    setErr('');
    try {
      await api('/api/v1/health/shield-error/clear', { method: 'POST', body: '{}' });
      await refreshHealth();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('清除失败'));
    } finally {
      setBusy(false);
    }
  }

  async function retryHealth() {
    setBusy(true);
    setErr('');
    try {
      await refreshHealth();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('加载失败'));
    } finally {
      setBusy(false);
    }
  }

  const dns = h.deskDns;
  const shield = h.shield;

  return (
    <section className="health-net-card" data-testid="health-net-card">
      <h3>{t('网络适配状态')}</h3>
      {err ? <p className="error">{err}</p> : null}
      <p className="hint" data-testid="health-desk-dns">
        DeskDNS：
        {!dns?.enabled
          ? t('未启用')
          : dns.running
            ? `${t('运行中')} udp/${dns.port ?? '—'}`
            : `${t('未绑定')}${dns.error ? `（${dns.error}）` : ''}`}
      </p>
      <p className="hint" data-testid="health-shield">
        Shield：{shield?.displayName ?? '—'}（{shield?.active ?? 'mock'}）
        {shield?.adapters?.length ? ` · ${shield.adapters.join(' / ')}` : ''}
        {shield?.lastError?.message
          ? ` · lastError：${shield.lastError.message}${
              shield.lastError.at ? ` @ ${shield.lastError.at}` : ''
            }`
          : ''}
      </p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          data-testid="deskdns-check-btn"
          onClick={() => void runDeskDnsCheck()}
        >
          {t('检测 DeskDNS / :53')}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          data-testid="sign-ssid-health-btn"
          onClick={() => void runSignHealth()}
        >
          {t('SSID 签名自检')}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          data-testid="health-retry-btn"
          onClick={() => void retryHealth()}
        >
          {t('刷新重试')}
        </button>
        {shield?.lastError?.message ? (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            data-testid="shield-error-clear-btn"
            onClick={() => void clearShieldError()}
          >
            {t('清除 Shield 错误')}
          </button>
        ) : null}
      </div>
      {dnsCheck ? (
        <p className="hint" data-testid="deskdns-check-result">
          {dnsCheck.ok ? t('DeskDNS 检测通过') : t('DeskDNS 检测异常')}
          {dnsCheck.probeTool ? ` · ${dnsCheck.probeTool}` : ''}
          {dnsCheck.listening53 === true ? ' · udp/53' : ''}
          {dnsCheck.listening53 === false ? ` · ${t('未监听 53')}` : ''}
          {dnsCheck.hint ? ` · ${dnsCheck.hint}` : ''}
        </p>
      ) : null}
      {signHealth ? (
        <div className="hint" data-testid="sign-ssid-health-result">
          <p>
            {signHealth.ok ? t('签名往返正常') : t('签名自检失败')}
            {signHealth.requireSsidSig ? ` · ${t('已强制签名')}` : ''}
            {signHealth.detail ? ` · ${signHealth.detail}` : ''}
          </p>
          {signHealth.samplePath ? (
            <p>
              <code data-testid="sign-ssid-sample-path">{signHealth.samplePath}</code>{' '}
              <button
                type="button"
                className="linkish"
                data-testid="sign-ssid-copy-path"
                onClick={() => void copySamplePath()}
              >
                {copied ? t('已复制') : t('复制路径')}
              </button>
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

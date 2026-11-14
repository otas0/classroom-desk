import { useEffect, useState } from 'react';
import { t } from '@classroom-desk/i18n';
import { API_BASE, api } from '../api';

type HealthNet = {
  deskDns?: { enabled?: boolean; running?: boolean; port?: number | null; error?: string | null };
  enterprise8021xRequired?: boolean;
  enterprise8021x?: {
    required?: boolean;
    idp?: string;
    staffSsid?: string;
    staffVlan?: string;
    studentSsid?: string;
    studentVlan?: string;
  };
  examBox?: {
    serial?: string | null;
    imageTag?: string | null;
    hardwareAccepted?: boolean;
    acceptedAt?: string | null;
    hardwareSku?: boolean;
  };
  capabilities?: {
    examBox?: boolean;
    examBoxHardware?: boolean;
    enterprise8021x?: boolean;
  };
  shield?: {
    active?: string;
    displayName?: string;
    adapters?: string[];
    lastError?: { at?: string; message?: string } | null;
  };
  tls?: { mode?: string; hint?: string; example?: string };
};

type DeskDnsCheck = {
  ok?: boolean;
  listening53?: boolean | null;
  probeTool?: string;
  ssSample?: string[];
  hint?: string | null;
  deskDns?: HealthNet['deskDns'];
  dnsResolution?: {
    hostname?: string;
    resolved?: string[];
    pointsAtTeacher?: boolean | null;
    teacherIps?: string[];
    error?: string;
  };
  studentDnsLimitation?: string;
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
  const [probeHost, setProbeHost] = useState('');

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
        const s = await api<{ deskdnsProbeHostname?: string }>('/api/v1/settings');
        if (!cancelled) setProbeHost(String(s.deskdnsProbeHostname ?? ''));
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
      <details className="deskdns-wizard" data-testid="deskdns-wizard" open={!dns?.running}>
        <summary>{t('本教室只改 DNS（DeskDNS）')}</summary>
        <ol className="hint">
          <li>{t('教师机启动前设置 CLASSROOM_DESK_DNS=1（可选 CLASSROOM_DESK_DNS_PORT=53）')}</li>
          <li>{t('机房 DHCP 把 DNS 指到本教师机 IP（勿指错网关）')}</li>
          <li>{t('点下方「检测 DeskDNS」确认监听；详情见 docs/DESKDNS_PORT53.md')}</li>
          <li>{t('可选：填写探针域名（学生机常解析的 hostname），检测会核对 A 记录是否落在本机 LAN IP')}</li>
        </ol>
        <label>
          {t('DeskDNS 探针域名')}
          <input
            value={probeHost}
            onChange={(e) => setProbeHost(e.target.value)}
            placeholder="portal.school.edu"
            data-testid="deskdns-probe-hostname"
          />
        </label>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() =>
            void api('/api/v1/settings', {
              method: 'PATCH',
              body: JSON.stringify({ deskdnsProbeHostname: probeHost.trim() }),
            }).catch((e) => setErr(e instanceof Error ? e.message : t('保存失败')))
          }
        >
          {t('保存探针域名')}
        </button>
      </details>
      <p className="hint" data-testid="health-desk-dns">
        DeskDNS：
        {!dns?.enabled
          ? t('未启用')
          : dns.running
            ? `${t('运行中')} udp/${dns.port ?? '—'}`
            : `${t('未绑定')}${dns.error ? `（${dns.error}）` : ''}`}{' '}
        <a
          href="https://github.com/otas0/classroom-desk/blob/main/docs/DESKDNS_PORT53.md"
          target="_blank"
          rel="noreferrer"
        >
          :53
        </a>
      </p>
      <p className="hint" data-testid="health-tls">
        TLS：{t('默认教室 HTTP')}
        {h.tls?.example ? ` · ${h.tls.example}` : ''}{' '}
        <a
          href="https://github.com/otas0/classroom-desk/blob/main/docs/TLS_REVERSE_PROXY.md"
          target="_blank"
          rel="noreferrer"
        >
          docs/TLS_REVERSE_PROXY.md
        </a>
      </p>
      <p className="hint" data-testid="health-enterprise-8021x">
        802.1X（IT）：
        {h.enterprise8021xRequired || h.enterprise8021x?.required
          ? t('已要求 802.1X')
          : t('未勾选要求')}
        {h.enterprise8021x?.idp ? ` · IdP ${h.enterprise8021x.idp}` : ` · ${t('IdP 未登记')}`}
        {h.enterprise8021x?.staffSsid
          ? ` · ${t('教工')} ${h.enterprise8021x.staffSsid}/${h.enterprise8021x.staffVlan || '—'}`
          : ''}
        {h.enterprise8021x?.studentSsid
          ? ` · ${t('学生')} ${h.enterprise8021x.studentSsid}/${h.enterprise8021x.studentVlan || '—'}`
          : ''}{' '}
        <a
          href="https://github.com/otas0/classroom-desk/blob/main/deploy/radius/README.md"
          target="_blank"
          rel="noreferrer"
        >
          deploy/radius/
        </a>
      </p>
      <p className="hint" data-testid="health-exam-box">
        Exam Box：
        {h.capabilities?.examBoxHardware || h.examBox?.hardwareSku
          ? `${t('量产已验收')}${h.examBox?.serial ? ` · ${h.examBox.serial}` : ''}${
              h.examBox?.imageTag ? ` · ${h.examBox.imageTag}` : ''
            }`
          : h.capabilities?.examBox
            ? `${t('文档/compose 已交付')} · ${t('量产硬件待验收')}`
            : t('未交付')}{' '}
        <a
          href="https://github.com/otas0/classroom-desk/blob/main/deploy/exam-box/HARDWARE.md"
          target="_blank"
          rel="noreferrer"
        >
          deploy/exam-box/HARDWARE.md
        </a>
      </p>
      <p className="hint" data-testid="health-shield">
        Shield：
        {!shield?.active || shield.active === 'off'
          ? t('未配置（需 OPNsense / UniFi / HTTP）')
          : `${shield.displayName ?? '—'}（${shield.active}）`}
        {shield?.active === 'http' ? ` · ${t('HTTP/lab 网关')}` : ''}
        {shield?.adapters?.length
          ? ` · ${t('可选')}：${shield.adapters.join(' / ')}`
          : ''}
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
          {dnsCheck.dnsResolution?.hostname
            ? ` · resolve ${dnsCheck.dnsResolution.hostname} → ${
                dnsCheck.dnsResolution.resolved?.join(', ') || '—'
              }`
            : ''}
          {dnsCheck.dnsResolution?.pointsAtTeacher === true ? ` · ${t('DNS 指向教师机')}` : ''}
          {dnsCheck.dnsResolution?.pointsAtTeacher === false ? ` · ${t('DNS 未指向教师机')}` : ''}
        </p>
      ) : null}
      {dnsCheck?.studentDnsLimitation ? (
        <p className="hint" data-testid="deskdns-student-limitation">
          {dnsCheck.studentDnsLimitation}
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

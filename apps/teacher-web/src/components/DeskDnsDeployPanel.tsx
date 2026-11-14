import { useCallback, useEffect, useState } from 'react';
import { t, te } from '@classroom-desk/i18n';
import { API_BASE, api } from '../api';
import { isAssistant } from '../authRole';
import type { AssignedAccessGate } from './AssignedAccessBanner';
import type { LabGoLiveGate } from './LabGoLivePanel';

type HealthDesk = {
  deskDns?: { enabled?: boolean; running?: boolean; port?: number | null; error?: string | null };
  lanIps?: string[];
  advertiseLanIp?: string | null;
  suggestedApiBase?: string;
};

type DeskDnsCheck = {
  ok?: boolean;
  hint?: string | null;
  deskDns?: HealthDesk['deskDns'];
  dnsResolution?: {
    hostname?: string;
    pointsAtTeacher?: boolean | null;
    teacherIps?: string[];
    error?: string;
  };
};

/**
 * First-class in-product DeskDNS deploy entry (not a separate SKU).
 * Enable / port / status / probe / DHCP copy — policy syncs with Classroom Desk.
 */
export function DeskDnsDeployPanel({
  aaGate,
  labGate,
}: {
  aaGate?: AssignedAccessGate;
  labGate?: LabGoLiveGate;
}) {
  const [enabled, setEnabled] = useState(false);
  const [port, setPort] = useState(5353);
  const [health, setHealth] = useState<HealthDesk>({});
  const [check, setCheck] = useState<DeskDnsCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const readonly = isAssistant();

  const refresh = useCallback(async () => {
    const [s, h] = await Promise.all([
      api<{ deskDnsEnabled?: boolean; deskDnsPort?: number }>('/api/v1/settings'),
      fetch(`${API_BASE}/health`, { cache: 'no-store' }).then((r) => r.json() as Promise<HealthDesk>),
    ]);
    setEnabled(Boolean(s.deskDnsEnabled));
    if (s.deskDnsPort != null && Number.isFinite(Number(s.deskDnsPort))) {
      setPort(Number(s.deskDnsPort));
    }
    setHealth(h);
  }, []);

  useEffect(() => {
    void refresh().catch(() => undefined);
    const id = window.setInterval(() => void refresh().catch(() => undefined), 15_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  async function save() {
    if (readonly) return;
    setBusy(true);
    setMsg('');
    try {
      await api('/api/v1/settings', {
        method: 'PATCH',
        body: JSON.stringify({ deskDnsEnabled: enabled, deskDnsPort: port }),
      });
      await refresh();
      setMsg(t('已保存 DeskDNS（已尝试重新绑定）'));
    } catch (e) {
      setMsg(te(e, t('保存失败')));
    } finally {
      setBusy(false);
    }
  }

  async function runProbe() {
    setBusy(true);
    setMsg('');
    try {
      const r = await api<DeskDnsCheck>('/api/v1/health/deskdns-check');
      setCheck(r);
      setMsg(r.ok ? t('DeskDNS 检测通过') : t('DeskDNS 检测异常'));
      await refresh();
    } catch (e) {
      setMsg(te(e, t('DeskDNS 检测失败')));
    } finally {
      setBusy(false);
    }
  }

  const dns = health.deskDns;
  const lanIp =
    String(health.advertiseLanIp ?? '').trim() ||
    (Array.isArray(health.lanIps) ? String(health.lanIps[0] ?? '') : '');
  const dhcpHint =
    lanIp && port
      ? port === 53
        ? t('DHCP DNS 设为 {v0}（UDP/53）', { v0: lanIp })
        : t('DHCP DNS 设为 {v0}，非标端口 {v1}（路由器须支持）', {
            v0: lanIp,
            v1: String(port),
          })
      : t('尚未检测到教师机 LAN IP，请先在设置中填写广播 IP');

  async function copyDhcp() {
    const text = [
      dhcpHint,
      lanIp ? `Teacher LAN: ${lanIp}` : '',
      `DeskDNS port: ${port}`,
      health.suggestedApiBase ? `API: ${health.suggestedApiBase}` : '',
      `Policy: ${API_BASE}/api/v1/desk-dns/policy`,
      'AA: docs/EXIT_LOCK_MDM.md',
      'DeskDNS: docs/DESKDNS_PORT53.md',
    ]
      .filter(Boolean)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setMsg(t('复制失败'));
    }
  }

  return (
    <section className="deskdns-deploy-panel" data-testid="deskdns-deploy-panel">
      <h3>{t('部署 DeskDNS')}</h3>
      <p className="hint">
        {t(
          'DeskDNS 是本产品内模块（非独立产品线）。启用后学生机 DHCP 指向本讲台，拉黑域名与深锁策略与讲台互通。旁路机可轮询 /api/v1/desk-dns/policy。',
        )}
      </p>

      <p className="hint" data-testid="deskdns-deploy-status">
        {t('状态：')}
        {dns?.enabled
          ? dns.running
            ? t('已启用 · 监听 udp/{v0}', { v0: String(dns.port ?? port) })
            : t('已启用 · 未绑定{v0}', {
                v0: dns.error ? `（${dns.error}）` : '',
              })
          : t('未启用')}
      </p>

      {labGate || aaGate ? (
        <p className="hint" data-testid="deskdns-aa-hint">
          {t('机房上线门禁：')}
          {labGate
            ? labGate.readyForMaxSecrecy
              ? t('已通过，可武装最高保密级 / 深锁断网')
              : labGate.blockReasons.length
                ? t('未通过：{v0}', { v0: labGate.blockReasons.join('；') })
                : t('尚未通过 — 见上方机房上线门禁与 docs/LAB_GO_LIVE.md')
            : aaGate?.canArm
              ? t('AA/加固已就绪；仍须 DeskDNS · Shield · 运维声明（见机房上线门禁）')
              : aaGate?.blockReason || t('尚未通过 AA 门禁 — 见上方红条与 docs/EXIT_LOCK_MDM.md')}
        </p>
      ) : null}

      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <label className="hint">
          <input
            type="checkbox"
            checked={enabled}
            disabled={readonly || busy}
            data-testid="deskdns-deploy-enabled"
            onChange={(e) => setEnabled(e.target.checked)}
          />{' '}
          {t('启用 DeskDNS')}
        </label>
        <label>
          {t('端口')}
          <input
            type="number"
            min={1}
            max={65535}
            value={port}
            disabled={readonly || busy}
            data-testid="deskdns-deploy-port"
            onChange={(e) => setPort(Number(e.target.value) || 5353)}
          />
        </label>
        <button type="button" disabled={readonly || busy} onClick={() => void save()}>
          {t('保存并绑定')}
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={() => void runProbe()}>
          {t('检测 DeskDNS')}
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={() => void copyDhcp()}>
          {copied ? t('已复制') : t('复制 DHCP 提示')}
        </button>
      </div>

      <p className="hint" data-testid="deskdns-dhcp-hint">
        {dhcpHint}
      </p>

      {enabled && port === 53 ? (
        <p className="hint" data-testid="deskdns-win53-hint" role="status">
          {t(
            'Windows 教师机绑 :53 常被系统 DNS 占用。推荐：DeskDNS 用 5353（路由器支持非标端口）或 Linux/Exam Box 绑 53。见 docs/DESKDNS_PORT53.md',
          )}
        </p>
      ) : null}

      {check ? (
        <p className="hint" data-testid="deskdns-probe-result">
          {check.ok ? t('探针：通过') : t('探针：异常')}
          {check.hint ? ` — ${check.hint}` : ''}
          {check.dnsResolution?.error ? ` — ${check.dnsResolution.error}` : ''}
        </p>
      ) : null}

      {msg ? <p className="hint">{msg}</p> : null}

      <p className="hint">
        <a
          href="https://github.com/otas0/classroom-desk/blob/main/docs/DESKDNS_PORT53.md"
          target="_blank"
          rel="noreferrer"
        >
          docs/DESKDNS_PORT53.md
        </a>
        {' · '}
        <a
          href="https://github.com/otas0/classroom-desk/blob/main/docs/EXIT_LOCK_MDM.md"
          target="_blank"
          rel="noreferrer"
        >
          docs/EXIT_LOCK_MDM.md
        </a>
        {' · '}
        <a href={`${API_BASE}/api/v1/desk-dns/policy`} target="_blank" rel="noreferrer">
          /api/v1/desk-dns/policy
        </a>
      </p>
    </section>
  );
}

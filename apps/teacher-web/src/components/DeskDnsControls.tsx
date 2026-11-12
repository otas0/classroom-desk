import { useEffect, useState } from 'react';
import { t } from '@classroom-desk/i18n';
import { api } from '../api';

type DnsStatus = {
  profile: 'exam' | 'normal' | 'open' | string;
  running?: boolean;
  port?: number | null;
  conflict?: { pid?: number; cmd?: string; hint?: string } | null;
};

/** DeskDNS profile presets + :53 conflict detect / rebind hints. */
export function DeskDnsControls() {
  const [st, setSt] = useState<DnsStatus>({ profile: 'normal' });
  const [msg, setMsg] = useState('');

  async function load() {
    const body = await api<DnsStatus>('/api/v1/deskdns/status');
    setSt(body);
  }

  useEffect(() => {
    void load().catch(() => undefined);
  }, []);

  async function setProfile(profile: string) {
    setMsg('');
    await api('/api/v1/deskdns/profile', {
      method: 'POST',
      body: JSON.stringify({ profile }),
    });
    setMsg(t('已切换 DNS 配置档'));
    await load();
  }

  return (
    <section data-testid="deskdns-controls">
      <h3>{t('DeskDNS 课策略')}</h3>
      <p className="hint">
        {t('当前')}：{st.profile}
        {st.running ? ` · udp/${st.port}` : ` · ${t('未运行')}`}
      </p>
      <div className="row">
        <button type="button" className="secondary" onClick={() => void setProfile('exam')}>
          {t('考试')}
        </button>
        <button type="button" className="secondary" onClick={() => void setProfile('normal')}>
          {t('普通课')}
        </button>
        <button type="button" className="secondary" onClick={() => void setProfile('open')}>
          {t('开放检索')}
        </button>
        <button type="button" className="secondary" onClick={() => void load()}>
          {t('检测 :53')}
        </button>
      </div>
      {st.conflict ? (
        <p className="error" data-testid="deskdns-port53-conflict">
          {t('端口冲突')} PID {st.conflict.pid ?? '—'} {st.conflict.cmd ?? ''}
          <br />
          {st.conflict.hint || t('可改绑非特权端口，或关闭占用进程后再开 DeskDNS。')}
        </p>
      ) : (
        <p className="hint">{t('未检测到 :53 冲突（或 DeskDNS 未启）')}</p>
      )}
      {msg ? <p className="hint">{msg}</p> : null}
    </section>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { t, te } from '@classroom-desk/i18n';
import { api } from '../api';
import { isAssistant } from '../authRole';
import { playPendingDeviceBeep } from '../pendingDeviceBeep';

type Pending = {
  id: string;
  deviceLabel?: string | null;
  deviceId?: string | null;
  createdAt?: string;
};

type Live = {
  count: number;
  shield?: {
    active?: string;
    lastError?: string | null;
    healthy?: boolean;
    lastHeartbeatAt?: string;
  };
};

/** Sticky live-class strip: allowlist · Shield · heartbeat · pending approve. */
export function LiveClassNetStrip({ classId }: { classId: string }) {
  const [live, setLive] = useState<Live | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const readonly = isAssistant();
  const prevPendingRef = useRef(0);

  const refresh = useCallback(async () => {
    const [body, pend] = await Promise.all([
      api<Live>('/api/v1/gateway/allowlist-live').catch(() => null),
      api<{ items: Pending[] }>('/api/v1/classroom/join/pending-devices').catch(() => ({
        items: [] as Pending[],
      })),
    ]);
    if (body) setLive(body);
    const items = pend.items ?? [];
    setPending(items);
    if (items.length > prevPendingRef.current && items.length > 0) {
      try {
        playPendingDeviceBeep();
      } catch {
        /* ignore */
      }
    }
    prevPendingRef.current = items.length;
  }, []);

  useEffect(() => {
    void refresh().catch(() => undefined);
    const id = window.setInterval(() => void refresh().catch(() => undefined), 8_000);
    return () => window.clearInterval(id);
  }, [refresh, classId]);

  async function decide(id: string, decision: 'approved' | 'denied') {
    if (readonly) return;
    setBusy(true);
    setMsg('');
    try {
      await api(`/api/v1/classroom/join/devices/${encodeURIComponent(id)}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      setMsg(decision === 'approved' ? t('已批准设备连班') : t('已拒绝设备连班'));
      await refresh();
    } catch (e) {
      setMsg(te(e, '操作失败'));
    } finally {
      setBusy(false);
    }
  }

  const shieldActive = String(live?.shield?.active ?? 'off');
  const shieldOff = !shieldActive || shieldActive === 'off';
  const heartbeatBad = live?.shield?.healthy === false;

  return (
    <section className="live-class-net-strip" data-testid="live-class-net-strip">
      <p className="hint" style={{ marginBottom: 6 }}>
        {t('当前放行')} {live?.count ?? 0}
        {' · '}
        Shield{' '}
        <span className={shieldOff || heartbeatBad ? 'error' : undefined}>
          {shieldOff ? t('未配置') : shieldActive}
          {heartbeatBad ? ` · ${t('心跳异常')}` : ''}
        </span>
        {live?.shield?.lastError ? ` · ${live.shield.lastError}` : ''}
        {' · '}
        {t('待批准设备')} {pending.length}
      </p>
      {pending.length ? (
        <ul data-testid="live-pending-devices" style={{ margin: 0, paddingLeft: 18 }}>
          {pending.slice(0, 6).map((d) => (
            <li key={d.id} className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
              <span>
                {d.deviceLabel || d.deviceId || d.id.slice(0, 8)}
                {d.createdAt ? ` · ${new Date(d.createdAt).toLocaleTimeString()}` : ''}
              </span>
              {!readonly ? (
                <>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    data-testid={`live-pending-approve-${d.id}`}
                    onClick={() => void decide(d.id, 'approved')}
                  >
                    {t('批准')}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => void decide(d.id, 'denied')}
                  >
                    {t('拒绝')}
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">{t('无待批准设备')}</p>
      )}
      {msg ? <p className="hint">{msg}</p> : null}
    </section>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { t, te } from '@classroom-desk/i18n';
import { api } from '../api';
import { isAssistant } from '../authRole';

export type LabGoLiveGate = {
  readyForMaxSecrecy: boolean;
  blockReasons: string[];
};

export const EMPTY_LAB_GO_LIVE_GATE: LabGoLiveGate = {
  readyForMaxSecrecy: false,
  blockReasons: [],
};

type Check = {
  id: string;
  ok: boolean;
  required: boolean;
  label: string;
  detail: string;
  fixHint: string;
};

type LabGoLiveStatus = {
  readyForMaxSecrecy?: boolean;
  blockReasons?: string[];
  checks?: Check[];
  windows53?: { conflictLikely?: boolean; recommendedPaths?: string[]; port?: number | null };
  ops?: {
    fixedIpReady?: boolean;
    avAllowlistReady?: boolean;
    wifiNoIsolation?: boolean;
  };
  advertiseLanIp?: string;
  shieldAdapter?: string;
};

/**
 * Unified lab go-live gate on session home: AA · DeskDNS path · Shield · ops.
 * Feeds DeviceControlBar「最高保密级」arm enablement.
 */
export function LabGoLivePanel({
  classId,
  onGateChange,
}: {
  classId: string;
  onGateChange?: (gate: LabGoLiveGate) => void;
}) {
  const [status, setStatus] = useState<LabGoLiveStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const readonly = isAssistant();

  const publish = useCallback(
    (s: LabGoLiveStatus | null) => {
      const gate: LabGoLiveGate = {
        readyForMaxSecrecy: Boolean(s?.readyForMaxSecrecy),
        blockReasons: s?.blockReasons ?? [],
      };
      onGateChange?.(gate);
    },
    [onGateChange],
  );

  const refresh = useCallback(async () => {
    if (!classId.trim()) {
      setStatus(null);
      publish(null);
      return;
    }
    try {
      const r = await api<LabGoLiveStatus>(
        `/api/v1/ops/lab-go-live?classId=${encodeURIComponent(classId)}`,
      );
      setStatus(r);
      publish(r);
    } catch (e) {
      setStatus(null);
      publish(null);
      setMsg(te(e, t('机房上线门禁加载失败')));
    }
  }, [classId, publish]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  async function setOps(patch: Record<string, boolean>) {
    if (readonly) return;
    setBusy(true);
    setMsg('');
    try {
      await api('/api/v1/settings', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setMsg(t('已保存运维声明'));
      await refresh();
    } catch (e) {
      setMsg(te(e, t('保存失败')));
    } finally {
      setBusy(false);
    }
  }

  const ready = Boolean(status?.readyForMaxSecrecy);
  const checks = status?.checks ?? [];
  const ops = status?.ops;

  return (
    <details
      className={ready ? 'hint' : 'banner-alert'}
      data-testid="lab-go-live-panel"
      data-ready={ready ? '1' : '0'}
      open={ready ? true : undefined}
    >
      <summary>
        {t('机房上线门禁（最高保密级）')}
        {ready ? ` · ${t('已通过')}` : ` · ${t('日常上课可暂缓')}`}
      </summary>
      <p className="hint" role={ready ? 'status' : 'alert'}>
        {ready
          ? t('门禁已通过：可武装最高保密级（系统热键仍依赖 Assigned Access）。')
          : t(
              '仅限制最高保密级 / 深锁断网。日常建班、连班、发题不依赖此项。Alt+Tab 须 AA；DeskDNS 须真进路径；Shield 须真网关。',
            )}
      </p>
      {!ready && (status?.blockReasons?.length ?? 0) > 0 ? (
        <p className="hint" data-testid="lab-go-live-blocks">
          {t('阻塞：')}
          {(status?.blockReasons ?? []).join('；')}
        </p>
      ) : null}

      <ul
        className="hint"
        data-testid="lab-go-live-checks"
        style={{ margin: '0.5rem 0', paddingLeft: '1.2rem' }}
      >
        {checks.map((c) => (
          <li key={c.id} data-ok={c.ok ? '1' : '0'} data-required={c.required ? '1' : '0'}>
            {c.ok ? '✓' : '✗'} {c.label}
            {c.required ? '' : t('（建议）')} — {c.detail}
            {!c.ok && c.fixHint ? ` · ${c.fixHint}` : ''}
          </li>
        ))}
      </ul>

      {status?.windows53?.conflictLikely ? (
        <p className="hint" data-testid="lab-go-live-win53">
          {t('Windows :53：')}
          {(status.windows53.recommendedPaths ?? []).join('；')}
        </p>
      ) : null}

      <div className="hint" data-testid="lab-go-live-ops" style={{ display: 'grid', gap: 4 }}>
        <strong>{t('运维基线声明')}</strong>
        <label>
          <input
            type="checkbox"
            checked={Boolean(ops?.fixedIpReady)}
            disabled={readonly || busy}
            data-testid="lab-ops-fixed-ip"
            onChange={(e) => void setOps({ labOpsFixedIpReady: e.target.checked })}
          />{' '}
          {t('教师机已固定 IP')}
          {status?.advertiseLanIp ? `（${status.advertiseLanIp}）` : ''}
        </label>
        <label>
          <input
            type="checkbox"
            checked={Boolean(ops?.avAllowlistReady)}
            disabled={readonly || busy}
            data-testid="lab-ops-av"
            onChange={(e) => void setOps({ labOpsAvAllowlistReady: e.target.checked })}
          />{' '}
          {t('杀软已放行 ClassroomDesk（未关 Defender）')}
        </label>
        <label>
          <input
            type="checkbox"
            checked={Boolean(ops?.wifiNoIsolation)}
            disabled={readonly || busy}
            data-testid="lab-ops-wifi"
            onChange={(e) => void setOps({ labOpsWifiNoIsolation: e.target.checked })}
          />{' '}
          {t('非访客隔离 Wi‑Fi · 学生↔教师 TCP 8787 可达')}
        </label>
      </div>

      <p className="hint">
        <a
          href="https://github.com/otas0/classroom-desk/blob/main/docs/LAB_GO_LIVE.md"
          target="_blank"
          rel="noreferrer"
        >
          docs/LAB_GO_LIVE.md
        </a>
        {' · '}
        <a
          href="https://github.com/otas0/classroom-desk/blob/main/docs/DESKDNS_PORT53.md"
          target="_blank"
          rel="noreferrer"
        >
          docs/DESKDNS_PORT53.md
        </a>
        {' · '}
        Shield: {status?.shieldAdapter ?? '—'}
      </p>
      {msg ? <p className="hint">{msg}</p> : null}
    </details>
  );
}

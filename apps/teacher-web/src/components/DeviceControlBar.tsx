import { useCallback, useEffect, useState } from 'react';
import { t, te } from '@classroom-desk/i18n';
import type {
  DeviceControlPolicy,
  OfflineLockMode,
  OfflineLockPolicy,
} from '@classroom-desk/shared';
import {
  DEFAULT_OFFLINE_LOCK_POLICY,
  EMPTY_DEVICE_CONTROL_POLICY,
} from '@classroom-desk/shared';
import { API_BASE, api } from '../api';
import { isAssistant } from '../authRole';

/**
 * Compact student-device controls: open/close apps & URLs, block lists,
 * and offline hard-lock policy when the teacher host is unreachable.
 */
export function DeviceControlBar({ classId }: { classId: string }) {
  const [policy, setPolicy] = useState<DeviceControlPolicy>(EMPTY_DEVICE_CONTROL_POLICY());
  const [offline, setOffline] = useState<OfflineLockPolicy>(DEFAULT_OFFLINE_LOCK_POLICY());
  const [appsText, setAppsText] = useState('');
  const [hostsText, setHostsText] = useState('');
  const [openUrl, setOpenUrl] = useState('');
  const [openApp, setOpenApp] = useState('');
  const [closeApps, setCloseApps] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const readonly = isAssistant();

  const refresh = useCallback(async () => {
    const r = await api<{ policy?: DeviceControlPolicy; offline?: OfflineLockPolicy }>(
      '/api/v1/device-control',
    );
    const p = r.policy ?? EMPTY_DEVICE_CONTROL_POLICY();
    const o = r.offline ?? DEFAULT_OFFLINE_LOCK_POLICY();
    setPolicy(p);
    setOffline(o);
    setAppsText(p.blockedApps.join(', '));
    setHostsText(p.blockedHosts.join(', '));
  }, []);

  useEffect(() => {
    void refresh().catch(() => undefined);
    const es = new EventSource(`${API_BASE}/api/v1/device-control/stream`);
    es.addEventListener('device_control', () => {
      void refresh().catch(() => undefined);
    });
    es.onmessage = () => {
      void refresh().catch(() => undefined);
    };
    return () => es.close();
  }, [refresh]);

  function parseList(raw: string): string[] {
    return raw
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function savePolicy() {
    if (readonly) return;
    setBusy(true);
    void api('/api/v1/device-control/policy', {
      method: 'PUT',
      body: JSON.stringify({
        policy: {
          blockedApps: parseList(appsText),
          blockedHosts: parseList(hostsText),
        },
      }),
    })
      .then(async () => {
        setMsg(t('已保存拉黑名单'));
        await refresh();
      })
      .catch((e) => setMsg(te(e, '保存失败')))
      .finally(() => setBusy(false));
  }

  function saveOffline(patch: Partial<OfflineLockPolicy>) {
    if (readonly) return;
    const next = { ...offline, ...patch };
    setBusy(true);
    void api('/api/v1/device-control/offline-policy', {
      method: 'PUT',
      body: JSON.stringify({ offline: next }),
    })
      .then(async () => {
        setMsg(t('已保存掉线策略'));
        await refresh();
      })
      .catch((e) => setMsg(te(e, '保存失败')))
      .finally(() => setBusy(false));
  }

  function send(kind: 'open_url' | 'open_app' | 'close_apps') {
    if (readonly || !classId.trim()) return;
    setBusy(true);
    const body: Record<string, unknown> = { kind, classId: classId.trim() };
    if (kind === 'open_url') body.url = openUrl.trim();
    if (kind === 'open_app') body.app = openApp.trim();
    if (kind === 'close_apps') body.apps = parseList(closeApps);
    void api('/api/v1/device-control/command', {
      method: 'POST',
      body: JSON.stringify(body),
    })
      .then(() =>
        setMsg(
          kind === 'open_url'
            ? t('已下发打开网页')
            : kind === 'open_app'
              ? t('已下发打开应用')
              : t('已下发关闭应用'),
        ),
      )
      .catch((e) => setMsg(te(e, '下发失败')))
      .finally(() => setBusy(false));
  }

  return (
    <section className="device-control-bar" data-testid="device-control-bar">
      <h3>{t('学生机应用与网页')}</h3>
      <p className="hint">
        {t(
          '打开/关闭学生机上的应用或网页；拉黑名单持续拦截（学生端请求 + 教师机 CLASSROOM_DESK_DNS=1 时 DNS 返回 0.0.0.0）。掉线时可强硬全屏锁。',
        )}
      </p>

      <div className="device-control-grid">
        <label>
          {t('打开网页')}
          <input
            value={openUrl}
            disabled={readonly || busy}
            onChange={(e) => setOpenUrl(e.target.value)}
            placeholder="https://"
          />
        </label>
        <button type="button" disabled={readonly || busy || !openUrl.trim()} onClick={() => send('open_url')}>
          {t('打开')}
        </button>
        <label>
          {t('打开应用')}
          <input
            value={openApp}
            disabled={readonly || busy}
            onChange={(e) => setOpenApp(e.target.value)}
            placeholder={t('如 notepad.exe / Calculator')}
          />
        </label>
        <button type="button" disabled={readonly || busy || !openApp.trim()} onClick={() => send('open_app')}>
          {t('打开')}
        </button>
        <label>
          {t('关闭应用')}
          <input
            value={closeApps}
            disabled={readonly || busy}
            onChange={(e) => setCloseApps(e.target.value)}
            placeholder={t('逗号分隔进程名')}
          />
        </label>
        <button
          type="button"
          disabled={readonly || busy || !closeApps.trim()}
          onClick={() => send('close_apps')}
        >
          {t('关闭')}
        </button>
      </div>

      <details className="device-control-blocks">
        <summary>{t('拉黑网页 / 应用（持续）')}</summary>
        <label>
          {t('拉黑域名')}
          <input
            value={hostsText}
            disabled={readonly || busy}
            onChange={(e) => setHostsText(e.target.value)}
            placeholder="tiktok.com, bilibili.com"
          />
        </label>
        <label>
          {t('拉黑应用')}
          <input
            value={appsText}
            disabled={readonly || busy}
            onChange={(e) => setAppsText(e.target.value)}
            placeholder="WeChat.exe, QQ.exe"
          />
        </label>
        <button type="button" className="secondary" disabled={readonly || busy} onClick={() => savePolicy()}>
          {t('保存拉黑名单')}
        </button>
        {policy.blockedApps.length || policy.blockedHosts.length ? (
          <p className="hint">
            {t('当前拉黑：')}
            {[...policy.blockedHosts, ...policy.blockedApps].join(' · ') || '—'}
          </p>
        ) : null}
      </details>

      <details className="device-control-offline" open>
        <summary>{t('掉线 / 连不上教师机')}</summary>
        <label>
          {t('策略')}
          <select
            value={offline.mode}
            disabled={readonly || busy}
            onChange={(e) => saveOffline({ mode: e.target.value as OfflineLockMode })}
          >
            <option value="hard_lock">{t('强硬全屏锁（无解除码不可用）')}</option>
            <option value="warn">{t('仅提示，不锁屏')}</option>
            <option value="off">{t('不处理掉线')}</option>
          </select>
        </label>
        <label>
          {t('宽限（秒）')}
          <input
            type="number"
            min={2}
            max={120}
            value={Math.round(offline.graceMs / 1000)}
            disabled={readonly || busy}
            onChange={(e) =>
              saveOffline({ graceMs: Math.round(Number(e.target.value) || 8) * 1000 })
            }
          />
        </label>
        <label className="hint">
          <input
            type="checkbox"
            checked={offline.unlockWithCode}
            disabled={readonly || busy}
            onChange={(e) => saveOffline({ unlockWithCode: e.target.checked })}
          />{' '}
          {t('允许用解除码解除掉线锁')}
        </label>
        <label className="hint">
          <input
            type="checkbox"
            checked={offline.collapseOnReconnect}
            disabled={readonly || busy}
            onChange={(e) => saveOffline({ collapseOnReconnect: e.target.checked })}
          />{' '}
          {t('重连教师机后自动回右下角')}
        </label>
        <label className="hint">
          <input
            type="checkbox"
            checked={offline.holdUntilUnlockCode}
            disabled={readonly || busy}
            onChange={(e) => saveOffline({ holdUntilUnlockCode: e.target.checked })}
          />{' '}
          {t('重连后仍须解除码才退出全屏')}
        </label>
      </details>
      {msg ? <p className="hint">{msg}</p> : null}
    </section>
  );
}

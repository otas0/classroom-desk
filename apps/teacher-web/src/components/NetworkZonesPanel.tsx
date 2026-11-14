import { useCallback, useEffect, useState } from 'react';
import { t, te } from '@classroom-desk/i18n';
import type { NetworkZone, NetworkZoneRole } from '@classroom-desk/shared';
import { api } from '../api';
import { isAssistant } from '../authRole';

type ZoneViolation = {
  studentId: string;
  classId: string;
  zoneId: string;
  zoneLabel: string;
  ssid: string;
  ipv4: string;
  action: string;
  reason?: string;
  count: number;
  lastAt: string;
};

function blankZone(): NetworkZone {
  return {
    id: `z_${Math.random().toString(36).slice(2, 10)}`,
    label: '',
    ssidIncludes: [],
    cidrs: [],
    allowedRoles: ['student'],
    defaultNetMode: 'allow',
    defaultAllowlistHosts: [],
    studentUnauthorized: 'flag',
    requirePortal: true,
    enabled: true,
  };
}

export function NetworkZonesPanel() {
  const [zones, setZones] = useState<NetworkZone[]>([]);
  const [violations, setViolations] = useState<ZoneViolation[]>([]);
  const [portalCode, setPortalCode] = useState('');
  const [portalSet, setPortalSet] = useState(false);
  const [privatePortalOnly, setPrivatePortalOnly] = useState(false);
  const [caps, setCaps] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const readonly = isAssistant();

  const refresh = useCallback(async () => {
    const r = await api<{ zones?: NetworkZone[]; violations?: ZoneViolation[] }>(
      '/api/v1/network-zones',
    );
    setZones(Array.isArray(r.zones) ? r.zones : []);
    setViolations(Array.isArray(r.violations) ? r.violations : []);
    try {
      const p = await api<{
        portalSharedCodeSet?: boolean;
        capabilities?: Record<string, unknown>;
      }>('/api/v1/portal/settings');
      setPortalSet(Boolean(p.portalSharedCodeSet));
      const c = p.capabilities ?? {};
      setCaps(
        [
          c.netPortal ? t('门户') : '',
          c.netDns ? t('DeskDNS') : '',
          c.examBox ? t('ExamBox') : '',
          c.netShield ? t('Shield') : '',
          c.neverStudentNetBlock ? t('从未学生网拦截') : '',
          c.deviceFingerprinting ? '' : t('无指纹'),
        ]
          .filter(Boolean)
          .join(' · '),
      );
      const m = await api<{ privateDevicePortalOnly?: boolean }>(
        '/api/v1/settings/private-device-mode',
      );
      setPrivatePortalOnly(Boolean(m.privateDevicePortalOnly));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  function update(i: number, patch: Partial<NetworkZone>) {
    setZones((prev) => prev.map((z, idx) => (idx === i ? { ...z, ...patch } : z)));
  }

  function save() {
    if (readonly) return;
    setBusy(true);
    void api('/api/v1/network-zones', {
      method: 'PUT',
      body: JSON.stringify({ zones }),
    })
      .then(async () => {
        setMsg(t('网络配置档已保存'));
        await refresh();
      })
      .catch((e) => setMsg(te(e, '保存失败')))
      .finally(() => setBusy(false));
  }

  function toggleRole(i: number, role: NetworkZoneRole) {
    const z = zones[i];
    if (!z) return;
    const has = z.allowedRoles.includes(role);
    update(i, {
      allowedRoles: has ? z.allowedRoles.filter((r) => r !== role) : [...z.allowedRoles, role],
    });
  }

  return (
    <section className="network-zones-panel" data-testid="network-zones-panel">
      <h3>{t('网络配置档')}</h3>
      <p className="hint">
        {t(
          '自定义 SSID/网段权限；教工档强制门户；从未学生网→block；私人设备可强制 /portal。见 docs/ENTERPRISE_8021X.md 与 docs/EXAM_BOX.md。',
        )}
      </p>
      {caps ? (
        <p className="hint" data-testid="product-capabilities-line">
          {t('已启用：')}
          {caps}
        </p>
      ) : null}
      <label className="hint">
        {t('门户共用码')}
        <input
          data-testid="portal-shared-code"
          value={portalCode}
          disabled={readonly}
          onChange={(e) => setPortalCode(e.target.value)}
          placeholder={portalSet ? t('已设置（输入新码可覆盖）') : t('设置后用于 /portal')}
        />
      </label>
      <button
        type="button"
        className="secondary"
        disabled={readonly || busy || !portalCode.trim()}
        data-testid="portal-shared-code-save"
        onClick={() => {
          setBusy(true);
          void api('/api/v1/portal/settings', {
            method: 'PUT',
            body: JSON.stringify({ portalSharedCode: portalCode.trim() }),
          })
            .then(async () => {
              setMsg(t('门户共用码已保存'));
              setPortalCode('');
              await refresh();
            })
            .catch((e) => setMsg(te(e, '保存失败')))
            .finally(() => setBusy(false));
        }}
      >
        {t('保存门户共用码')}
      </button>
      <label className="hint" style={{ display: 'block', marginTop: 8 }}>
        <input
          type="checkbox"
          checked={privatePortalOnly}
          disabled={readonly || busy}
          data-testid="private-device-portal-only"
          onChange={(e) => {
            const on = e.target.checked;
            setPrivatePortalOnly(on);
            setBusy(true);
            void api('/api/v1/settings/private-device-mode', {
              method: 'PUT',
              body: JSON.stringify({ privateDevicePortalOnly: on }),
            })
              .then(() => setMsg(on ? t('私人设备已改走门户') : t('已恢复公开名单（机房）')))
              .catch((err) => setMsg(te(err, '保存失败')))
              .finally(() => setBusy(false));
          }}
        />{' '}
        {t('私人设备强制门户（浏览器禁公开名单；lab-agent 仍可用）')}
      </label>
      <p className="hint">
        {t('Captive Portal 重定向')} <code>/portal?ssid=…&ssid_ts=…&ssid_sig=…</code>
        {t('（网关用 sign-ssid 注入）')}
      </p>
      <p className="hint">
        {t('强制签名 SSID 开关见开通向导；环境变量 CLASSROOM_DESK_PORTAL_SSID_REQUIRE_SIG=1 可强制开启。')}
      </p>
      <button
        type="button"
        className="secondary"
        disabled={readonly || busy}
        data-testid="campus-preset-apply"
        onClick={() => {
          setBusy(true);
          void api<{ ok?: boolean; tip?: string; mode?: string }>(
            '/api/v1/settings/campus-preset',
            { method: 'PUT', body: JSON.stringify({ mode: 'soft' }) },
          )
            .then(async (r) => {
              setPrivatePortalOnly(true);
              setMsg(
                r.tip ||
                  t('已应用校园网预设：私人设备门户 + Zones 模板（SSID 签名默认关）'),
              );
              await refresh();
            })
            .catch((e) => setMsg(te(e, '保存失败')))
            .finally(() => setBusy(false));
        }}
      >
        {t('一键校园网预设（门户 + Zones，宽松）')}
      </button>
      {zones.map((z, i) => (
        <div key={z.id} className="network-zone-card" data-testid={`network-zone-${z.id}`}>
          <label className="hint">
            {t('名称')}
            <input
              value={z.label}
              disabled={readonly}
              onChange={(e) => update(i, { label: e.target.value })}
            />
          </label>
          <label className="hint">
            {t('SSID 包含')}
            <input
              value={z.ssidIncludes.join(', ')}
              disabled={readonly}
              onChange={(e) =>
                update(i, {
                  ssidIncludes: e.target.value
                    .split(/[,;\s]+/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <label className="hint">
            {t('CIDR')}
            <input
              value={z.cidrs.join(', ')}
              disabled={readonly}
              onChange={(e) =>
                update(i, {
                  cidrs: e.target.value
                    .split(/[,;\s]+/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <div className="chip-row">
            {(['student', 'teacher', 'staff', 'guest'] as NetworkZoneRole[]).map((role) => (
              <button
                key={role}
                type="button"
                className={`chip${z.allowedRoles.includes(role) ? ' active-chip' : ''}`}
                disabled={readonly}
                onClick={() => toggleRole(i, role)}
              >
                {role}
              </button>
            ))}
          </div>
          <label className="hint">
            {t('学生误入')}
            <select
              value={z.studentUnauthorized}
              disabled={readonly}
              onChange={(e) =>
                update(i, {
                  studentUnauthorized: e.target.value as NetworkZone['studentUnauthorized'],
                })
              }
            >
              <option value="flag">{t('仅标记')}</option>
              <option value="deny">{t('Shield 断网')}</option>
              <option value="kick">{t('Shield 踢下线')}</option>
            </select>
          </label>
          <label className="hint">
            <input
              type="checkbox"
              checked={z.enabled}
              disabled={readonly}
              onChange={(e) => update(i, { enabled: e.target.checked })}
            />{' '}
            {t('启用')}
          </label>
          <button
            type="button"
            className="secondary"
            disabled={readonly}
            onClick={() => setZones((prev) => prev.filter((_, idx) => idx !== i))}
          >
            {t('删除此档')}
          </button>
        </div>
      ))}
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <button
          type="button"
          className="secondary"
          disabled={readonly || busy}
          data-testid="network-zone-add"
          onClick={() => setZones((prev) => [...prev, blankZone()])}
        >
          {t('添加网络档')}
        </button>
        <button type="button" disabled={readonly || busy} data-testid="network-zone-save" onClick={() => save()}>
          {busy ? t('保存中…') : t('保存网络档')}
        </button>
      </div>
      {violations.length ? (
        <p className="hint" data-testid="network-zone-violations">
          {t('未授权上网告警：')}
          {violations.slice(0, 10).map((v) => (
            <span key={`${v.studentId}-${v.zoneId}`}>
              {' '}
              {v.zoneLabel}
              {v.reason === 'never_student_net' ? t('[从未上学生网]') : ''}×{v.count}
            </span>
          ))}
        </p>
      ) : null}
      {msg ? <p className="hint">{msg}</p> : null}
    </section>
  );
}

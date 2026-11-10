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

/**
 * School-custom network zones (any labels). Not hardcoded guest/teacher/student.
 * Mitigates leaked PSK: students on staff-only zones → flag / deny / kick via Shield.
 */
export function NetworkZonesPanel() {
  const [zones, setZones] = useState<NetworkZone[]>([]);
  const [violations, setViolations] = useState<ZoneViolation[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const readonly = isAssistant();

  const refresh = useCallback(async () => {
    const r = await api<{ zones?: NetworkZone[]; violations?: ZoneViolation[] }>(
      '/api/v1/network-zones',
    );
    setZones(Array.isArray(r.zones) ? r.zones : []);
    setViolations(Array.isArray(r.violations) ? r.violations : []);
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
    const allowedRoles = has
      ? z.allowedRoles.filter((r) => r !== role)
      : [...z.allowedRoles, role];
    update(i, { allowedRoles });
  }

  return (
    <section className="network-zones-panel" data-testid="network-zones-panel">
      <h3>{t('网络配置档')}</h3>
      <p className="hint">
        {t(
          '按学校自己的 SSID / 网段自定义分区与权限，不要依赖写死的 guest/teacher/student 名称。学生若知道教工网密码连上去：只要该档不允许 student，即可标记违规，并可选 Shield 断网或踢下线。建议教工网开 802.1X/门户，单靠 Wi‑Fi 密码不够。',
        )}
      </p>
      {zones.map((z, i) => (
        <div key={z.id} className="network-zone-card" data-testid={`network-zone-${z.id}`}>
          <label className="hint">
            {t('名称')}
            <input
              value={z.label}
              disabled={readonly}
              onChange={(e) => update(i, { label: e.target.value })}
              placeholder={t('例如：教学网 / 教工 / 访客')}
            />
          </label>
          <label className="hint">
            {t('SSID 包含（逗号分隔，可空）')}
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
            {t('网段 CIDR（逗号分隔，可空）')}
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
              placeholder="10.20.0.0/16"
            />
          </label>
          <div className="chip-row" role="group" aria-label={t('允许角色')}>
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
            {t('学生误入时')}
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
              checked={z.requirePortal}
              disabled={readonly}
              onChange={(e) => update(i, { requirePortal: e.target.checked })}
            />{' '}
            {t('建议门户/802.1X（泄露密码仍要认人）')}
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
        <button
          type="button"
          disabled={readonly || busy}
          data-testid="network-zone-save"
          onClick={() => save()}
        >
          {busy ? t('保存中…') : t('保存网络档')}
        </button>
      </div>
      {violations.length ? (
        <p className="hint" data-testid="network-zone-violations">
          {t('未授权上网告警：')}
          {violations.slice(0, 10).map((v) => (
            <span key={`${v.studentId}-${v.zoneId}`}>
              {' '}
              {v.zoneLabel || v.zoneId}
              {v.ssid ? `@${v.ssid}` : ''}×{v.count}
            </span>
          ))}
        </p>
      ) : null}
      {msg ? <p className="hint">{msg}</p> : null}
    </section>
  );
}

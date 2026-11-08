import { useEffect, useState } from 'react';
import { api } from '../api';
import { t } from '@classroom-desk/i18n';

type Dash = {
  expectedStudentVersion: string;
  fleet: {
    classCount: number;
    rosterTotal: number;
    onlineTotal: number;
    onlineRate: number;
    driftClients: number;
    driftRate: number;
    hardenedOnline?: number;
    unhardenedOnline?: number;
    unhardenedRate?: number;
    unhardenedAlertThreshold?: number;
    unhardenedAlert?: boolean;
  };
  readiness: {
    ctaCount: number;
    readyCount: number;
    funnelRate: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    avgMs: number | null;
    count: number;
    histogram?: Array<{ label: string; count: number }>;
  };
  driftTrend?: Array<{ day: string; samples: number; driftAvg: number }>;
  backup: { ageHours: number | null; latestAt: string | null; lastError: { message?: string } | null };
  upgrades: { files: string[]; dir: string };
  classes: Array<{
    classId: string;
    name: string;
    roster: number;
    online: number;
    onlineRate: number;
    driftCount: number;
    hardenedCount?: number;
    unhardenedCount?: number;
    versions: string[];
  }>;
};

function fmtMs(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function OpsDashboard({
  onGoUnhardenedThreshold,
}: {
  onGoUnhardenedThreshold?: () => void;
} = {}) {
  const [dash, setDash] = useState<Dash | null>(null);
  const [err, setErr] = useState('');
  const [upgradeTip, setUpgradeTip] = useState('');

  async function load() {
    setErr('');
    const [d, u] = await Promise.all([
      api<Dash>('/api/v1/ops/dashboard'),
      api<{ tipTemplate?: string; preferredLanUrl?: string | null }>('/api/v1/upgrades'),
    ]);
    setDash(d);
    setUpgradeTip(u.tipTemplate ?? '');
  }

  useEffect(() => {
    void load().catch((e) => setErr(e instanceof Error ? e.message : t('加载失败')));
    const _cdTimer = window.setInterval(() => void load().catch(() => undefined), 20_000);
    return () => window.clearInterval(_cdTimer);
  }, []);

  const hist = dash?.readiness.histogram ?? [];
  const histMax = Math.max(1, ...hist.map((h) => h.count));
  const trend = dash?.driftTrend ?? [];
  const trendMax = Math.max(1, ...trend.map((t) => t.driftAvg));

  return (
    <section>
      <h2>{t('健康 / 就绪仪表盘')}</h2>
      <p className="hint">{t('全校在线率、版本漂移、备份年龄；机房就绪时长（扫码 CTA → classroom_ready）P50/P95。')}</p>
      <button type="button" className="secondary" onClick={() => void load().catch((e) => setErr(String(e)))}>
        {t('刷新')}
      </button>
      {err ? <p className="error">{err}</p> : null}
      {!dash ? <p className="hint">{t('加载中…')}</p> : null}
      {dash ? (
        <>
          <p className="hint" data-testid="ops-unhardened-threshold">
            未加固告警阈值：
            {((dash.fleet.unhardenedAlertThreshold ?? 0.25) * 100).toFixed(0)}%
            {onGoUnhardenedThreshold ? (
              <>
                （
                <button
                  type="button"
                  className="linkish"
                  data-testid="ops-unhardened-threshold-link"
                  onClick={() => onGoUnhardenedThreshold()}
                >
                  设置 → 运维调度锚点
                </button>
                ）
              </>
            ) : (
              t('（设置 → 运维调度可改）')
            )}
            {dash.fleet.onlineTotal > 0
              ? ` · 当前占比 ${((dash.fleet.unhardenedRate ?? 0) * 100).toFixed(0)}%`
              : ' · 当前无在线机'}
          </p>
          {dash.fleet.unhardenedAlert ? (
            <p className="error" role="alert" data-testid="ops-unhardened-alert">
              未加固机位占比{' '}
              {((dash.fleet.unhardenedRate ?? 0) * 100).toFixed(0)}%（
              {dash.fleet.unhardenedOnline ?? 0}/{dash.fleet.onlineTotal}
              ）≥ 阈值 {((dash.fleet.unhardenedAlertThreshold ?? 0.25) * 100).toFixed(0)}
              %。请到「加固体检」核对 Assigned Access / MDM。
            </p>
          ) : null}
          <div className="ops-kpis">
            <div>
              <strong>{(dash.fleet.onlineRate * 100).toFixed(0)}%</strong>
              <span>在线率（{dash.fleet.onlineTotal}/{dash.fleet.rosterTotal}）</span>
            </div>
            <div>
              <strong>{(dash.fleet.driftRate * 100).toFixed(0)}%</strong>
              <span>漂移率（{dash.fleet.driftClients} 台 · 期望 v{dash.expectedStudentVersion}）</span>
            </div>
            <div>
              <strong>
                {dash.fleet.onlineTotal > 0
                  ? `${(((dash.fleet.hardenedOnline ?? 0) / dash.fleet.onlineTotal) * 100).toFixed(0)}%`
                  : '—'}
              </strong>
              <span>
                加固率（已加固 {dash.fleet.hardenedOnline ?? 0} / 未加固{' '}
                {dash.fleet.unhardenedOnline ?? 0}）
              </span>
            </div>
            <div>
              <strong>{dash.backup.ageHours != null ? `${dash.backup.ageHours.toFixed(1)}h` : '—'}</strong>
              <span>备份年龄{dash.backup.lastError?.message ? ` · 异常` : ''}</span>
            </div>
            <div>
              <strong>{fmtMs(dash.readiness.p50Ms)}</strong>
              <span>就绪 P50 · P95 {fmtMs(dash.readiness.p95Ms)}</span>
            </div>
          </div>
          <p className="hint">
            扫码 CTA {dash.readiness.ctaCount} · 就绪事件 {dash.readiness.readyCount}
            {dash.readiness.funnelRate != null
              ? ` · 转化 ${(dash.readiness.funnelRate * 100).toFixed(0)}%`
              : ''}
            {dash.readiness.avgMs != null ? ` · 均 ${fmtMs(dash.readiness.avgMs)}` : ''}
          </p>

          <h3>{t('就绪时长直方图')}</h3>
          {hist.length === 0 || hist.every((h) => h.count === 0) ? (
            <p className="hint">{t('尚无就绪时长样本')}</p>
          ) : (
            <div className="ops-chart" role="img" aria-label={t('就绪时长直方图')}>
              {hist.map((h) => (
                <div key={h.label} className="ops-chart-col">
                  <div
                    className="ops-chart-bar"
                    style={{ height: `${Math.max(4, (h.count / histMax) * 100)}%` }}
                    title={`${h.label}: ${h.count}`}
                  />
                  <span className="ops-chart-label">
                    {h.label}
                    <br />
                    {h.count}
                  </span>
                </div>
              ))}
            </div>
          )}

          <h3>{t('漂移趋势（近 14 日）')}</h3>
          {trend.length === 0 ? (
            <p className="hint">尚无漂移样本（今日实时：{dash.fleet.driftClients}）</p>
          ) : (
            <div className="ops-chart ops-chart-trend" role="img" aria-label={t('漂移趋势')}>
              {trend.map((t) => (
                <div key={t.day} className="ops-chart-col">
                  <div
                    className="ops-chart-bar drift"
                    style={{ height: `${Math.max(4, (t.driftAvg / trendMax) * 100)}%` }}
                    title={`${t.day}: avg ${t.driftAvg.toFixed(1)}`}
                  />
                  <span className="ops-chart-label">
                    {t.day.slice(5)}
                    <br />
                    {t.driftAvg.toFixed(0)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {upgradeTip ? (
            <p className="hint">
              LAN 升级提示：{upgradeTip}{' '}
              <button
                type="button"
                className="linkish"
                onClick={() => void navigator.clipboard.writeText(upgradeTip)}
              >
                复制
              </button>
            </p>
          ) : null}
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('班级')}</th>
                <th>{t('名单')}</th>
                <th>{t('在线')}</th>
                <th>{t('在线率')}</th>
                <th>{t('漂移')}</th>
                <th>{t('未加固')}</th>
                <th>{t('版本')}</th>
              </tr>
            </thead>
            <tbody>
              {dash.classes.map((c) => (
                <tr
                  key={c.classId}
                  className={
                    c.driftCount || (c.unhardenedCount ?? 0) > 0 ? 'row-warn' : undefined
                  }
                >
                  <td>{c.name}</td>
                  <td>{c.roster}</td>
                  <td>{c.online}</td>
                  <td>{(c.onlineRate * 100).toFixed(0)}%</td>
                  <td>{c.driftCount}</td>
                  <td>{c.unhardenedCount ?? 0}</td>
                  <td>{c.versions.join(' / ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  );
}

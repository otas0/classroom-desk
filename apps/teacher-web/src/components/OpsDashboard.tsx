import { useEffect, useState } from 'react';
import { api } from '../api';

type Dash = {
  expectedStudentVersion: string;
  fleet: {
    classCount: number;
    rosterTotal: number;
    onlineTotal: number;
    onlineRate: number;
    driftClients: number;
    driftRate: number;
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
    versions: string[];
  }>;
};

function fmtMs(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function OpsDashboard() {
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
    void load().catch((e) => setErr(e instanceof Error ? e.message : '加载失败'));
    const t = window.setInterval(() => void load().catch(() => undefined), 20_000);
    return () => window.clearInterval(t);
  }, []);

  const hist = dash?.readiness.histogram ?? [];
  const histMax = Math.max(1, ...hist.map((h) => h.count));
  const trend = dash?.driftTrend ?? [];
  const trendMax = Math.max(1, ...trend.map((t) => t.driftAvg));

  return (
    <section>
      <h2>健康 / 就绪仪表盘</h2>
      <p className="hint">全校在线率、版本漂移、备份年龄；机房就绪时长（扫码 CTA → classroom_ready）P50/P95。</p>
      <button type="button" className="secondary" onClick={() => void load().catch((e) => setErr(String(e)))}>
        刷新
      </button>
      {err ? <p className="error">{err}</p> : null}
      {!dash ? <p className="hint">加载中…</p> : null}
      {dash ? (
        <>
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

          <h3>就绪时长直方图</h3>
          {hist.length === 0 || hist.every((h) => h.count === 0) ? (
            <p className="hint">尚无就绪时长样本</p>
          ) : (
            <div className="ops-chart" role="img" aria-label="就绪时长直方图">
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

          <h3>漂移趋势（近 14 日）</h3>
          {trend.length === 0 ? (
            <p className="hint">尚无漂移样本（今日实时：{dash.fleet.driftClients}）</p>
          ) : (
            <div className="ops-chart ops-chart-trend" role="img" aria-label="漂移趋势">
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
                <th>班级</th>
                <th>名单</th>
                <th>在线</th>
                <th>在线率</th>
                <th>漂移</th>
                <th>版本</th>
              </tr>
            </thead>
            <tbody>
              {dash.classes.map((c) => (
                <tr key={c.classId} className={c.driftCount ? 'row-warn' : undefined}>
                  <td>{c.name}</td>
                  <td>{c.roster}</td>
                  <td>{c.online}</td>
                  <td>{(c.onlineRate * 100).toFixed(0)}%</td>
                  <td>{c.driftCount}</td>
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

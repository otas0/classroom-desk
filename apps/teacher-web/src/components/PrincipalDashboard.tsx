import { useEffect, useState } from 'react';
import { t } from '@classroom-desk/i18n';
import { API_BASE, api, getToken } from '../api';
import { attachPrincipalWsReconnect, type PrincipalWsLike } from '../principalWsReconnect';

type Stats = {
  onlineTotal?: number;
  rosterTotal?: number;
  unauthorizedNet?: number;
  focusViolationEvents?: number;
  focusViolationStudents?: number;
  zoneViolationEvents?: number;
  capabilities?: Record<string, unknown>;
  shield?: { active?: string; displayName?: string };
  deskDns?: { enabled?: boolean; running?: boolean; port?: number | null };
  deepLockSessionsToday?: number;
  portalAdmitsToday?: number;
  unlockCodeOverdueClasses?: number;
  byClass?: Array<{
    classId: string;
    name: string;
    roster: number;
    online: number;
    netZoneUnauthorized: number;
  }>;
  live?: boolean;
};

/** Read-only capability + live counts board for principals / admins. */
export function PrincipalDashboard({
  onOpenPresence,
  wsFactory,
}: {
  onOpenPresence?: (classId: string) => void;
  /** Inject for tests (disconnect/backoff mocks). */
  wsFactory?: (url: string) => PrincipalWsLike;
}) {
  const [stats, setStats] = useState<Stats>({});
  const [err, setErr] = useState('');
  const [live, setLive] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void api<Stats>('/api/v1/principal/stats')
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : t('加载失败'));
      });

    const factory =
      wsFactory ??
      ((url: string) => new WebSocket(url) as unknown as PrincipalWsLike);

    const ctl = attachPrincipalWsReconnect({
      buildUrl: () => {
        const token = getToken();
        if (!token) return null;
        const base = API_BASE.replace(/^http/, 'ws');
        return `${base}/api/v1/principal/ws?token=${encodeURIComponent(token)}`;
      },
      wsFactory: factory,
      schedule: (fn, ms) => setTimeout(fn, ms),
      clearSchedule: (id) => clearTimeout(id),
      onLive: (v) => {
        if (!cancelled) {
          setLive(v);
          if (v) setErr('');
        }
      },
      onMessage: (data) => {
        if (cancelled) return;
        const d = data as Stats;
        if (d && typeof d.onlineTotal === 'number') {
          setStats((prev) => ({ ...prev, ...d, live: true }));
        }
      },
    });

    return () => {
      cancelled = true;
      ctl.dispose();
    };
  }, [wsFactory]);

  const caps = stats.capabilities ?? {};
  const rows: Array<{ key: string; label: string; shipped: boolean }> = [
    { key: 'labAgent', label: t('机房客户端'), shipped: caps.labAgent === true },
    { key: 'deepLock', label: t('深锁控制台'), shipped: caps.deepLock === true },
    { key: 'networkZones', label: t('自定义网络档'), shipped: caps.networkZones === true },
    { key: 'netPortal', label: t('零安装门户'), shipped: caps.netPortal === true },
    { key: 'netDns', label: t('DeskDNS'), shipped: caps.netDns === true },
    { key: 'netDnsRunning', label: t('DeskDNS 运行中'), shipped: caps.netDnsRunning === true },
    { key: 'netShield', label: t('Shield'), shipped: caps.netShield === true },
    { key: 'examBox', label: t('Exam Box 文档/镜像'), shipped: caps.examBox === true },
    { key: 'examBoxHardware', label: t('Exam Box 量产硬件'), shipped: caps.examBoxHardware === true },
    { key: 'enterprise8021x', label: t('802.1X 对接'), shipped: caps.enterprise8021x === true },
    { key: 'principalDashboard', label: t('校长看板'), shipped: caps.principalDashboard !== false },
    { key: 'neverStudentNetBlock', label: t('从未学生网拦截'), shipped: caps.neverStudentNetBlock === true },
    {
      key: 'deviceFingerprinting',
      label: t('隐蔽指纹（应关闭）'),
      shipped: caps.deviceFingerprinting === true,
    },
  ];

  return (
    <section className="principal-dashboard" data-testid="principal-dashboard">
      <h3>{t('校长能力看板')}</h3>
      <p className="hint">
        {t('运营视图：在线/加固相关能力旗标与实时在线。灰色=未交付或未启用。Shield：')}
        {(() => {
          const active = String(stats.shield?.active ?? caps.netShieldActive ?? 'off');
          if (!active || active === 'off') return t('未配置');
          if (active === 'mock') return t('联调 mock（非生产）');
          return active;
        })()}
        <span data-testid="principal-ws-live">{live ? ` · ${t('实时')}` : ` · ${t('轮询后备')}`}</span>
      </p>
      <p className="hint" data-testid="principal-ops-summary">
        {t('机房包')}：{caps.labAgent ? t('开') : t('关')} · {t('校园网包')}：
        {caps.netPortal || caps.networkZones ? t('开') : t('关')} · DeskDNS：
        {caps.netDnsRunning ? t('运行中') : caps.netDns ? t('已编入未运行') : t('关')} · Exam Box：
        {caps.examBoxHardware ? t('硬件') : caps.examBox ? t('文档/镜像') : t('关')}
      </p>
      {err ? <p className="error">{err}</p> : null}
      <div className="principal-live" data-testid="principal-live-counts">
        <p>
          {t('在线')}：{stats.onlineTotal ?? 0} / {t('名单')} {stats.rosterTotal ?? 0}
        </p>
        <p>
          {t('未授权网')}：{stats.unauthorizedNet ?? 0} · {t('失焦违规')}：
          {stats.focusViolationEvents ?? 0}（{stats.focusViolationStudents ?? 0} {t('人')}）·{' '}
          {t('网络档违规')}：{stats.zoneViolationEvents ?? 0}
        </p>
        {stats.deskDns?.enabled ? (
          <p className="hint">
            DeskDNS：{stats.deskDns.running ? `udp/${stats.deskDns.port}` : t('未绑定')}
          </p>
        ) : null}
        <p data-testid="principal-pilot-metrics">
          {t('今日深锁场次')}：{stats.deepLockSessionsToday ?? 0} · {t('门户准入')}：
          {stats.portalAdmitsToday ?? 0} · {t('解除码逾期班级')}：
          {stats.unlockCodeOverdueClasses ?? 0}
        </p>
      </div>
      {stats.byClass && stats.byClass.length ? (
        <ul className="hint" data-testid="principal-by-class">
          {stats.byClass.slice(0, 12).map((c) => (
            <li key={c.classId}>
              {onOpenPresence ? (
                <button
                  type="button"
                  className="linkish"
                  data-testid={`principal-drill-${c.classId}`}
                  onClick={() => onOpenPresence(c.classId)}
                >
                  {c.name}
                </button>
              ) : (
                c.name
              )}
              ：{c.online}/{c.roster}
              {c.netZoneUnauthorized ? ` · ${t('未授权网')} ${c.netZoneUnauthorized}` : ''}
              {onOpenPresence ? (
                <>
                  {' '}
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => onOpenPresence(c.classId)}
                  >
                    {t('查看在线机位')}
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p>
        <button
          type="button"
          className="secondary"
          data-testid="principal-ops-csv-download"
          onClick={() => {
            const token = getToken();
            const url = `${API_BASE}/api/v1/principal/ops-export.csv`;
            void fetch(url, {
              headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            })
              .then(async (res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const blob = await res.blob();
                const stamp = new Date().toISOString().slice(0, 10);
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `principal-ops-${stamp}.csv`;
                a.click();
                URL.revokeObjectURL(a.href);
              })
              .catch((e) => setErr(e instanceof Error ? e.message : t('下载失败')));
          }}
        >
          {t('下载运营 CSV（版本漂移 / 未加固 / 连班失败）')}
        </button>
      </p>
      <ul className="capability-list">
        {rows.map((r) => (
          <li
            key={r.key}
            className={r.shipped ? 'cap-on' : 'cap-off'}
            data-testid={`cap-${r.key}`}
          >
            <span>{r.shipped ? '●' : '○'}</span> {r.label}
            {!r.shipped ? <em> · {t('未启用/未交付')}</em> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import { t } from '@classroom-desk/i18n';
import { API_BASE, api, getToken } from '../api';

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
}: {
  onOpenPresence?: (classId: string) => void;
}) {
  const [stats, setStats] = useState<Stats>({});
  const [err, setErr] = useState('');
  const [live, setLive] = useState(false);
  const attemptRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    void api<Stats>('/api/v1/principal/stats')
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : t('加载失败'));
      });

    function clearTimer() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function connect() {
      if (cancelled) return;
      const token = getToken();
      if (!token) return;
      try {
        const base = API_BASE.replace(/^http/, 'ws');
        ws = new WebSocket(`${base}/api/v1/principal/ws?token=${encodeURIComponent(token)}`);
        ws.onopen = () => {
          if (cancelled) return;
          attemptRef.current = 0;
          setLive(true);
          setErr('');
        };
        ws.onmessage = (ev) => {
          try {
            const data = JSON.parse(String(ev.data)) as Stats;
            if (!cancelled && data && typeof data.onlineTotal === 'number') {
              setStats((prev) => ({ ...prev, ...data, live: true }));
            }
          } catch {
            /* ignore */
          }
        };
        ws.onclose = () => {
          if (cancelled) return;
          setLive(false);
          const attempt = attemptRef.current + 1;
          attemptRef.current = attempt;
          const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempt - 1, 5));
          clearTimer();
          reconnectTimer = setTimeout(connect, delay);
        };
        ws.onerror = () => {
          try {
            ws?.close();
          } catch {
            /* ignore */
          }
        };
      } catch {
        /* REST only */
      }
    }

    connect();

    return () => {
      cancelled = true;
      clearTimer();
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, []);

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
    { key: 'enterprise8021x', label: t('802.1X 白皮书'), shipped: caps.enterprise8021x === true },
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
        {t('只读：本校已纳入产品的能力。灰色项表示未交付或未启用。当前 Shield：')}
        {String(stats.shield?.active ?? caps.netShieldActive ?? 'mock')}
        {live ? ` · ${t('实时')}` : ` · ${t('轮询后备')}`}
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

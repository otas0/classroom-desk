import { useEffect, useMemo, useState } from 'react';
import { t } from '@classroom-desk/i18n';
import { API_BASE, api, getToken } from '../api';
import { VersionRemediationCard } from './VersionRemediationCard';

type PresenceRow = {
  studentId: string;
  displayName: string;
  studentNo: string | null;
  clientVersion: string;
  lastSeenAt: string;
  netZoneUnauthorized?: boolean;
};

type RosterRow = { id: string; displayName: string; studentNo: string | null };

type ExitLockPublic = {
  clientExitAllowed?: boolean;
  exitUnlockCodeRotationDue?: boolean;
};

/**
 * One-screen three buckets: offline / version behind / exit-lock (class-wide) alerts.
 */
export function ClassPresenceMatrix({
  classId,
  compact,
}: {
  classId: string;
  /** Projection / session strip */
  compact?: boolean;
}) {
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [online, setOnline] = useState<PresenceRow[]>([]);
  const [expected, setExpected] = useState('');
  const [exit, setExit] = useState<ExitLockPublic>({});
  const [forceSync, setForceSync] = useState(false);
  const [err, setErr] = useState('');

  async function refresh() {
    if (!classId) return;
    setErr('');
    const [students, presence, health, settings, upgrades] = await Promise.all([
      api<{ items: RosterRow[] }>(`/api/v1/classes/${encodeURIComponent(classId)}/students`),
      api<{ items: PresenceRow[] }>(
        `/api/v1/presence/clients?classId=${encodeURIComponent(classId)}`,
      ),
      fetch('/health', { cache: 'no-store' })
        .then((r) => r.json())
        .catch(() => ({})) as Promise<{ studentDesktopVersion?: string; version?: string }>,
      api<ExitLockPublic & { studentAutoUpdate?: boolean }>('/api/v1/settings').catch(
        () => ({}) as ExitLockPublic,
      ),
      api<{ studentAutoUpdate?: boolean }>('/api/v1/upgrades').catch(() => ({})),
    ]);
    setRoster(students.items ?? []);
    setOnline(presence.items ?? []);
    setExpected(String(health.studentDesktopVersion ?? health.version ?? ''));
    setExit(settings);
    setForceSync(Boolean(settings.studentAutoUpdate ?? upgrades.studentAutoUpdate));
  }

  useEffect(() => {
    if (!classId) return;
    let cancelled = false;
    let es: EventSource | null = null;
    let poll: number | undefined;

    void refresh().catch((e) => {
      if (!cancelled) setErr(e instanceof Error ? e.message : t('加载失败'));
    });

    const token = getToken();
    if (token && typeof EventSource !== 'undefined') {
      es = new EventSource(
        `${API_BASE}/api/v1/presence/stream?classId=${encodeURIComponent(classId)}&token=${encodeURIComponent(token)}`,
      );
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as { type?: string; items?: PresenceRow[] };
          if (data.type === 'presence' && data.items) setOnline(data.items);
        } catch {
          /* ignore */
        }
      };
      es.onerror = () => {
        es?.close();
        es = null;
        if (poll == null) {
          poll = window.setInterval(() => void refresh().catch(() => undefined), 15_000);
        }
      };
    } else {
      poll = window.setInterval(() => void refresh().catch(() => undefined), 15_000);
    }

    return () => {
      cancelled = true;
      es?.close();
      if (poll != null) window.clearInterval(poll);
    };
  }, [classId]);

  const onlineIds = useMemo(() => new Set(online.map((r) => r.studentId)), [online]);
  const offline = useMemo(
    () => roster.filter((s) => !onlineIds.has(s.id)),
    [roster, onlineIds],
  );
  const behind = useMemo(
    () =>
      online.filter(
        (r) => expected && r.clientVersion && r.clientVersion !== expected,
      ),
    [online, expected],
  );
  const lockAlert = exit.clientExitAllowed === false || exit.exitUnlockCodeRotationDue === true;

  if (!classId) return null;

  if (compact) {
    return (
      <div className="presence-matrix-strip" data-testid="presence-matrix-strip">
        <span data-testid="matrix-offline-count">
          {t('未报到')} {offline.length}
        </span>
        <span data-testid="matrix-behind-count">
          {t('版本落后')} {behind.length}
        </span>
        <span
          data-testid="matrix-lock-alert"
          className={lockAlert ? 'badge-danger' : undefined}
        >
          {t('退出锁定告警')} {lockAlert ? t('是') : t('否')}
        </span>
      </div>
    );
  }

  return (
    <section className="presence-matrix" data-testid="presence-matrix">
      <h2>{t('本班在线矩阵')}</h2>
      <p className="hint">
        {t('未报到')} / {t('版本落后')} / {t('退出锁定告警')} · {t('期望版本')} v
        {expected || '—'}
      </p>
      {err ? <p className="error">{err}</p> : null}
      <div className="row presence-matrix-cols">
        <div data-testid="matrix-offline">
          <h3>
            {t('未报到')}（{offline.length}）
          </h3>
          <ul>
            {offline.slice(0, 40).map((s) => (
              <li key={s.id}>
                {s.studentNo ? `${s.studentNo} ` : ''}
                {s.displayName}
              </li>
            ))}
          </ul>
        </div>
        <div data-testid="matrix-behind">
          <h3>
            {t('版本落后')}（{behind.length}）
          </h3>
          <ul>
            {behind.slice(0, 40).map((s) => (
              <li key={s.studentId}>
                {s.studentNo ? `${s.studentNo} ` : ''}
                {s.displayName} · v{s.clientVersion}
              </li>
            ))}
          </ul>
        </div>
        <div data-testid="matrix-lock">
          <h3>{t('退出锁定告警')}</h3>
          <p className={lockAlert ? 'error' : 'hint'}>
            {lockAlert
              ? exit.exitUnlockCodeRotationDue
                ? t('解除码已逾期，请更换')
                : t('学生端退出锁定生效中')
              : t('无班级级退出锁告警')}
          </p>
        </div>
      </div>
      {forceSync && behind.length > 0 ? (
        <VersionRemediationCard classId={classId} expectedVersion={expected} behindCount={behind.length} />
      ) : null}
    </section>
  );
}

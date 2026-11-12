import { useEffect, useState } from 'react';
import { API_BASE, api } from '../api';
import type { ClassItem } from '../types';
import { t } from '@classroom-desk/i18n';

export type SetupDest = 'prep' | 'assign' | 'session' | 'prep-roster' | 'prep-questions' | 'prep-presence';

/**
 * First-run teacher path: three actions only. No SKU/capability matrix here.
 * Also surfaces easy-join / unhardened fleet health so teachers notice before class.
 */
export function SetupChecklist({
  classId,
  classes,
  studentCount,
  hasApiBase,
  refreshTick = 0,
  onGo,
  onCreateClass,
}: {
  classId: string;
  classes: ClassItem[];
  studentCount: number;
  hasApiBase: boolean;
  refreshTick?: number;
  onGo: (tab: SetupDest) => void;
  onCreateClass?: () => void;
}) {
  const [hasQuestion, setHasQuestion] = useState(false);
  const [questionKnown, setQuestionKnown] = useState(false);
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [connectedCount, setConnectedCount] = useState(0);
  const [easyJoinOn, setEasyJoinOn] = useState<boolean | null>(null);
  const [hardenedCount, setHardenedCount] = useState(0);
  const [unhardenedCount, setUnhardenedCount] = useState(0);
  const [unhardenedThresh, setUnhardenedThresh] = useState(0.25);
  const [readyUrl, setReadyUrl] = useState('');
  const [versionDrift, setVersionDrift] = useState(0);
  const [expectedVersion, setExpectedVersion] = useState('');
  const [joinPendingCount, setJoinPendingCount] = useState(0);
  const [joinRateLimitHour, setJoinRateLimitHour] = useState(0);
  const [deskDnsOk, setDeskDnsOk] = useState<boolean | null>(null);
  const [deskDnsHint, setDeskDnsHint] = useState('');

  useEffect(() => {
    if (!classId) {
      setHasQuestion(false);
      setQuestionKnown(true);
      return;
    }
    let cancelled = false;
    setQuestionKnown(false);
    void api<{ items: unknown[] }>(`/api/v1/questions?classId=${encodeURIComponent(classId)}`)
      .then((r) => {
        if (cancelled) return;
        setHasQuestion(r.items.length > 0);
        setQuestionKnown(true);
      })
      .catch(() => {
        if (cancelled) return;
        setHasQuestion(false);
        setQuestionKnown(true);
      });
    return () => {
      cancelled = true;
    };
  }, [classId, refreshTick]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let expVer = '';
      try {
        const res = await fetch(`${API_BASE}/health`, { cache: 'no-store' });
        const body = (await res.json()) as {
          ok?: boolean;
          studentReadyUrl?: string;
          studentDesktopVersion?: string;
          version?: string;
          suggestedApiBase?: string;
        };
        if (cancelled) return;
        setServerOk(Boolean(res.ok && body.ok));
        setReadyUrl(
          String(body.studentReadyUrl ?? '').trim() ||
            `${String(body.suggestedApiBase ?? API_BASE).replace(/\/$/, '')}/ready`,
        );
        expVer = String(body.studentDesktopVersion ?? body.version ?? '').trim();
        setExpectedVersion(expVer);
      } catch {
        if (cancelled) return;
        setServerOk(false);
      }

      try {
        const settings = await api<{
          studentEasyJoin?: boolean;
          studentEasyJoinClassId?: string;
          unhardenedAlertThreshold?: number;
          joinPendingDeviceCount?: number;
          joinRateLimitEventsLastHour?: number;
        }>('/api/v1/settings');
        if (cancelled) return;
        const on =
          settings.studentEasyJoin === true &&
          Boolean(settings.studentEasyJoinClassId) &&
          settings.studentEasyJoinClassId === classId;
        setEasyJoinOn(Boolean(classId) && on);
        setJoinPendingCount(Number(settings.joinPendingDeviceCount ?? 0));
        setJoinRateLimitHour(Number(settings.joinRateLimitEventsLastHour ?? 0));
        if (
          settings.unhardenedAlertThreshold != null &&
          Number.isFinite(Number(settings.unhardenedAlertThreshold))
        ) {
          setUnhardenedThresh(Number(settings.unhardenedAlertThreshold));
        }
      } catch {
        if (cancelled) return;
        setEasyJoinOn(null);
        setJoinPendingCount(0);
        setJoinRateLimitHour(0);
      }

      try {
        const dnsRes = await fetch(`${API_BASE}/api/v1/health/deskdns-check`, { cache: 'no-store' });
        const dnsBody = (await dnsRes.json()) as {
          ok?: boolean;
          hint?: string | null;
          dnsResolution?: { pointsAtTeacher?: boolean | null; hostname?: string };
        };
        if (cancelled) return;
        const badResolve = dnsBody.dnsResolution?.pointsAtTeacher === false;
        setDeskDnsOk(dnsRes.ok && dnsBody.ok !== false && !badResolve);
        setDeskDnsHint(
          String(dnsBody.hint ?? '').trim() ||
            (badResolve && dnsBody.dnsResolution?.hostname
              ? t('DeskDNS 解析 {v0} 未指向本讲台 LAN', { v0: dnsBody.dnsResolution.hostname })
              : ''),
        );
      } catch {
        if (cancelled) return;
        setDeskDnsOk(null);
        setDeskDnsHint('');
      }

      if (!classId) {
        setConnectedCount(0);
        setHardenedCount(0);
        setUnhardenedCount(0);
        setVersionDrift(0);
        return;
      }
      try {
        const clients = await api<{
          count: number;
          hardenedCount?: number;
          unhardenedCount?: number;
          items?: Array<{ clientVersion?: string }>;
        }>(`/api/v1/presence/clients?classId=${encodeURIComponent(classId)}`);
        if (cancelled) return;
        setConnectedCount(clients.count);
        setHardenedCount(Number(clients.hardenedCount ?? 0));
        setUnhardenedCount(Number(clients.unhardenedCount ?? 0));
        if (expVer && Array.isArray(clients.items)) {
          setVersionDrift(
            clients.items.filter((i) => i.clientVersion && i.clientVersion !== expVer).length,
          );
        } else {
          setVersionDrift(0);
        }
      } catch {
        if (cancelled) return;
        setConnectedCount(0);
        setHardenedCount(0);
        setUnhardenedCount(0);
        setVersionDrift(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTick, classId]);

  const rosterDone = classes.length > 0 && Boolean(classId) && studentCount > 0;
  // Presence heartbeats are enough; do not require a non-localhost assign apiBase
  // (teachers often open /admin on 127.0.0.1 while students use the LAN IP).
  const studentsOnline = Boolean(classId) && serverOk === true && connectedCount > 0;
  const studentsPending = serverOk === null;
  const questionDone = hasQuestion;
  const coreDone = rosterDone && studentsOnline && (!questionKnown || questionDone);

  const onlineForHardening = hardenedCount + unhardenedCount;
  const unhardenedRate = onlineForHardening > 0 ? unhardenedCount / onlineForHardening : 0;
  const unhardenedAlert = onlineForHardening > 0 && unhardenedRate >= unhardenedThresh;
  const easyJoinMissing = Boolean(classId) && easyJoinOn === false;
  const driftAlert = versionDrift > 0;
  const joinPendingAlert = joinPendingCount > 0;
  const joinRateAlert = joinRateLimitHour > 0;
  const deskDnsAlert = deskDnsOk === false;
  const healthAlerts =
    easyJoinMissing ||
    unhardenedAlert ||
    driftAlert ||
    joinPendingAlert ||
    joinRateAlert ||
    deskDnsAlert;

  type BlockerLight = { id: string; label: string; state: 'ok' | 'unknown' | 'bad' };
  const blockerLights: BlockerLight[] = [
    {
      id: 'easy-join',
      label: t('一键连班'),
      state: !classId ? 'unknown' : easyJoinOn === null ? 'unknown' : easyJoinOn ? 'ok' : 'bad',
    },
    {
      id: 'join-pending',
      label: t('待批准设备'),
      state: joinPendingCount > 0 ? 'bad' : 'ok',
    },
    {
      id: 'join-rate',
      label: t('连班限流'),
      state: joinRateLimitHour > 0 ? 'bad' : 'ok',
    },
    {
      id: 'version-drift',
      label: t('版本漂移'),
      state: !classId || !expectedVersion ? 'unknown' : versionDrift > 0 ? 'bad' : 'ok',
    },
    {
      id: 'deskdns',
      label: 'DeskDNS',
      state: deskDnsOk === null ? 'unknown' : deskDnsOk ? 'ok' : 'bad',
    },
    {
      id: 'hardening',
      label: t('机位加固'),
      state:
        onlineForHardening === 0 ? 'unknown' : unhardenedAlert ? 'bad' : 'ok',
    },
  ];
  if (coreDone && !healthAlerts) return null;

  function goCreateOrRoster() {
    if (classes.length === 0 && onCreateClass) onCreateClass();
    else onGo('prep-roster');
  }

  function goAssignWithAudit(source: string) {
    const at = Date.now();
    try {
      sessionStorage.setItem(`cd_assign_cta_at_${classId}`, String(at));
    } catch {
      /* ignore */
    }
    void api('/api/v1/audit/events', {
      method: 'POST',
      body: JSON.stringify({
        action: 'setup.scan_assign_cta',
        classId,
        detail: { at: new Date(at).toISOString(), source },
      }),
    }).catch(() => undefined);
    onGo('assign');
  }

  type Step = {
    n: number;
    label: string;
    done: boolean;
    pending: boolean;
    detail?: string;
    actionLabel?: string;
    action?: () => void;
  };

  const steps: Step[] = [
    {
      n: 1,
      label: t('建班并导入名单'),
      done: rosterDone,
      pending: false,
      actionLabel: classes.length === 0 ? t('去建班') : t('去导入名单'),
      action: goCreateOrRoster,
    },
    {
      n: 2,
      label: t('学生机扫码连上'),
      done: studentsOnline,
      pending: studentsPending,
      detail:
        serverOk === null
          ? t('检测中…')
          : serverOk === false
            ? t('服务器不可达，请先在教师机启动服务')
            : connectedCount === 0
              ? hasApiBase
                ? t('服务已通 · 请扫码让学生机连上')
                : t('服务已通 · 去指派页展示二维码（学生填局域网 IP）')
              : t('已连 {v0} 台', { v0: String(connectedCount) }),
      actionLabel: t('去指派'),
      action: () => goAssignWithAudit('setup_step2'),
    },
    {
      n: 3,
      label: t('发第一题'),
      done: questionDone,
      pending: !questionKnown,
      actionLabel: t('去发第一题'),
      action: () => onGo('session'),
    },
  ];

  let ctaLabel = t('去发第一题');
  let cta = () => onGo('session');
  if (!rosterDone) {
    ctaLabel = classes.length === 0 ? t('创建班级') : t('去导入名单');
    cta = goCreateOrRoster;
  } else if (!studentsOnline) {
    ctaLabel = serverOk === false ? t('检查服务器') : t('扫码指派学生机');
    cta = () => goAssignWithAudit('setup_checklist_cta');
  } else if (easyJoinMissing) {
    ctaLabel = t('去开一键连班');
    cta = () => goAssignWithAudit('setup_easy_join');
  } else if (unhardenedAlert) {
    ctaLabel = t('查看机位加固');
    cta = () => onGo('prep-presence');
  }

  return (
    <section className="setup-checklist" data-testid="setup-checklist-simple">
      <h2>{coreDone ? t('开课健康') : t('开课准备')}</h2>
      {!coreDone ? <p className="hint">{t('三步即可上课。做完会自动收起。')}</p> : null}

      {readyUrl ? (
        <p className="hint" data-testid="setup-ready-link">
          {t('课前检测：')}{' '}
          <a href={readyUrl} target="_blank" rel="noreferrer">
            {readyUrl}
          </a>
          {t('（含防火墙 8787 / AP 隔离提示）')}
        </p>
      ) : null}
      {coreDone || healthAlerts ? (
        <div className="setup-blockers-summary" data-testid="setup-blockers-summary" aria-label={t('开课阻塞项')}>
          {blockerLights.map((b) => (
            <span
              key={b.id}
              className={`setup-blocker-light setup-blocker-light--${b.state}`}
              data-testid={`setup-blocker-${b.id}`}
              data-state={b.state}
            >
              {b.label}
            </span>
          ))}
        </div>
      ) : null}

      {healthAlerts ? (
        <div className="setup-health-alerts" data-testid="setup-health-alerts" role="alert">
          {joinRateAlert ? (
            <p className="setup-health-alert" data-testid="setup-join-rate-alert">
              {t('近 1 小时有 {v0} 次连班 IP 限流（错 PIN 过多）。学生需等待冷却后再试。', {
                v0: String(joinRateLimitHour),
              })}
            </p>
          ) : null}
          {joinPendingAlert ? (
            <p className="setup-health-alert" data-testid="setup-join-pending-alert">
              {t('有 {v0} 台设备待批准连班。请到指派页「连班鉴权」处理。', {
                v0: String(joinPendingCount),
              })}{' '}
              <button
                type="button"
                className="secondary setup-step-jump"
                onClick={() => goAssignWithAudit('setup_join_pending')}
              >
                {t('去批准')}
              </button>
            </p>
          ) : null}
          {deskDnsAlert ? (
            <p className="setup-health-alert" data-testid="setup-deskdns-alert">
              {deskDnsHint || t('DeskDNS 探测未通过：DHCP DNS 可能未指向本讲台。')}
            </p>
          ) : null}
          {driftAlert ? (
            <p className="setup-health-alert" data-testid="setup-version-drift-alert">
              {t('版本漂移：{v0} 台学生端 ≠ 期望 {v1}。请上传对应架构 Setup 并开强制同版。', {
                v0: String(versionDrift),
                v1: expectedVersion || '—',
              })}
            </p>
          ) : null}
          {easyJoinMissing ? (
            <p className="setup-health-alert" data-testid="setup-easy-join-alert">
              {t('尚未开放本班「一键连班」：隔壁教室学生会找不到本讲台。去指派页打开开关。')}{' '}
              <button
                type="button"
                className="secondary setup-step-jump"
                onClick={() => goAssignWithAudit('setup_easy_join_banner')}
              >
                {t('去开一键连班')}
              </button>
            </p>
          ) : null}
          {unhardenedAlert ? (
            <p className="setup-health-alert" data-testid="setup-unhardened-alert">
              {t(
                '未加固机位偏高：{v0}%（{v1}/{v2}），阈值 {v3}%。学校机请配 Assigned Access / Intune。',
                {
                  v0: (unhardenedRate * 100).toFixed(0),
                  v1: String(unhardenedCount),
                  v2: String(onlineForHardening),
                  v3: (unhardenedThresh * 100).toFixed(0),
                },
              )}{' '}
              <button
                type="button"
                className="secondary setup-step-jump"
                onClick={() => onGo('prep-presence')}
              >
                {t('查看机位加固')}
              </button>
            </p>
          ) : null}
        </div>
      ) : null}

      {!coreDone ? (
        <>
          <ol className="setup-steps">
            {steps.map((step) => (
              <li key={step.n} className={step.done ? 'setup-step done' : 'setup-step'}>
                <span>
                  {step.n}. {step.label}
                  {step.detail ? <span className="hint"> · {step.detail}</span> : null}
                </span>
                <span className="status">
                  {step.done ? t('已完成') : step.pending ? t('检查中') : t('未完成')}
                </span>
                {!step.done && !step.pending && step.action && step.actionLabel ? (
                  <button type="button" className="secondary setup-step-jump" onClick={step.action}>
                    {step.actionLabel}
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
          <button type="button" onClick={cta}>
            {ctaLabel}
          </button>
        </>
      ) : healthAlerts ? (
        <button type="button" onClick={cta}>
          {ctaLabel}
        </button>
      ) : null}
    </section>
  );
}

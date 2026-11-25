import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ClassItem } from '../types';
import { t } from '@classroom-desk/i18n';

export type SetupDest = 'prep' | 'assign' | 'session' | 'prep-roster' | 'prep-questions' | 'prep-presence';

/**
 * Day-1: only roster. Class + easy-join already bootstrapped; students Find classroom.
 */
export function SetupChecklist({
  classId,
  classes,
  studentCount,
  hasApiBase: _hasApiBase,
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
  const [joinPendingCount, setJoinPendingCount] = useState(0);
  const [joinRateLimitLive, setJoinRateLimitLive] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void api<{
      joinPendingDeviceCount?: number;
      joinRateLimitedIpsLive?: number;
    }>('/api/v1/settings')
      .then((settings) => {
        if (cancelled) return;
        setJoinPendingCount(Number(settings.joinPendingDeviceCount ?? 0));
        setJoinRateLimitLive(Number(settings.joinRateLimitedIpsLive ?? 0));
      })
      .catch(() => {
        if (cancelled) return;
        setJoinPendingCount(0);
        setJoinRateLimitLive(0);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshTick, classId]);

  const rosterDone = classes.length > 0 && Boolean(classId) && studentCount > 0;
  const joinPendingAlert = joinPendingCount > 0;
  const joinRateAlert = joinRateLimitLive > 0;
  const healthAlerts = joinPendingAlert || joinRateAlert;

  if (rosterDone && !healthAlerts) return null;

  function goCreateOrRoster() {
    if (classes.length === 0 && onCreateClass) onCreateClass();
    else onGo('prep-roster');
  }

  function goAssign() {
    onGo('assign');
  }

  return (
    <section className="setup-checklist" data-testid="setup-checklist-simple">
      <h2>{rosterDone ? t('开课健康') : t('开课准备')}</h2>
      {!rosterDone ? (
        <p className="hint">
          {t('导入名单即可上课。学生装好打开应用会自动连班；连不上再「查找教室」或输房间码。')}
        </p>
      ) : null}

      {healthAlerts ? (
        <div className="setup-health-alerts" data-testid="setup-health-alerts" role="alert">
          {joinRateAlert ? (
            <p className="setup-health-alert" data-testid="setup-join-rate-alert">
              {t('当前有 {v0} 个 IP 处于连班冷却（错 PIN 过多）。学生需等待冷却后再试。', {
                v0: String(joinRateLimitLive),
              })}
            </p>
          ) : null}
          {joinPendingAlert ? (
            <p className="setup-health-alert" data-testid="setup-join-pending-alert">
              {t('有 {v0} 台设备待批准连班。请到指派页「连班鉴权」处理。', {
                v0: String(joinPendingCount),
              })}{' '}
              <button type="button" className="secondary setup-step-jump" onClick={goAssign}>
                {t('去批准')}
              </button>
            </p>
          ) : null}
        </div>
      ) : null}

      {!rosterDone ? (
        <>
          <ol className="setup-steps">
            <li className="setup-step" data-testid="setup-step-roster">
              <span>
                1. {classes.length === 0 ? t('建班并导入名单') : t('导入名单')}
              </span>
              <span className="status">{t('未完成')}</span>
              <button type="button" className="secondary setup-step-jump" onClick={goCreateOrRoster}>
                {classes.length === 0 ? t('去建班') : t('去导入名单')}
              </button>
            </li>
          </ol>
          <button type="button" onClick={goCreateOrRoster} data-testid="setup-cta-roster">
            {classes.length === 0 ? t('创建班级') : t('去导入名单')}
          </button>
        </>
      ) : healthAlerts ? (
        <button type="button" onClick={goAssign}>
          {joinPendingAlert ? t('去批准设备') : t('去指派')}
        </button>
      ) : null}
    </section>
  );
}

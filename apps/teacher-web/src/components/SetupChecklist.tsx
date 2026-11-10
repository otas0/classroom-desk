import { useEffect, useState } from 'react';
import { API_BASE, api } from '../api';
import type { ClassItem } from '../types';
import { t } from '@classroom-desk/i18n';

export type SetupDest = 'prep' | 'assign' | 'session' | 'prep-roster' | 'prep-questions' | 'prep-presence';

/**
 * First-run teacher path: three actions only. No SKU/capability matrix here.
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
      try {
        const res = await fetch(`${API_BASE}/health`, { cache: 'no-store' });
        const body = (await res.json()) as { ok?: boolean };
        if (cancelled) return;
        setServerOk(Boolean(res.ok && body.ok));
      } catch {
        if (cancelled) return;
        setServerOk(false);
      }
      if (!classId) {
        setConnectedCount(0);
        return;
      }
      try {
        const clients = await api<{ count: number }>(
          `/api/v1/presence/clients?classId=${encodeURIComponent(classId)}`,
        );
        if (cancelled) return;
        setConnectedCount(clients.count);
      } catch {
        if (cancelled) return;
        setConnectedCount(0);
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
  if (coreDone) return null;

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
  }

  return (
    <section className="setup-checklist" data-testid="setup-checklist-simple">
      <h2>{t('开课准备')}</h2>
      <p className="hint">{t('三步即可上课。做完会自动收起。')}</p>
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
    </section>
  );
}

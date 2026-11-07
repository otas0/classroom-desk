import { useEffect, useState } from 'react';
import { API_BASE, api } from '../api';
import type { ClassItem } from '../types';

export type SetupDest = 'prep' | 'assign' | 'session' | 'prep-roster' | 'prep-questions';

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
  const [serverVersion, setServerVersion] = useState('');
  const [studentPkgVersion, setStudentPkgVersion] = useState('');
  const [connectedVersions, setConnectedVersions] = useState<string[]>([]);
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
        const body = (await res.json()) as {
          ok?: boolean;
          version?: string;
          studentDesktopVersion?: string;
        };
        if (cancelled) return;
        setServerOk(Boolean(res.ok && body.ok));
        setServerVersion(String(body.version ?? ''));
        setStudentPkgVersion(String(body.studentDesktopVersion ?? body.version ?? ''));
      } catch {
        if (cancelled) return;
        setServerOk(false);
        setServerVersion('');
        setStudentPkgVersion('');
      }
      if (!classId) {
        setConnectedVersions([]);
        setConnectedCount(0);
        return;
      }
      try {
        const clients = await api<{ count: number; versions: string[] }>(
          `/api/v1/presence/clients?classId=${encodeURIComponent(classId)}`,
        );
        if (cancelled) return;
        setConnectedCount(clients.count);
        setConnectedVersions(clients.versions ?? []);
      } catch {
        if (cancelled) return;
        setConnectedCount(0);
        setConnectedVersions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTick, classId]);

  const rosterDone = classes.length > 0 && Boolean(classId) && studentCount > 0;
  const assignDone = hasApiBase && Boolean(classId);
  const questionDone = hasQuestion;
  const healthDone = serverOk === true;
  if (rosterDone && assignDone && healthDone && (!questionKnown || questionDone)) return null;

  type Step = {
    n: number;
    label: string;
    done: boolean;
    pending: boolean;
    actionLabel?: string;
    action?: () => void;
  };

  const steps: Step[] = [
    {
      n: 1,
      label: '建班并导入名单',
      done: rosterDone,
      pending: false,
      actionLabel: classes.length === 0 ? '去建班' : '去导入名单',
      action: () => (classes.length === 0 ? (onCreateClass ? onCreateClass() : onGo('prep-roster')) : onGo('prep-roster')),
    },
    {
      n: 2,
      label: '指派学生机',
      done: assignDone,
      pending: false,
      actionLabel: '去指派',
      action: () => onGo('assign'),
    },
    {
      n: 3,
      label: '发第一题',
      done: questionDone,
      pending: !questionKnown,
      actionLabel: '去发第一题',
      action: () => onGo('session'),
    },
    {
      n: 4,
      label: '服务器可达 / 学生端版本',
      done: healthDone,
      pending: serverOk === null,
      actionLabel: '重新检测',
      action: () => onGo('assign'),
    },
  ];

  let ctaLabel = '去发第一题';
  let cta = () => onGo('session');
  if (!rosterDone) {
    if (classes.length === 0) {
      ctaLabel = '创建班级';
      cta = () => (onCreateClass ? onCreateClass() : onGo('prep-roster'));
    } else {
      ctaLabel = '去导入名单';
      cta = () => onGo('prep-roster');
    }
  } else if (!assignDone) {
    ctaLabel = '去指派学生机';
    cta = () => onGo('assign');
  } else if (!healthDone) {
    ctaLabel = '检查服务器';
    cta = () => onGo('assign');
  }

  const connectedLabel =
    connectedCount === 0
      ? '暂无在线桌面端'
      : `已连桌面端 ${connectedCount} 台 · 版本 ${connectedVersions.length ? connectedVersions.join(' / ') : '未上报'}`;

  return (
    <section className="setup-checklist">
      <h2>开课准备</h2>
      <p className="hint">完成以下步骤后，本清单会自动收起。未完成项可一键跳转。</p>
      <ol className="setup-steps">
        {steps.map((step) => (
          <li key={step.n} className={step.done ? 'setup-step done' : 'setup-step'}>
            <span>
              {step.n}. {step.label}
              {step.n === 4 ? (
                <span className="hint">
                  {' '}
                  ·{' '}
                  {serverOk === null
                    ? '检测中…'
                    : serverOk
                      ? `可达 · 服务端 v${serverVersion || '—'} · ${connectedLabel}${
                          studentPkgVersion ? ` · 安装包应对齐 v${studentPkgVersion}` : ''
                        }`
                      : '不可达，请检查教师机服务'}
                </span>
              ) : null}
            </span>
            <span className="status">{step.done ? '已完成' : step.pending ? '检查中' : '未完成'}</span>
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

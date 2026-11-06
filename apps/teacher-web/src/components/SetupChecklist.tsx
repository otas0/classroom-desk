import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ClassItem } from '../types';

export function SetupChecklist({
  classId,
  classes,
  studentCount,
  hasApiBase,
  onGo,
  onCreateClass,
}: {
  classId: string;
  classes: ClassItem[];
  studentCount: number;
  hasApiBase: boolean;
  onGo: (tab: 'prep' | 'assign' | 'session') => void;
  onCreateClass?: () => void;
}) {
  const [hasQuestion, setHasQuestion] = useState(false);
  const [questionKnown, setQuestionKnown] = useState(false);

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
  }, [classId]);

  const rosterDone = classes.length > 0 && Boolean(classId) && studentCount > 0;
  const assignDone = hasApiBase && Boolean(classId);
  const questionDone = hasQuestion;
  if (rosterDone && assignDone && (!questionKnown || questionDone)) return null;

  const steps: Array<{ n: number; label: string; done: boolean; pending: boolean }> = [
    { n: 1, label: '建班并导入名单', done: rosterDone, pending: false },
    { n: 2, label: '指派学生机', done: assignDone, pending: false },
    { n: 3, label: '发第一题', done: questionDone, pending: !questionKnown },
  ];

  let ctaLabel = '去发第一题';
  let cta = () => onGo('session');
  if (!rosterDone) {
    if (classes.length === 0) {
      ctaLabel = '创建班级';
      cta = () => (onCreateClass ? onCreateClass() : onGo('prep'));
    } else {
      ctaLabel = '去导入名单';
      cta = () => onGo('prep');
    }
  } else if (!assignDone) {
    ctaLabel = '去指派学生机';
    cta = () => onGo('assign');
  }

  return (
    <section className="setup-checklist">
      <h2>开课准备</h2>
      <p className="hint">完成以下三步后，本清单会自动收起。</p>
      <ol className="setup-steps">
        {steps.map((step) => (
          <li key={step.n} className={step.done ? 'setup-step done' : 'setup-step'}>
            <span>
              {step.n}. {step.label}
            </span>
            <span className="status">{step.done ? '已完成' : step.pending ? '检查中' : '未完成'}</span>
          </li>
        ))}
      </ol>
      <button type="button" onClick={cta}>
        {ctaLabel}
      </button>
    </section>
  );
}

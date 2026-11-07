import { useState } from 'react';

function tryParse(detail: string): unknown {
  try {
    return JSON.parse(detail);
  } catch {
    return null;
  }
}

export type AuditJumpTarget = 'roster' | 'questions' | 'q-recycle';

export type PurgeConfirmJump = {
  classId: string | null;
  count: number | null;
  students: number | null;
  questions: number | null;
};

export function auditJumpTarget(
  action: string | null | undefined,
  detailObj?: Record<string, unknown> | null,
): AuditJumpTarget | null {
  const a = String(action ?? '');
  if (a.startsWith('students.')) return 'roster';
  if (
    a === 'questions.bulk_delete' ||
    a === 'questions.bulk_purge' ||
    (a.includes('recycle') && a.startsWith('questions.'))
  ) {
    return 'q-recycle';
  }
  if (a === 'questions.bulk') {
    const bulkAction = String(detailObj?.action ?? '');
    if (bulkAction === 'delete' || bulkAction === 'purge') return 'q-recycle';
    return 'questions';
  }
  if (a.startsWith('questions.')) return 'questions';
  return null;
}

function readPurgeJump(obj: Record<string, unknown>): PurgeConfirmJump {
  const classId =
    typeof obj.classId === 'string' && obj.classId.trim() ? obj.classId.trim() : null;
  const students = typeof obj.students === 'number' ? obj.students : null;
  const questions = typeof obj.questions === 'number' ? obj.questions : null;
  const count =
    typeof obj.count === 'number'
      ? obj.count
      : students != null || questions != null
        ? (students ?? 0) + (questions ?? 0)
        : null;
  return { classId, count, students, questions };
}

export function AuditDetail({
  detail,
  action,
  onJumpIds,
  onJumpPurgeConfirm,
}: {
  detail: string;
  action?: string | null;
  onJumpIds?: (opts: { ids: string[]; target: AuditJumpTarget; action: string }) => void;
  onJumpPurgeConfirm?: (jump: PurgeConfirmJump) => void;
}) {
  const [open, setOpen] = useState(false);
  const parsed = tryParse(detail);
  if (!parsed || typeof parsed !== 'object') {
    return <span>{detail.slice(0, 160)}</span>;
  }
  const obj = parsed as Record<string, unknown>;
  const ids = Array.isArray(obj.ids) ? (obj.ids as unknown[]).map(String) : null;
  const summary = Object.entries(obj)
    .filter(([k]) => k !== 'ids' && k !== 'byClass')
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .slice(0, 4)
    .join(' · ');
  const target = auditJumpTarget(action, obj);
  const purgeMeta = readPurgeJump(obj);
  const purgeJump =
    String(action ?? '') === 'recycle.purge_preview' && onJumpPurgeConfirm ? (
      <>
        {' '}
        <button
          type="button"
          className="linkish"
          data-testid="audit-jump-purge-confirm"
          data-purge-count={purgeMeta.count ?? ''}
          data-purge-class={purgeMeta.classId ?? ''}
          onClick={() => onJumpPurgeConfirm(purgeMeta)}
        >
          跳转清理确认
          {purgeMeta.count != null ? `（${purgeMeta.count}）` : ''}
        </button>
      </>
    ) : null;

  return (
    <span className="audit-detail">
      {summary || '详情'}
      {purgeJump}
      {ids && ids.length ? (
        <>
          {' '}
          <button type="button" className="linkish" onClick={() => setOpen((v) => !v)}>
            {open ? '收起 ids' : `展开 ids（${ids.length}）`}
          </button>
          {target && onJumpIds ? (
            <>
              {' '}
              <button
                type="button"
                className="linkish"
                data-testid="audit-jump-ids"
                onClick={() => onJumpIds({ ids, target, action: String(action ?? '') })}
              >
                {target === 'roster' ? '跳转名单' : target === 'q-recycle' ? '跳转题目回收站' : '跳转发题'}
              </button>
            </>
          ) : null}
          {open ? (
            <pre className="audit-ids" data-testid="audit-ids-list">
              {ids.join('\n')}
            </pre>
          ) : null}
        </>
      ) : detail.length > 80 ? (
        <>
          {' '}
          <button type="button" className="linkish" onClick={() => setOpen((v) => !v)}>
            {open ? '收起' : '展开 JSON'}
          </button>
          {open ? <pre className="audit-ids">{JSON.stringify(obj, null, 2)}</pre> : null}
        </>
      ) : null}
    </span>
  );
}

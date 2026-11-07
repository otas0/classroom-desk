import { useState } from 'react';

function tryParse(detail: string): unknown {
  try {
    return JSON.parse(detail);
  } catch {
    return null;
  }
}

export function AuditDetail({ detail }: { detail: string }) {
  const [open, setOpen] = useState(false);
  const parsed = tryParse(detail);
  if (!parsed || typeof parsed !== 'object') {
    return <span>{detail.slice(0, 160)}</span>;
  }
  const obj = parsed as Record<string, unknown>;
  const ids = Array.isArray(obj.ids) ? (obj.ids as unknown[]).map(String) : null;
  const summary = Object.entries(obj)
    .filter(([k]) => k !== 'ids')
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .slice(0, 4)
    .join(' · ');

  return (
    <span className="audit-detail">
      {summary || '详情'}
      {ids && ids.length ? (
        <>
          {' '}
          <button type="button" className="linkish" onClick={() => setOpen((v) => !v)}>
            {open ? '收起 ids' : `展开 ids（${ids.length}）`}
          </button>
          {open ? (
            <pre className="audit-ids">{ids.join('\n')}</pre>
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

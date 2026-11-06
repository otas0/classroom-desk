import { useEffect, useState } from 'react';
import { api } from '../api';

export function LiveBoard({
  classId,
  projection = false,
  onExitProjection,
}: {
  classId: string;
  projection?: boolean;
  onExitProjection?: () => void;
}) {
  const [items, setItems] = useState<
    Array<{
      id: string;
      title: string;
      type: string;
      closed: boolean;
      retryWrong?: boolean;
      rosterTotal: number;
      answeredCount: number;
      pendingCount: number;
      correctCount: number;
      correctRate: number;
      pendingStudents?: Array<{ displayName: string; studentNo: string | null }>;
    }>
  >([]);
  const [rosterTotal, setRosterTotal] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState('');

  async function load() {
    if (!classId) return;
    const r = await api<{
      rosterTotal: number;
      items: typeof items;
    }>(`/api/v1/questions/live-board?classId=${classId}`);
    setRosterTotal(r.rosterTotal);
    setItems(r.items);
  }

  useEffect(() => {
    void load().catch((e) => setErr(e instanceof Error ? e.message : '加载失败'));
    const t = window.setInterval(() => void load().catch(() => undefined), 3000);
    return () => window.clearInterval(t);
  }, [classId]);

  return (
    <section className={projection ? 'live-board projection-mode' : 'live-board'}>
      <h2>大屏答题态势</h2>
      {projection ? (
        <button type="button" className="secondary" onClick={() => onExitProjection?.()}>
          退出投影
        </button>
      ) : null}
      <p className="hint">全班 {rosterTotal} 人 · 约每 3 秒刷新 · 投影可读</p>
      {err ? <p className="error">{err}</p> : null}
      {items.length === 0 ? <p className="hint">暂无进行中的已发布题目</p> : null}
      {items.map((q) => {
        const answeredPct =
          q.rosterTotal > 0 ? Math.round((q.answeredCount / q.rosterTotal) * 100) : 0;
        const correctPct = Math.round(q.correctRate * 100);
        const openPending = Boolean(expanded[q.id]);
        const pending = q.pendingStudents ?? [];
        return (
          <div key={q.id} className="live-card">
            <h3>
              [{q.type}] {q.title}
              {q.closed ? ' · 已收卷' : ''}
              {q.retryWrong ? ' · 错题重练中' : ''}
            </h3>
            <p className="projection-stats">
              已交 {q.answeredCount} · 未交 {q.pendingCount} · 正确率 {correctPct}%
            </p>
            <div className="bar-track tall">
              <div className="bar correct" style={{ width: `${answeredPct}%` }} title="已交占比" />
            </div>
            <div className="bar-track tall">
              <div className="bar option" style={{ width: `${correctPct}%` }} title="正确率" />
            </div>
            <div className="row">
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  void api(`/api/v1/questions/${q.id}/${q.closed ? 'reopen' : 'close'}`, {
                    method: 'POST',
                    body: '{}',
                  }).then(load)
                }
              >
                {q.closed ? '重开' : '一键收卷'}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={!q.closed}
                onClick={() =>
                  void api(`/api/v1/questions/${q.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ retryWrong: !q.retryWrong }),
                  }).then(load)
                }
              >
                {q.retryWrong ? '关闭错题重练' : '开启错题重练'}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setExpanded((prev) => ({ ...prev, [q.id]: !prev[q.id] }))}
              >
                {openPending ? '收起未交名单' : `未交名单（${q.pendingCount}）`}
              </button>
            </div>
            {openPending ? (
              <div className="pending-list">
                {pending.length === 0 ? (
                  <p className="hint">全班已交</p>
                ) : (
                  <ul>
                    {pending.map((s) => (
                      <li key={`${s.displayName}-${s.studentNo ?? ''}`}>
                        {s.studentNo ? `${s.studentNo} · ` : ''}
                        {s.displayName}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

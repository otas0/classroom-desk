import { useEffect, useRef, useState, type CSSProperties } from 'react';
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
  const [fsHint, setFsHint] = useState('');
  const [readOnlyScreen, setReadOnlyScreen] = useState(() => {
    try {
      return localStorage.getItem('cd_liveboard_readonly') === '1';
    } catch {
      return false;
    }
  });
  const [autoReadonlyMins, setAutoReadonlyMins] = useState(5);
  const [sessionStartAt, setSessionStartAt] = useState<string | null>(null);
  const [autoReadonlyHint, setAutoReadonlyHint] = useState('');
  const [inputLockSummary, setInputLockSummary] = useState('');
  const [highContrast, setHighContrast] = useState(() => {
    try {
      return localStorage.getItem('cd_liveboard_hc') === '1';
    } catch {
      return false;
    }
  });
  const [barHue, setBarHue] = useState(() => {
    try {
      const n = Number(localStorage.getItem('cd_liveboard_bar_hue') ?? '0');
      return Number.isFinite(n) ? Math.max(0, Math.min(360, n)) : 0;
    } catch {
      return 0;
    }
  });
  const [barPreset, setBarPreset] = useState<'custom' | 'okabe' | 'blueorange' | 'gray'>(() => {
    try {
      const p = localStorage.getItem('cd_liveboard_bar_preset') ?? 'okabe';
      return p === 'okabe' || p === 'blueorange' || p === 'gray' || p === 'custom' ? p : 'okabe';
    } catch {
      return 'okabe';
    }
  });
  const autoArmedRef = useRef(false);

  function applyBarPreset(next: 'custom' | 'okabe' | 'blueorange' | 'gray') {
    setBarPreset(next);
    try {
      localStorage.setItem('cd_liveboard_bar_preset', next);
    } catch {
      /* ignore */
    }
  }

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

  useEffect(() => {
    void api<{ liveboardReadonlyAfterMinutes?: number }>('/api/v1/settings')
      .then((s) => {
        const mins = Number(s.liveboardReadonlyAfterMinutes ?? 5);
        setAutoReadonlyMins(Number.isFinite(mins) ? Math.max(0, Math.min(240, Math.trunc(mins))) : 5);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!classId) {
      setSessionStartAt(null);
      return;
    }
    let cancelled = false;
    void api<{ items: Array<{ id: string; startAt: string; status: string }> }>(
      `/api/v1/attendance/sessions?classId=${encodeURIComponent(classId)}`,
    )
      .then((r) => {
        if (cancelled) return;
        const open = (r.items ?? []).find((s) => s.status === 'open');
        setSessionStartAt(open?.startAt ?? null);
      })
      .catch(() => {
        if (!cancelled) setSessionStartAt(null);
      });
    return () => {
      cancelled = true;
    };
  }, [classId, projection]);

  useEffect(() => {
    if (!projection || !classId) {
      setInputLockSummary('');
      return;
    }
    let cancelled = false;
    async function loadInputLock() {
      try {
        const s = await api<{
          inputLock?: {
            keyboard?: boolean;
            mouse?: boolean;
            voice?: boolean;
            camera?: boolean;
          };
          inputLockActive?: boolean;
        }>(`/api/v1/settings/public?classId=${encodeURIComponent(classId)}`);
        if (cancelled) return;
        if (!s.inputLockActive) {
          setInputLockSummary('物理输入锁：未启用');
          return;
        }
        const parts: string[] = [];
        if (s.inputLock?.keyboard) parts.push('键盘');
        if (s.inputLock?.mouse) parts.push('鼠标');
        if (s.inputLock?.voice) parts.push('语音');
        if (s.inputLock?.camera) parts.push('相机');
        setInputLockSummary(`全班输入锁：已锁 ${parts.join('、') || '—'}`);
      } catch {
        if (!cancelled) setInputLockSummary('');
      }
    }
    void loadInputLock();
    const t = window.setInterval(() => void loadInputLock(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [projection, classId]);

  useEffect(() => {
    if (!projection) {
      autoArmedRef.current = false;
      setAutoReadonlyHint('');
      return;
    }

    if (autoReadonlyMins <= 0) {
      setAutoReadonlyHint('自动只读已关闭（设置中 N=0）');
      return;
    }

    if (!sessionStartAt) {
      setAutoReadonlyHint('尚无进行中的出勤课次：创建/开启签到后按课次 startAt 计时自动只读');
      return;
    }

    const enteredAt = new Date(sessionStartAt).getTime();
    if (!Number.isFinite(enteredAt)) {
      setAutoReadonlyHint('课次开始时间无效');
      return;
    }

    const dueAt = enteredAt + autoReadonlyMins * 60_000;
    const remaining = dueAt - Date.now();

    function enableAutoReadonly() {
      if (autoArmedRef.current) return;
      autoArmedRef.current = true;
      setReadOnly(true);
      setAutoReadonlyHint(`已到本场课次开始后 ${autoReadonlyMins} 分钟，自动进入只读大屏`);
    }

    if (remaining <= 0) {
      enableAutoReadonly();
      return;
    }

    const minsLeft = Math.ceil(remaining / 60_000);
    setAutoReadonlyHint(
      `本场课次 ${new Date(sessionStartAt).toLocaleTimeString()} 起算，约 ${minsLeft} 分钟后自动只读（R 可手动）`,
    );
    const t = window.setTimeout(enableAutoReadonly, remaining);
    return () => window.clearTimeout(t);
  }, [projection, autoReadonlyMins, sessionStartAt]);

  useEffect(() => {
    if (!projection) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (document.fullscreenElement) {
          void document.exitFullscreen().catch(() => undefined);
        }
        onExitProjection?.();
        return;
      }
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        void toggleFullscreen();
      }
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        setReadOnlyScreen((prev) => {
          const next = !prev;
          try {
            localStorage.setItem('cd_liveboard_readonly', next ? '1' : '0');
          } catch {
            /* ignore */
          }
          return next;
        });
      }
      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        setHighContrast((prev) => {
          const next = !prev;
          try {
            localStorage.setItem('cd_liveboard_hc', next ? '1' : '0');
          } catch {
            /* ignore */
          }
          return next;
        });
      }
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        setBarHue((prev) => {
          const next = (prev + 60) % 360;
          try {
            localStorage.setItem('cd_liveboard_bar_hue', String(next));
          } catch {
            /* ignore */
          }
          return next;
        });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [projection, onExitProjection]);

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        setFsHint('已进入全屏（Esc 退出投影，F 全屏，R 只读大屏）');
      } else {
        await document.exitFullscreen();
        setFsHint('已退出全屏');
      }
    } catch (e) {
      setFsHint(e instanceof Error ? e.message : '全屏失败');
    }
  }

  function setReadOnly(next: boolean) {
    setReadOnlyScreen(next);
    try {
      localStorage.setItem('cd_liveboard_readonly', next ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  const hideControls = projection && readOnlyScreen;

  const barStyle = {
    ['--bar-hue' as string]: String(barHue),
    ['--bar-preset' as string]: barPreset,
  } as CSSProperties;

  return (
    <section
      className={`live-board bar-preset-${barPreset}${projection ? ' projection-mode' : ''}${highContrast ? ' hc-theme' : ''}`}
      style={barStyle}
    >
      <h2>大屏答题态势</h2>
      {projection && inputLockSummary ? (
        <p className="hint" data-testid="projection-input-lock-summary" role="status">
          {inputLockSummary}
        </p>
      ) : null}
      {projection ? (
        <div className="row">
          <button type="button" className="secondary" onClick={() => onExitProjection?.()}>
            退出投影（Esc）
          </button>
          <button type="button" className="secondary" onClick={() => void toggleFullscreen()}>
            全屏（F）
          </button>
          <label className="row">
            <input
              type="checkbox"
              checked={readOnlyScreen}
              onChange={(e) => setReadOnly(e.target.checked)}
            />
            只读大屏（R）
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={highContrast}
              onChange={(e) => {
                setHighContrast(e.target.checked);
                try {
                  localStorage.setItem('cd_liveboard_hc', e.target.checked ? '1' : '0');
                } catch {
                  /* ignore */
                }
              }}
            />
            高对比大字（H）
          </label>
          <div className="row">
            <span className="hint">色盲预设</span>
            {(
              [
                ['okabe', 'Okabe–Ito'],
                ['blueorange', '蓝橙'],
                ['gray', '灰阶'],
                ['custom', '自定义色相'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={barPreset === id ? 'chip active-chip' : 'chip'}
                onClick={() => applyBarPreset(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {barPreset === 'custom' ? (
            <label className="row">
              色盲色相
              <input
                type="range"
                min={0}
                max={360}
                value={barHue}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setBarHue(next);
                  try {
                    localStorage.setItem('cd_liveboard_bar_hue', String(next));
                  } catch {
                    /* ignore */
                  }
                }}
              />
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setBarHue((prev) => {
                    const next = (prev + 60) % 360;
                    try {
                      localStorage.setItem('cd_liveboard_bar_hue', String(next));
                    } catch {
                      /* ignore */
                    }
                    return next;
                  });
                }}
              >
                切换色相（C）
              </button>
            </label>
          ) : null}
        </div>
      ) : null}
      <div className="bar-legend hint" aria-label="进度条图例">
        <span className="legend-swatch correct" /> 已交占比
        <span className="legend-swatch option" /> 正确率
        {projection
          ? ' · Esc 退出 · F 全屏 · R 只读 · H 高对比 · C 色相（自定义）'
          : ''}
      </div>
      <p className="hint">
        全班 {rosterTotal} 人 · 约每 3 秒刷新 · 投影可读
      </p>
      {projection && autoReadonlyHint ? <p className="hint">{autoReadonlyHint}</p> : null}
      {fsHint ? <p className="hint">{fsHint}</p> : null}
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
            {hideControls ? null : (
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
            )}
            {!hideControls && openPending ? (
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

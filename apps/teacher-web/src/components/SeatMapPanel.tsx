import { useEffect, useState } from 'react';
import { api } from '../api';
import { ConfirmModal } from '../ConfirmModal';
import { t } from '@classroom-desk/i18n';

type Seat = {
  id: string;
  rowIndex: number;
  colIndex: number;
  label: string;
  studentId: string | null;
  displayName: string | null;
  studentNo: string | null;
  online: boolean;
};

type Roster = { id: string; displayName: string; studentNo: string | null };

function isSeatNetworkError(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return /network|fetch|Failed to fetch|断线|offline|ECONNREFUSED|超时|timeout|http_5\d\d|TypeError/i.test(
    text,
  );
}

function seatFailMessage(err: unknown, kind: 'bind' | 'swap'): string {
  const text = err instanceof Error ? err.message : String(err);
  const conflict = /already_seated|一人一座|其它座位|student_already|409|conflict|UNIQUE|unique/i.test(
    text,
  );
  const network = isSeatNetworkError(err);
  if (kind === 'swap') {
    if (conflict) return `换座冲突：${text}（已回滚本地预览）`;
    if (network) return `换座网络失败：${text}（已回滚，请检查教师机连接后重试）`;
    return `换座失败：${text}（已回滚）`;
  }
  if (conflict) return text;
  if (network) return `绑座网络失败：${text}`;
  return `绑座失败：${text}`;
}

export function SeatMapPanel({ classId }: { classId: string }) {
  const [items, setItems] = useState<Seat[]>([]);
  const [rows, setRows] = useState(5);
  const [cols, setCols] = useState(6);
  const [roster, setRoster] = useState<Roster[]>([]);
  const [msg, setMsg] = useState('');
  const [errToast, setErrToast] = useState('');
  const [offlineBound, setOfflineBound] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [shakeIds, setShakeIds] = useState<string[]>([]);
  const [pendingSwap, setPendingSwap] = useState<{ a: string; b: string } | null>(null);
  const [swapRetryBusy, setSwapRetryBusy] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const [batchConfirm, setBatchConfirm] = useState<{
    action: 'lock' | 'unlock';
    mode: 'row' | 'col' | 'all';
    seatIds: string[];
    /** Unlock: how many of seatIds currently have bySeat locks. */
    lockedCount?: number;
    /** Unlock: seat labels for ConfirmModal list. */
    seatLabels?: string[];
  } | null>(null);
  const [unlockLabelsExpanded, setUnlockLabelsExpanded] = useState(false);
  const UNLOCK_LABEL_PREVIEW = 5;

  async function load() {
    if (!classId) {
      setItems([]);
      return;
    }
    const [seats, students] = await Promise.all([
      api<{ items: Seat[]; rows: number; cols: number; offlineBound: number }>(
        `/api/v1/classes/${classId}/seats`,
      ),
      api<{ items: Roster[] }>(`/api/v1/classes/${classId}/students`),
    ]);
    setItems(seats.items ?? []);
    setOfflineBound(seats.offlineBound ?? 0);
    if (seats.rows > 0) setRows(seats.rows);
    if (seats.cols > 0) setCols(seats.cols);
    setRoster(
      (students.items ?? []).map((s) => ({
        id: String((s as { id: string }).id),
        displayName: String((s as { displayName?: string }).displayName ?? ''),
        studentNo:
          (s as { studentNo?: string | null }).studentNo == null
            ? null
            : String((s as { studentNo: string }).studentNo),
      })),
    );
  }

  useEffect(() => {
    setPendingSwap(null);
    void load().catch((e) => setMsg(e instanceof Error ? e.message : t('加载失败')));
    const _cdTimer = window.setInterval(() => void load().catch(() => undefined), 8000);
    return () => window.clearInterval(_cdTimer);
  }, [classId]);

  function flashShake(ids: string[], toast: string) {
    setShakeIds(ids);
    setErrToast(toast);
    window.setTimeout(() => setShakeIds([]), 600);
    window.setTimeout(() => setErrToast(''), 4000);
  }

  async function ensureGrid() {
    await api(`/api/v1/classes/${classId}/seats`, {
      method: 'PUT',
      body: JSON.stringify({ rows, cols }),
    });
    setMsg(t('已生成 {v0}×{v1} 座位', { v0: rows, v1: cols }));
    await load();
  }

  async function bind(seatId: string, studentId: string | null) {
    try {
      const r = await api<{ message?: string; clearedFromLabel?: string | null }>(
        `/api/v1/classes/${classId}/seats/${seatId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ studentId }),
        },
      );
      setSelected(null);
      if (r.message) setMsg(r.message);
      else if (r.clearedFromLabel) {
        setMsg(t('已从 {v0} 移开（同班一人一座）', { v0: r.clearedFromLabel }));
      }
      await load();
    } catch (e) {
      flashShake([seatId], seatFailMessage(e, 'bind'));
      await load();
    }
  }

  async function swapSeats(a: string, b: string) {
    const before = items;
    // Optimistic visual swap
    setItems((prev) => {
      const sa = prev.find((x) => x.id === a);
      const sb = prev.find((x) => x.id === b);
      if (!sa || !sb) return prev;
      return prev.map((x) => {
        if (x.id === a) {
          return {
            ...x,
            studentId: sb.studentId,
            displayName: sb.displayName,
            studentNo: sb.studentNo,
            online: sb.online,
          };
        }
        if (x.id === b) {
          return {
            ...x,
            studentId: sa.studentId,
            displayName: sa.displayName,
            studentNo: sa.studentNo,
            online: sa.online,
          };
        }
        return x;
      });
    });
    try {
      await api(`/api/v1/classes/${classId}/seats/swap`, {
        method: 'POST',
        body: JSON.stringify({ seatIdA: a, seatIdB: b }),
      });
      setMsg(t('已换座'));
      setSelected(null);
      setPendingSwap(null);
      setShakeIds([]);
      setErrToast('');
      await load();
    } catch (e) {
      setItems(before);
      flashShake([a, b], seatFailMessage(e, 'swap'));
      if (isSeatNetworkError(e)) setPendingSwap({ a, b });
      else setPendingSwap(null);
      await load();
    }
  }

  async function snakeFill() {
    const r = await api<{ seated: number; seats: number; roster: number }>(
      `/api/v1/classes/${classId}/seats/snake-fill`,
      { method: 'POST', body: '{}' },
    );
    setMsg(
      t('蛇形落座 {v0}/{v1}（网格 {v2}）', {
        v0: r.seated,
        v1: r.roster,
        v2: r.seats,
      }),
    );
    await load();
  }

  function seatsInMode(mode: 'row' | 'col' | 'all', onlyEmpty: boolean): Seat[] | null {
    let pool = onlyEmpty ? items.filter((s) => !s.studentId) : items;
    if (mode === 'row' || mode === 'col') {
      const anchor = selected ? items.find((s) => s.id === selected) : null;
      if (!anchor) {
        setMsg(
          mode === 'row'
            ? t('请先点选一行内任意座位')
            : t('请先点选一列内任意座位'),
        );
        return null;
      }
      pool =
        mode === 'row'
          ? pool.filter((s) => s.rowIndex === anchor.rowIndex)
          : pool.filter((s) => s.colIndex === anchor.colIndex);
    }
    return pool;
  }

  function requestLockEmpty(mode: 'row' | 'col' | 'all') {
    if (!classId) return;
    const targets = seatsInMode(mode, true);
    if (!targets) return;
    if (!targets.length) {
      setMsg(t('没有可锁的空座'));
      return;
    }
    setUnlockLabelsExpanded(false);
    setBatchConfirm({ action: 'lock', mode, seatIds: targets.map((s) => s.id) });
  }

  async function loadLockedSeatIds(): Promise<Set<string>> {
    const s = await api<{
      inputLockStore?: { bySeat?: Record<string, unknown> };
    }>(`/api/v1/settings/public?classId=${encodeURIComponent(classId)}`);
    const prefix = `${classId}:`;
    const ids = new Set<string>();
    for (const k of Object.keys(s.inputLockStore?.bySeat ?? {})) {
      if (k.startsWith(prefix)) ids.add(k.slice(prefix.length));
    }
    return ids;
  }

  function requestUnlockSeats(mode: 'row' | 'col' | 'all') {
    if (!classId) return;
    const targets = seatsInMode(mode, false);
    if (!targets) return;
    if (!targets.length) {
      setMsg(t('该范围无座位'));
      return;
    }
    setLockBusy(true);
    void loadLockedSeatIds()
      .then((locked) => {
        const lockedSeats = targets.filter((s) => locked.has(s.id));
        const seatIds = lockedSeats.map((s) => s.id);
        if (!seatIds.length) {
          setMsg(t('该范围没有已上锁的机位'));
          return;
        }
        setUnlockLabelsExpanded(false);
        setBatchConfirm({
          action: 'unlock',
          mode,
          seatIds,
          lockedCount: seatIds.length,
          seatLabels: lockedSeats.map((s) => s.label || s.id),
        });
      })
      .catch((e) => setMsg(e instanceof Error ? e.message : t('读取机位锁失败')))
      .finally(() => setLockBusy(false));
  }

  async function runBatchConfirm() {
    if (!classId || !batchConfirm) return;
    const { action, mode, seatIds } = batchConfirm;
    setLockBusy(true);
    try {
      if (action === 'lock') {
        await api('/api/v1/settings', {
          method: 'PATCH',
          body: JSON.stringify({
            inputLock: {
              classId,
              seatIds,
              keyboard: true,
              mouse: true,
              voice: false,
              camera: false,
            },
          }),
        });
        setMsg(
          mode === 'all'
            ? `已锁全部空座 ${seatIds.length} 个（键鼠）`
            : mode === 'row'
              ? `已锁本行空座 ${seatIds.length} 个（键鼠）`
              : `已锁本列空座 ${seatIds.length} 个（键鼠）`,
        );
      } else {
        await api('/api/v1/settings', {
          method: 'PATCH',
          body: JSON.stringify({
            inputLock: { classId, clearSeatIds: seatIds },
          }),
        });
        setMsg(
          mode === 'all'
            ? `已解除 ${seatIds.length} 个机位锁`
            : mode === 'row'
              ? `已解除本行 ${seatIds.length} 个机位锁`
              : `已解除本列 ${seatIds.length} 个机位锁`,
        );
      }
      setBatchConfirm(null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('批量机位锁操作失败'));
    } finally {
      setLockBusy(false);
    }
  }

  const modeLabel =
    batchConfirm?.mode === 'all' ? t('全部') : batchConfirm?.mode === 'row' ? t('本行') : t('本列');

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: `repeat(${Math.max(cols, 1)}, minmax(72px, 1fr))`,
    gap: 8,
  } as const;

  return (
    <section>
      <h2>{t('座位图')}</h2>
      <p className="hint">
        拖拽座位互换；或按学号蛇形落座（奇偶行反向）。绿=在线，红框=已绑定未上线。未上线绑定{' '}
        {offlineBound} 个。同班一人一座。
      </p>
      {!classId ? <p className="hint">{t('请先选择班级')}</p> : null}
      <div className="row">
        <label>
          行
          <input type="number" min={1} max={20} value={rows} onChange={(e) => setRows(Number(e.target.value) || 1)} />
        </label>
        <label>
          列
          <input type="number" min={1} max={16} value={cols} onChange={(e) => setCols(Number(e.target.value) || 1)} />
        </label>
        <button type="button" disabled={!classId} onClick={() => void ensureGrid().catch((e) => setMsg(String(e)))}>
          生成/调整网格
        </button>
        <button
          type="button"
          disabled={!classId}
          onClick={() => void snakeFill().catch((e) => setMsg(e instanceof Error ? e.message : String(e)))}
        >
          按学号蛇形落座
        </button>
        <button type="button" className="secondary" disabled={!classId} onClick={() => void load()}>
          刷新在线
        </button>
        <button
          type="button"
          data-testid="seat-lock-empty-row"
          disabled={!classId || lockBusy}
          title={t('先选中该行任意座位')}
          onClick={() => requestLockEmpty('row')}
        >
          锁本行空座
        </button>
        <button
          type="button"
          data-testid="seat-lock-empty-col"
          disabled={!classId || lockBusy}
          title={t('先选中该列任意座位')}
          onClick={() => requestLockEmpty('col')}
        >
          锁本列空座
        </button>
        <button
          type="button"
          data-testid="seat-lock-empty-all"
          disabled={!classId || lockBusy}
          onClick={() => requestLockEmpty('all')}
        >
          锁全部空座
        </button>
        <button
          type="button"
          className="secondary"
          data-testid="seat-unlock-row"
          disabled={!classId || lockBusy}
          title={t('先选中该行任意座位')}
          onClick={() => requestUnlockSeats('row')}
        >
          解本行座锁
        </button>
        <button
          type="button"
          className="secondary"
          data-testid="seat-unlock-col"
          disabled={!classId || lockBusy}
          title={t('先选中该列任意座位')}
          onClick={() => requestUnlockSeats('col')}
        >
          解本列座锁
        </button>
        <button
          type="button"
          className="secondary"
          data-testid="seat-unlock-all"
          disabled={!classId || lockBusy}
          onClick={() => requestUnlockSeats('all')}
        >
          解全部座锁
        </button>
      </div>
      {msg ? <p className="hint">{msg}</p> : null}
      {errToast ? (
        <p className="error seat-toast" role="alert">
          {errToast}
        </p>
      ) : null}
      {pendingSwap ? (
        <div className="row" data-testid="seat-swap-retry">
          <p className="error" style={{ margin: 0 }}>
            上次换座因网络失败已回滚
          </p>
          <button
            type="button"
            disabled={swapRetryBusy || !classId}
            onClick={() => {
              const { a, b } = pendingSwap;
              setSwapRetryBusy(true);
              void swapSeats(a, b).finally(() => setSwapRetryBusy(false));
            }}
          >
            {swapRetryBusy ? t('重试中…') : t('重试换座')}
          </button>
          <button type="button" className="secondary" disabled={swapRetryBusy} onClick={() => setPendingSwap(null)}>
            {t('取消')}
          </button>
        </div>
      ) : null}
      <div className="seat-grid" style={gridStyle}>
        {items.map((s) => (
          <button
            key={s.id}
            type="button"
            draggable
            className={`seat-cell${s.online ? ' online' : ''}${s.studentId && !s.online ? ' offline-bound' : ''}${selected === s.id ? ' selected' : ''}${dragId === s.id ? ' dragging' : ''}${shakeIds.includes(s.id) ? ' seat-shake' : ''}`}
            onClick={() => setSelected(s.id)}
            onDragStart={(e) => {
              setDragId(s.id);
              e.dataTransfer.setData('text/seat-id', s.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => setDragId(null)}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(e) => {
              e.preventDefault();
              const from = e.dataTransfer.getData('text/seat-id') || dragId;
              setDragId(null);
              if (!from || from === s.id) return;
              void swapSeats(from, s.id);
            }}
            title={`${s.label} · 拖到其它座位换座`}
          >
            <span className="seat-label">{s.label}</span>
            <span className="seat-name">
              {s.displayName ? s.displayName : t('空位')}
              {s.studentNo ? ` · ${s.studentNo}` : ''}
            </span>
          </button>
        ))}
      </div>
      {selected ? (
        <div className="row">
          <label>
            绑定学生到选中机位
            <select
              defaultValue=""
              onChange={(e) => {
                const v = e.target.value;
                void bind(selected, v || null);
              }}
            >
              <option value="">{t('（清空）')}</option>
              {roster.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.studentNo ? `${r.studentNo} · ` : ''}
                  {r.displayName}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      <ConfirmModal
        open={Boolean(batchConfirm)}
        title={
          batchConfirm?.action === 'lock'
            ? `确认锁${modeLabel}空座`
            : `确认解除${modeLabel}机位锁`
        }
        body={
          batchConfirm ? (
            <div data-testid="seat-batch-lock-confirm-body">
              {batchConfirm.action === 'lock' ? (
                <p>
                  将对本范围 {batchConfirm.seatIds.length}{' '}
                  个空座启用键鼠锁（语音/相机不变）。
                </p>
              ) : (
                <>
                  <p>
                    将清除 {batchConfirm.lockedCount ?? batchConfirm.seatIds.length}{' '}
                    个已上锁机位的输入锁（仅含当前确有 bySeat 的座位）：
                    <span className="hint" data-testid="seat-batch-unlock-total">
                      {' '}
                      共 {(batchConfirm.seatLabels ?? []).length}
                    </span>
                  </p>
                  <ul data-testid="seat-batch-unlock-labels">
                    {(unlockLabelsExpanded ||
                    (batchConfirm.seatLabels ?? []).length <= UNLOCK_LABEL_PREVIEW
                      ? batchConfirm.seatLabels ?? []
                      : (batchConfirm.seatLabels ?? []).slice(0, UNLOCK_LABEL_PREVIEW)
                    ).map((lb) => (
                      <li key={lb}>{lb}</li>
                    ))}
                  </ul>
                  {(batchConfirm.seatLabels ?? []).length > UNLOCK_LABEL_PREVIEW ? (
                    <button
                      type="button"
                      className="linkish"
                      data-testid="seat-batch-unlock-labels-toggle"
                      onClick={() => setUnlockLabelsExpanded((v) => !v)}
                    >
                      {unlockLabelsExpanded
                        ? t('收起')
                        : `展开其余 ${(batchConfirm.seatLabels ?? []).length - UNLOCK_LABEL_PREVIEW}（共 ${(batchConfirm.seatLabels ?? []).length}）`}
                    </button>
                  ) : null}
                </>
              )}
            </div>
          ) : null
        }
        confirmLabel={batchConfirm?.action === 'lock' ? t('确认锁定') : t('确认解除')}
        busy={lockBusy}
        onCancel={() => {
          if (!lockBusy) {
            setBatchConfirm(null);
            setUnlockLabelsExpanded(false);
          }
        }}
        onConfirm={() => void runBatchConfirm()}
      />
    </section>
  );
}

import { useEffect, useState } from 'react';
import { api } from '../api';

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

export function SeatMapPanel({ classId }: { classId: string }) {
  const [items, setItems] = useState<Seat[]>([]);
  const [rows, setRows] = useState(5);
  const [cols, setCols] = useState(6);
  const [roster, setRoster] = useState<Roster[]>([]);
  const [msg, setMsg] = useState('');
  const [offlineBound, setOfflineBound] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

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
    void load().catch((e) => setMsg(e instanceof Error ? e.message : '加载失败'));
    const t = window.setInterval(() => void load().catch(() => undefined), 8000);
    return () => window.clearInterval(t);
  }, [classId]);

  async function ensureGrid() {
    await api(`/api/v1/classes/${classId}/seats`, {
      method: 'PUT',
      body: JSON.stringify({ rows, cols }),
    });
    setMsg(`已生成 ${rows}×${cols} 座位`);
    await load();
  }

  async function bind(seatId: string, studentId: string | null) {
    const r = await api<{ message?: string; clearedFromLabel?: string | null }>(
      `/api/v1/classes/${classId}/seats/${seatId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ studentId }),
      },
    );
    setSelected(null);
    if (r.message) setMsg(r.message);
    else if (r.clearedFromLabel) setMsg(`已从 ${r.clearedFromLabel} 移开（同班一人一座）`);
    await load();
  }

  async function swapSeats(a: string, b: string) {
    await api(`/api/v1/classes/${classId}/seats/swap`, {
      method: 'POST',
      body: JSON.stringify({ seatIdA: a, seatIdB: b }),
    });
    setMsg('已换座');
    setSelected(null);
    await load();
  }

  async function snakeFill() {
    const r = await api<{ seated: number; seats: number; roster: number }>(
      `/api/v1/classes/${classId}/seats/snake-fill`,
      { method: 'POST', body: '{}' },
    );
    setMsg(`蛇形落座 ${r.seated}/${r.roster}（网格 ${r.seats}）`);
    await load();
  }

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: `repeat(${Math.max(cols, 1)}, minmax(72px, 1fr))`,
    gap: 8,
  } as const;

  return (
    <section>
      <h2>座位图</h2>
      <p className="hint">
        拖拽座位互换；或按学号蛇形落座（奇偶行反向）。绿=在线，红框=已绑定未上线。未上线绑定{' '}
        {offlineBound} 个。
      </p>
      {!classId ? <p className="hint">请先选择班级</p> : null}
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
      </div>
      {msg ? <p className="hint">{msg}</p> : null}
      <div className="seat-grid" style={gridStyle}>
        {items.map((s) => (
          <button
            key={s.id}
            type="button"
            draggable
            className={`seat-cell${s.online ? ' online' : ''}${s.studentId && !s.online ? ' offline-bound' : ''}${selected === s.id ? ' selected' : ''}${dragId === s.id ? ' dragging' : ''}`}
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
              void swapSeats(from, s.id).catch((err) => setMsg(String(err)));
            }}
            title={`${s.label} · 拖到其它座位换座`}
          >
            <span className="seat-label">{s.label}</span>
            <span className="seat-name">
              {s.displayName ? s.displayName : '空位'}
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
                void bind(selected, v || null).catch((err) => setMsg(String(err)));
              }}
            >
              <option value="">（清空）</option>
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
    </section>
  );
}

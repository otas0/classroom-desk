import { useEffect, useRef, useState } from 'react';
import { API_BASE, api, getToken } from '../api';
import { POINT_REASON_CHIPS } from '../types';
import { LiveBoard } from './LiveBoard';

const OCR_DRAFT_KEY = 'cd_ocr_draft';

type RosterStudent = {
  id: string;
  displayName: string;
  studentNo: string | null;
};

export function SessionHome({
  classId,
  onEnterProjection,
  onGoPrep,
  onGoAssign,
  onSetupChanged,
}: {
  classId: string;
  onEnterProjection: () => void;
  onGoPrep?: () => void;
  onGoAssign?: () => void;
  onSetupChanged?: () => void;
}) {
  const [kind, setKind] = useState<'bool' | 'blank'>('bool');
  const [boolCorrect, setBoolCorrect] = useState<'A' | 'B'>('A');
  const [title, setTitle] = useState('');
  const [stem, setStem] = useState('');
  const [blankKey, setBlankKey] = useState('');
  const [closesAtLocal, setClosesAtLocal] = useState('');
  const [publishMsg, setPublishMsg] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [boardKey, setBoardKey] = useState(0);

  const [students, setStudents] = useState<RosterStudent[]>([]);
  const [picked, setPicked] = useState<RosterStudent | null>(null);
  const [awardPts, setAwardPts] = useState(1);
  const [awardReason, setAwardReason] = useState('表扬');
  const [awardMsg, setAwardMsg] = useState('');
  const [sessionMsg, setSessionMsg] = useState('');
  const [buzzRound, setBuzzRound] = useState<{ id: string; reason: string; status: string } | null>(null);
  const [buzzHits, setBuzzHits] = useState<
    Array<{ studentId: string; displayName: string; studentNo: string | null; hitAt: string }>
  >([]);
  const [buzzLive, setBuzzLive] = useState(false);
  const buzzWsRef = useRef<WebSocket | null>(null);
  const [groupA, setGroupA] = useState(0);
  const [groupB, setGroupB] = useState(0);

  const [requests, setRequests] = useState<Array<Record<string, unknown>>>([]);
  const [requestErr, setRequestErr] = useState('');

  useEffect(() => {
    if (!classId) {
      setStudents([]);
      setPicked(null);
      return;
    }
    let cancelled = false;
    void api<{ items: Array<Record<string, unknown>> }>(`/api/v1/classes/${classId}/students`)
      .then((r) => {
        if (cancelled) return;
        setStudents(
          r.items.map((s) => ({
            id: String(s.id),
            displayName: String(s.displayName ?? ''),
            studentNo: s.studentNo == null || s.studentNo === '' ? null : String(s.studentNo),
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setStudents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [classId]);

  useEffect(() => {
    if (!classId) {
      setRequests([]);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const r = await api<{ items: Array<Record<string, unknown>> }>(
          `/api/v1/point-requests/pending?classId=${encodeURIComponent(classId)}`,
        );
        if (!cancelled) {
          setRequests(r.items);
          setRequestErr('');
        }
      } catch (e) {
        if (!cancelled) setRequestErr(e instanceof Error ? e.message : '加载加分请求失败');
      }
    }
    void load();
    const t = window.setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [classId]);

  function applyTemplate(next: 'bool' | 'blank') {
    setKind(next);
    if (next === 'bool') {
      setTitle((t) => t || '判断题');
      setStem((s) => s || '（请改成真实题干）下列说法正确吗？');
      setBlankKey('');
    } else {
      setTitle((t) => t || '填空题');
      setStem((s) => s || '（请改成真实题干）请填写答案：____');
    }
  }

  async function publish() {
    setPublishMsg('');
    if (!classId) {
      setPublishMsg('请先选择班级');
      return;
    }
    if (!title.trim() || !stem.trim()) {
      setPublishMsg('请填写题目标题与题干');
      return;
    }
    let closesAt: string | undefined;
    if (closesAtLocal) {
      const d = new Date(closesAtLocal);
      if (Number.isNaN(d.getTime())) {
        setPublishMsg('截止时间无效');
        return;
      }
      closesAt = d.toISOString();
    }
    const body: Record<string, unknown> =
      kind === 'blank'
        ? {
            classId,
            title: title.trim(),
            stem: stem.trim(),
            type: 'blank',
            answerKey: blankKey.trim(),
            options: [],
            closesAt,
          }
        : {
            classId,
            title: title.trim(),
            stem: stem.trim(),
            type: 'bool',
            closesAt,
            options: [
              { label: 'A', content: '正确', isCorrect: boolCorrect === 'A' },
              { label: 'B', content: '错误', isCorrect: boolCorrect === 'B' },
            ],
          };
    if (kind === 'blank' && !blankKey.trim()) {
      setPublishMsg('请填写填空参考答案');
      return;
    }
    setPublishing(true);
    try {
      await api('/api/v1/questions', { method: 'POST', body: JSON.stringify(body) });
      setTitle('');
      setStem('');
      setBlankKey('');
      setClosesAtLocal('');
      setPublishMsg('已发布');
      setBoardKey((n) => n + 1);
      onSetupChanged?.();
    } catch (e) {
      setPublishMsg(e instanceof Error ? e.message : '发布失败');
    } finally {
      setPublishing(false);
    }
  }

  async function drawStudent() {
    if (!classId) return;
    try {
      const r = await api<{ student: RosterStudent; poolSize: number }>('/api/v1/session/random-call', {
        method: 'POST',
        body: JSON.stringify({ classId, preferOnline: true }),
      });
      setPicked(r.student);
      setAwardMsg(`随机点名（池 ${r.poolSize}，优先在线）· ${r.student.displayName}`);
      setAwardReason('随机点名');
    } catch {
      if (students.length === 0) {
        setAwardMsg('名单为空，无法抽答');
        setPicked(null);
        return;
      }
      const row = students[Math.floor(Math.random() * students.length)]!;
      setPicked(row);
      setAwardMsg(`抽到：${row.displayName}`);
    }
  }

  async function resetSession() {
    if (!classId) return;
    if (!window.confirm('本场重置：收卷全部进行中题目并关闭抢答。确定？')) return;
    try {
      const r = await api<{ closedQuestions: number }>('/api/v1/session/reset', {
        method: 'POST',
        body: JSON.stringify({ classId }),
      });
      setBoardKey((k) => k + 1);
      setSessionMsg(`已收卷 ${r.closedQuestions} 题`);
    } catch (e) {
      setSessionMsg(e instanceof Error ? e.message : '重置失败');
    }
  }

  async function openBuzz() {
    if (!classId) return;
    try {
      const r = await api<{ id: string; reason: string; status: string }>('/api/v1/session/buzz/open', {
        method: 'POST',
        body: JSON.stringify({ classId, reason: '抢答' }),
      });
      setBuzzRound(r);
      setBuzzHits([]);
      setSessionMsg('抢答已开启，学生端可点「抢答」');
    } catch (e) {
      setSessionMsg(e instanceof Error ? e.message : '开启抢答失败');
    }
  }

  async function refreshBuzz() {
    if (!classId) return;
    const r = await api<{
      round: { id: string; reason: string; status: string } | null;
      hits: Array<{ studentId: string; displayName: string; studentNo: string | null; hitAt: string }>;
    }>(`/api/v1/session/buzz/current?classId=${encodeURIComponent(classId)}`);
    setBuzzRound(r.round);
    setBuzzHits(r.hits ?? []);
  }

  useEffect(() => {
    function applyOcrDraft() {
      try {
        const raw = sessionStorage.getItem(OCR_DRAFT_KEY);
        if (!raw?.trim()) return;
        const text = raw.trim();
        const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (lines[0]) setTitle((t) => t || lines[0]!.slice(0, 80));
        setStem((s) => s || text.slice(0, 2000));
        setPublishMsg('已从 OCR 草稿填入快发题（可改后发布）');
        sessionStorage.removeItem(OCR_DRAFT_KEY);
      } catch {
        /* ignore */
      }
    }
    applyOcrDraft();
    function onStorage(e: StorageEvent) {
      if (e.key === OCR_DRAFT_KEY) applyOcrDraft();
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    buzzWsRef.current?.close();
    buzzWsRef.current = null;
    setBuzzLive(false);
    if (!classId) return;
    void refreshBuzz().catch(() => undefined);
    const token = getToken();
    if (!token) return;
    const base = API_BASE.replace(/^http/, 'ws');
    const ws = new WebSocket(
      `${base}/api/v1/session/buzz/ws?classId=${encodeURIComponent(classId)}&token=${encodeURIComponent(token)}`,
    );
    buzzWsRef.current = ws;
    ws.onopen = () => setBuzzLive(true);
    ws.onclose = () => setBuzzLive(false);
    ws.onerror = () => setBuzzLive(false);
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(String(ev.data)) as {
          round?: { id: string; reason: string; status: string } | null;
          hits?: Array<{ studentId: string; displayName: string; studentNo: string | null; hitAt: string }>;
        };
        if ('round' in data) setBuzzRound(data.round ?? null);
        if (Array.isArray(data.hits)) setBuzzHits(data.hits);
      } catch {
        /* ignore */
      }
    };
    return () => {
      ws.close();
      buzzWsRef.current = null;
    };
  }, [classId]);

  async function awardBuzzWinner() {
    if (!buzzRound?.id) return;
    try {
      await api('/api/v1/session/buzz/award-winner', {
        method: 'POST',
        body: JSON.stringify({ roundId: buzzRound.id, points: awardPts }),
      });
      setSessionMsg(`已给抢答第一名 +${awardPts}`);
      await refreshBuzz();
    } catch (e) {
      setSessionMsg(e instanceof Error ? e.message : '加分失败');
    }
  }

  async function awardPicked() {
    if (!picked || !classId) return;
    try {
      await api('/api/v1/points/manual', {
        method: 'POST',
        body: JSON.stringify({
          classId,
          studentId: picked.id,
          points: awardPts,
          reasonSummary: awardReason.trim() || '课堂抽答',
        }),
      });
      setAwardMsg(`已给 ${picked.displayName} +${awardPts}（${awardReason.trim() || '课堂抽答'}）`);
    } catch (e) {
      setAwardMsg(e instanceof Error ? e.message : '加分失败');
    }
  }

  async function decideRequest(id: string, action: 'confirm' | 'reject') {
    try {
      await api(`/api/v1/point-requests/${id}/${action}`, { method: 'POST', body: '{}' });
      const r = await api<{ items: Array<Record<string, unknown>> }>(
        `/api/v1/point-requests/pending?classId=${encodeURIComponent(classId)}`,
      );
      setRequests(r.items);
      setRequestErr('');
    } catch (e) {
      setRequestErr(e instanceof Error ? e.message : '处理加分请求失败');
    }
  }

  return (
    <div className="session-home">
      <div className="session-toolbar">
        <button type="button" onClick={onEnterProjection} disabled={!classId}>
          投影全屏
        </button>
        <button type="button" className="secondary" disabled={!classId} onClick={() => void resetSession()}>
          本场重置
        </button>
        <button type="button" className="secondary" disabled={!classId} onClick={() => void openBuzz()}>
          开启抢答
        </button>
        <button type="button" className="secondary" disabled={!classId} onClick={() => void refreshBuzz()}>
          刷新抢答{buzzLive ? ' · 实时' : ''}
        </button>
        <p className="hint help-bubble">
          投影：<kbd>Esc</kbd> 退出，<kbd>F</kbd> 全屏，<kbd>H</kbd> 高对比。详见{' '}
          <code>docs/TEACHER_PROJECTION.md</code>。
        </p>
        {onGoPrep ? (
          <button type="button" className="secondary" onClick={onGoPrep}>
            去备课
          </button>
        ) : null}
        {onGoAssign ? (
          <button type="button" className="secondary" onClick={onGoAssign}>
            去指派
          </button>
        ) : null}
      </div>
      {sessionMsg ? <p className="hint">{sessionMsg}</p> : null}
      {buzzRound ? (
        <section>
          <h2>抢答器 · {buzzRound.status === 'open' ? '进行中' : '已结束'}</h2>
          <p className="hint">
            理由：{buzzRound.reason}
            {buzzLive ? ' · WebSocket 实时榜' : ' · 连接中断时可点刷新'}
          </p>
          <ol>
            {buzzHits.map((h, i) => (
              <li key={h.studentId}>
                #{i + 1} {h.displayName}
                {h.studentNo ? ` · ${h.studentNo}` : ''}
              </li>
            ))}
          </ol>
          <button type="button" disabled={!buzzHits.length} onClick={() => void awardBuzzWinner()}>
            给第一名加分（{awardPts}）
          </button>
        </section>
      ) : null}
      <section>
        <h2>分组竞赛积分（本页记分）</h2>
        <div className="row">
          <button type="button" className="chip" onClick={() => setGroupA((n) => n + 1)}>
            A 组 +1（{groupA}）
          </button>
          <button type="button" className="chip" onClick={() => setGroupB((n) => n + 1)}>
            B 组 +1（{groupB}）
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setGroupA(0);
              setGroupB(0);
            }}
          >
            清零
          </button>
        </div>
      </section>

      <section id="session-quick-publish">
        <h2>快速发题</h2>
        <div className="row">
          <button type="button" className={kind === 'bool' ? 'chip active-chip' : 'chip'} onClick={() => applyTemplate('bool')}>
            判断题模板
          </button>
          <button type="button" className={kind === 'blank' ? 'chip active-chip' : 'chip'} onClick={() => applyTemplate('blank')}>
            填空题模板
          </button>
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="题目标题（必填）" />
        <textarea value={stem} onChange={(e) => setStem(e.target.value)} placeholder="题干（必填）" />
        {kind === 'blank' ? (
          <input value={blankKey} onChange={(e) => setBlankKey(e.target.value)} placeholder="参考答案（必填）" />
        ) : (
          <>
            <p className="hint">判断题选项固定为「正确 / 错误」</p>
            <div className="row" role="radiogroup" aria-label="正确答案">
              <span>正确答案：</span>
              <label className="choice">
                <input
                  type="radio"
                  name="session-bool-correct"
                  checked={boolCorrect === 'A'}
                  onChange={() => setBoolCorrect('A')}
                />
                正确
              </label>
              <label className="choice">
                <input
                  type="radio"
                  name="session-bool-correct"
                  checked={boolCorrect === 'B'}
                  onChange={() => setBoolCorrect('B')}
                />
                错误
              </label>
            </div>
          </>
        )}
        <label>
          截止时间（可选，到点自动收卷）
          <input type="datetime-local" value={closesAtLocal} onChange={(e) => setClosesAtLocal(e.target.value)} />
        </label>
        <button type="button" disabled={!classId || publishing} onClick={() => void publish()}>
          发布题目
        </button>
        {publishMsg ? <p className={/失败|无效|请/.test(publishMsg) ? 'error' : 'hint'}>{publishMsg}</p> : null}
      </section>

      <section>
        <h2>抽答加分</h2>
        <p className="hint">本班 {students.length} 人</p>
        <div className="row">
          <button type="button" disabled={!classId} onClick={() => void drawStudent()}>
            随机点名
          </button>
          <input
            type="number"
            min={1}
            value={awardPts}
            onChange={(e) => setAwardPts(Number(e.target.value) || 1)}
            style={{ width: 72 }}
          />
          <input value={awardReason} onChange={(e) => setAwardReason(e.target.value)} placeholder="理由" />
          <button type="button" disabled={!picked} onClick={() => void awardPicked()}>
            给抽中的人加分
          </button>
        </div>
        <div className="chip-row">
          {POINT_REASON_CHIPS.map((c) => (
            <button key={c} type="button" className="chip" onClick={() => setAwardReason(c)}>
              {c}
            </button>
          ))}
        </div>
        {picked ? (
          <p className="projection-name">
            {picked.displayName}
            {picked.studentNo ? ` · ${picked.studentNo}` : ''}
          </p>
        ) : null}
        {awardMsg ? <p className="hint">{awardMsg}</p> : null}
      </section>

      <section>
        <h2>待审加分</h2>
        <p className="hint">约每 5 秒刷新。通过后写入积分。</p>
        {requestErr ? <p className="error">{requestErr}</p> : null}
        {requests.length === 0 ? <p className="hint">暂无待审请求</p> : null}
        {requests.map((item) => (
          <div key={String(item.id)} className="row request-row">
            <span>
              {String(item.studentName)} · {String(item.reason || '（无理由）')} · {String(item.points)} 分
            </span>
            <button type="button" onClick={() => void decideRequest(String(item.id), 'confirm')}>
              通过
            </button>
            <button type="button" className="secondary" onClick={() => void decideRequest(String(item.id), 'reject')}>
              拒绝
            </button>
          </div>
        ))}
      </section>

      <div className="session-live">
        <LiveBoard key={boardKey} classId={classId} />
      </div>
    </div>
  );
}

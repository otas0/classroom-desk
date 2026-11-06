import { useEffect, useState } from 'react';
import { API_BASE, api, getToken } from './api';
import { hardReloadTeacherNav } from './navStorage';
import {
  IMPORT_ERROR_ZH,
  POINT_REASON_CHIPS,
  monthString,
  shiftMonth,
  type ClassItem,
} from './types';

export function RosterPanel({
  classId,
  classes,
  onClasses,
}: {
  classId: string;
  classes: ClassItem[];
  onClasses: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [csv, setCsv] = useState('');
  const [students, setStudents] = useState<Array<Record<string, unknown>>>([]);
  const [importResult, setImportResult] = useState('');
  const [search, setSearch] = useState('');
  const [replaceRoster, setReplaceRoster] = useState(false);
  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentNo, setNewStudentNo] = useState('');
  const [picked, setPicked] = useState<Record<string, unknown> | null>(null);
  const [awardPts, setAwardPts] = useState(1);
  const [awardReason, setAwardReason] = useState('表扬');
  const [awardMsg, setAwardMsg] = useState('');

  async function loadStudents() {
    if (!classId) return;
    const r = await api<{ items: Array<Record<string, unknown>> }>(`/api/v1/classes/${classId}/students`);
    setStudents(r.items);
  }

  async function addOneStudent() {
    const displayName = newStudentName.trim();
    if (!displayName) {
      setImportResult('请填写姓名');
      return;
    }
    try {
      await api(`/api/v1/classes/${classId}/students`, {
        method: 'POST',
        body: JSON.stringify({
          displayName,
          studentNo: newStudentNo.trim() || null,
        }),
      });
      setNewStudentName('');
      setNewStudentNo('');
      setImportResult(`已添加 ${displayName}`);
      await loadStudents();
    } catch (e) {
      setImportResult(e instanceof Error ? e.message : '添加失败');
    }
  }

  function drawStudent() {
    const pool = filteredStudents;
    if (pool.length === 0) {
      setAwardMsg('名单为空，无法抽答');
      return;
    }
    const row = pool[Math.floor(Math.random() * pool.length)]!;
    setPicked(row);
    setAwardMsg(`抽到：${String(row.displayName)}`);
  }

  async function awardPicked() {
    if (!picked) return;
    try {
      await api('/api/v1/points/manual', {
        method: 'POST',
        body: JSON.stringify({
          classId,
          studentId: String(picked.id),
          points: awardPts,
          reasonSummary: awardReason.trim() || '课堂抽答',
        }),
      });
      setAwardMsg(`已给 ${String(picked.displayName)} +${awardPts}（${awardReason}）`);
      await loadStudents();
    } catch (e) {
      setAwardMsg(e instanceof Error ? e.message : '加分失败');
    }
  }

  const filteredStudents = [...students]
    .sort((a, b) => String(a.studentNo ?? '').localeCompare(String(b.studentNo ?? ''), 'zh'))
    .filter((s) => {
      const key = search.trim().toLowerCase();
      if (!key) return true;
      return (
        String(s.displayName).toLowerCase().includes(key) ||
        String(s.studentNo ?? '')
          .toLowerCase()
          .includes(key)
      );
    });

  useEffect(() => {
    void loadStudents().catch(() => setStudents([]));
  }, [classId]);

  async function confirmBeforeImport(): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/health`, { cache: 'no-store' });
      const body = (await res.json()) as {
        backup?: { latestAt?: string | null; ageHours?: number | null; lastError?: unknown };
      };
      const age = body.backup?.ageHours;
      const stale = body.backup?.latestAt == null || (typeof age === 'number' && age > 24);
      const err = body.backup?.lastError;
      if (err || stale) {
        const ok = window.confirm(
          `${err ? '检测到备份异常。' : '近 24 小时内未见备份。'}导入前建议在教师机执行 npm run backup:db。\n仍要继续导入吗？`,
        );
        if (!ok) return false;
      }
    } catch {
      const ok = window.confirm('无法确认备份状态。仍要继续导入吗？');
      if (!ok) return false;
    }
    if (replaceRoster) {
      const n = students.length;
      return window.confirm(
        n > 0
          ? `覆盖导入将清空本班现有 ${n} 名学生，再写入表格。此操作不可撤销，确定继续？`
          : '将按覆盖模式导入（当前班暂无学生）。确定继续？',
      );
    }
    return true;
  }

  async function importFile(file: File) {
    if (!(await confirmBeforeImport())) return;
    const fd = new FormData();
    fd.append('file', file);
    if (replaceRoster) fd.append('replace', '1');
    const token = getToken();
    const q = replaceRoster ? '?replace=1' : '';
    const res = await fetch(`${API_BASE}/api/v1/classes/${classId}/students/import-file${q}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: fd,
    });
    const data = (await res.json()) as {
      created?: number;
      skipped?: number;
      replaced?: number;
      failures?: Array<{ line: number; name: string; reasonText?: string; reason: string }>;
      error?: string;
      message?: string;
    };
    if (!res.ok) {
      throw new Error(data.message ?? IMPORT_ERROR_ZH[data.error ?? ''] ?? data.error ?? '导入失败');
    }
    const fail = (data.failures ?? [])
      .map((f) => `第${f.line}行 ${f.name} → ${f.reasonText ?? f.reason}`)
      .join('；');
    setImportResult(
      `${replaceRoster ? `覆盖清除 ${data.replaced ?? 0} 人后，` : ''}新建 ${data.created}，跳过 ${data.skipped}${
        fail ? `。失败行：${fail}` : ''
      }`,
    );
    await loadStudents();
  }

  return (
    <section>
      <h2>班级与名单</h2>
      <div className="row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="新班级名称" />
        <button
          type="button"
          onClick={() =>
            void api('/api/v1/classes', { method: 'POST', body: JSON.stringify({ name }) }).then(() => {
              setName('');
              return onClasses();
            })
          }
        >
          创建班级
        </button>
      </div>

      <h3>单个新增</h3>
      <div className="row">
        <input
          value={newStudentName}
          onChange={(e) => setNewStudentName(e.target.value)}
          placeholder="姓名"
        />
        <input
          value={newStudentNo}
          onChange={(e) => setNewStudentNo(e.target.value)}
          placeholder="学号（可选）"
        />
        <button type="button" disabled={!classId} onClick={() => void addOneStudent()}>
          添加学生
        </button>
      </div>

      <h3>随机抽答 / 加分</h3>
      <div className="row">
        <button type="button" disabled={!classId} onClick={drawStudent}>
          抽一人
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
          {String(picked.displayName)}
          {picked.studentNo ? ` · ${String(picked.studentNo)}` : ''}
        </p>
      ) : null}
      {awardMsg ? <p className="hint">{awardMsg}</p> : null}

      <h3>批量导入（Excel / CSV）</h3>
      <p className="hint">
        支持 .xlsx / .xls / .csv。不必是「姓名,学号」逗号格式：自动识别「姓名/学号」表头、制表符、中文逗号、空格分隔，以及「学号在前/姓名在前」、Excel
        数字学号。无表头也会尝试拆分。
      </p>
      <label className="row">
        <input type="checkbox" checked={replaceRoster} onChange={(e) => setReplaceRoster(e.target.checked)} />
        覆盖导入（先清空本班现有学生，再写入表格；请先 backup:db）
      </label>
      <label className="dropzone dropzone-wrap">
        <strong>点击选择文件</strong>
        <p className="hint">或拖入 Excel / CSV（真实上传到本班名单）</p>
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importFile(file).catch((err) => setImportResult(String(err.message ?? err)));
            e.target.value = '';
          }}
        />
      </label>
      <textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        rows={5}
        placeholder={'可粘贴：姓名 学号 / 学号\t姓名 / 姓名，学号\n（任意常见分隔均可）'}
      />
      <button
        type="button"
        onClick={() => {
          if (!csv.trim()) {
            setImportResult('请粘贴真实名单，或使用上方文件上传');
            return;
          }
          void (async () => {
            if (!(await confirmBeforeImport())) return;
            try {
              const r = await api<{
                created: number;
                skipped: number;
                replaced?: number;
                failures?: Array<{ line: number; name: string; reasonText?: string; reason: string }>;
              }>(`/api/v1/classes/${classId}/students/import`, {
                method: 'POST',
                body: JSON.stringify({ csv, replace: replaceRoster }),
              });
              const fail = (r.failures ?? [])
                .map((f) => `第${f.line}行 ${f.name} → ${f.reasonText ?? f.reason}`)
                .join('；');
              setImportResult(
                `${replaceRoster ? `覆盖清除 ${r.replaced ?? 0} 人后，` : ''}新建 ${r.created}，跳过 ${r.skipped}${
                  fail ? `。${fail}` : ''
                }`,
              );
              await loadStudents();
            } catch (err) {
              setImportResult(String(err instanceof Error ? err.message : err));
            }
          })();
        }}
      >
        从文本导入 CSV
      </button>
      {importResult ? <p className={/失败|错误|无效|损坏/.test(importResult) ? 'error' : 'hint'}>{importResult}</p> : null}

      <h3>当前班名单（{classes.find((c) => c.id === classId)?.name ?? ''}）· 按学号排序</h3>
      <p className="hint">可直接改姓名/学号并保存，或删除学生（相关签到/加分记录一并清除）。</p>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索姓名/学号" />
      <table className="data-table">
        <thead>
          <tr>
            <th>学号</th>
            <th>姓名</th>
            <th>积分</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {filteredStudents.map((s) => (
            <StudentRow
              key={String(s.id)}
              classId={classId}
              student={s}
              onChanged={() => void loadStudents()}
              onError={(msg) => setImportResult(msg)}
            />
          ))}
        </tbody>
      </table>
      {filteredStudents.length === 0 ? <p className="hint">暂无学生</p> : null}
    </section>
  );
}

export function StudentRow({
  classId,
  student,
  onChanged,
  onError,
}: {
  classId: string;
  student: Record<string, unknown>;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const id = String(student.id);
  const [name, setName] = useState(String(student.displayName ?? ''));
  const [studentNo, setStudentNo] = useState(String(student.studentNo ?? ''));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(String(student.displayName ?? ''));
    setStudentNo(String(student.studentNo ?? ''));
  }, [student.displayName, student.studentNo, student.id]);

  async function save() {
    setBusy(true);
    try {
      await api(`/api/v1/classes/${classId}/students/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ displayName: name.trim(), studentNo: studentNo.trim() }),
      });
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      let impactText = '相关签到与加分记录也会清除';
      try {
        const impact = await api<{
          attendanceRecords: number;
          pointsLog: number;
          answers: number;
          messages: number;
          pointRequests: number;
          total: number;
        }>(`/api/v1/classes/${classId}/students/${id}/impact`);
        impactText = `将清除：签到 ${impact.attendanceRecords} · 积分流水 ${impact.pointsLog} · 作答 ${impact.answers} · 留言 ${impact.messages} · 加分请求 ${impact.pointRequests}（共 ${impact.total} 条）`;
      } catch {
        /* keep default */
      }
      if (!window.confirm(`确定删除「${name || id}」？\n${impactText}`)) return;
      await api(`/api/v1/classes/${classId}/students/${id}`, { method: 'DELETE' });
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td>
        <input
          value={studentNo}
          disabled={busy}
          onChange={(e) => setStudentNo(e.target.value)}
          placeholder="学号"
          aria-label="学号"
        />
      </td>
      <td>
        <input
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          placeholder="姓名"
          aria-label="姓名"
        />
      </td>
      <td>{String(student.totalPoints)}</td>
      <td>
        <button type="button" className="secondary" disabled={busy} onClick={() => void save()}>
          保存
        </button>{' '}
        <button type="button" disabled={busy} onClick={() => void remove()}>
          删除
        </button>
      </td>
    </tr>
  );
}

type QAttachment = { url: string; originalName: string; size?: number; mime?: string };

const QUESTION_FILE_ACCEPT =
  '.pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.mp3,.m4a,.wav,.mp4,.webm';

export function QuestionsPanel({ classId }: { classId: string }) {
  const [title, setTitle] = useState('');
  const [stem, setStem] = useState('');
  const [type, setType] = useState<'single' | 'multi' | 'bool' | 'blank'>('single');
  const [optA, setOptA] = useState('');
  const [optB, setOptB] = useState('');
  const [optC, setOptC] = useState('');
  const [blankKey, setBlankKey] = useState('');
  const [closesAtLocal, setClosesAtLocal] = useState('');
  const [attachments, setAttachments] = useState<QAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [createMsg, setCreateMsg] = useState('');
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [chart, setChart] = useState<{
    title: string;
    answered: number;
    wrong: number;
    pending: number;
    rosterTotal: number;
    correctRate: number;
    rate: number;
    options: Array<{ label: string; content: string; chosenCount: number }>;
  } | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<Record<string, unknown> | null>(null);

  async function load() {
    const q = showArchived ? '&includeArchived=1' : '';
    const r = await api<{ items: Array<Record<string, unknown>> }>(
      `/api/v1/questions?classId=${classId}${q}`,
    );
    setItems(r.items);
  }

  useEffect(() => {
    void load().catch(() => setItems([]));
  }, [classId, showArchived]);

  function applyTemplate(kind: 'bool' | 'blank') {
    setType(kind);
    if (kind === 'bool') {
      setTitle((t) => t || '判断题');
      setStem((s) => s || '（请改成真实题干）下列说法正确吗？');
      setBlankKey('');
    } else {
      setTitle((t) => t || '填空题');
      setStem((s) => s || '（请改成真实题干）请填写答案：____');
      setBlankKey((k) => k || '');
    }
  }

  async function uploadFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    setUploading(true);
    setCreateMsg('');
    try {
      const fd = new FormData();
      Array.from(fileList).forEach((f) => fd.append('files', f));
      const res = await api<{ items: QAttachment[] }>('/api/v1/uploads/batch', {
        method: 'POST',
        body: fd,
      });
      setAttachments((prev) => [...prev, ...res.items]);
      setCreateMsg(`已上传 ${res.items.length} 个附件`);
    } catch (e) {
      setCreateMsg(e instanceof Error ? e.message : '上传失败');
    } finally {
      setUploading(false);
    }
  }

  async function create() {
    setCreateMsg('');
    if (!title.trim() || !stem.trim()) {
      setCreateMsg('请填写真实题目标题与题干');
      return;
    }
    const closesAt = closesAtLocal
      ? new Date(closesAtLocal).toISOString()
      : undefined;
    let body: Record<string, unknown>;
    if (type === 'blank') {
      if (!blankKey.trim()) {
        setCreateMsg('请填写填空参考答案');
        return;
      }
      body = {
        classId,
        title: title.trim(),
        stem: stem.trim(),
        type,
        answerKey: blankKey.trim(),
        options: [],
        attachments,
        closesAt,
      };
    } else if (type === 'bool') {
      body = {
        classId,
        title: title.trim(),
        stem: stem.trim(),
        type,
        attachments,
        closesAt,
        options: [
          { label: 'A', content: '正确', isCorrect: true },
          { label: 'B', content: '错误', isCorrect: false },
        ],
      };
    } else if (type === 'multi') {
      if (!optA.trim() || !optB.trim() || !optC.trim()) {
        setCreateMsg('多选题请填写选项 A/B/C 真实内容（默认 A、B 为正确）');
        return;
      }
      body = {
        classId,
        title: title.trim(),
        stem: stem.trim(),
        type,
        attachments,
        closesAt,
        options: [
          { label: 'A', content: optA.trim(), isCorrect: true },
          { label: 'B', content: optB.trim(), isCorrect: true },
          { label: 'C', content: optC.trim(), isCorrect: false },
        ],
      };
    } else {
      if (!optA.trim() || !optB.trim()) {
        setCreateMsg('单选题请填写选项 A/B 真实内容（默认 A 为正确）');
        return;
      }
      body = {
        classId,
        title: title.trim(),
        stem: stem.trim(),
        type,
        attachments,
        closesAt,
        options: [
          { label: 'A', content: optA.trim(), isCorrect: true },
          { label: 'B', content: optB.trim(), isCorrect: false },
        ],
      };
    }
    await api('/api/v1/questions', { method: 'POST', body: JSON.stringify(body) });
    setTitle('');
    setStem('');
    setOptA('');
    setOptB('');
    setOptC('');
    setBlankKey('');
    setClosesAtLocal('');
    setAttachments([]);
    setCreateMsg('已发布');
    await load();
  }

  async function showStats(id: string, qTitle: string) {
    const stats = await api<{
      answeredCount: number;
      wrongCount: number;
      pendingCount: number;
      rosterTotal: number;
      correctRate: number;
      errorRate: number;
      optionDistribution: Array<{ label: string; content: string; chosenCount: number }>;
    }>(`/api/v1/questions/${id}/stats`);
    setChart({
      title: qTitle,
      answered: Number(stats.answeredCount),
      wrong: Number(stats.wrongCount),
      pending: Number(stats.pendingCount),
      rosterTotal: Number(stats.rosterTotal),
      correctRate: Number(stats.correctRate),
      rate: Number(stats.errorRate),
      options: (stats.optionDistribution ?? []).map((o) => ({
        label: String(o.label),
        content: String(o.content),
        chosenCount: Number(o.chosenCount ?? 0),
      })),
    });
  }

  const correct = chart ? Math.max(0, chart.answered - chart.wrong) : 0;
  const wrongPct = chart && chart.answered > 0 ? (chart.wrong / chart.answered) * 100 : 0;
  const correctPct = chart && chart.answered > 0 ? (correct / chart.answered) * 100 : 0;

  return (
    <section>
      <h2>发题 / 正确率 · 错误率</h2>
      <div className="row">
        <button type="button" className="chip" onClick={() => applyTemplate('bool')}>
          判断题模板
        </button>
        <button type="button" className="chip" onClick={() => applyTemplate('blank')}>
          填空题模板
        </button>
        <label className="row">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          显示已下线
        </label>
      </div>
      <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
        <option value="single">单选</option>
        <option value="multi">多选</option>
        <option value="bool">判断</option>
        <option value="blank">填空</option>
      </select>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="题目标题（必填）" />
      <textarea value={stem} onChange={(e) => setStem(e.target.value)} placeholder="题干（必填）" />
      {type === 'blank' ? (
        <input value={blankKey} onChange={(e) => setBlankKey(e.target.value)} placeholder="参考答案（必填）" />
      ) : type === 'bool' ? (
        <p className="hint">判断题选项固定为「正确 / 错误」</p>
      ) : (
        <>
          <input value={optA} onChange={(e) => setOptA(e.target.value)} placeholder="选项 A（正确，必填）" />
          <input value={optB} onChange={(e) => setOptB(e.target.value)} placeholder="选项 B（必填）" />
          {type === 'multi' ? (
            <input value={optC} onChange={(e) => setOptC(e.target.value)} placeholder="选项 C（必填）" />
          ) : null}
        </>
      )}
      <label>
        截止时间（可选，到点自动收卷）
        <input
          type="datetime-local"
          value={closesAtLocal}
          onChange={(e) => setClosesAtLocal(e.target.value)}
        />
      </label>
      <label className="dropzone dropzone-wrap">
        <strong>{uploading ? '上传中…' : '题目附件（可多选）'}</strong>
        <p className="hint">pdf / 图片 / Word / Excel / PPT / 音视频 / zip / txt / md / csv，单文件 ≤10MB</p>
        <input
          type="file"
          multiple
          accept={QUESTION_FILE_ACCEPT}
          disabled={uploading}
          onChange={(e) => {
            void uploadFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </label>
      {attachments.length ? (
        <ul className="attach-list">
          {attachments.map((a) => (
            <li key={a.url}>
              <a href={`${API_BASE}${a.url}`} target="_blank" rel="noreferrer">
                {a.originalName}
              </a>{' '}
              <button type="button" className="secondary" onClick={() => setAttachments((prev) => prev.filter((x) => x.url !== a.url))}>
                移除
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <button type="button" onClick={() => void create()} disabled={uploading}>
        发布题目
      </button>
      {createMsg ? <p className="hint">{createMsg}</p> : null}
      <ul className="question-list">
        {items.map((q) => {
          const active = editingQuestion && String(editingQuestion.id) === String(q.id);
          const closed = Boolean(q.closed);
          const archived = Boolean(q.archived);
          return (
            <li
              key={String(q.id)}
              className={`question-item${active ? ' active' : ''}`}
              tabIndex={0}
              role="button"
              onClick={() => {
                setEditingQuestion(q);
                void showStats(String(q.id), String(q.title));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setEditingQuestion(q);
                  void showStats(String(q.id), String(q.title));
                }
              }}
            >
              <span className="title">
                [{String(q.type)}] {String(q.title)}
                {closed ? ' · 已收卷' : ''}
                {archived ? ' · 已下线' : ''}
                {Array.isArray(q.attachments) && (q.attachments as unknown[]).length
                  ? ` · 附件${(q.attachments as unknown[]).length}`
                  : ''}
              </span>
              <button
                type="button"
                className="secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  void showStats(String(q.id), String(q.title));
                }}
              >
                态势
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingQuestion(q);
                }}
              >
                编辑
              </button>
              <button
                type="button"
                className="secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  const path = closed
                    ? `/api/v1/questions/${String(q.id)}/reopen`
                    : `/api/v1/questions/${String(q.id)}/close`;
                  void api(path, { method: 'POST', body: '{}' })
                    .then(async () => {
                      setCreateMsg(closed ? '已重开' : '已收卷');
                      await load();
                      await showStats(String(q.id), String(q.title));
                    })
                    .catch((err) => setCreateMsg(err instanceof Error ? err.message : '操作失败'));
                }}
              >
                {closed ? '重开' : '收卷'}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  void api(`/api/v1/questions/${String(q.id)}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ archived: !archived }),
                  })
                    .then(async () => {
                      setCreateMsg(archived ? '已恢复上线' : '已软下线（保留正确率）');
                      await load();
                    })
                    .catch((err) => setCreateMsg(err instanceof Error ? err.message : '操作失败'));
                }}
              >
                {archived ? '恢复' : '下线'}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!window.confirm(`确定删除题目「${String(q.title)}」？作答记录也会清除。`)) return;
                  void api(`/api/v1/questions/${String(q.id)}`, { method: 'DELETE' })
                    .then(async () => {
                      if (String(editingQuestion?.id) === String(q.id)) setEditingQuestion(null);
                      await load();
                    })
                    .catch((err) => setCreateMsg(err instanceof Error ? err.message : '删除失败'));
                }}
              >
                删除
              </button>
            </li>
          );
        })}
      </ul>
      <h3>编辑题目（加载原选项）</h3>
      <QuestionEditForm
        classId={classId}
        seed={editingQuestion}
        onSaved={async () => {
          setEditingQuestion(null);
          await load();
        }}
        onDeleted={async () => {
          setEditingQuestion(null);
          await load();
        }}
      />
      {chart ? (
        <div className="chart">
          <h3>{chart.title}</h3>
          <p className="projection-stats">
            已交 {chart.answered} · 未交 {chart.pending} · 全班 {chart.rosterTotal} · 正确{' '}
            {correct} · 正确率 {(chart.correctRate * 100).toFixed(0)}%
          </p>
          <div className="bar-track tall">
            <div className="bar correct" style={{ width: `${correctPct}%` }} />
            <div className="bar wrong" style={{ width: `${wrongPct}%` }} />
          </div>
          <h4>选项分布</h4>
          {chart.options.map((opt) => {
            const max = Math.max(1, ...chart.options.map((o) => o.chosenCount));
            const pct = (opt.chosenCount / max) * 100;
            return (
              <div key={opt.label} className="option-row">
                <span>
                  {opt.label}. {opt.content}（{opt.chosenCount}）
                </span>
                <div className="bar-track thin">
                  <div className="bar option" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

export function QuestionEditForm({
  classId,
  seed,
  onSaved,
  onDeleted,
}: {
  classId: string;
  seed: Record<string, unknown> | null;
  onSaved: () => Promise<void>;
  onDeleted?: () => Promise<void>;
}) {
  const [qid, setQid] = useState('');
  const [title, setTitle] = useState('');
  const [stem, setStem] = useState('');
  const [qType, setQType] = useState('single');
  const [options, setOptions] = useState<Array<{ label: string; content: string; isCorrect: boolean }>>([]);
  const [attachments, setAttachments] = useState<QAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!seed) return;
    setQid(String(seed.id ?? ''));
    setTitle(String(seed.title ?? ''));
    setStem(String(seed.stem ?? ''));
    setQType(String(seed.type ?? 'single'));
    const opts = (seed.options as Array<{ label: string; content: string; isCorrect?: number | boolean }>) ?? [];
    setOptions(
      opts.map((o) => ({
        label: String(o.label),
        content: String(o.content),
        isCorrect: Boolean(o.isCorrect),
      })),
    );
    setAttachments(
      ((seed.attachments as QAttachment[]) ?? []).map((a) => ({
        url: String(a.url),
        originalName: String(a.originalName ?? '附件'),
        size: a.size,
        mime: a.mime,
      })),
    );
    setMsg(`已加载原题 ${String(seed.id ?? '')}`);
  }, [seed]);

  async function uploadMore(fileList: FileList | null) {
    if (!fileList?.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      Array.from(fileList).forEach((f) => fd.append('files', f));
      const res = await api<{ items: QAttachment[] }>('/api/v1/uploads/batch', {
        method: 'POST',
        body: fd,
      });
      setAttachments((prev) => [...prev, ...res.items]);
      setMsg(`已追加 ${res.items.length} 个附件`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '上传失败');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="card">
      <p className="hint">点列表「编辑」加载选项；可改标题/题干/选项/附件后保存。班级 {classId}</p>
      <input value={qid} onChange={(e) => setQid(e.target.value)} placeholder="题目 ID" readOnly />
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题" />
      <textarea value={stem} onChange={(e) => setStem(e.target.value)} placeholder="题干" />
      <p className="hint">类型：{qType}</p>
      {options.map((opt, idx) => (
        <div key={idx} className="row">
          <span>{opt.label}</span>
          <input
            value={opt.content}
            onChange={(e) =>
              setOptions((prev) => prev.map((o, i) => (i === idx ? { ...o, content: e.target.value } : o)))
            }
          />
          <label>
            <input
              type="checkbox"
              checked={opt.isCorrect}
              onChange={(e) =>
                setOptions((prev) =>
                  prev.map((o, i) => (i === idx ? { ...o, isCorrect: e.target.checked } : o)),
                )
              }
            />
            正确
          </label>
        </div>
      ))}
      <label className="dropzone dropzone-wrap">
        <strong>{uploading ? '上传中…' : '更换/追加附件'}</strong>
        <input
          type="file"
          multiple
          accept={QUESTION_FILE_ACCEPT}
          disabled={uploading || !qid}
          onChange={(e) => {
            void uploadMore(e.target.files);
            e.target.value = '';
          }}
        />
      </label>
      {attachments.length ? (
        <ul className="attach-list">
          {attachments.map((a) => (
            <li key={a.url}>
              <a href={`${API_BASE}${a.url}`} target="_blank" rel="noreferrer">
                {a.originalName}
              </a>{' '}
              <button
                type="button"
                className="secondary"
                onClick={() => setAttachments((prev) => prev.filter((x) => x.url !== a.url))}
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">无附件</p>
      )}
      <button
        type="button"
        disabled={!qid || uploading}
        onClick={() =>
          void api(`/api/v1/questions/${qid}`, {
            method: 'PATCH',
            body: JSON.stringify({
              title,
              stem,
              type: qType,
              options,
              attachments,
            }),
          })
            .then(() => {
              setMsg('已保存原题修改');
              return onSaved();
            })
            .catch((e) => setMsg(e instanceof Error ? e.message : '失败'))
        }
      >
        保存编辑
      </button>{' '}
      <button
        type="button"
        className="secondary"
        disabled={!qid}
        onClick={() => {
          if (!window.confirm(`确定删除题目「${title || qid}」？`)) return;
          void api(`/api/v1/questions/${qid}`, { method: 'DELETE' })
            .then(() => {
              setMsg('已删除');
              return onDeleted?.() ?? onSaved();
            })
            .catch((e) => setMsg(e instanceof Error ? e.message : '删除失败'));
        }}
      >
        删除题目
      </button>
      {msg ? <p className="hint">{msg}</p> : null}
    </div>
  );
}
export function AttendancePanel({ classId }: { classId: string }) {
  const [month, setMonth] = useState(
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
  );
  const [stats, setStats] = useState<{
    sessionCount: number;
    classAttendanceRate: number;
    items: Array<{ displayName: string; studentNo: string | null; presentCount: number; attendanceRate: number }>;
  } | null>(null);

  async function load() {
    const r = await api<{
      sessionCount: number;
      classAttendanceRate: number;
      items: Array<{ displayName: string; studentNo: string | null; presentCount: number; attendanceRate: number }>;
    }>(`/api/v1/attendance/stats?classId=${classId}&month=${month}`);
    setStats(r);
  }

  useEffect(() => {
    void load().catch(() => setStats(null));
  }, [classId, month]);

  return (
    <section>
      <h2>签到统计（月）</h2>
      <p className="hint">
        按教师机本地时区自然月统计（非 UTC）。学生端点「签到」写入今日场次。
      </p>
      <input value={month} onChange={(e) => setMonth(e.target.value)} placeholder="YYYY-MM" />
      <button type="button" onClick={() => void load()}>
        刷新
      </button>
      {stats ? (
        <>
          <p>
            本月场次 {stats.sessionCount} · 班级出勤率 {(stats.classAttendanceRate * 100).toFixed(1)}%
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>学号</th>
                <th>姓名</th>
                <th>出勤次数</th>
                <th>出勤率</th>
              </tr>
            </thead>
            <tbody>
              {stats.items.map((s) => (
                <tr key={s.displayName + String(s.studentNo)}>
                  <td>{s.studentNo ?? '—'}</td>
                  <td>{s.displayName}</td>
                  <td>{s.presentCount}</td>
                  <td>{(s.attendanceRate * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  );
}

export function ExportsPanel({ classId }: { classId: string }) {
  const [month, setMonth] = useState(monthString());
  const [format, setFormat] = useState<'csv' | 'xlsx' | 'json' | 'tsv'>('csv');

  async function download(path: string, filename: string) {
    const token = getToken();
    const res = await fetch(`${API_BASE}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) throw new Error('export_failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const ext = format;
  const thisMonth = monthString();
  const lastMonth = shiftMonth(thisMonth, -1);
  return (
    <section>
      <h2>导出（多格式）</h2>
      <div className="row">
        <button type="button" className="secondary" onClick={() => setMonth(lastMonth)}>
          上月（{lastMonth}）
        </button>
        <button type="button" className="secondary" onClick={() => setMonth(thisMonth)}>
          本月（{thisMonth}）
        </button>
      </div>
      <label>
        月份
        <input value={month} onChange={(e) => setMonth(e.target.value)} />
      </label>
      <label>
        格式
        <select value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
          <option value="csv">CSV</option>
          <option value="xlsx">Excel (.xlsx)</option>
          <option value="json">JSON</option>
          <option value="tsv">TSV</option>
        </select>
      </label>
      <div className="row">
        <button
          type="button"
          onClick={() =>
            void download(
              `/api/v1/exports/attendance?month=${month}&classId=${classId}&format=${format}`,
              `attendance-${month}.${ext}`,
            )
          }
        >
          签到明细
        </button>
        <button
          type="button"
          onClick={() =>
            void download(
              `/api/v1/exports/attendance-summary?month=${month}&classId=${classId}&format=${format}`,
              `attendance-summary-${month}.${ext}`,
            )
          }
        >
          月出勤汇总
        </button>
        <button
          type="button"
          onClick={() =>
            void download(`/api/v1/exports/points?month=${month}&format=${format}`, `points-${month}.${ext}`)
          }
        >
          加分
        </button>
        <button
          type="button"
          onClick={() =>
            void download(
              `/api/v1/exports/questions?classId=${classId}&format=${format}`,
              `questions.${ext}`,
            )
          }
        >
          题目正确率
        </button>
      </div>
    </section>
  );
}

export function RequestsPanel({ classId }: { classId: string }) {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [board, setBoard] = useState<
    Array<{ rank: number; displayName: string; studentNo: string | null; monthPoints: number }>
  >([]);
  const [month, setMonth] = useState(monthString());
  const [period, setPeriod] = useState<'week' | 'month' | 'semester'>('month');
  const [boardLabel, setBoardLabel] = useState('');
  const [manualStudentId, setManualStudentId] = useState('');
  const [students, setStudents] = useState<Array<Record<string, unknown>>>([]);
  const [manualPts, setManualPts] = useState(1);
  const [manualReason, setManualReason] = useState('表扬');
  const [manualMsg, setManualMsg] = useState('');

  async function load() {
    const r = await api<{ items: Array<Record<string, unknown>> }>(
      `/api/v1/point-requests/pending?classId=${classId}`,
    );
    setItems(r.items);
  }

  async function loadBoard() {
    const q =
      period === 'month'
        ? `month=${encodeURIComponent(month)}`
        : `period=${period}`;
    const r = await api<{
      label?: string;
      month?: string;
      items: Array<{ rank: number; displayName: string; studentNo: string | null; monthPoints: number }>;
    }>(`/api/v1/points/leaderboard?classId=${classId}&${q}`);
    setBoard(r.items);
    setBoardLabel(r.label ?? r.month ?? period);
  }

  useEffect(() => {
    void load().catch(() => setItems([]));
    const t = window.setInterval(() => void load().catch(() => undefined), 5000);
    return () => window.clearInterval(t);
  }, [classId]);

  useEffect(() => {
    void loadBoard().catch(() => setBoard([]));
    void api<{ items: Array<Record<string, unknown>> }>(`/api/v1/classes/${classId}/students`)
      .then((r) => setStudents(r.items))
      .catch(() => setStudents([]));
  }, [classId, month, period]);

  return (
    <section>
      <h2>加分 · 排行榜</h2>
      <h3>快捷手动加分</h3>
      <div className="row">
        <select value={manualStudentId} onChange={(e) => setManualStudentId(e.target.value)}>
          <option value="">选择学生</option>
          {[...students]
            .sort((a, b) => String(a.studentNo ?? '').localeCompare(String(b.studentNo ?? ''), 'zh'))
            .map((s) => (
              <option key={String(s.id)} value={String(s.id)}>
                {String(s.studentNo ?? '—')} · {String(s.displayName)}
              </option>
            ))}
        </select>
        <input
          type="number"
          min={1}
          value={manualPts}
          onChange={(e) => setManualPts(Number(e.target.value) || 1)}
          style={{ width: 72 }}
        />
        <input value={manualReason} onChange={(e) => setManualReason(e.target.value)} placeholder="理由" />
        <button
          type="button"
          disabled={!manualStudentId}
          onClick={() =>
            void api('/api/v1/points/manual', {
              method: 'POST',
              body: JSON.stringify({
                classId,
                studentId: manualStudentId,
                points: manualPts,
                reasonSummary: manualReason.trim() || '教师手动加分',
              }),
            })
              .then(async () => {
                setManualMsg('已加分');
                await loadBoard();
              })
              .catch((e) => setManualMsg(e instanceof Error ? e.message : '失败'))
          }
        >
          加分
        </button>
      </div>
      <div className="chip-row">
        {POINT_REASON_CHIPS.map((c) => (
          <button key={c} type="button" className="chip" onClick={() => setManualReason(c)}>
            {c}
          </button>
        ))}
      </div>
      {manualMsg ? <p className="hint">{manualMsg}</p> : null}

      <h3>学生加分请求审核</h3>
      <p className="hint">学生在名单点选姓名后提交请求；通过后写入积分。</p>
      {items.length === 0 ? <p>暂无待审请求</p> : null}
      {items.map((item) => (
        <div key={String(item.id)} className="row request-row">
          <span>
            {String(item.studentName)} · {String(item.reason || '（无理由）')} · {String(item.points)} 分
          </span>
          <button
            type="button"
            onClick={() =>
              void api(`/api/v1/point-requests/${String(item.id)}/confirm`, {
                method: 'POST',
                body: '{}',
              }).then(load)
            }
          >
            通过
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              void api(`/api/v1/point-requests/${String(item.id)}/reject`, {
                method: 'POST',
                body: '{}',
              }).then(load)
            }
          >
            拒绝
          </button>
        </div>
      ))}

      <h3>积分排行（投影）</h3>
      <div className="chip-row">
        {(
          [
            ['week', '本周'],
            ['month', '本月'],
            ['semester', '本学期'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={period === id ? 'chip active-chip' : 'chip'}
            onClick={() => setPeriod(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="row">
        {period === 'month' ? (
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        ) : (
          <span className="hint">{boardLabel || period}</span>
        )}
        <button type="button" className="secondary" onClick={() => void loadBoard()}>
          刷新
        </button>
      </div>
      <ol className="leaderboard">
        {board.map((row) => (
          <li key={`${row.rank}-${row.displayName}`}>
            <strong>#{row.rank}</strong> {row.displayName}
            {row.studentNo ? `（${row.studentNo}）` : ''} · {row.monthPoints} 分
          </li>
        ))}
      </ol>
      {board.length === 0 ? <p className="hint">该时段暂无积分流水</p> : null}
    </section>
  );
}

export function MessagesPanel({
  classId,
  onEnabledChange,
}: {
  classId: string;
  onEnabledChange?: (enabled: boolean) => void;
}) {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState(true);
  const [err, setErr] = useState('');

  async function load() {
    setErr('');
    const [msgs, settings] = await Promise.all([
      api<{ items: Array<Record<string, unknown>> }>(`/api/v1/messages?classId=${classId}`),
      api<{ messagesEnabled: boolean }>('/api/v1/settings'),
    ]);
    setItems(msgs.items);
    const on = settings.messagesEnabled !== false;
    setEnabled(on);
    onEnabledChange?.(on);
  }

  useEffect(() => {
    void load().catch((e) => setErr(e instanceof Error ? e.message : '加载失败'));
  }, [classId]);

  return (
    <section>
      <h2>留言</h2>
      <p className="hint">含学生→老师、学生↔学生；可回复任意一条。</p>
      {err ? <p className="error">{err}</p> : null}
      <label className="row">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) =>
            void api('/api/v1/settings', {
              method: 'PATCH',
              body: JSON.stringify({ messagesEnabled: e.target.checked }),
            })
              .then(() => {
                setEnabled(e.target.checked);
                onEnabledChange?.(e.target.checked);
                const next = e.target.checked;
                hardReloadTeacherNav({
                  tab: 'prep',
                  prepTab: next ? 'messages' : 'roster',
                });
              })
              .catch((ex) => setErr(ex instanceof Error ? ex.message : '保存失败'))
          }
        />
        允许学生留言（关闭后学生端与本侧「留言」入口一并隐藏）
      </label>
      <button type="button" className="secondary" onClick={() => void load().catch((e) => setErr(String(e)))}>
        刷新
      </button>
      {items.length === 0 ? <p className="hint">暂无留言</p> : null}
      {items.map((msg) => {
        const peer = Boolean(msg.toStudentId);
        const heading = peer
          ? `${String(msg.studentName)} → ${String(msg.toStudentName ?? '同学')}`
          : `${String(msg.studentName)} → 老师`;
        return (
          <div key={String(msg.id)} className="card">
            <strong>{heading}</strong>
            <p>{String(msg.body)}</p>
            <p className="hint">{msg.createdAt ? new Date(String(msg.createdAt)).toLocaleString() : ''}</p>
            {((msg.replies as Array<{ id?: string; authorName?: string; body: string }>) ?? []).map((r, i) => (
              <p key={r.id ?? i} className="hint">
                {r.authorName ?? '回复'}：{r.body}
              </p>
            ))}
            <input
              value={reply[String(msg.id)] ?? ''}
              onChange={(e) => setReply((prev) => ({ ...prev, [String(msg.id)]: e.target.value }))}
              placeholder="回复内容"
            />
            <button
              type="button"
              onClick={() => {
                const text = (reply[String(msg.id)] ?? '').trim();
                if (!text) {
                  setErr('回复不能为空');
                  return;
                }
                void api(`/api/v1/messages/${String(msg.id)}/replies`, {
                  method: 'POST',
                  body: JSON.stringify({ body: text }),
                })
                  .then(() => {
                    setReply((prev) => ({ ...prev, [String(msg.id)]: '' }));
                    return load();
                  })
                  .catch((ex) => setErr(ex instanceof Error ? ex.message : '回复失败'));
              }}
            >
              回复
            </button>
          </div>
        );
      })}
    </section>
  );
}

export function SettingsPanel({
  forcePasswordOnly = false,
  onPasswordChanged,
  onMessagesChange,
}: {
  forcePasswordOnly?: boolean;
  onPasswordChanged?: () => void;
  onMessagesChange?: (enabled: boolean) => void;
} = {}) {
  const [diag, setDiag] = useState('');
  const [ttl, setTtl] = useState(60);
  const [saveMsg, setSaveMsg] = useState('');
  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [pwdMsg, setPwdMsg] = useState('');
  const [messagesOn, setMessagesOn] = useState(true);
  const [exitAllowed, setExitAllowed] = useState(false);
  const [exitUnlockUntil, setExitUnlockUntil] = useState<string | null>(null);
  const [hasExitCode, setHasExitCode] = useState(false);
  const [exitMinutes, setExitMinutes] = useState(15);
  const [exitCodeDraft, setExitCodeDraft] = useState('');
  const [exitMsg, setExitMsg] = useState('');
  const [exitEvents, setExitEvents] = useState<
    Array<{ id: string; kind: string; detail: string; createdAt: string; actorRole?: string | null }>
  >([]);
  const [nowTick, setNowTick] = useState(() => Date.now());

  async function refreshExitLock() {
    const s = await api<{
      pointRequestTtlMinutes: number;
      messagesEnabled?: boolean;
      clientExitAllowed?: boolean;
      clientExitUnlockUntil?: string | null;
      hasExitUnlockCode?: boolean;
    }>('/api/v1/settings');
    setTtl(s.pointRequestTtlMinutes);
    setMessagesOn(s.messagesEnabled !== false);
    setExitAllowed(s.clientExitAllowed === true);
    setExitUnlockUntil(s.clientExitUnlockUntil ?? null);
    setHasExitCode(s.hasExitUnlockCode === true);
    const ev = await api<{
      items: Array<{ id: string; kind: string; detail: string; createdAt: string; actorRole?: string | null }>;
    }>('/api/v1/settings/exit-lock-events?limit=12');
    setExitEvents(ev.items ?? []);
  }

  useEffect(() => {
    void refreshExitLock().catch(() => undefined);
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  async function runDiag() {
    const t0 = performance.now();
    try {
      const res = await fetch(`${API_BASE}/health`, { cache: 'no-store' });
      const ms = Math.round(performance.now() - t0);
      const body = (await res.json()) as {
        ok?: boolean;
        lanIps?: string[];
        suggestedApiBase?: string;
        backup?: { latestAt?: string | null; lastError?: { message?: string } | null };
      };
      const err = body.backup?.lastError;
      setDiag(
        body.ok
          ? `正常 ${ms}ms · LAN ${body.lanIps?.join(', ') || '—'} · ${body.suggestedApiBase ?? ''}${
              err ? ` · lastError：${err.message ?? JSON.stringify(err)}` : ' · lastError 无'
            }`
          : `失败 HTTP ${res.status}`,
      );
    } catch (e) {
      setDiag(e instanceof Error ? e.message : 'network_error');
    }
  }

  const pwdHint =
    newPwd.length === 0
      ? '至少 8 位，须含字母与数字；勿用 ChangeMe123 等联调口令'
      : newPwd.length < 8
        ? '还差字符：至少 8 位'
        : !/[A-Za-z]/.test(newPwd) || !/[0-9]/.test(newPwd)
          ? '还需同时包含字母与数字'
          : '强度看起来可以提交';

  return (
    <section>
      <h2>设置</h2>
      {forcePasswordOnly ? (
        <p className="error">首次/联调口令登录：必须先改成个人密码才能使用其它功能。</p>
      ) : null}
      {!forcePasswordOnly ? (
        <>
          <button type="button" onClick={() => void runDiag()}>
            一键检测 /health
          </button>
          {diag ? <p className="hint">{diag}</p> : null}
        </>
      ) : null}

      <h3>教师登录密码</h3>
      <p className="hint">{pwdHint}</p>
      <label>
        当前密码
        <input type="password" value={curPwd} onChange={(e) => setCurPwd(e.target.value)} autoComplete="current-password" />
      </label>
      <label>
        新密码
        <input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} autoComplete="new-password" />
      </label>
      <button
        type="button"
        onClick={() =>
          void api<{ message?: string }>('/api/v1/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({ currentPassword: curPwd, newPassword: newPwd }),
          })
            .then((r) => {
              setPwdMsg(r.message ?? '已更新');
              setCurPwd('');
              setNewPwd('');
              onPasswordChanged?.();
            })
            .catch((e) => setPwdMsg(e instanceof Error ? e.message : '改密失败'))
        }
      >
        修改登录密码
      </button>
      {pwdMsg ? <p className="hint">{pwdMsg}</p> : null}

      {forcePasswordOnly ? null : (
        <>
          <h3>留言</h3>
          <label className="row">
            <input
              type="checkbox"
              checked={messagesOn}
              onChange={(e) =>
                void api('/api/v1/settings', {
                  method: 'PATCH',
                  body: JSON.stringify({ messagesEnabled: e.target.checked }),
                })
                  .then(() => {
                    setMessagesOn(e.target.checked);
                    onMessagesChange?.(e.target.checked);
                    const next = e.target.checked;
                    hardReloadTeacherNav({
                      tab: next ? 'prep' : 'settings',
                      prepTab: next ? 'messages' : 'roster',
                    });
                  })
                  .catch((err) => setSaveMsg(err instanceof Error ? err.message : '保存失败'))
              }
            />
            允许学生留言（关闭后侧栏隐藏「留言」）
          </label>

          <h3>加分请求</h3>
          <label>
            有效期（分钟）
            <input type="number" value={ttl} onChange={(e) => setTtl(Number(e.target.value))} />
          </label>
          <button
            type="button"
            onClick={() =>
              void api('/api/v1/settings', {
                method: 'PATCH',
                body: JSON.stringify({ pointRequestTtlMinutes: ttl }),
              })
                .then(() => setSaveMsg('已保存'))
                .catch((e) => setSaveMsg(e instanceof Error ? e.message : '保存失败'))
            }
          >
            保存设置
          </button>
          {saveMsg ? <p className="hint">{saveMsg}</p> : null}

          <h3>学生端退出锁定</h3>
          <p className="hint">
            默认禁止学生关闭客户端。批量解除后，全班可在时限内退出；或本机输入解除码退出。
            {(() => {
              void nowTick;
              if (!exitAllowed) return ' 当前：已锁定';
              if (!exitUnlockUntil) return ' 当前：已允许退出';
              const left = Math.max(0, Date.parse(exitUnlockUntil) - Date.now());
              const sec = Math.ceil(left / 1000);
              const m = Math.floor(sec / 60);
              const s = String(sec % 60).padStart(2, '0');
              return ` 当前：可退出剩余 ${m}:${s}（至 ${new Date(exitUnlockUntil).toLocaleString()}）`;
            })()}
            {hasExitCode ? ' · 已设置解除码' : ' · 尚未单独设置解除码（可用管理密码）'}
          </p>
          <label>
            批量解除时长（分钟）
            <input
              type="number"
              min={1}
              max={240}
              value={exitMinutes}
              onChange={(e) => setExitMinutes(Number(e.target.value))}
            />
          </label>
          <div className="row">
            <button
              type="button"
              onClick={() => {
                if (
                  !window.confirm(
                    `确认批量允许全班关闭学生端 ${exitMinutes} 分钟？\n时限结束后将自动恢复锁定。`,
                  )
                ) {
                  return;
                }
                void api<{
                  clientExitAllowed?: boolean;
                  clientExitUnlockUntil?: string | null;
                }>('/api/v1/settings', {
                  method: 'PATCH',
                  body: JSON.stringify({ clientExitUnlockMinutes: exitMinutes }),
                })
                  .then(async (r) => {
                    setExitAllowed(r.clientExitAllowed === true);
                    setExitUnlockUntil(r.clientExitUnlockUntil ?? null);
                    setExitMsg(`已批量允许关闭 ${exitMinutes} 分钟`);
                    await refreshExitLock().catch(() => undefined);
                  })
                  .catch((e) => setExitMsg(e instanceof Error ? e.message : '解除失败'));
              }}
            >
              批量允许关闭学生端
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                if (!window.confirm('确认重新锁定？学生端将无法退出。')) return;
                void api<{
                  clientExitAllowed?: boolean;
                  clientExitUnlockUntil?: string | null;
                }>('/api/v1/settings', {
                  method: 'PATCH',
                  body: JSON.stringify({ clientExitRelock: true }),
                })
                  .then(async (r) => {
                    setExitAllowed(r.clientExitAllowed === true);
                    setExitUnlockUntil(r.clientExitUnlockUntil ?? null);
                    setExitMsg('已重新锁定：学生端无法退出');
                    await refreshExitLock().catch(() => undefined);
                  })
                  .catch((e) => setExitMsg(e instanceof Error ? e.message : '锁定失败'));
              }}
            >
              重新锁定
            </button>
          </div>
          <label>
            设置/更换解除码（至少 6 位，不预填）
            <input
              type="password"
              value={exitCodeDraft}
              onChange={(e) => setExitCodeDraft(e.target.value)}
              autoComplete="new-password"
              placeholder="输入新解除码后点保存"
            />
          </label>
          <button
            type="button"
            onClick={() =>
              void api<{ hasExitUnlockCode?: boolean }>('/api/v1/settings', {
                method: 'PATCH',
                body: JSON.stringify({ exitUnlockCode: exitCodeDraft }),
              })
                .then(async (r) => {
                  setHasExitCode(r.hasExitUnlockCode === true);
                  setExitCodeDraft('');
                  setExitMsg('解除码已更新');
                  await refreshExitLock().catch(() => undefined);
                })
                .catch((e) => setExitMsg(e instanceof Error ? e.message : '保存解除码失败'))
            }
          >
            保存解除码
          </button>
          {exitMsg ? <p className="hint">{exitMsg}</p> : null}
          {exitEvents.length ? (
            <div className="card">
              <p className="hint">最近退出锁定审计</p>
              <ul>
                {exitEvents.map((e) => (
                  <li key={e.id}>
                    {new Date(e.createdAt).toLocaleString()} · {e.kind}
                    {e.actorRole ? ` · ${e.actorRole}` : ''} · {e.detail}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="hint">
            数据库：服务进程每天自动备份一次（保留约 14 份）；也可手动 `npm run backup:db`。确认 /health 无
            lastError。任务管理器级结束见 docs/EXIT_LOCK_MDM.md。
          </p>
        </>
      )}
    </section>
  );
}

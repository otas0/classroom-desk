import { useEffect, useMemo, useRef, useState, type CSSProperties, type UIEvent } from 'react';
import { API_BASE, api, getToken } from './api';
import { AuditDetail } from './AuditDetail';
import { canBulkDelete, canWriteClass, isAssistant } from './authRole';
import { ConfirmModal } from './ConfirmModal';
import { downloadPost } from './download';
import { hardReloadTeacherNav } from './navStorage';
import {
  formatRecycleDaysLeft,
  isRecycleUrgent,
  RECYCLE_DAYS_LEFT_TESTID,
  RECYCLE_RETENTION_DAYS,
  recycleDaysLeft,
} from './recycleRetention';
import { useToast } from './toast';
import { permissionsDocHref } from './permissionsHref';
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
  onRosterChanged,
}: {
  classId: string;
  classes: ClassItem[];
  onClasses: () => Promise<void>;
  onRosterChanged?: () => void;
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [stuNoPrefix, setStuNoPrefix] = useState('');
  const [recycle, setRecycle] = useState<Array<Record<string, unknown>>>([]);
  const [showRecycle, setShowRecycle] = useState(false);
  const [rosterScrollTop, setRosterScrollTop] = useState(0);
  const [impactModal, setImpactModal] = useState<{
    studentCount: number;
    attendanceRecords: number;
    pointsLog: number;
    answers: number;
    messages: number;
    pointRequests: number;
    total: number;
    ids: string[];
    label?: string;
  } | null>(null);
  const toast = useToast();
  const allowDelete = canBulkDelete();
  const allowWrite = canWriteClass();
  const rosterAnchorId = useRef<string | null>(null);
  const ROSTER_ROW_H = 44;
  const ROSTER_VIEW_H = 420;

  async function loadStudents() {
    if (!classId) return;
    const r = await api<{ items: Array<Record<string, unknown>> }>(`/api/v1/classes/${classId}/students`);
    setStudents(r.items);
    setSelectedIds(new Set());
  }

  async function loadRecycle() {
    if (!classId) return;
    const r = await api<{ items: Array<Record<string, unknown>> }>(
      `/api/v1/classes/${classId}/students/recycle`,
    );
    setRecycle(r.items);
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
      onRosterChanged?.();
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
    setShowRecycle(false);
    setRecycle([]);
    setRosterScrollTop(0);
  }, [classId]);

  const rosterVirtual = useMemo(() => {
    const start = Math.max(0, Math.floor(rosterScrollTop / ROSTER_ROW_H) - 4);
    const visible = Math.ceil(ROSTER_VIEW_H / ROSTER_ROW_H) + 8;
    const end = Math.min(filteredStudents.length, start + visible);
    return { start, end, totalH: filteredStudents.length * ROSTER_ROW_H };
  }, [filteredStudents.length, rosterScrollTop]);

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
    onRosterChanged?.();
  }

  return (
    <section>
      <h2>班级与名单</h2>
      {!allowWrite ? <p className="hint">助教只读名单，不可创建班级/导入/加分/删人</p> : null}
      {allowWrite ? (
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
      ) : null}

      {allowWrite ? (
      <>
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
              onRosterChanged?.();
            } catch (err) {
              setImportResult(String(err instanceof Error ? err.message : err));
            }
          })();
        }}
      >
        从文本导入 CSV
      </button>
      {importResult ? <p className={/失败|错误|无效|损坏/.test(importResult) ? 'error' : 'hint'}>{importResult}</p> : null}
      </>
      ) : null}

      <h3>当前班名单（{classes.find((c) => c.id === classId)?.name ?? ''}）· 按学号排序</h3>
      <p className="hint">
        可直接改姓名/学号并保存；勾选后可批量处理。删除先入回收站，{RECYCLE_RETENTION_DAYS}{' '}
        日内可恢复。
      </p>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索姓名/学号" />
      <div className="row bulk-bar">
        <label className="row">
          <input
            type="checkbox"
            checked={
              filteredStudents.length > 0 &&
              filteredStudents.every((s) => selectedIds.has(String(s.id)))
            }
            onChange={(e) => {
              if (e.target.checked) {
                setSelectedIds(new Set(filteredStudents.map((s) => String(s.id))));
              } else {
                setSelectedIds(new Set());
              }
            }}
          />
          全选当前列表（{filteredStudents.length}）
        </label>
        <button
          type="button"
          className="secondary"
          disabled={bulkBusy || selectedIds.size === 0}
          onClick={() =>
            void (async () => {
              setBulkBusy(true);
              try {
                await downloadPost(
                  '/api/v1/exports/students-selected',
                  { classId, ids: [...selectedIds], format: 'xlsx' },
                  `students-selected.xlsx`,
                );
                toast.ok(`已导出选中 ${selectedIds.size} 人`);
              } catch (e) {
                toast.err(e instanceof Error ? e.message : '导出失败');
              } finally {
                setBulkBusy(false);
              }
            })()
          }
        >
          导出选中
        </button>
        <input
          value={stuNoPrefix}
          onChange={(e) => setStuNoPrefix(e.target.value)}
          placeholder="学号前缀"
          aria-label="学号前缀"
          style={{ width: '7rem' }}
          disabled={!allowDelete}
        />
        <button
          type="button"
          className="secondary"
          disabled={bulkBusy || selectedIds.size === 0 || !allowDelete || !stuNoPrefix.trim()}
          onClick={() =>
            void (async () => {
              if (!window.confirm(`为选中的 ${selectedIds.size} 人学号加上前缀「${stuNoPrefix.trim()}」？`)) {
                return;
              }
              setBulkBusy(true);
              try {
                const r = await api<{ message?: string }>(
                  `/api/v1/classes/${classId}/students/bulk-student-no`,
                  {
                    method: 'POST',
                    body: JSON.stringify({
                      ids: [...selectedIds],
                      action: 'prefix',
                      prefix: stuNoPrefix.trim(),
                    }),
                  },
                );
                toast.ok(r.message ?? '已更新学号');
                await loadStudents();
              } catch (e) {
                toast.err(e instanceof Error ? e.message : '学号更新失败');
              } finally {
                setBulkBusy(false);
              }
            })()
          }
        >
          加前缀
        </button>
        <button
          type="button"
          className="secondary"
          disabled={bulkBusy || selectedIds.size === 0 || !allowDelete}
          onClick={() =>
            void (async () => {
              if (!window.confirm(`清空选中的 ${selectedIds.size} 人学号？`)) return;
              setBulkBusy(true);
              try {
                const r = await api<{ message?: string }>(
                  `/api/v1/classes/${classId}/students/bulk-student-no`,
                  {
                    method: 'POST',
                    body: JSON.stringify({ ids: [...selectedIds], action: 'clear' }),
                  },
                );
                toast.ok(r.message ?? '已清空学号');
                await loadStudents();
              } catch (e) {
                toast.err(e instanceof Error ? e.message : '清空失败');
              } finally {
                setBulkBusy(false);
              }
            })()
          }
        >
          清空学号
        </button>
        <button
          type="button"
          data-testid="bulk-delete-students"
          disabled={bulkBusy || selectedIds.size === 0 || !allowDelete}
          onClick={() =>
            void (async () => {
              setBulkBusy(true);
              try {
                const impact = await api<{
                  studentCount: number;
                  attendanceRecords: number;
                  pointsLog: number;
                  answers: number;
                  messages: number;
                  pointRequests: number;
                  total: number;
                }>(`/api/v1/classes/${classId}/students/bulk-impact`, {
                  method: 'POST',
                  body: JSON.stringify({ ids: [...selectedIds] }),
                });
                setImpactModal({ ...impact, ids: [...selectedIds] });
              } catch (e) {
                toast.err(e instanceof Error ? e.message : '无法获取影响汇总');
              } finally {
                setBulkBusy(false);
              }
            })()
          }
        >
          批量删除（{selectedIds.size}）
        </button>
        {!allowDelete ? <span className="hint">助教不可批量删除/改学号</span> : null}
      </div>
      {selectedIds.size > 0 ? (
        <div className="selection-sticky" data-testid="roster-selection-sticky">
          已选 {selectedIds.size} 人 · Shift+点击可连选
        </div>
      ) : null}
      <div className="row" style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>
        <span style={{ width: '2.5rem' }}>选</span>
        <span style={{ flex: 1 }}>学号</span>
        <span style={{ flex: 1.2 }}>姓名</span>
        <span style={{ width: '4rem' }}>积分</span>
        <span>操作</span>
      </div>
      {filteredStudents.length === 0 ? <p className="hint">暂无学生</p> : null}
      <div
        className="roster-virtual"
        style={{ height: ROSTER_VIEW_H }}
        data-testid="roster-virtual"
        onScroll={(e: UIEvent<HTMLDivElement>) => setRosterScrollTop(e.currentTarget.scrollTop)}
      >
        <div className="roster-virtual-inner" style={{ height: rosterVirtual.totalH }}>
          {filteredStudents.slice(rosterVirtual.start, rosterVirtual.end).map((s, i) => {
            const idx = rosterVirtual.start + i;
            return (
              <StudentRow
                key={String(s.id)}
                classId={classId}
                student={s}
                style={{ top: idx * ROSTER_ROW_H, height: ROSTER_ROW_H } as CSSProperties}
                selected={selectedIds.has(String(s.id))}
                onSelectChange={(id, on, opts) => {
                  const ordered = filteredStudents.map((row) => String(row.id));
                  if (opts?.shift && rosterAnchorId.current) {
                    const a = ordered.indexOf(rosterAnchorId.current);
                    const b = ordered.indexOf(id);
                    if (a >= 0 && b >= 0) {
                      const [lo, hi] = a < b ? [a, b] : [b, a];
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        for (let k = lo; k <= hi; k++) {
                          const rid = ordered[k]!;
                          if (on) next.add(rid);
                          else next.delete(rid);
                        }
                        return next;
                      });
                      return;
                    }
                  }
                  rosterAnchorId.current = id;
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (on) next.add(id);
                    else next.delete(id);
                    return next;
                  });
                }}
                onChanged={() => void loadStudents()}
                onRemoved={() => {
                  onRosterChanged?.();
                  toast.ok('已移入回收站');
                }}
                onError={(msg) => toast.err(msg)}
                onRequestDelete={allowWrite ? (payload) => setImpactModal(payload) : undefined}
                allowWrite={allowWrite}
              />
            );
          })}
        </div>
      </div>
      <ConfirmModal
        open={Boolean(impactModal)}
        title="确认移入回收站"
        confirmLabel="移入回收站"
        busy={bulkBusy}
        body={
          impactModal ? (
            <>
              <p>
                {impactModal.label
                  ? `将「${impactModal.label}」移入回收站（${RECYCLE_RETENTION_DAYS} 日内可恢复）。`
                  : `将 ${impactModal.studentCount} 名学生移入回收站（${RECYCLE_RETENTION_DAYS} 日内可恢复）。`}
              </p>
              <p>
                关联数据暂保留：签到 {impactModal.attendanceRecords} · 积分流水 {impactModal.pointsLog} ·
                作答 {impactModal.answers} · 留言 {impactModal.messages} · 加分请求{' '}
                {impactModal.pointRequests}（共 {impactModal.total} 条）。
              </p>
              <p>永久删除或到期清理时才会清除关联记录；在线学生端将被踢下线。</p>
            </>
          ) : null
        }
        onCancel={() => setImpactModal(null)}
        onConfirm={() =>
          void (async () => {
            if (!impactModal) return;
            setBulkBusy(true);
            try {
              const r = await api<{ message?: string; deleted: number }>(
                `/api/v1/classes/${classId}/students/bulk-delete`,
                { method: 'POST', body: JSON.stringify({ ids: impactModal.ids }) },
              );
              toast.ok(r.message ?? `已移入回收站 ${r.deleted} 人`);
              setImpactModal(null);
              await loadStudents();
              onRosterChanged?.();
              if (showRecycle) await loadRecycle();
            } catch (e) {
              toast.err(e instanceof Error ? e.message : '批量删除失败');
            } finally {
              setBulkBusy(false);
            }
          })()
        }
      />

      <div className="recycle-box">
        <button
          type="button"
          className="secondary"
          onClick={() =>
            void (async () => {
              const next = !showRecycle;
              setShowRecycle(next);
              if (next) {
                try {
                  await loadRecycle();
                } catch (e) {
                  toast.err(e instanceof Error ? e.message : '加载回收站失败');
                }
              }
            })()
          }
        >
          {showRecycle ? '收起回收站' : '学生回收站'}
        </button>
        {showRecycle ? (
          <>
            <p className="hint">软删除学生可恢复；永久删除会级联清除关联记录。</p>
            {allowDelete && recycle.length > 0 ? (
              <div className="row bulk-bar">
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    void (async () => {
                      if (!window.confirm(`恢复回收站全部 ${recycle.length} 人？`)) return;
                      try {
                        const r = await api<{ message?: string }>(
                          `/api/v1/classes/${classId}/students/recycle/restore-all`,
                          { method: 'POST', body: '{}' },
                        );
                        toast.ok(r.message ?? '已全部恢复');
                        await loadRecycle();
                        await loadStudents();
                        onRosterChanged?.();
                      } catch (e) {
                        toast.err(e instanceof Error ? e.message : '恢复失败');
                      }
                    })()
                  }
                >
                  一键恢复全部
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void (async () => {
                      if (
                        !window.confirm(
                          `永久清空回收站全部 ${recycle.length} 人？不可恢复，关联记录一并清除。`,
                        )
                      ) {
                        return;
                      }
                      try {
                        const r = await api<{ message?: string }>(
                          `/api/v1/classes/${classId}/students/recycle/purge-all`,
                          { method: 'POST', body: '{}' },
                        );
                        toast.ok(r.message ?? '已清空');
                        await loadRecycle();
                      } catch (e) {
                        toast.err(e instanceof Error ? e.message : '清空失败');
                      }
                    })()
                  }
                >
                  一键清空全部
                </button>
              </div>
            ) : null}
            {recycle.length === 0 ? <p className="hint">回收站为空</p> : null}
            <ul className="question-list">
              {recycle.map((s) => (
                <li key={String(s.id)} className="question-item">
                  <span className="title">
                    {String(s.displayName)}
                    {s.studentNo ? ` · ${String(s.studentNo)}` : ''}
                    {s.deletedAt ? ` · 删除于 ${String(s.deletedAt).slice(0, 19)}` : ''}
                    {(() => {
                      const days =
                        s.daysLeft != null ? Number(s.daysLeft) : recycleDaysLeft(s.deletedAt);
                      const label = formatRecycleDaysLeft(days);
                      return label ? (
                        <span
                          className={`days-left${isRecycleUrgent(days) ? ' days-left-urgent' : ''}`}
                          data-testid={RECYCLE_DAYS_LEFT_TESTID}
                        >
                          {' '}
                          · {label}
                        </span>
                      ) : null;
                    })()}
                  </span>
                  {allowDelete ? (
                    <>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          void (async () => {
                            try {
                              await api(`/api/v1/classes/${classId}/students/bulk-restore`, {
                                method: 'POST',
                                body: JSON.stringify({ ids: [String(s.id)] }),
                              });
                              toast.ok(`已恢复 ${String(s.displayName)}`);
                              await loadRecycle();
                              await loadStudents();
                              onRosterChanged?.();
                            } catch (e) {
                              toast.err(e instanceof Error ? e.message : '恢复失败');
                            }
                          })()
                        }
                      >
                        恢复
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void (async () => {
                            if (!window.confirm(`永久删除「${String(s.displayName)}」？不可恢复。`)) return;
                            try {
                              await api(`/api/v1/classes/${classId}/students/bulk-purge`, {
                                method: 'POST',
                                body: JSON.stringify({ ids: [String(s.id)] }),
                              });
                              toast.ok('已永久删除');
                              await loadRecycle();
                            } catch (e) {
                              toast.err(e instanceof Error ? e.message : '永久删除失败');
                            }
                          })()
                        }
                      >
                        永久删除
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </section>
  );
}

export function StudentRow({
  classId,
  student,
  selected,
  onSelectChange,
  onChanged,
  onRemoved,
  onError,
  onRequestDelete,
  allowWrite = true,
  style,
}: {
  classId: string;
  student: Record<string, unknown>;
  selected?: boolean;
  onSelectChange?: (id: string, selected: boolean, opts?: { shift?: boolean }) => void;
  onChanged: () => void;
  onRemoved?: () => void;
  onError: (msg: string) => void;
  onRequestDelete?: (payload: {
    ids: string[];
    studentCount: number;
    attendanceRecords: number;
    pointsLog: number;
    answers: number;
    messages: number;
    pointRequests: number;
    total: number;
    label: string;
  }) => void;
  allowWrite?: boolean;
  style?: CSSProperties;
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
      const impact = await api<{
        attendanceRecords: number;
        pointsLog: number;
        answers: number;
        messages: number;
        pointRequests: number;
        total: number;
      }>(`/api/v1/classes/${classId}/students/${id}/impact`);
      if (onRequestDelete) {
        onRequestDelete({
          ids: [id],
          studentCount: 1,
          attendanceRecords: impact.attendanceRecords,
          pointsLog: impact.pointsLog,
          answers: impact.answers,
          messages: impact.messages,
          pointRequests: impact.pointRequests,
          total: impact.total,
          label: name || id,
        });
        return;
      }
      await api(`/api/v1/classes/${classId}/students/${id}`, { method: 'DELETE' });
      onChanged();
      onRemoved?.();
    } catch (e) {
      onError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="roster-virtual-row" style={style} data-testid={`student-row-${id}`}>
      <input
        type="checkbox"
        checked={Boolean(selected)}
        disabled={busy}
        aria-label={`选择 ${name || id}`}
        data-testid={`student-check-${id}`}
        onClick={(e) => {
          if (e.shiftKey) {
            e.preventDefault();
            onSelectChange?.(id, !selected, { shift: true });
          }
        }}
        onChange={(e) => onSelectChange?.(id, e.target.checked)}
      />
      <input
        value={studentNo}
        disabled={busy || !allowWrite}
        onChange={(e) => setStudentNo(e.target.value)}
        placeholder="学号"
        aria-label="学号"
        readOnly={!allowWrite}
      />
      <input
        value={name}
        disabled={busy || !allowWrite}
        onChange={(e) => setName(e.target.value)}
        placeholder="姓名"
        aria-label="姓名"
        readOnly={!allowWrite}
      />
      <span>{String(student.totalPoints)}</span>
      <span>
        {allowWrite ? (
          <>
            <button type="button" className="secondary" disabled={busy} onClick={() => void save()}>
              保存
            </button>{' '}
            <button type="button" disabled={busy} onClick={() => void remove()}>
              删除
            </button>
          </>
        ) : (
          <span className="hint">只读</span>
        )}
      </span>
    </div>
  );
}

type QAttachment = { url: string; originalName: string; size?: number; mime?: string };

const QUESTION_FILE_ACCEPT =
  '.pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.mp3,.m4a,.wav,.mp4,.webm';

export function QuestionsPanel({ classId }: { classId: string }) {
  const [title, setTitle] = useState('');
  const [stem, setStem] = useState('');
  const [type, setType] = useState<'single' | 'multi' | 'bool' | 'blank'>('single');
  const [correctSingle, setCorrectSingle] = useState<'A' | 'B'>('A');
  const [correctMulti, setCorrectMulti] = useState<{ A: boolean; B: boolean; C: boolean }>({
    A: true,
    B: true,
    C: false,
  });
  const [boolCorrect, setBoolCorrect] = useState<'A' | 'B'>('A');
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
  const [selectedQIds, setSelectedQIds] = useState<Set<string>>(new Set());
  const [bulkQBusy, setBulkQBusy] = useState(false);
  const [bulkClosesAt, setBulkClosesAt] = useState('');
  const [qScrollTop, setQScrollTop] = useState(0);
  const toast = useToast();
  const allowDelete = canBulkDelete();
  const allowWrite = canWriteClass();
  const Q_ROW_H = 48;
  const Q_VIEW_H = 420;

  async function load() {
    const q = showArchived ? '&includeArchived=1' : '';
    const r = await api<{ items: Array<Record<string, unknown>> }>(
      `/api/v1/questions?classId=${classId}${q}`,
    );
    setItems(r.items);
    setSelectedQIds(new Set());
  }

  async function bulkQuestions(
    action: 'delete' | 'purge' | 'restore' | 'close' | 'reopen' | 'archive' | 'unarchive' | 'set_closes_at',
  ) {
    if (selectedQIds.size === 0) return;
    if (!allowDelete && (action === 'delete' || action === 'purge')) {
      toast.err('助教不可批量删除');
      return;
    }
    const labels: Record<typeof action, string> = {
      delete: '移入回收站',
      purge: '永久删除',
      restore: '恢复',
      close: '收卷',
      reopen: '重开',
      archive: '下线',
      unarchive: '恢复上线',
      set_closes_at: '设置截止',
    };
    if (action === 'delete') {
      if (
        !window.confirm(
          `确定将选中的 ${selectedQIds.size} 道题移入回收站？作答记录暂保留，永久删除或到期后清除。`,
        )
      ) {
        return;
      }
    } else if (action === 'purge') {
      if (!window.confirm(`永久删除选中的 ${selectedQIds.size} 道题？不可恢复。`)) return;
    } else if (action === 'set_closes_at') {
      if (!bulkClosesAt.trim()) {
        toast.err('请填写截止时间');
        return;
      }
      if (!window.confirm(`为选中的 ${selectedQIds.size} 道题设置截止 ${bulkClosesAt}？`)) return;
    } else if (
      !window.confirm(`确定对选中的 ${selectedQIds.size} 道题执行「${labels[action]}」？`)
    ) {
      return;
    }
    setBulkQBusy(true);
    try {
      const r = await api<{ message?: string; affected: number }>('/api/v1/questions/bulk', {
        method: 'POST',
        body: JSON.stringify({
          classId,
          ids: [...selectedQIds],
          action,
          closesAt:
            action === 'set_closes_at'
              ? new Date(bulkClosesAt).toISOString()
              : undefined,
        }),
      });
      toast.ok(r.message ?? `已${labels[action]} ${r.affected} 题`);
      if (
        (action === 'delete' || action === 'purge') &&
        editingQuestion &&
        selectedQIds.has(String(editingQuestion.id))
      ) {
        setEditingQuestion(null);
      }
      await load();
    } catch (e) {
      toast.err(e instanceof Error ? e.message : '批量操作失败');
    } finally {
      setBulkQBusy(false);
    }
  }

  useEffect(() => {
    void load().catch(() => setItems([]));
  }, [classId, showArchived]);

  const qVirtual = useMemo(() => {
    const start = Math.max(0, Math.floor(qScrollTop / Q_ROW_H) - 4);
    const visible = Math.ceil(Q_VIEW_H / Q_ROW_H) + 8;
    const end = Math.min(items.length, start + visible);
    return { start, end, totalH: items.length * Q_ROW_H };
  }, [items.length, qScrollTop]);

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
          { label: 'A', content: '正确', isCorrect: boolCorrect === 'A' },
          { label: 'B', content: '错误', isCorrect: boolCorrect === 'B' },
        ],
      };
    } else if (type === 'multi') {
      if (!optA.trim() || !optB.trim() || !optC.trim()) {
        setCreateMsg('多选题请填写选项 A/B/C 的真实内容');
        return;
      }
      if (!correctMulti.A && !correctMulti.B && !correctMulti.C) {
        setCreateMsg('多选题请至少勾选一个正确答案');
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
          { label: 'A', content: optA.trim(), isCorrect: correctMulti.A },
          { label: 'B', content: optB.trim(), isCorrect: correctMulti.B },
          { label: 'C', content: optC.trim(), isCorrect: correctMulti.C },
        ],
      };
    } else {
      if (!optA.trim() || !optB.trim()) {
        setCreateMsg('单选题请填写选项 A/B 的真实内容');
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
          { label: 'A', content: optA.trim(), isCorrect: correctSingle === 'A' },
          { label: 'B', content: optB.trim(), isCorrect: correctSingle === 'B' },
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
    setCorrectSingle('A');
    setCorrectMulti({ A: true, B: true, C: false });
    setBoolCorrect('A');
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
      {!allowWrite ? <p className="hint">助教可收卷/下线，不可发布或编辑题目</p> : null}
      <div className="row">
        {allowWrite ? (
          <>
            <button type="button" className="chip" onClick={() => applyTemplate('bool')}>
              判断题模板
            </button>
            <button type="button" className="chip" onClick={() => applyTemplate('blank')}>
              填空题模板
            </button>
          </>
        ) : null}
        <label className="row">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          显示已下线
        </label>
      </div>
      {allowWrite ? (
      <>
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
        <>
          <p className="hint">判断题选项固定为「正确 / 错误」</p>
          <div className="row" role="radiogroup" aria-label="正确答案">
            <span>正确答案：</span>
            <label className="choice">
              <input
                type="radio"
                name="q-bool-correct"
                checked={boolCorrect === 'A'}
                onChange={() => setBoolCorrect('A')}
              />
              正确
            </label>
            <label className="choice">
              <input
                type="radio"
                name="q-bool-correct"
                checked={boolCorrect === 'B'}
                onChange={() => setBoolCorrect('B')}
              />
              错误
            </label>
          </div>
        </>
      ) : (
        <>
          <input value={optA} onChange={(e) => setOptA(e.target.value)} placeholder="选项 A（必填）" />
          <input value={optB} onChange={(e) => setOptB(e.target.value)} placeholder="选项 B（必填）" />
          {type === 'multi' ? (
            <input value={optC} onChange={(e) => setOptC(e.target.value)} placeholder="选项 C（必填）" />
          ) : null}
          {type === 'single' ? (
            <div className="row" role="radiogroup" aria-label="正确答案">
              <span>正确答案</span>
              <label className="choice">
                <input
                  type="radio"
                  name="q-correct-single"
                  checked={correctSingle === 'A'}
                  onChange={() => setCorrectSingle('A')}
                />
                A
              </label>
              <label className="choice">
                <input
                  type="radio"
                  name="q-correct-single"
                  checked={correctSingle === 'B'}
                  onChange={() => setCorrectSingle('B')}
                />
                B
              </label>
            </div>
          ) : (
            <div className="row">
              {(['A', 'B', 'C'] as const).map((letter) => (
                <label key={letter} className="choice">
                  <input
                    type="checkbox"
                    checked={correctMulti[letter]}
                    onChange={(e) => setCorrectMulti((prev) => ({ ...prev, [letter]: e.target.checked }))}
                  />
                  {letter} 正确
                </label>
              ))}
            </div>
          )}
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
      <button
        type="button"
        onClick={() => void create()}
        disabled={
          uploading ||
          !title.trim() ||
          !stem.trim() ||
          (type === 'blank' && !blankKey.trim()) ||
          (type === 'multi' &&
            (!optA.trim() ||
              !optB.trim() ||
              !optC.trim() ||
              (!correctMulti.A && !correctMulti.B && !correctMulti.C))) ||
          ((type === 'single' || type === 'bool') &&
            type === 'single' &&
            (!optA.trim() || !optB.trim()))
        }
        title={
          type === 'multi' && !correctMulti.A && !correctMulti.B && !correctMulti.C
            ? '多选题请至少勾选一个正确答案'
            : undefined
        }
      >
        发布题目
      </button>
      {type === 'multi' && !correctMulti.A && !correctMulti.B && !correctMulti.C ? (
        <p className="error">请至少勾选一个正确答案后再发布</p>
      ) : null}
      {createMsg ? <p className="hint">{createMsg}</p> : null}
      </>
      ) : null}
      <div className="row bulk-bar">
        <label className="row">
          <input
            type="checkbox"
            checked={items.length > 0 && items.every((q) => selectedQIds.has(String(q.id)))}
            onChange={(e) => {
              if (e.target.checked) setSelectedQIds(new Set(items.map((q) => String(q.id))));
              else setSelectedQIds(new Set());
            }}
          />
          全选（{items.length}）· 已选 {selectedQIds.size}
        </label>
        <button
          type="button"
          className="secondary"
          disabled={bulkQBusy || items.every((q) => !q.closed)}
          onClick={() =>
            setSelectedQIds(new Set(items.filter((q) => q.closed).map((q) => String(q.id))))
          }
        >
          全选已收卷
        </button>
        <button
          type="button"
          className="secondary"
          disabled={bulkQBusy || items.every((q) => !q.archived)}
          onClick={() =>
            setSelectedQIds(new Set(items.filter((q) => q.archived).map((q) => String(q.id))))
          }
        >
          全选已下线
        </button>
        <button type="button" className="secondary" disabled={bulkQBusy || selectedQIds.size === 0} onClick={() => void bulkQuestions('close')}>
          批量收卷
        </button>
        <button type="button" className="secondary" disabled={bulkQBusy || selectedQIds.size === 0} onClick={() => void bulkQuestions('reopen')}>
          批量重开
        </button>
        <button type="button" className="secondary" disabled={bulkQBusy || selectedQIds.size === 0} onClick={() => void bulkQuestions('archive')}>
          批量下线
        </button>
        <button type="button" className="secondary" disabled={bulkQBusy || selectedQIds.size === 0} onClick={() => void bulkQuestions('unarchive')}>
          批量恢复上线
        </button>
        <input
          type="datetime-local"
          value={bulkClosesAt}
          onChange={(e) => setBulkClosesAt(e.target.value)}
          aria-label="批量截止时间"
          disabled={!allowDelete}
        />
        <button
          type="button"
          className="secondary"
          disabled={bulkQBusy || selectedQIds.size === 0 || !allowDelete || !bulkClosesAt.trim()}
          onClick={() => void bulkQuestions('set_closes_at')}
        >
          批量设截止
        </button>
        <button
          type="button"
          className="secondary"
          disabled={bulkQBusy || selectedQIds.size === 0 || !allowDelete}
          onClick={() =>
            void (async () => {
              if (!window.confirm(`清空选中的 ${selectedQIds.size} 道题的截止时间？`)) return;
              setBulkQBusy(true);
              try {
                const r = await api<{ message?: string }>('/api/v1/questions/bulk', {
                  method: 'POST',
                  body: JSON.stringify({
                    classId,
                    ids: [...selectedQIds],
                    action: 'set_closes_at',
                    closesAt: null,
                  }),
                });
                toast.ok(r.message ?? '已清空截止');
                await load();
              } catch (e) {
                toast.err(e instanceof Error ? e.message : '清空失败');
              } finally {
                setBulkQBusy(false);
              }
            })()
          }
        >
          清空截止
        </button>
        <button
          type="button"
          className="secondary"
          disabled={bulkQBusy || selectedQIds.size === 0}
          onClick={() =>
            void (async () => {
              try {
                await downloadPost(
                  '/api/v1/exports/questions-selected',
                  { classId, ids: [...selectedQIds], format: 'xlsx' },
                  'questions-selected.xlsx',
                );
                toast.ok(`已导出选中 ${selectedQIds.size} 题`);
              } catch (e) {
                toast.err(e instanceof Error ? e.message : '导出失败');
              }
            })()
          }
        >
          导出选中
        </button>
        <button type="button" disabled={bulkQBusy || selectedQIds.size === 0 || !allowDelete} onClick={() => void bulkQuestions('delete')}>
          批量删除
        </button>
        {!allowDelete ? <span className="hint">助教不可删除/设截止</span> : null}
      </div>
      {items.length === 0 ? <p className="hint">暂无题目</p> : null}
      <div
        className="q-virtual"
        style={{ height: Q_VIEW_H }}
        onScroll={(e: UIEvent<HTMLDivElement>) => setQScrollTop(e.currentTarget.scrollTop)}
      >
        <div className="q-virtual-inner" style={{ height: qVirtual.totalH }}>
          {items.slice(qVirtual.start, qVirtual.end).map((q, i) => {
          const idx = qVirtual.start + i;
          const qid = String(q.id);
          const active = editingQuestion && String(editingQuestion.id) === qid;
          const closed = Boolean(q.closed);
          const archived = Boolean(q.archived);
          return (
            <div
              key={qid}
              className={`q-virtual-row question-item${active ? ' active' : ''}`}
              style={{ top: idx * Q_ROW_H, height: Q_ROW_H }}
              tabIndex={0}
              role="button"
              onClick={() => {
                setEditingQuestion(q);
                void showStats(qid, String(q.title));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setEditingQuestion(q);
                  void showStats(qid, String(q.title));
                }
              }}
            >
              <label className="choice" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selectedQIds.has(qid)}
                  onChange={(e) => {
                    setSelectedQIds((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(qid);
                      else next.delete(qid);
                      return next;
                    });
                  }}
                  aria-label={`选择 ${String(q.title)}`}
                />
              </label>
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
                disabled={!allowDelete}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!allowDelete) return;
                  if (!window.confirm(`将题目「${String(q.title)}」移入回收站？`)) return;
                  void api(`/api/v1/questions/${String(q.id)}`, { method: 'DELETE' })
                    .then(async () => {
                      toast.ok('已移入回收站');
                      if (String(editingQuestion?.id) === String(q.id)) setEditingQuestion(null);
                      await load();
                    })
                    .catch((err) => toast.err(err instanceof Error ? err.message : '删除失败'));
                }}
              >
                删除
              </button>
            </div>
          );
          })}
        </div>
      </div>
      {allowWrite && editingQuestion ? (
        <>
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
        </>
      ) : null}
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

export function QuestionRecyclePanel({ classId }: { classId: string }) {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const qAnchorId = useRef<string | null>(null);
  const toast = useToast();
  const allowDelete = canBulkDelete();
  const ROW_H = 44;
  const VIEW_H = 420;

  async function load() {
    const r = await api<{ items: Array<Record<string, unknown>> }>(
      `/api/v1/questions?classId=${classId}&includeDeleted=1`,
    );
    setItems(r.items);
    setSelected(new Set());
  }

  useEffect(() => {
    void load().catch(() => setItems([]));
    setScrollTop(0);
  }, [classId]);

  const virt = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 4);
    const visible = Math.ceil(VIEW_H / ROW_H) + 8;
    const end = Math.min(items.length, start + visible);
    return { start, end, totalH: items.length * ROW_H };
  }, [items.length, scrollTop]);

  async function run(action: 'restore' | 'purge', ids: string[]) {
    if (!ids.length || !allowDelete) return;
    if (action === 'purge' && !window.confirm(`永久删除 ${ids.length} 道题？不可恢复。`)) return;
    setBusy(true);
    try {
      const r = await api<{ message?: string }>('/api/v1/questions/bulk', {
        method: 'POST',
        body: JSON.stringify({ classId, ids, action }),
      });
      toast.ok(r.message ?? '完成');
      await load();
    } catch (e) {
      toast.err(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>题目回收站</h2>
      <p className="hint">
        软删除题目在此恢复或永久清除；与「含已下线」无关。默认保留 {RECYCLE_RETENTION_DAYS} 天。
      </p>
      <div className="row bulk-bar">
        <label className="row">
          <input
            type="checkbox"
            checked={items.length > 0 && items.every((q) => selected.has(String(q.id)))}
            onChange={(e) => {
              if (e.target.checked) setSelected(new Set(items.map((q) => String(q.id))));
              else setSelected(new Set());
            }}
          />
          全选（{items.length}）
        </label>
        <button
          type="button"
          className="secondary"
          disabled={busy || selected.size === 0 || !allowDelete}
          onClick={() => void run('restore', [...selected])}
        >
          恢复选中
        </button>
        <button
          type="button"
          disabled={busy || selected.size === 0 || !allowDelete}
          onClick={() => void run('purge', [...selected])}
        >
          永久删除选中
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy || items.length === 0 || !allowDelete}
          onClick={() =>
            void (async () => {
              if (!window.confirm(`恢复全部 ${items.length} 道题？`)) return;
              setBusy(true);
              try {
                const r = await api<{ message?: string }>('/api/v1/questions/recycle/restore-all', {
                  method: 'POST',
                  body: JSON.stringify({ classId }),
                });
                toast.ok(r.message ?? '已全部恢复');
                await load();
              } catch (e) {
                toast.err(e instanceof Error ? e.message : '恢复失败');
              } finally {
                setBusy(false);
              }
            })()
          }
        >
          一键恢复全部
        </button>
        <button
          type="button"
          data-testid="q-recycle-purge-all"
          disabled={busy || items.length === 0 || !allowDelete}
          onClick={() =>
            void (async () => {
              if (!window.confirm(`永久清空回收站 ${items.length} 道题？`)) return;
              setBusy(true);
              try {
                const r = await api<{ message?: string }>('/api/v1/questions/recycle/purge-all', {
                  method: 'POST',
                  body: JSON.stringify({ classId }),
                });
                toast.ok(r.message ?? '已清空');
                await load();
              } catch (e) {
                toast.err(e instanceof Error ? e.message : '清空失败');
              } finally {
                setBusy(false);
              }
            })()
          }
        >
          一键清空全部
        </button>
      </div>
      {selected.size > 0 ? (
        <div className="selection-sticky" data-testid="q-recycle-selection-sticky">
          已选 {selected.size} 题 · Shift+点击可连选
        </div>
      ) : null}
      {items.length === 0 ? <p className="hint">回收站为空</p> : null}
      <div
        className="q-virtual"
        style={{ height: VIEW_H }}
        data-testid="q-recycle-virtual"
        onScroll={(e: UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div className="q-virtual-inner" style={{ height: virt.totalH }}>
          {items.slice(virt.start, virt.end).map((q, i) => {
            const idx = virt.start + i;
            const qid = String(q.id);
            const days =
              q.daysLeft != null ? Number(q.daysLeft) : recycleDaysLeft(q.deletedAt);
            const daysLabel = formatRecycleDaysLeft(days);
            return (
              <div
                key={qid}
                className="q-virtual-row question-item"
                style={{ top: idx * ROW_H, height: ROW_H }}
                data-testid={`q-recycle-row-${qid}`}
              >
                <label className="choice">
                  <input
                    type="checkbox"
                    checked={selected.has(qid)}
                    onClick={(e) => {
                      if (!e.shiftKey) return;
                      e.preventDefault();
                      const ordered = items.map((row) => String(row.id));
                      const on = !selected.has(qid);
                      if (qAnchorId.current) {
                        const a = ordered.indexOf(qAnchorId.current);
                        const b = ordered.indexOf(qid);
                        if (a >= 0 && b >= 0) {
                          const [lo, hi] = a < b ? [a, b] : [b, a];
                          setSelected((prev) => {
                            const next = new Set(prev);
                            for (let k = lo; k <= hi; k++) {
                              const rid = ordered[k]!;
                              if (on) next.add(rid);
                              else next.delete(rid);
                            }
                            return next;
                          });
                          return;
                        }
                      }
                      qAnchorId.current = qid;
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (on) next.add(qid);
                        else next.delete(qid);
                        return next;
                      });
                    }}
                    onChange={(e) => {
                      qAnchorId.current = qid;
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(qid);
                        else next.delete(qid);
                        return next;
                      });
                    }}
                  />
                </label>
                <span className="title">
                  [{String(q.type)}] {String(q.title)}
                  {q.deletedAt ? ` · ${String(q.deletedAt).slice(0, 19)}` : ''}
                  {daysLabel ? (
                    <span
                      className={`days-left${isRecycleUrgent(days) ? ' days-left-urgent' : ''}`}
                      data-testid={RECYCLE_DAYS_LEFT_TESTID}
                    >
                      {' '}
                      · {daysLabel}
                    </span>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      </div>
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
  const [sessionId, setSessionId] = useState('');
  const [format, setFormat] = useState<'csv' | 'xlsx'>('csv');
  const [sessions, setSessions] = useState<
    Array<{ id: string; startAt: string; status: string; mode: string }>
  >([]);
  const [exportMsg, setExportMsg] = useState('');
  const [stats, setStats] = useState<{
    sessionCount: number;
    classAttendanceRate: number;
    items: Array<{ displayName: string; studentNo: string | null; presentCount: number; attendanceRate: number }>;
  } | null>(null);

  async function load() {
    const q = new URLSearchParams({ classId, month });
    if (sessionId) q.set('sessionId', sessionId);
    const r = await api<{
      sessionCount: number;
      classAttendanceRate: number;
      items: Array<{ displayName: string; studentNo: string | null; presentCount: number; attendanceRate: number }>;
    }>(`/api/v1/attendance/stats?${q}`);
    setStats(r);
  }

  async function loadSessions() {
    const r = await api<{ items: Array<{ id: string; startAt: string; status: string; mode: string }> }>(
      `/api/v1/attendance/sessions?classId=${encodeURIComponent(classId)}`,
    );
    setSessions(r.items ?? []);
  }

  async function download(kind: 'detail' | 'summary') {
    setExportMsg('');
    const token = getToken();
    const q = new URLSearchParams({
      month,
      classId,
      format,
    });
    if (sessionId) q.set('sessionId', sessionId);
    const path =
      kind === 'detail'
        ? `/api/v1/exports/attendance?${q}`
        : `/api/v1/exports/attendance-summary?${q}`;
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error(`导出失败 HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const tag = sessionId ? `session-${sessionId.slice(0, 8)}` : month;
      a.download = `${kind === 'detail' ? 'attendance' : 'attendance-summary'}-${tag}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      setExportMsg(`已下载 ${a.download}`);
    } catch (e) {
      setExportMsg(e instanceof Error ? e.message : '导出失败');
    }
  }

  async function downloadAbsent() {
    setExportMsg('');
    if (!sessionId) {
      setExportMsg('请先选择单场课次再导出缺勤名单');
      return;
    }
    const token = getToken();
    const q = new URLSearchParams({ classId, sessionId, format });
    try {
      const res = await fetch(`${API_BASE}/api/v1/exports/attendance-absent?${q}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error(`导出失败 HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attendance-absent-${sessionId.slice(0, 8)}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      setExportMsg(`已下载 ${a.download}`);
    } catch (e) {
      setExportMsg(e instanceof Error ? e.message : '导出失败');
    }
  }

  useEffect(() => {
    void loadSessions().catch(() => setSessions([]));
  }, [classId]);

  useEffect(() => {
    void load().catch(() => setStats(null));
  }, [classId, month, sessionId]);

  return (
    <section>
      <h2>出勤报表</h2>
      <p className="hint">
        按教师机本地时区自然月统计（非 UTC）。选课次后表格与导出一并按该场重算。
      </p>
      <div className="row">
        <label>
          月份
          <input value={month} onChange={(e) => setMonth(e.target.value)} placeholder="YYYY-MM" />
        </label>
        <label>
          课次
          <select value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
            <option value="">整月全部课次</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {new Date(s.startAt).toLocaleString()} · {s.status} · {s.mode}
              </option>
            ))}
          </select>
        </label>
        <label>
          导出格式
          <select value={format} onChange={(e) => setFormat(e.target.value as 'csv' | 'xlsx')}>
            <option value="csv">CSV</option>
            <option value="xlsx">Excel (.xlsx)</option>
          </select>
        </label>
      </div>
      <div className="row">
        <button type="button" onClick={() => void load()}>
          刷新
        </button>
        <button type="button" className="secondary" onClick={() => void download('detail')}>
          导出明细
        </button>
        <button type="button" className="secondary" onClick={() => void download('summary')}>
          导出汇总
        </button>
        <button
          type="button"
          className="secondary"
          disabled={!sessionId}
          title={sessionId ? '导出本场缺勤名单' : '请先选择单场课次'}
          onClick={() => void downloadAbsent()}
        >
          本场缺勤名单
        </button>
      </div>
      {exportMsg ? <p className="hint">{exportMsg}</p> : null}
      {stats ? (
        <>
          <p>
            {sessionId ? '本场' : '本月'}场次 {stats.sessionCount} · 班级出勤率{' '}
            {(stats.classAttendanceRate * 100).toFixed(1)}%
            {sessionId ? ' · 表格已按单场重算' : ''}
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>学号</th>
                <th>姓名</th>
                <th>{sessionId ? '本场出勤' : '出勤次数'}</th>
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
          出勤明细
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
          出勤汇总
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
  const [quizConfirmOn, setQuizConfirmOn] = useState(true);
  const [backupInfo, setBackupInfo] = useState<{
    dir?: string;
    keep?: number;
    latestAt: string | null;
    ageHours: number | null;
    lastError: { at?: string; message?: string } | null;
    lastAutoBackupAt: string | null;
  } | null>(null);
  const [backupMsg, setBackupMsg] = useState('');
  const [exitAllowed, setExitAllowed] = useState(false);
  const [exitUnlockUntil, setExitUnlockUntil] = useState<string | null>(null);
  const [hasExitCode, setHasExitCode] = useState(false);
  const [exitMinutes, setExitMinutes] = useState(15);
  const [exitCodeDraft, setExitCodeDraft] = useState('');
  const [exitMsg, setExitMsg] = useState('');
  const [exitEvents, setExitEvents] = useState<
    Array<{ id: string; kind: string; detail: string; createdAt: string; actorRole?: string | null }>
  >([]);
  const [exitEventsTotal, setExitEventsTotal] = useState(0);
  const [exitEventsPage, setExitEventsPage] = useState(0);
  const EXIT_PAGE_SIZE = 15;
  const [exitKindFilter, setExitKindFilter] = useState('');
  const [showExitHelp, setShowExitHelp] = useState(false);
  const [maxFails, setMaxFails] = useState(5);
  const [windowMin, setWindowMin] = useState(15);
  const [lockoutMin, setLockoutMin] = useState(15);
  const [rotateDays, setRotateDays] = useState(90);
  const [codeAgeDays, setCodeAgeDays] = useState<number | null>(null);
  const [codeRotationDue, setCodeRotationDue] = useState(false);
  const [auditItems, setAuditItems] = useState<
    Array<{
      id: string;
      action: string;
      actorRole?: string | null;
      detail: string;
      createdAt: string;
      classId?: string | null;
    }>
  >([]);
  const [auditActions, setAuditActions] = useState<string[]>([]);
  const [auditClassId, setAuditClassId] = useState('');
  const [auditAction, setAuditAction] = useState('');
  const [auditClasses, setAuditClasses] = useState<ClassItem[]>([]);
  const [asstUser, setAsstUser] = useState('');
  const [asstPass, setAsstPass] = useState('');
  const [asstName, setAsstName] = useState('助教');
  const [asstMsg, setAsstMsg] = useState('');
  const [assistants, setAssistants] = useState<
    Array<{
      id: string;
      username: string;
      displayName: string;
      createdAt: string;
      disabledAt?: string | null;
    }>
  >([]);
  const [resetPwdDraft, setResetPwdDraft] = useState<Record<string, string>>({});
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [weakPasswords, setWeakPasswords] = useState<Set<string>>(() => new Set());
  const [weakExtraDraft, setWeakExtraDraft] = useState('');
  const [readonlyAfterMins, setReadonlyAfterMins] = useState(5);
  const [backupDirPath, setBackupDirPath] = useState('');
  const [recycleDays, setRecycleDays] = useState(30);
  const [restoreFile, setRestoreFile] = useState('');
  const [restorePass, setRestorePass] = useState('');
  const [restoreChecklist, setRestoreChecklist] = useState<string[]>([]);
  const [restoreSha, setRestoreSha] = useState('');
  const [restoreConfirmCode, setRestoreConfirmCode] = useState('');
  const [restoreConfirmInput, setRestoreConfirmInput] = useState('');
  const [upgradeMsg, setUpgradeMsg] = useState('');
  const [upgradeFiles, setUpgradeFiles] = useState<string[]>([]);
  const [grantEditId, setGrantEditId] = useState<string | null>(null);
  const [grantRows, setGrantRows] = useState<
    Array<{ classId: string; name: string; canExport: boolean; canAwardPoints: boolean }>
  >([]);
  const [grantMsg, setGrantMsg] = useState('');

  async function loadAudit() {
    const q = new URLSearchParams({ limit: '80' });
    if (auditClassId) q.set('classId', auditClassId);
    if (auditAction) q.set('action', auditAction);
    const r = await api<{ items: typeof auditItems; actions?: string[] }>(`/api/v1/audit?${q}`);
    setAuditItems(r.items ?? []);
    if (r.actions) setAuditActions(r.actions);
  }

  async function loadAssistants() {
    const r = await api<{ items: typeof assistants }>('/api/v1/auth/assistants');
    setAssistants(r.items ?? []);
  }

  async function refreshExitLock() {
    const s = await api<{
      pointRequestTtlMinutes: number;
      messagesEnabled?: boolean;
      quizConfirmSubmit?: boolean;
      liveboardReadonlyAfterMinutes?: number;
      weakTeacherPasswordsExtra?: string[];
      recycleRetentionDays?: number;
      clientExitAllowed?: boolean;
      clientExitUnlockUntil?: string | null;
      hasExitUnlockCode?: boolean;
      exitUnlockMaxFails?: number;
      exitUnlockWindowMinutes?: number;
      exitUnlockLockoutMinutes?: number;
      exitUnlockCodeRotateDays?: number;
      exitUnlockCodeAgeDays?: number | null;
      exitUnlockCodeRotationDue?: boolean;
      backup?: {
        dir?: string;
        keep?: number;
        latestAt: string | null;
        ageHours: number | null;
        lastError: { at?: string; message?: string } | null;
        lastAutoBackupAt: string | null;
      };
    }>('/api/v1/settings');
    setTtl(s.pointRequestTtlMinutes);
    setMessagesOn(s.messagesEnabled !== false);
    setQuizConfirmOn(s.quizConfirmSubmit !== false);
    if (s.liveboardReadonlyAfterMinutes != null) {
      setReadonlyAfterMins(Number(s.liveboardReadonlyAfterMinutes) || 0);
    }
    if (s.recycleRetentionDays != null && Number.isFinite(Number(s.recycleRetentionDays))) {
      setRecycleDays(Number(s.recycleRetentionDays));
    }
    if (Array.isArray(s.weakTeacherPasswordsExtra)) {
      setWeakExtraDraft(s.weakTeacherPasswordsExtra.join('\n'));
    }
    if (s.backup) {
      setBackupInfo(s.backup);
      if (s.backup.dir) setBackupDirPath(s.backup.dir);
    }
    setExitAllowed(s.clientExitAllowed === true);
    setExitUnlockUntil(s.clientExitUnlockUntil ?? null);
    setHasExitCode(s.hasExitUnlockCode === true);
    setMaxFails(s.exitUnlockMaxFails ?? 5);
    setWindowMin(s.exitUnlockWindowMinutes ?? 15);
    setLockoutMin(s.exitUnlockLockoutMinutes ?? 15);
    setRotateDays(s.exitUnlockCodeRotateDays ?? 90);
    setCodeAgeDays(s.exitUnlockCodeAgeDays ?? null);
    setCodeRotationDue(s.exitUnlockCodeRotationDue === true);
    const q = new URLSearchParams({
      limit: String(EXIT_PAGE_SIZE),
      offset: String(exitEventsPage * EXIT_PAGE_SIZE),
    });
    if (exitKindFilter) q.set('kind', exitKindFilter);
    const ev = await api<{
      items: Array<{ id: string; kind: string; detail: string; createdAt: string; actorRole?: string | null }>;
      total?: number;
    }>(`/api/v1/settings/exit-lock-events?${q}`);
    setExitEvents(ev.items ?? []);
    setExitEventsTotal(Number(ev.total ?? ev.items?.length ?? 0));
  }

  function exitLockKindLabel(kind: string): string {
    const map: Record<string, string> = {
      batch_unlock: '批量解除',
      relock: '重新锁定',
      unlock_flag_off: '关闭锁定标志',
      code_ok: '解除码成功',
      code_fail: '解除码失败',
      code_rate_limited: '解除码限流',
      code_set: '首次设置解除码',
      code_rotated: '轮换解除码',
      rate_config: '限流/轮换配置',
    };
    return map[kind] ? `${map[kind]}（${kind}）` : kind;
  }

  async function exportExitLockCsv(opts: { limit: number; offset: number; filename: string }) {
    const token = getToken() || '';
    const q = new URLSearchParams({
      limit: String(opts.limit),
      offset: String(opts.offset),
    });
    if (exitKindFilter) q.set('kind', exitKindFilter);
    const res = await fetch(`${API_BASE}/api/v1/settings/exit-lock-events.csv?${q}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      setExitMsg(`导出失败 HTTP ${res.status}`);
      return;
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = opts.filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  useEffect(() => {
    void refreshExitLock().catch(() => undefined);
    void loadAudit().catch(() => setAuditItems([]));
    void loadAssistants().catch(() => setAssistants([]));
    void api<{ items: ClassItem[] }>('/api/v1/classes')
      .then((r) => setAuditClasses(r.items ?? []))
      .catch(() => setAuditClasses([]));
    void api<{ weakPasswords?: string[] }>('/api/v1/auth/password-policy')
      .then((r) => setWeakPasswords(new Set(r.weakPasswords ?? [])))
      .catch(() => setWeakPasswords(new Set()));
    void api<{ files?: Array<{ name: string } | string> }>('/api/v1/upgrades')
      .then((r) =>
        setUpgradeFiles(
          (r.files ?? []).map((f) => (typeof f === 'string' ? f : f.name)).filter(Boolean),
        ),
      )
      .catch(() => setUpgradeFiles([]));
    const poll = window.setInterval(() => {
      void loadAssistants().catch(() => undefined);
    }, 5_000);
    return () => window.clearInterval(poll);
  }, [exitKindFilter, exitEventsPage]);

  async function openAssistantGrants(assistantId: string) {
    setGrantEditId(assistantId);
    setGrantMsg('');
    const [gr, classes] = await Promise.all([
      api<{ items: Array<{ classId: string; canExport: number | boolean; canAwardPoints: number | boolean }> }>(
        `/api/v1/auth/assistants/${assistantId}/grants`,
      ),
      api<{ items: ClassItem[] }>('/api/v1/classes'),
    ]);
    const byId = new Map(
      (gr.items ?? []).map((g) => [
        g.classId,
        {
          canExport: Boolean(g.canExport),
          canAwardPoints: Boolean(g.canAwardPoints),
        },
      ]),
    );
    setGrantRows(
      (classes.items ?? []).map((c) => ({
        classId: c.id,
        name: c.name,
        canExport: byId.get(c.id)?.canExport ?? false,
        canAwardPoints: byId.get(c.id)?.canAwardPoints ?? false,
      })),
    );
  }

  async function saveAssistantGrants() {
    if (!grantEditId) return;
    const grants = grantRows
      .filter((r) => r.canExport || r.canAwardPoints)
      .map((r) => ({
        classId: r.classId,
        canExport: r.canExport,
        canAwardPoints: r.canAwardPoints,
      }));
    await api(`/api/v1/auth/assistants/${grantEditId}/grants`, {
      method: 'PUT',
      body: JSON.stringify({ grants }),
    });
    setGrantMsg(
      grants.length === 0
        ? '已清空按班授权（助教恢复全局只读导出）'
        : `已保存 ${grants.length} 个班级授权`,
    );
  }

  useEffect(() => {
    void loadAudit().catch(() => undefined);
  }, [auditClassId, auditAction]);

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
        audit?: { lastError?: { message?: string } | null };
      };
      const err = body.backup?.lastError;
      const auditErr = body.audit?.lastError;
      setDiag(
        body.ok
          ? `正常 ${ms}ms · LAN ${body.lanIps?.join(', ') || '—'} · ${body.suggestedApiBase ?? ''}${
              err ? ` · backupError：${err.message ?? JSON.stringify(err)}` : ''
            }${auditErr ? ` · auditError：${auditErr.message}` : ' · 无 lastError'}`
          : `失败 HTTP ${res.status}${auditErr ? ` · audit：${auditErr.message}` : ''}${
              err ? ` · backup：${err.message}` : ''
            }`,
      );
    } catch (e) {
      setDiag(e instanceof Error ? e.message : 'network_error');
    }
  }

  const pwdWeakExact = weakPasswords.size > 0 && weakPasswords.has(newPwd);
  const pwdTooShort = newPwd.length > 0 && newPwd.length < 8;
  const pwdNeedMixed =
    newPwd.length >= 8 && (!/[A-Za-z]/.test(newPwd) || !/[0-9]/.test(newPwd));
  const pwdOk = newPwd.length >= 8 && /[A-Za-z]/.test(newPwd) && /[0-9]/.test(newPwd) && !pwdWeakExact;
  const pwdHint =
    newPwd.length === 0
      ? '至少 8 位，须含字母与数字；弱口令列表与服务端一致（/api/v1/auth/password-policy）'
      : pwdWeakExact
        ? '不可使用常见联调/弱口令，请换个人密码'
        : pwdTooShort
          ? `还差 ${8 - newPwd.length} 个字符（至少 8 位）`
          : pwdNeedMixed
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
      <p className={pwdWeakExact || pwdTooShort || pwdNeedMixed ? 'error' : 'hint'}>{pwdHint}</p>
      {newPwd.length > 0 ? (
        <div className="pwd-meter" aria-hidden>
          <span className={newPwd.length >= 8 ? 'on' : ''} />
          <span className={/[A-Za-z]/.test(newPwd) && /[0-9]/.test(newPwd) ? 'on' : ''} />
          <span className={pwdOk ? 'on' : ''} />
        </div>
      ) : null}
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
        disabled={!curPwd || !pwdOk}
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
          {!isAssistant() ? (
          <>
          <h3>数据库备份</h3>
          <p className="hint">
            {backupInfo
              ? `目录：${backupInfo.dir ?? '—'} · 保留最新 ${backupInfo.keep ?? '—'} 份 · 上次成功：${
                  backupInfo.latestAt
                    ? new Date(backupInfo.latestAt).toLocaleString()
                    : '尚无'
                }${
                  backupInfo.ageHours != null ? `（${backupInfo.ageHours} 小时前）` : ''
                }${
                  backupInfo.lastError?.message
                    ? ` · 失败原因：${backupInfo.lastError.message}${
                        backupInfo.lastError.at
                          ? ` @ ${new Date(backupInfo.lastError.at).toLocaleString()}`
                          : ''
                      }`
                    : ' · 无失败记录'
                }`
              : '加载备份状态…'}
          </p>
          <p className="hint">
            可用环境变量 <code>CLASSROOM_DESK_BACKUP_DIR</code> / <code>CLASSROOM_DESK_BACKUP_KEEP</code> 调整路径与保留份数。说明见仓库{' '}
            <code>docs/EXIT_LOCK_MDM.md</code>（备份段落）与 <code>npm run backup:db</code>。
          </p>
          <div className="row">
            <button
              type="button"
              className="secondary"
              onClick={() =>
                void api<{
                  ok?: boolean;
                  error?: string;
                  dir?: string;
                  keep?: number;
                  latestAt?: string | null;
                  ageHours?: number | null;
                  lastError?: { at?: string; message?: string } | null;
                  lastAutoBackupAt?: string | null;
                }>('/api/v1/settings/backup-now', { method: 'POST', body: '{}' })
                  .then((r) => {
                    setBackupInfo({
                      dir: r.dir,
                      keep: r.keep,
                      latestAt: r.latestAt ?? null,
                      ageHours: r.ageHours ?? null,
                      lastError: r.lastError ?? null,
                      lastAutoBackupAt: r.lastAutoBackupAt ?? null,
                    });
                    setBackupMsg(r.ok ? '备份成功' : r.error ?? '备份失败');
                  })
                  .catch((e) => setBackupMsg(e instanceof Error ? e.message : '备份失败'))
              }
            >
              立即备份
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                void api<{
                  ok?: boolean;
                  dir?: string;
                  opened?: boolean;
                  message?: string;
                }>('/api/v1/settings/backup-open-dir', { method: 'POST', body: '{}' })
                  .then((r) => {
                    if (r.dir) {
                      setBackupDirPath(r.dir);
                      setBackupInfo((prev) =>
                        prev
                          ? { ...prev, dir: r.dir }
                          : {
                              dir: r.dir,
                              keep: undefined,
                              latestAt: null,
                              ageHours: null,
                              lastError: null,
                              lastAutoBackupAt: null,
                            },
                      );
                    }
                    if (r.opened) {
                      setBackupMsg(`已在教师机打开备份目录：${r.dir ?? ''}`);
                    } else {
                      setBackupMsg(
                        r.dir
                          ? `备份目录：${r.dir}${r.message ? `（${r.message}）` : '（无图形环境）'} — 可用「复制路径」`
                          : r.message ?? '无法读取备份目录',
                      );
                    }
                  })
                  .catch((e) => setBackupMsg(e instanceof Error ? e.message : '打开失败'))
              }
            >
              显示备份目录
            </button>
            <button
              type="button"
              className="secondary"
              disabled={!backupDirPath && !backupInfo?.dir}
              onClick={() => {
                const dir = backupDirPath || backupInfo?.dir || '';
                if (!dir) {
                  setBackupMsg('尚无备份目录路径');
                  return;
                }
                void navigator.clipboard
                  .writeText(dir)
                  .then(() => setBackupMsg(`已复制路径：${dir}`))
                  .catch(() => {
                    window.prompt('复制备份目录路径', dir);
                    setBackupMsg(`路径：${dir}`);
                  });
              }}
            >
              复制路径
            </button>
          </div>
          {backupMsg ? <p className="hint">{backupMsg}</p> : null}

          <h3>弱口令扩展列表</h3>
          <p className="hint">每行一条；与内置联调口令合并后用于改密校验（单一策略数据源）。</p>
          <label>
            额外弱口令
            <textarea
              rows={4}
              value={weakExtraDraft}
              onChange={(e) => setWeakExtraDraft(e.target.value)}
              placeholder={'SchoolDemo1\nTempPass2026'}
            />
          </label>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              const list = weakExtraDraft
                .split(/\r?\n/)
                .map((s) => s.trim())
                .filter(Boolean);
              void api('/api/v1/settings', {
                method: 'PATCH',
                body: JSON.stringify({ weakTeacherPasswordsExtra: list }),
              })
                .then(() =>
                  api<{ weakPasswords?: string[] }>('/api/v1/auth/password-policy').then((r) => {
                    setWeakPasswords(new Set(r.weakPasswords ?? []));
                    setSaveMsg(`已保存扩展弱口令 ${list.length} 条（合计策略 ${(r.weakPasswords ?? []).length}）`);
                  }),
                )
                .catch((e) => setSaveMsg(e instanceof Error ? e.message : '保存失败'));
            }}
          >
            保存弱口令扩展
          </button>

          <h3>数据保留 / 备份加密</h3>
          <p className="hint">
            回收站按 recycle_retention_days 自动 purge；也可手动立即清理。备份 AES 口令生成 .enc。
          </p>
          <label>
            回收站保留天数
            <input
              type="number"
              min={1}
              max={365}
              value={recycleDays}
              onChange={(e) => setRecycleDays(Number(e.target.value) || 1)}
              onBlur={() => {
                const days = Math.max(1, Math.min(365, Math.trunc(recycleDays) || 30));
                setRecycleDays(days);
                void api('/api/v1/settings', {
                  method: 'PATCH',
                  body: JSON.stringify({ recycleRetentionDays: days }),
                })
                  .then(() => setSaveMsg(`回收站保留 ${days} 天（调度按此 purge）`))
                  .catch((err) => setSaveMsg(err instanceof Error ? err.message : '保存失败'));
              }}
            />
          </label>
          <div className="row">
            <button
              type="button"
              className="secondary"
              onClick={() =>
                void api<{ message?: string; students?: number; questions?: number }>(
                  '/api/v1/settings/recycle-purge-now',
                  { method: 'POST', body: JSON.stringify({ dryRun: true }) },
                )
                  .then((r) => setSaveMsg(r.message ?? `预览 学生${r.students} 题目${r.questions}`))
                  .catch((e) => setSaveMsg(e instanceof Error ? e.message : '预览失败'))
              }
            >
              预览将 purge 数量
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                void api<{ message?: string; students?: number; questions?: number }>(
                  '/api/v1/settings/recycle-purge-now',
                  { method: 'POST', body: JSON.stringify({ dryRun: true }) },
                )
                  .then((preview) => {
                    if (
                      !window.confirm(
                        `${preview.message ?? `将删学生 ${preview.students} · 题目 ${preview.questions}`}\n确认执行硬删？`,
                      )
                    ) {
                      return;
                    }
                    return api<{ message?: string; students?: number; questions?: number }>(
                      '/api/v1/settings/recycle-purge-now',
                      { method: 'POST', body: JSON.stringify({ dryRun: false }) },
                    ).then((r) =>
                      setSaveMsg(r.message ?? `已清理 学生${r.students} 题目${r.questions}`),
                    );
                  })
                  .catch((e) => setSaveMsg(e instanceof Error ? e.message : '清理失败'));
              }}
            >
              预览后执行 purge
            </button>
          </div>
          <label>
            备份加密口令（可留空）
            <input
              type="password"
              value={restorePass}
              onChange={(e) => setRestorePass(e.target.value)}
              autoComplete="new-password"
              placeholder="设置后立即备份将额外写 .enc"
            />
          </label>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              void api('/api/v1/settings', {
                method: 'PATCH',
                body: JSON.stringify({ backupEncryptPassphrase: restorePass }),
              })
                .then(() => setSaveMsg(restorePass ? '已保存备份加密口令' : '已清空备份加密口令'))
                .catch((e) => setSaveMsg(e instanceof Error ? e.message : '保存失败'));
            }}
          >
            保存备份口令
          </button>

          <h3>备份恢复向导</h3>
          <p className="hint">先解密/校验哈希并查看停服清单；确认后再 commit 替换 live DB（会先写 .pre-restore-*）。</p>
          <label>
            备份文件名（backups 目录下 .enc / .db）
            <input
              value={restoreFile}
              onChange={(e) => setRestoreFile(e.target.value)}
              placeholder="classroom-….db.enc"
            />
          </label>
          <div className="row">
            <button
              type="button"
              className="secondary"
              onClick={() => {
                void api<{
                  restoredPath?: string;
                  message?: string;
                  sha256?: string;
                  checklist?: string[];
                  confirmCode?: string;
                }>('/api/v1/settings/backup-restore-preview', {
                  method: 'POST',
                  body: JSON.stringify({
                    fileName: restoreFile,
                    passphrase: restorePass,
                    commit: false,
                  }),
                })
                  .then((r) => {
                    setRestoreChecklist(r.checklist ?? []);
                    setRestoreSha(r.sha256 ?? '');
                    setRestoreConfirmCode(r.confirmCode ?? '');
                    setRestoreConfirmInput('');
                    setBackupMsg(
                      r.message
                        ? `${r.message}${r.confirmCode ? ` · 确认码 ${r.confirmCode}` : ''} → ${r.restoredPath}`
                        : '已准备',
                    );
                  })
                  .catch((e) => setBackupMsg(e instanceof Error ? e.message : '恢复失败'));
              }}
            >
              1. 校验哈希 + 停服清单
            </button>
            <button
              type="button"
              disabled={!restoreSha || restoreConfirmInput.trim().length < 6}
              onClick={() => {
                if (
                  !window.confirm(
                    `确认用校验文件替换 live DB？\nsha256=${restoreSha}\n请确保已停服或即将重启。`,
                  )
                ) {
                  return;
                }
                void api<{ message?: string; sha256?: string; checklist?: string[] }>(
                  '/api/v1/settings/backup-restore-preview',
                  {
                    method: 'POST',
                    body: JSON.stringify({
                      fileName: restoreFile,
                      passphrase: restorePass,
                      commit: true,
                      confirmCode: restoreConfirmInput.trim(),
                    }),
                  },
                )
                  .then((r) => {
                    setRestoreChecklist(r.checklist ?? []);
                    setRestoreSha(r.sha256 ?? restoreSha);
                    setRestoreConfirmCode('');
                    setRestoreConfirmInput('');
                    setBackupMsg(r.message ?? '已替换 live DB，请重启服务');
                  })
                  .catch((e) => setBackupMsg(e instanceof Error ? e.message : '替换失败'));
              }}
            >
              2. 输入确认码后替换 live DB
            </button>
          </div>
          {restoreSha ? <p className="hint">sha256={restoreSha}</p> : null}
          {restoreConfirmCode ? (
            <label>
              二次确认码（校验步骤下发，10 分钟有效）
              <input
                value={restoreConfirmInput}
                onChange={(e) => setRestoreConfirmInput(e.target.value)}
                placeholder={restoreConfirmCode}
                autoComplete="one-time-code"
              />
            </label>
          ) : null}
          {restoreChecklist.length ? (
            <ol className="hint">
              {restoreChecklist.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          ) : null}

          <h3>LAN 升级包（Setup.exe）</h3>
          <p className="hint">上传到服务器 /upgrades；.exe 自动配对生成 .sha256。</p>
          <label className="secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            上传 Setup.exe
            <input
              type="file"
              accept=".exe,.sha256,.json,application/octet-stream"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                const fd = new FormData();
                fd.append('file', file);
                const token = getToken();
                void fetch(`${API_BASE}/api/v1/upgrades`, {
                  method: 'POST',
                  headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                  body: fd,
                })
                  .then(async (res) => {
                    const body = (await res.json().catch(() => ({}))) as {
                      message?: string;
                      name?: string;
                      sha256Name?: string | null;
                      error?: string;
                    };
                    if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
                    setUpgradeMsg(
                      body.sha256Name
                        ? `已上传 ${body.name}，并生成 ${body.sha256Name}`
                        : `已上传 ${body.name ?? file.name}`,
                    );
                    return api<{ files?: Array<{ name: string } | string> }>('/api/v1/upgrades');
                  })
                  .then((r) =>
                    setUpgradeFiles(
                      (r.files ?? []).map((f) => (typeof f === 'string' ? f : f.name)).filter(Boolean),
                    ),
                  )
                  .catch((err) => setUpgradeMsg(err instanceof Error ? err.message : '上传失败'));
              }}
            />
          </label>
          {upgradeMsg ? <p className="hint">{upgradeMsg}</p> : null}
          {upgradeFiles.length ? (
            <ul className="hint">
              {upgradeFiles.map((f) => (
                <li key={f} className="row">
                  <span>{f}</span>
                  {/\.exe$/i.test(f) ? (
                    <>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          void api<{ message?: string; match?: boolean | null }>(
                            '/api/v1/upgrades/verify-sha256',
                            { method: 'POST', body: JSON.stringify({ name: f }) },
                          )
                            .then((r) => setUpgradeMsg(r.message ?? '已校验'))
                            .catch((e) =>
                              setUpgradeMsg(e instanceof Error ? e.message : '校验失败'),
                            )
                        }
                      >
                        校验 sha256
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          if (!window.confirm(`删除 ${f}？`)) return;
                          void api(`/api/v1/upgrades/${encodeURIComponent(f)}`, {
                            method: 'DELETE',
                          })
                            .then(() =>
                              api<{ files?: Array<{ name: string } | string> }>('/api/v1/upgrades'),
                            )
                            .then((r) => {
                              setUpgradeFiles(
                                (r.files ?? [])
                                  .map((x) => (typeof x === 'string' ? x : x.name))
                                  .filter(Boolean),
                              );
                              setUpgradeMsg(`已删除 ${f}`);
                            })
                            .catch((e) =>
                              setUpgradeMsg(e instanceof Error ? e.message : '删除失败'),
                            );
                        }}
                      >
                        删除
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">尚无升级包</p>
          )}

          <h3>投影只读自动开启</h3>
          <p className="hint">按本场出勤课次 startAt 起算，N 分钟后投影自动只读。0 = 关闭。</p>
          <label>
            上课后分钟数
            <input
              type="number"
              min={0}
              max={240}
              value={readonlyAfterMins}
              onChange={(e) => setReadonlyAfterMins(Number(e.target.value))}
            />
          </label>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              void api('/api/v1/settings', {
                method: 'PATCH',
                body: JSON.stringify({ liveboardReadonlyAfterMinutes: readonlyAfterMins }),
              })
                .then(() => setSaveMsg(`投影只读自动开启已设为 ${readonlyAfterMins} 分钟`))
                .catch((e) => setSaveMsg(e instanceof Error ? e.message : '保存失败'))
            }
          >
            保存投影只读时长
          </button>
          {saveMsg ? <p className="hint">{saveMsg}</p> : null}

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

          <h3>答题确认</h3>
          <label className="row">
            <input
              type="checkbox"
              checked={quizConfirmOn}
              onChange={(e) =>
                void api('/api/v1/settings', {
                  method: 'PATCH',
                  body: JSON.stringify({ quizConfirmSubmit: e.target.checked }),
                })
                  .then(() => {
                    setQuizConfirmOn(e.target.checked);
                    setSaveMsg(
                      e.target.checked
                        ? '已开启：单选/判断需点「确认提交」'
                        : '已关闭：点选项即提交',
                    );
                  })
                  .catch((err) => setSaveMsg(err instanceof Error ? err.message : '保存失败'))
              }
            />
            单选/判断二次确认提交（默认开启）
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

          <h3 id="exit-lock-settings">学生端退出锁定</h3>
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
            {codeAgeDays != null ? ` · 解除码已使用 ${codeAgeDays} 天` : ''}
          </p>
          {codeRotationDue ? (
            <p className="error">解除码已超过轮换周期（{rotateDays} 天），请尽快更换。</p>
          ) : null}
          {isAssistant() ? (
            <p className="hint">助教可查看锁定状态与审计（只读）；批量解除 / 解除码轮换由教师操作。</p>
          ) : (
            <>
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

              <h4>解除码限流 / 轮换</h4>
              <div className="row">
                <label>
                  失败次数上限
                  <input
                    type="number"
                    min={3}
                    max={30}
                    value={maxFails}
                    onChange={(e) => setMaxFails(Number(e.target.value))}
                  />
                </label>
                <label>
                  统计窗口（分钟）
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={windowMin}
                    onChange={(e) => setWindowMin(Number(e.target.value))}
                  />
                </label>
                <label>
                  锁定时长（分钟）
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={lockoutMin}
                    onChange={(e) => setLockoutMin(Number(e.target.value))}
                  />
                </label>
                <label>
                  轮换提醒（天）
                  <input
                    type="number"
                    min={7}
                    max={365}
                    value={rotateDays}
                    onChange={(e) => setRotateDays(Number(e.target.value))}
                  />
                </label>
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  void api('/api/v1/settings', {
                    method: 'PATCH',
                    body: JSON.stringify({
                      exitUnlockMaxFails: maxFails,
                      exitUnlockWindowMinutes: windowMin,
                      exitUnlockLockoutMinutes: lockoutMin,
                      exitUnlockCodeRotateDays: rotateDays,
                    }),
                  })
                    .then(async () => {
                      setExitMsg('限流/轮换设置已保存');
                      await refreshExitLock().catch(() => undefined);
                    })
                    .catch((e) => setExitMsg(e instanceof Error ? e.message : '保存失败'))
                }
              >
                保存限流与轮换
              </button>
            </>
          )}

          <div className="card">
            <p className="hint">
              退出锁定审计（每页 {EXIT_PAGE_SIZE} 条）
              {isAssistant() ? ' · 助教只读' : ''}
            </p>
            <label>
              按类型筛选
              <select
                value={exitKindFilter}
                onChange={(e) => {
                  setExitEventsPage(0);
                  setExitKindFilter(e.target.value);
                }}
              >
                <option value="">全部</option>
                <option value="batch_unlock">批量解除</option>
                <option value="relock">重新锁定</option>
                <option value="code_ok">解除码成功</option>
                <option value="code_fail">解除码失败</option>
                <option value="code_rate_limited">解除码限流</option>
                <option value="code_set">首次设置解除码</option>
                <option value="code_rotated">轮换解除码</option>
                <option value="rate_config">限流/轮换配置</option>
              </select>
            </label>
            <div className="row">
              <button type="button" className="secondary" onClick={() => void refreshExitLock().catch(() => undefined)}>
                刷新审计
              </button>
              <button
                type="button"
                className="secondary"
                disabled={exitEventsPage <= 0}
                onClick={() => setExitEventsPage((p) => Math.max(0, p - 1))}
              >
                上一页
              </button>
              <button
                type="button"
                className="secondary"
                disabled={(exitEventsPage + 1) * EXIT_PAGE_SIZE >= exitEventsTotal}
                onClick={() => setExitEventsPage((p) => p + 1)}
              >
                下一页
              </button>
              <span className="hint">
                第 {exitEventsPage + 1} / {Math.max(1, Math.ceil(exitEventsTotal / EXIT_PAGE_SIZE))} 页 · 共{' '}
                {exitEventsTotal} 条
              </span>
              <button
                type="button"
                className="secondary"
                onClick={(e) => {
                  e.preventDefault();
                  void exportExitLockCsv({
                    limit: EXIT_PAGE_SIZE,
                    offset: exitEventsPage * EXIT_PAGE_SIZE,
                    filename: 'exit-lock-events-page.csv',
                  });
                }}
              >
                导出当前页 CSV
              </button>
              <button
                type="button"
                className="secondary"
                onClick={(e) => {
                  e.preventDefault();
                  const cap = 500;
                  if (exitEventsTotal > cap) {
                    const ok = window.confirm(
                      `当前筛选共 ${exitEventsTotal} 条，导出上限 ${cap} 条（按时间倒序最新）。\n是否继续导出截断结果？`,
                    );
                    if (!ok) return;
                  }
                  void exportExitLockCsv({
                    limit: Math.min(cap, Math.max(exitEventsTotal, 1)),
                    offset: 0,
                    filename: 'exit-lock-events-all.csv',
                  }).then(() => {
                    if (exitEventsTotal > cap) {
                      setExitMsg(`已导出全部 CSV（截断至 ${cap} / ${exitEventsTotal} 条）`);
                    }
                  });
                }}
              >
                导出全部 CSV
              </button>
            </div>
            <ul>
              {exitEvents.map((e) => (
                <li key={e.id}>
                  {new Date(e.createdAt).toLocaleString()} · {exitLockKindLabel(e.kind)}
                  {e.actorRole ? ` · ${e.actorRole}` : ''} · {e.detail}
                </li>
              ))}
            </ul>
            {!exitEvents.length ? <p className="hint">暂无记录</p> : null}
          </div>

          <div className="card">
            <button type="button" className="secondary" onClick={() => setShowExitHelp((v) => !v)}>
              {showExitHelp ? '收起帮助' : '帮助：锁定状态机'}
            </button>
            {showExitHelp ? (
              <div className="hint">
                <p>
                  完整说明（含 C2 手测表 / Assigned Access / Intune）：{' '}
                  <a
                    href="https://github.com/otas0/classroom-desk/blob/main/docs/EXIT_LOCK_MDM.md"
                    target="_blank"
                    rel="noreferrer"
                  >
                    docs/EXIT_LOCK_MDM.md
                  </a>
                </p>
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.45 }}>
                  {`默认 → [已锁定]
  │ 教师「批量允许关闭」(二次确认)
  ▼
[可退出 TimedOpen] ──时限到/重新锁定──▶ [已锁定]
  │
  │ 本机解除码成功 / 关窗
  ▼
[退出进程]

错码达上限 → [限流 RateLimited] → 窗口结束 → [已锁定]

mermaid（与文档同构）:
stateDiagram-v2
  [*] --> Locked
  Locked --> TimedOpen : 批量解除
  TimedOpen --> Locked : 到期/重新锁定
  Locked --> LocalExit : 解除码成功
  LocalExit --> [*]
  Locked --> RateLimited : 错码上限
  RateLimited --> Locked : 窗口结束`}
                </pre>
              </div>
            ) : null}
          </div>

          <div className="card">
            <h3>创建助教账号</h3>
            <p className="hint">助教可登录后台只读导出/出勤，不可批量删除。详见 docs/PERMISSIONS.md。</p>
            <label>
              用户名
              <input
                value={asstUser}
                onChange={(e) => setAsstUser(e.target.value)}
                placeholder="如 assistant1"
                autoComplete="off"
              />
            </label>
            <label>
              显示名
              <input value={asstName} onChange={(e) => setAsstName(e.target.value)} placeholder="助教" />
            </label>
            <label>
              初始口令
              <input
                type="password"
                value={asstPass}
                onChange={(e) => setAsstPass(e.target.value)}
                placeholder="至少 8 位，含字母数字"
                autoComplete="new-password"
              />
            </label>
            <button
              type="button"
              onClick={() =>
                void (async () => {
                  setAsstMsg('');
                  try {
                    const r = await api<{ message?: string }>('/api/v1/auth/assistants', {
                      method: 'POST',
                      body: JSON.stringify({
                        username: asstUser.trim(),
                        password: asstPass,
                        displayName: asstName.trim() || '助教',
                      }),
                    });
                    setAsstMsg(r.message ?? '已创建');
                    setAsstUser('');
                    setAsstPass('');
                    await loadAssistants();
                  } catch (e) {
                    setAsstMsg(e instanceof Error ? e.message : '创建失败');
                  }
                })()
              }
            >
              创建助教
            </button>
            {asstMsg ? <p className={/失败|错误|已存在/.test(asstMsg) ? 'error' : 'hint'}>{asstMsg}</p> : null}
            {assistants.length ? (
              <ul>
                {assistants.map((a) => (
                  <li key={a.id}>
                    {a.username} · {a.displayName}
                    {a.disabledAt ? ' · 已停用' : ''} · {new Date(a.createdAt).toLocaleString()}
                    <div className="row" style={{ marginTop: 4 }}>
                      {a.disabledAt ? (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() =>
                            void api(`/api/v1/auth/assistants/${a.id}/enable`, {
                              method: 'POST',
                              body: '{}',
                            })
                              .then(async () => {
                                setAsstMsg(`已启用 ${a.username}`);
                                await loadAssistants();
                              })
                              .catch((e) => setAsstMsg(e instanceof Error ? e.message : '启用失败'))
                          }
                        >
                          启用
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() =>
                            void api(`/api/v1/auth/assistants/${a.id}/disable`, {
                              method: 'POST',
                              body: '{}',
                            })
                              .then(async () => {
                                setAsstMsg(`已停用 ${a.username}`);
                                await loadAssistants();
                              })
                              .catch((e) => setAsstMsg(e instanceof Error ? e.message : '停用失败'))
                          }
                        >
                          停用
                        </button>
                      )}
                      <input
                        type="password"
                        placeholder="新口令"
                        value={resetPwdDraft[a.id] ?? ''}
                        onChange={(e) =>
                          setResetPwdDraft((prev) => ({ ...prev, [a.id]: e.target.value }))
                        }
                        style={{ width: '8rem' }}
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          void (async () => {
                            const password = (resetPwdDraft[a.id] ?? '').trim();
                            try {
                              const r = await api<{ message?: string }>(
                                `/api/v1/auth/assistants/${a.id}/reset-password`,
                                { method: 'POST', body: JSON.stringify({ password }) },
                              );
                              setAsstMsg(r.message ?? '已重置口令');
                              setResetPwdDraft((prev) => ({ ...prev, [a.id]: '' }));
                            } catch (e) {
                              setAsstMsg(e instanceof Error ? e.message : '重置失败');
                            }
                          })()
                        }
                      >
                        重置口令
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          void openAssistantGrants(a.id).catch((e) =>
                            setAsstMsg(e instanceof Error ? e.message : '加载授权失败'),
                          )
                        }
                      >
                        按班授权
                      </button>
                    </div>
                    {grantEditId === a.id ? (
                      <div style={{ marginTop: 8 }}>
                        <p className="hint">勾选「可导出 / 可加分」；全不勾 = 清空授权（全局只读导出）。</p>
                        {grantRows.length === 0 ? (
                          <p className="hint">尚无班级</p>
                        ) : (
                          <ul>
                            {grantRows.map((row) => (
                              <li key={row.classId} className="row">
                                <span style={{ minWidth: '8rem' }}>{row.name}</span>
                                <label className="row">
                                  <input
                                    type="checkbox"
                                    checked={row.canExport}
                                    onChange={(e) =>
                                      setGrantRows((prev) =>
                                        prev.map((x) =>
                                          x.classId === row.classId
                                            ? { ...x, canExport: e.target.checked }
                                            : x,
                                        ),
                                      )
                                    }
                                  />
                                  可导出
                                </label>
                                <label className="row">
                                  <input
                                    type="checkbox"
                                    checked={row.canAwardPoints}
                                    onChange={(e) =>
                                      setGrantRows((prev) =>
                                        prev.map((x) =>
                                          x.classId === row.classId
                                            ? { ...x, canAwardPoints: e.target.checked }
                                            : x,
                                        ),
                                      )
                                    }
                                  />
                                  可加分
                                </label>
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="row">
                          <button
                            type="button"
                            onClick={() =>
                              void saveAssistantGrants().catch((e) =>
                                setGrantMsg(e instanceof Error ? e.message : '保存失败'),
                              )
                            }
                          >
                            保存授权
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => {
                              setGrantEditId(null);
                              setGrantRows([]);
                              setGrantMsg('');
                            }}
                          >
                            关闭
                          </button>
                        </div>
                        {grantMsg ? <p className="hint">{grantMsg}</p> : null}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">尚无助教账号</p>
            )}
            <p className="hint">
              <a href={permissionsDocHref()} target="_blank" rel="noreferrer">
                权限说明（PERMISSIONS.md）
              </a>
            </p>
          </div>
          </>
          ) : (
            <p className="hint">
              助教可改本人密码、查看审计与导出；完整权限见{' '}
              <a href={permissionsDocHref()} target="_blank" rel="noreferrer" data-testid="permissions-doc-link">
                权限说明
              </a>
              。
            </p>
          )}

          <div className="card">
            <h3>操作审计（批量删除等）</h3>
            <div className="row">
              <label>
                班级
                <select value={auditClassId} onChange={(e) => setAuditClassId(e.target.value)}>
                  <option value="">全部班级</option>
                  {auditClasses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                操作类型
                <select value={auditAction} onChange={(e) => setAuditAction(e.target.value)}>
                  <option value="">全部类型</option>
                  {auditActions.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="row">
              <button type="button" className="secondary" onClick={() => void loadAudit().catch(() => undefined)}>
                刷新审计
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  void (async () => {
                    const q = new URLSearchParams({ format: 'csv', limit: '500' });
                    if (auditClassId) q.set('classId', auditClassId);
                    if (auditAction) q.set('action', auditAction);
                    const token = getToken() || '';
                    const res = await fetch(`${API_BASE}/api/v1/audit/export?${q}`, {
                      headers: token ? { Authorization: `Bearer ${token}` } : {},
                    });
                    if (!res.ok) return;
                    const blob = await res.blob();
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = 'audit.csv';
                    a.click();
                    URL.revokeObjectURL(a.href);
                  })()
                }
              >
                导出 CSV
              </button>
            </div>
            {auditItems.length === 0 ? <p className="hint">暂无审计记录</p> : null}
            <ul>
              {auditItems.map((a) => (
                <li key={a.id}>
                  {new Date(a.createdAt).toLocaleString()} · {a.action}
                  {a.actorRole ? ` · ${a.actorRole}` : ''}
                  {a.detail ? (
                    <>
                      {' · '}
                      <AuditDetail
                        detail={a.detail}
                        action={a.action}
                        onJumpIds={({ target, ids }) => {
                          if (a.classId) localStorage.setItem('cd_teacher_class_id', String(a.classId));
                          sessionStorage.setItem('cd_audit_jump_ids', JSON.stringify(ids));
                          hardReloadTeacherNav({ tab: 'prep', prepTab: target });
                        }}
                      />
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          {!isAssistant() ? (
            <p className="hint">
              数据库：服务进程每天自动备份一次（保留约 14 份）；也可手动 `npm run backup:db`。确认 /health 无
              backup/audit lastError。
              <a
                href={permissionsDocHref()}
                target="_blank"
                rel="noreferrer"
                data-testid="permissions-doc-link"
              >
                权限说明
              </a>
              。
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

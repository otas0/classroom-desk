import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type UIEvent,
} from 'react';
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
  RECYCLE_URGENT_DAYS,
  recycleDaysLeft,
} from './recycleRetention';
import { useToast } from './toast';
import { permissionsDocHref } from './permissionsHref';
import { useListSelection } from './useListSelection';
import { streamPurgeAll } from './ndjsonPurge';
import {
  consumeAuditJumpIds,
  consumeAuditJumpOpenRecycle,
  stashAuditJumpIds,
} from './auditJumpStorage';
import {
  IMPORT_ERROR_ZH,
  POINT_REASON_CHIPS,
  monthString,
  shiftMonth,
  type ClassItem,
} from './types';
import {
  UI_LOCALE_LABELS,
  UI_LOCALES,
  normalizeUiLocale,
  t, te,
  type UiLocale,
} from '@classroom-desk/i18n';
import { ClassroomLockBar } from './components/ClassroomLockBar';
import { DeepLockBar } from './components/DeepLockBar';
import { NetworkZonesPanel } from './components/NetworkZonesPanel';

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
  const [awardReason, setAwardReason] = useState(t('表扬'));
  const [awardMsg, setAwardMsg] = useState('');
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
  const [jumpIds, setJumpIds] = useState<Set<string>>(new Set());
  const [urgentDays, setUrgentDays] = useState(RECYCLE_URGENT_DAYS);
  const ROSTER_ROW_H = 44;
  const ROSTER_VIEW_H = 420;

  const filteredStudents = useMemo(() => {
    return [...students]
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
  }, [students, search]);

  const orderedRosterIds = useMemo(
    () => filteredStudents.map((s) => String(s.id)),
    [filteredStudents],
  );
  const {
    selected: selectedIds,
    setSelected: setSelectedIds,
    clear: clearRosterSelection,
    toggleOne: toggleRosterSelect,
    onKeyDown: onRosterKeyDown,
  } = useListSelection(orderedRosterIds);

  function ensureRosterVisible(index: number) {
    const top = index * ROSTER_ROW_H;
    const viewBottom = rosterScrollTop + ROSTER_VIEW_H;
    if (top < rosterScrollTop) setRosterScrollTop(Math.max(0, top - ROSTER_ROW_H));
    else if (top + ROSTER_ROW_H > viewBottom) {
      setRosterScrollTop(top + ROSTER_ROW_H - ROSTER_VIEW_H + ROSTER_ROW_H);
    }
  }

  async function loadStudents() {
    if (!classId) return;
    const r = await api<{ items: Array<Record<string, unknown>> }>(`/api/v1/classes/${classId}/students`);
    setStudents(r.items);
    clearRosterSelection();
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
      setImportResult(t('请填写姓名'));
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
      setImportResult(t('已添加 {v0}', { v0: displayName }));
      await loadStudents();
      onRosterChanged?.();
    } catch (e) {
      setImportResult(te(e, '添加失败'));
    }
  }

  function drawStudent() {
    const pool = filteredStudents;
    if (pool.length === 0) {
      setAwardMsg(t('名单为空，无法抽答'));
      return;
    }
    const row = pool[Math.floor(Math.random() * pool.length)]!;
    setPicked(row);
    setAwardMsg(t('抽到：{v0}', { v0: String(row.displayName) }));
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
          reasonSummary: awardReason.trim() || t('课堂抽答'),
        }),
      });
      setAwardMsg(
        t('已给 {v0} +{v1}（{v2}）', {
          v0: String(picked.displayName),
          v1: awardPts,
          v2: awardReason,
        }),
      );
      await loadStudents();
    } catch (e) {
      setAwardMsg(te(e, '加分失败'));
    }
  }

  useEffect(() => {
    void loadStudents().catch(() => setStudents([]));
    setShowRecycle(false);
    setRecycle([]);
    setRosterScrollTop(0);
    const ids = consumeAuditJumpIds();
    if (ids.length) setJumpIds(new Set(ids));
    if (consumeAuditJumpOpenRecycle()) {
      setShowRecycle(true);
      void loadRecycle().catch(() => setRecycle([]));
    }
    void api<{ recycleUrgentDays?: number }>('/api/v1/settings')
      .then((s) => {
        if (s.recycleUrgentDays != null) setUrgentDays(Number(s.recycleUrgentDays));
      })
      .catch(() => undefined);
  }, [classId]);

  const rosterVirtual = useMemo(() => {
    const start = Math.max(0, Math.floor(rosterScrollTop / ROSTER_ROW_H) - 4);
    const visible = Math.ceil(ROSTER_VIEW_H / ROSTER_ROW_H) + 8;
    const end = Math.min(filteredStudents.length, start + visible);
    return { start, end, totalH: filteredStudents.length * ROSTER_ROW_H };
  }, [filteredStudents.length, rosterScrollTop]);

  useEffect(() => {
    if (!jumpIds.size) return;
    if (showRecycle && recycle.length) {
      const first = recycle.findIndex((s) => jumpIds.has(String(s.id)));
      if (first >= 0) {
        const _cdTimer = window.setTimeout(() => {
          document
            .querySelector(`[data-row-id="${CSS.escape(String(recycle[first]!.id))}"]`)
            ?.scrollIntoView({ block: 'nearest' });
        }, 80);
        return () => window.clearTimeout(_cdTimer);
      }
    }
    const first = filteredStudents.findIndex((s) => jumpIds.has(String(s.id)));
    if (first < 0) return;
    setRosterScrollTop(Math.max(0, first * ROSTER_ROW_H - ROSTER_VIEW_H / 3));
    const _cdTimer = window.setTimeout(() => {
      document
        .querySelector(`[data-row-id="${CSS.escape(String(filteredStudents[first]!.id))}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    }, 80);
    return () => window.clearTimeout(_cdTimer);
  }, [jumpIds, filteredStudents, showRecycle, recycle]);

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
          `${err ? t('检测到备份异常。') : t('近 24 小时内未见备份。')}${t('导入前建议在教师机执行 npm run backup:db。')}\n${t('仍要继续导入吗？')}`,
        );
        if (!ok) return false;
      }
    } catch {
      const ok = window.confirm(t('无法确认备份状态。仍要继续导入吗？'));
      if (!ok) return false;
    }
    if (replaceRoster) {
      const n = students.length;
      return window.confirm(
        n > 0
          ? t('覆盖导入将清空本班现有 {v0} 名学生，再写入表格。此操作不可撤销，确定继续？', {
              v0: n,
            })
          : t('将按覆盖模式导入（当前班暂无学生）。确定继续？'),
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
      throw new Error(
        data.message ??
          (IMPORT_ERROR_ZH[data.error ?? ''] ? t(IMPORT_ERROR_ZH[data.error ?? '']) : undefined) ??
          data.error ??
          t('导入失败'),
      );
    }
    const fail = (data.failures ?? [])
      .map((f) =>
        t('第{v0}行 {v1} → {v2}', {
          v0: f.line,
          v1: f.name,
          v2: f.reasonText ?? f.reason,
        }),
      )
      .join('；');
    setImportResult(
      `${replaceRoster ? t('覆盖清除 {v0} 人后，', { v0: data.replaced ?? 0 }) : ''}${t('新建 {v0}，跳过 {v1}', {
        v0: data.created,
        v1: data.skipped,
      })}${fail ? t('。失败行：{v0}', { v0: fail }) : ''}`,
    );
    await loadStudents();
    onRosterChanged?.();
  }

  return (
    <section>
      <h2>{t('班级与名单')}</h2>
      {!allowWrite ? <p className="hint">{t('助教只读名单，不可创建班级/导入/加分/删人')}</p> : null}
      {allowWrite ? (
      <div className="row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('新班级名称')} />
        <button
          type="button"
          onClick={() =>
            void api('/api/v1/classes', { method: 'POST', body: JSON.stringify({ name }) }).then(() => {
              setName('');
              return onClasses();
            })
          }
        >
          {t('创建班级')}
        </button>
      </div>
      ) : null}

      {allowWrite ? (
      <>
      <h3>{t('单个新增')}</h3>
      <div className="row">
        <input
          value={newStudentName}
          onChange={(e) => setNewStudentName(e.target.value)}
          placeholder={t('姓名')}
        />
        <input
          value={newStudentNo}
          onChange={(e) => setNewStudentNo(e.target.value)}
          placeholder={t('学号（可选）')}
        />
        <button type="button" disabled={!classId} onClick={() => void addOneStudent()}>
          {t('添加学生')}
        </button>
      </div>

      <h3>{t('随机抽答 / 加分')}</h3>
      <div className="row">
        <button type="button" disabled={!classId} onClick={drawStudent}>
          {t('抽一人')}
        </button>
        <input
          type="number"
          min={1}
          value={awardPts}
          onChange={(e) => setAwardPts(Number(e.target.value) || 1)}
          style={{ width: 72 }}
        />
        <input value={awardReason} onChange={(e) => setAwardReason(e.target.value)} placeholder={t('理由')} />
        <button type="button" disabled={!picked} onClick={() => void awardPicked()}>
          {t('给抽中的人加分')}
        </button>
      </div>
      <div className="chip-row">
        {POINT_REASON_CHIPS.map((c) => (
          <button key={c} type="button" className="chip" onClick={() => setAwardReason(c)}>
            {t(c)}
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

      <h3>{t('批量导入（Excel / CSV）')}</h3>
      <p className="hint">
        支持 .xlsx / .xls / .csv。不必是「姓名,学号」逗号格式：自动识别「姓名/学号」表头、制表符、中文逗号、空格分隔，以及「学号在前/姓名在前」、Excel
        数字学号。无表头也会尝试拆分。
      </p>
      <label className="row">
        <input type="checkbox" checked={replaceRoster} onChange={(e) => setReplaceRoster(e.target.checked)} />
        {t('覆盖导入（先清空本班现有学生，再写入表格；请先 backup:db）')}
      </label>
      <label className="dropzone dropzone-wrap">
        <strong>{t('点击选择文件')}</strong>
        <p className="hint">{t('或拖入 Excel / CSV（真实上传到本班名单）')}</p>
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
        placeholder={t('可粘贴：姓名 学号 / 学号\t姓名 / 姓名，学号\n（任意常见分隔均可）')}
      />
      <button
        type="button"
        onClick={() => {
          if (!csv.trim()) {
            setImportResult(t('请粘贴真实名单，或使用上方文件上传'));
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
                .map((f) =>
                  t('第{v0}行 {v1} → {v2}', {
                    v0: f.line,
                    v1: f.name,
                    v2: f.reasonText ?? f.reason,
                  }),
                )
                .join('；');
              setImportResult(
                `${replaceRoster ? t('覆盖清除 {v0} 人后，', { v0: r.replaced ?? 0 }) : ''}${t('新建 {v0}，跳过 {v1}', {
                  v0: r.created,
                  v1: r.skipped,
                })}${fail ? t('。失败行：{v0}', { v0: fail }) : ''}`,
              );
              await loadStudents();
              onRosterChanged?.();
            } catch (err) {
              setImportResult(String(err instanceof Error ? err.message : err));
            }
          })();
        }}
      >
        {t('从文本导入 CSV')}
      </button>
      {importResult ? <p className={/失败|错误|无效|损坏/.test(importResult) ? 'error' : 'hint'}>{importResult}</p> : null}
      </>
      ) : null}

      <h3>当前班名单（{classes.find((c) => c.id === classId)?.name ?? ''}）· 按学号排序</h3>
      <p className="hint">
        可直接改姓名/学号并保存；勾选后可批量处理。删除先入回收站，{RECYCLE_RETENTION_DAYS}{' '}
        日内可恢复。
      </p>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('搜索姓名/学号')} />
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
          {t('全选当前列表（{v0}）', { v0: filteredStudents.length })}
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
                toast.ok(t('已导出选中 {v0} 人', { v0: selectedIds.size }));
              } catch (e) {
                toast.err(te(e, '导出失败'));
              } finally {
                setBulkBusy(false);
              }
            })()
          }
        >
          {t('导出选中')}
        </button>
        <input
          value={stuNoPrefix}
          onChange={(e) => setStuNoPrefix(e.target.value)}
          placeholder={t('学号前缀')}
          aria-label={t('学号前缀')}
          style={{ width: '7rem' }}
          disabled={!allowDelete}
        />
        <button
          type="button"
          className="secondary"
          disabled={bulkBusy || selectedIds.size === 0 || !allowDelete || !stuNoPrefix.trim()}
          onClick={() =>
            void (async () => {
              if (
                !window.confirm(
                  t('为选中的 {v0} 人学号加上前缀「{v1}」？', {
                    v0: selectedIds.size,
                    v1: stuNoPrefix.trim(),
                  }),
                )
              ) {
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
                toast.ok(r.message ?? t('已更新学号'));
                await loadStudents();
              } catch (e) {
                toast.err(te(e, '学号更新失败'));
              } finally {
                setBulkBusy(false);
              }
            })()
          }
        >
          {t('加前缀')}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={bulkBusy || selectedIds.size === 0 || !allowDelete}
          onClick={() =>
            void (async () => {
              if (!window.confirm(t('清空选中的 {v0} 人学号？', { v0: selectedIds.size }))) return;
              setBulkBusy(true);
              try {
                const r = await api<{ message?: string }>(
                  `/api/v1/classes/${classId}/students/bulk-student-no`,
                  {
                    method: 'POST',
                    body: JSON.stringify({ ids: [...selectedIds], action: 'clear' }),
                  },
                );
                toast.ok(r.message ?? t('已清空学号'));
                await loadStudents();
              } catch (e) {
                toast.err(te(e, '清空失败'));
              } finally {
                setBulkBusy(false);
              }
            })()
          }
        >
          {t('清空学号')}
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
                toast.err(te(e, '无法获取影响汇总'));
              } finally {
                setBulkBusy(false);
              }
            })()
          }
        >
          {t('批量删除（{v0}）', { v0: selectedIds.size })}
        </button>
        {!allowDelete ? <span className="hint">{t('助教不可批量删除/改学号')}</span> : null}
      </div>
      {selectedIds.size > 0 ? (
        <div className="selection-sticky" data-testid="roster-selection-sticky">
          {t('已选 {v0} 人 · Shift+点击连选 · ↑↓ / Space 多选', { v0: selectedIds.size })}
        </div>
      ) : null}
      <div className="row" style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>
        <span style={{ width: '2.5rem' }}>{t('选')}</span>
        <span style={{ flex: 1 }}>{t('学号')}</span>
        <span style={{ flex: 1.2 }}>{t('姓名')}</span>
        <span style={{ width: '4rem' }}>{t('积分')}</span>
        <span>{t('操作')}</span>
      </div>
      {filteredStudents.length === 0 ? <p className="hint">{t('暂无学生')}</p> : null}
      <div
        className="roster-virtual"
        style={{ height: ROSTER_VIEW_H }}
        data-testid="roster-virtual"
        tabIndex={0}
        role="listbox"
        aria-multiselectable
        aria-label={t('学生名单，可用方向键与空格多选')}
        onScroll={(e: UIEvent<HTMLDivElement>) => setRosterScrollTop(e.currentTarget.scrollTop)}
        onKeyDown={(e) =>
          onRosterKeyDown(e, { ensureVisible: (index) => ensureRosterVisible(index) })
        }
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
                jumpHighlight={jumpIds.has(String(s.id))}
                selected={selectedIds.has(String(s.id))}
                onSelectChange={(id, on, opts) => {
                  toggleRosterSelect(id, on, Boolean(opts?.shift));
                }}
              onChanged={() => void loadStudents()}
                onRemoved={() => {
                  onRosterChanged?.();
                  toast.ok(t('已移入回收站'));
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
        title={t('确认移入回收站')}
        confirmLabel={t('移入回收站')}
        busy={bulkBusy}
        body={
          impactModal ? (
            <>
              <p>
                {impactModal.label
                  ? t('将「{v0}」移入回收站（{v1} 日内可恢复）。', {
                      v0: impactModal.label,
                      v1: RECYCLE_RETENTION_DAYS,
                    })
                  : t('将 {v0} 名学生移入回收站（{v1} 日内可恢复）。', {
                      v0: impactModal.studentCount,
                      v1: RECYCLE_RETENTION_DAYS,
                    })}
              </p>
              <p>
                关联数据暂保留：签到 {impactModal.attendanceRecords} · 积分流水 {impactModal.pointsLog} ·
                作答 {impactModal.answers} · 留言 {impactModal.messages} · 加分请求{' '}
                {impactModal.pointRequests}（共 {impactModal.total} 条）。
              </p>
              <p>{t('永久删除或到期清理时才会清除关联记录；在线学生端将被踢下线。')}</p>
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
              toast.ok(r.message ?? t('已移入回收站 {v0} 人', { v0: r.deleted }));
              setImpactModal(null);
              await loadStudents();
              onRosterChanged?.();
              if (showRecycle) await loadRecycle();
            } catch (e) {
              toast.err(te(e, '批量删除失败'));
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
                  toast.err(te(e, '加载回收站失败'));
                }
              }
            })()
          }
        >
          {showRecycle ? t('收起回收站') : t('学生回收站')}
        </button>
        {showRecycle ? (
          <>
            <p className="hint">{t('软删除学生可恢复；永久删除会级联清除关联记录。')}</p>
            {allowDelete && recycle.length > 0 ? (
              <div className="row bulk-bar">
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    void (async () => {
                      if (!window.confirm(t('恢复回收站全部 {v0} 人？', { v0: recycle.length }))) return;
                      try {
                        const r = await api<{ message?: string }>(
                          `/api/v1/classes/${classId}/students/recycle/restore-all`,
                          { method: 'POST', body: '{}' },
                        );
                        toast.ok(r.message ?? t('已全部恢复'));
                        await loadRecycle();
                        await loadStudents();
                        onRosterChanged?.();
                      } catch (e) {
                        toast.err(te(e, '恢复失败'));
                      }
                    })()
                  }
                >
                  {t('一键恢复全部')}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void (async () => {
                      if (
                        !window.confirm(
                          t('永久清空回收站全部 {v0} 人？不可恢复，关联记录一并清除。', {
                            v0: recycle.length,
                          }),
                        )
                      ) {
                        return;
                      }
                      try {
                        const r = await streamPurgeAll(
                          `/api/v1/classes/${classId}/students/recycle/purge-all`,
                          {},
                          (p) => {
                            if (!p.done) {
                              toast.ok(
                                t('清空中 {v0}/{v1}（{v2}%）', {
                                  v0: p.purged,
                                  v1: p.total,
                                  v2: p.pct,
                                }),
                              );
                            }
                          },
                        );
                        toast.ok(r.message ?? t('已清空'));
                        await loadRecycle();
                      } catch (e) {
                        toast.err(te(e, '清空失败'));
                      }
                    })()
                  }
                >
                  一键清空全部
                </button>
              </div>
            ) : null}
            {recycle.length === 0 ? <p className="hint">{t('回收站为空')}</p> : null}
            <ul className="question-list">
              {recycle.map((s) => (
                <li
                  key={String(s.id)}
                  className={`question-item${jumpIds.has(String(s.id)) ? ' cd-audit-jump-hl' : ''}`}
                  data-row-id={String(s.id)}
                >
                  <span className="title">
                    {String(s.displayName)}
                    {s.studentNo ? ` · ${String(s.studentNo)}` : ''}
                    {s.deletedAt ? ` · ${t('删除于 {v0}', { v0: String(s.deletedAt).slice(0, 19) })}` : ''}
                    {(() => {
                      const days =
                        s.daysLeft != null ? Number(s.daysLeft) : recycleDaysLeft(s.deletedAt);
                      const label = formatRecycleDaysLeft(days, t);
                      return label ? (
                        <span
                          className={`days-left${isRecycleUrgent(days, urgentDays) ? ' days-left-urgent' : ''}`}
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
                              toast.ok(t('已恢复 {v0}', { v0: String(s.displayName) }));
                              await loadRecycle();
                              await loadStudents();
                              onRosterChanged?.();
                            } catch (e) {
                              toast.err(te(e, '恢复失败'));
                            }
                          })()
                        }
                      >
                        {t('恢复')}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void (async () => {
                            if (
                              !window.confirm(
                                t('永久删除「{v0}」？不可恢复。', {
                                  v0: String(s.displayName),
                                }),
                              )
                            ) {
                              return;
                            }
                            try {
                              await api(`/api/v1/classes/${classId}/students/bulk-purge`, {
                                method: 'POST',
                                body: JSON.stringify({ ids: [String(s.id)] }),
                              });
                              toast.ok(t('已永久删除'));
                              await loadRecycle();
                            } catch (e) {
                              toast.err(te(e, '永久删除失败'));
                            }
                          })()
                        }
                      >
                        {t('永久删除')}
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
  jumpHighlight = false,
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
  jumpHighlight?: boolean;
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
      onError(e instanceof Error ? e.message : t('保存失败'));
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
      onError(e instanceof Error ? e.message : t('删除失败'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`roster-virtual-row${jumpHighlight ? ' cd-audit-jump-hl' : ''}`}
      style={style}
      data-testid={`student-row-${id}`}
      data-row-id={id}
      tabIndex={-1}
    >
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
          placeholder={t('学号')}
          aria-label={t('学号')}
        readOnly={!allowWrite}
        />
        <input
          value={name}
        disabled={busy || !allowWrite}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('姓名')}
          aria-label={t('姓名')}
        readOnly={!allowWrite}
      />
      <span>{String(student.totalPoints)}</span>
      <span>
        {allowWrite ? (
          <>
        <button type="button" className="secondary" disabled={busy} onClick={() => void save()}>
          {t('保存')}
        </button>{' '}
        <button type="button" disabled={busy} onClick={() => void remove()}>
          {t('删除')}
        </button>
          </>
        ) : (
          <span className="hint">{t('只读')}</span>
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
  const [bulkQBusy, setBulkQBusy] = useState(false);
  const [bulkClosesAt, setBulkClosesAt] = useState('');
  const [qScrollTop, setQScrollTop] = useState(0);
  const [jumpIds, setJumpIds] = useState<Set<string>>(new Set());
  const toast = useToast();
  const allowDelete = canBulkDelete();
  const allowWrite = canWriteClass();
  const Q_ROW_H = 48;
  const Q_VIEW_H = 420;
  const orderedQIds = useMemo(() => items.map((q) => String(q.id)), [items]);
  const {
    selected: selectedQIds,
    setSelected: setSelectedQIds,
    clear: clearQSelection,
    toggleOne: toggleQSelect,
    onKeyDown: onQuestionsKeyDown,
    focusIndex: qFocusIndex,
  } = useListSelection(orderedQIds);

  async function load() {
    const q = showArchived ? '&includeArchived=1' : '';
    const r = await api<{ items: Array<Record<string, unknown>> }>(
      `/api/v1/questions?classId=${classId}${q}`,
    );
    setItems(r.items);
    clearQSelection();
  }

  async function bulkQuestions(
    action: 'delete' | 'purge' | 'restore' | 'close' | 'reopen' | 'archive' | 'unarchive' | 'set_closes_at',
  ) {
    if (selectedQIds.size === 0) return;
    if (!allowDelete && (action === 'delete' || action === 'purge')) {
      toast.err(t('助教不可批量删除'));
      return;
    }
    const labels: Record<typeof action, string> = {
      delete: t('移入回收站'),
      purge: t('永久删除'),
      restore: t('恢复'),
      close: t('收卷'),
      reopen: t('重开'),
      archive: t('下线'),
      unarchive: t('恢复上线'),
      set_closes_at: t('设置截止'),
    };
    if (action === 'delete') {
      if (
        !window.confirm(
          t('确定将选中的 {v0} 道题移入回收站？作答记录暂保留，永久删除或到期后清除。', {
            v0: selectedQIds.size,
          }),
        )
      ) {
        return;
      }
    } else if (action === 'purge') {
      if (
        !window.confirm(t('永久删除选中的 {v0} 道题？不可恢复。', { v0: selectedQIds.size }))
      ) {
        return;
      }
    } else if (action === 'set_closes_at') {
      if (!bulkClosesAt.trim()) {
        toast.err(t('请填写截止时间'));
        return;
      }
      if (
        !window.confirm(
          t('为选中的 {v0} 道题设置截止 {v1}？', {
            v0: selectedQIds.size,
            v1: bulkClosesAt,
          }),
        )
      ) {
        return;
      }
    } else if (
      !window.confirm(
        t('确定对选中的 {v0} 道题执行「{v1}」？', {
          v0: selectedQIds.size,
          v1: labels[action],
        }),
      )
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
      toast.ok(
        r.message ?? t('已{v0} {v1} 题', { v0: labels[action], v1: r.affected }),
      );
      if (
        (action === 'delete' || action === 'purge') &&
        editingQuestion &&
        selectedQIds.has(String(editingQuestion.id))
      ) {
        setEditingQuestion(null);
      }
      await load();
    } catch (e) {
      toast.err(te(e, '批量操作失败'));
    } finally {
      setBulkQBusy(false);
    }
  }

  useEffect(() => {
    void load().catch(() => setItems([]));
    const ids = consumeAuditJumpIds();
    if (ids.length) setJumpIds(new Set(ids));
  }, [classId, showArchived]);

  const qVirtual = useMemo(() => {
    const start = Math.max(0, Math.floor(qScrollTop / Q_ROW_H) - 4);
    const visible = Math.ceil(Q_VIEW_H / Q_ROW_H) + 8;
    const end = Math.min(items.length, start + visible);
    return { start, end, totalH: items.length * Q_ROW_H };
  }, [items.length, qScrollTop]);

  useEffect(() => {
    if (!jumpIds.size || !items.length) return;
    const first = items.findIndex((q) => jumpIds.has(String(q.id)));
    if (first < 0) return;
    setQScrollTop(Math.max(0, first * Q_ROW_H - Q_VIEW_H / 3));
    const _cdTimer = window.setTimeout(() => {
      const id = String(items[first]!.id);
      document.querySelector(`[data-row-id="${CSS.escape(id)}"]`)?.scrollIntoView({
        block: 'nearest',
      });
    }, 50);
    return () => window.clearTimeout(_cdTimer);
  }, [jumpIds, items]);

  function ensureQVisible(index: number) {
    const top = index * Q_ROW_H;
    const viewBottom = qScrollTop + Q_VIEW_H;
    if (top < qScrollTop) setQScrollTop(Math.max(0, top - Q_ROW_H));
    else if (top + Q_ROW_H > viewBottom) setQScrollTop(top + Q_ROW_H - Q_VIEW_H + Q_ROW_H);
  }

  function applyTemplate(kind: 'bool' | 'blank') {
    setType(kind);
    if (kind === 'bool') {
      setTitle((prev) => prev || t('判断题'));
      setStem((s) => s || t('（请改成真实题干）下列说法正确吗？'));
      setBlankKey('');
    } else {
      setTitle((prev) => prev || t('填空题'));
      setStem((s) => s || t('（请改成真实题干）请填写答案：____'));
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
      setCreateMsg(e instanceof Error ? e.message : t('上传失败'));
    } finally {
      setUploading(false);
    }
  }

  async function create() {
    setCreateMsg('');
    if (!title.trim() || !stem.trim()) {
      setCreateMsg(t('请填写真实题目标题与题干'));
      return;
    }
    const closesAt = closesAtLocal
      ? new Date(closesAtLocal).toISOString()
      : undefined;
    let body: Record<string, unknown>;
    if (type === 'blank') {
      if (!blankKey.trim()) {
        setCreateMsg(t('请填写填空参考答案'));
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
          { label: 'A', content: t('正确'), isCorrect: boolCorrect === 'A' },
          { label: 'B', content: t('错误'), isCorrect: boolCorrect === 'B' },
        ],
      };
    } else if (type === 'multi') {
      if (!optA.trim() || !optB.trim() || !optC.trim()) {
        setCreateMsg(t('多选题请填写选项 A/B/C 的真实内容'));
        return;
      }
      if (!correctMulti.A && !correctMulti.B && !correctMulti.C) {
        setCreateMsg(t('多选题请至少勾选一个正确答案'));
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
        setCreateMsg(t('单选题请填写选项 A/B 的真实内容'));
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
    setCreateMsg(t('已发布'));
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
      <h2>{t('发题 / 正确率 · 错误率')}</h2>
      {!allowWrite ? <p className="hint">{t('助教可收卷/下线，不可发布或编辑题目')}</p> : null}
      <div className="row">
        {allowWrite ? (
          <>
        <button type="button" className="chip" onClick={() => applyTemplate('bool')}>
          {t('判断题模板')}
        </button>
        <button type="button" className="chip" onClick={() => applyTemplate('blank')}>
          {t('填空题模板')}
        </button>
          </>
        ) : null}
        <label className="row">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          {t('显示已下线')}
        </label>
      </div>
      {allowWrite ? (
      <>
      <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
        <option value="single">{t('单选')}</option>
        <option value="multi">{t('多选')}</option>
        <option value="bool">{t('判断')}</option>
        <option value="blank">{t('填空')}</option>
      </select>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('题目标题（必填）')} />
      <textarea value={stem} onChange={(e) => setStem(e.target.value)} placeholder={t('题干（必填）')} />
      {type === 'blank' ? (
        <input value={blankKey} onChange={(e) => setBlankKey(e.target.value)} placeholder={t('参考答案（必填）')} />
      ) : type === 'bool' ? (
        <>
        <p className="hint">{t('判断题选项固定为「正确 / 错误」')}</p>
          <div className="row" role="radiogroup" aria-label={t('正确答案')}>
            <span>{t('正确答案：')}</span>
            <label className="choice">
              <input
                type="radio"
                name="q-bool-correct"
                checked={boolCorrect === 'A'}
                onChange={() => setBoolCorrect('A')}
              />
              {t('正确')}
            </label>
            <label className="choice">
              <input
                type="radio"
                name="q-bool-correct"
                checked={boolCorrect === 'B'}
                onChange={() => setBoolCorrect('B')}
              />
              {t('错误')}
            </label>
          </div>
        </>
      ) : (
        <>
          <input value={optA} onChange={(e) => setOptA(e.target.value)} placeholder={t('选项 A（必填）')} />
          <input value={optB} onChange={(e) => setOptB(e.target.value)} placeholder={t('选项 B（必填）')} />
          {type === 'multi' ? (
            <input value={optC} onChange={(e) => setOptC(e.target.value)} placeholder={t('选项 C（必填）')} />
          ) : null}
          {type === 'single' ? (
            <div className="row" role="radiogroup" aria-label={t('正确答案')}>
              <span>{t('正确答案')}</span>
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
        <strong>{uploading ? t('上传中…') : t('题目附件（可多选）')}</strong>
        <p className="hint">{t('pdf / 图片 / Word / Excel / PPT / 音视频 / zip / txt / md / csv，单文件 ≤10MB')}</p>
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
            ? t('多选题请至少勾选一个正确答案')
            : undefined
        }
      >
        {t('发布题目')}
      </button>
      {type === 'multi' && !correctMulti.A && !correctMulti.B && !correctMulti.C ? (
        <p className="error">{t('请至少勾选一个正确答案后再发布')}</p>
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
          {t('全选（{v0}）· 已选 {v1}', { v0: items.length, v1: selectedQIds.size })}
        </label>
        <button
          type="button"
          className="secondary"
          disabled={bulkQBusy || items.every((q) => !q.closed)}
          onClick={() =>
            setSelectedQIds(new Set(items.filter((q) => q.closed).map((q) => String(q.id))))
          }
        >
          {t('全选已收卷')}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={bulkQBusy || items.every((q) => !q.archived)}
          onClick={() =>
            setSelectedQIds(new Set(items.filter((q) => q.archived).map((q) => String(q.id))))
          }
        >
          {t('全选已下线')}
        </button>
        <button type="button" className="secondary" disabled={bulkQBusy || selectedQIds.size === 0} onClick={() => void bulkQuestions('close')}>
          {t('批量收卷')}
        </button>
        <button type="button" className="secondary" disabled={bulkQBusy || selectedQIds.size === 0} onClick={() => void bulkQuestions('reopen')}>
          {t('批量重开')}
        </button>
        <button type="button" className="secondary" disabled={bulkQBusy || selectedQIds.size === 0} onClick={() => void bulkQuestions('archive')}>
          {t('批量下线')}
        </button>
        <button type="button" className="secondary" disabled={bulkQBusy || selectedQIds.size === 0} onClick={() => void bulkQuestions('unarchive')}>
          {t('批量恢复上线')}
        </button>
        <input
          type="datetime-local"
          value={bulkClosesAt}
          onChange={(e) => setBulkClosesAt(e.target.value)}
          aria-label={t('批量截止时间')}
          disabled={!allowDelete}
        />
        <button
          type="button"
          className="secondary"
          disabled={bulkQBusy || selectedQIds.size === 0 || !allowDelete || !bulkClosesAt.trim()}
          onClick={() => void bulkQuestions('set_closes_at')}
        >
          {t('批量设截止')}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={bulkQBusy || selectedQIds.size === 0 || !allowDelete}
          onClick={() =>
            void (async () => {
              if (
                !window.confirm(
                  t('清空选中的 {v0} 道题的截止时间？', { v0: selectedQIds.size }),
                )
              ) {
                return;
              }
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
                toast.ok(r.message ?? t('已清空截止'));
                await load();
              } catch (e) {
                toast.err(te(e, '清空失败'));
              } finally {
                setBulkQBusy(false);
              }
            })()
          }
        >
          {t('清空截止')}
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
                toast.ok(t('已导出选中 {v0} 题', { v0: selectedQIds.size }));
              } catch (e) {
                toast.err(te(e, '导出失败'));
              }
            })()
          }
        >
          {t('导出选中')}
        </button>
        <button type="button" disabled={bulkQBusy || selectedQIds.size === 0 || !allowDelete} onClick={() => void bulkQuestions('delete')}>
          {t('批量删除')}
        </button>
        {!allowDelete ? <span className="hint">{t('助教不可删除/设截止')}</span> : null}
      </div>
      {selectedQIds.size > 0 ? (
        <div className="selection-sticky" data-testid="questions-selection-sticky">
          {t('已选 {v0} 题 · Shift+点击连选 · ↑↓ 移动 · Space 勾选', { v0: selectedQIds.size })}
        </div>
      ) : null}
      {items.length === 0 ? <p className="hint">{t('暂无题目')}</p> : null}
      <div
        className="q-virtual"
        style={{ height: Q_VIEW_H }}
        tabIndex={0}
        role="listbox"
        aria-multiselectable
        aria-label={t('发题列表，可用方向键与空格多选')}
        onScroll={(e: UIEvent<HTMLDivElement>) => setQScrollTop(e.currentTarget.scrollTop)}
        onKeyDown={(e) =>
          onQuestionsKeyDown(e, {
            ensureVisible: (index) => ensureQVisible(index),
            onActivate: (id) => {
              const q = items.find((row) => String(row.id) === id);
              if (q) {
                setEditingQuestion(q);
                void showStats(id, String(q.title));
              }
            },
          })
        }
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
              className={`q-virtual-row question-item${active ? ' active' : ''}${jumpIds.has(qid) ? ' cd-audit-jump-hl' : ''}`}
              style={{ top: idx * Q_ROW_H, height: Q_ROW_H }}
              tabIndex={-1}
              data-row-id={qid}
              role="option"
              aria-selected={selectedQIds.has(qid)}
              onClick={() => {
                qFocusIndex.current = idx;
                setEditingQuestion(q);
                void showStats(qid, String(q.title));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
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
                  onClick={(e) => {
                    if (!e.shiftKey) return;
                    e.preventDefault();
                    toggleQSelect(qid, !selectedQIds.has(qid), true);
                  }}
                  onChange={(e) => {
                    toggleQSelect(qid, e.target.checked, false);
                  }}
                  aria-label={`选择 ${String(q.title)}`}
                />
              </label>
              <span className="title">
                [{String(q.type)}] {String(q.title)}
                {closed ? ' · 已收卷' : ''}
                {archived ? t(' · 已下线') : ''}
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
                      setCreateMsg(closed ? t('已重开') : t('已收卷'));
                      await load();
                      await showStats(String(q.id), String(q.title));
                    })
                    .catch((err) => setCreateMsg(err instanceof Error ? err.message : t('操作失败')));
                }}
              >
                {closed ? t('重开') : t('收卷')}
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
                      setCreateMsg(archived ? t('已恢复上线') : t('已软下线（保留正确率）'));
                      await load();
                    })
                    .catch((err) => setCreateMsg(err instanceof Error ? err.message : t('操作失败')));
                }}
              >
                {archived ? t('恢复') : t('下线')}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={!allowDelete}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!allowDelete) return;
                  if (
                    !window.confirm(
                      t('将题目「{v0}」移入回收站？', { v0: String(q.title) }),
                    )
                  ) {
                    return;
                  }
                  void api(`/api/v1/questions/${String(q.id)}`, { method: 'DELETE' })
                    .then(async () => {
                      toast.ok(t('已移入回收站'));
                      if (String(editingQuestion?.id) === String(q.id)) setEditingQuestion(null);
                      await load();
                    })
                    .catch((err) => toast.err(te(err, '删除失败')));
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
      <h3>{t('编辑题目（加载原选项）')}</h3>
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
          <h4>{t('选项分布')}</h4>
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
  const [busy, setBusy] = useState(false);
  const [purgePct, setPurgePct] = useState<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [jumpIds, setJumpIds] = useState<Set<string>>(new Set());
  const [urgentDays, setUrgentDays] = useState(RECYCLE_URGENT_DAYS);
  const toast = useToast();
  const allowDelete = canBulkDelete();
  const ROW_H = 44;
  const VIEW_H = 420;
  const orderedIds = useMemo(() => items.map((q) => String(q.id)), [items]);
  const { selected, setSelected, toggleOne, onKeyDown, clear } = useListSelection(orderedIds);

  async function load() {
    const r = await api<{ items: Array<Record<string, unknown>> }>(
      `/api/v1/questions?classId=${classId}&includeDeleted=1`,
    );
    setItems(r.items);
    clear();
  }

  useEffect(() => {
    void load().catch(() => setItems([]));
    setScrollTop(0);
    void api<{ recycleUrgentDays?: number }>('/api/v1/settings')
      .then((s) => {
        if (s.recycleUrgentDays != null) setUrgentDays(Number(s.recycleUrgentDays));
      })
      .catch(() => undefined);
  }, [classId]);

  // Consume jump stash once on mount (hard-reload from audit). Do not re-consume on
  // classId sync — that raced the clear timer and dropped cd-audit-jump-hl in CI.
  useEffect(() => {
    const ids = consumeAuditJumpIds();
    if (ids.length) setJumpIds(new Set(ids));
  }, []);

  const virt = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 4);
    const visible = Math.ceil(VIEW_H / ROW_H) + 8;
    const end = Math.min(items.length, start + visible);
    return { start, end, totalH: items.length * ROW_H };
  }, [items.length, scrollTop]);

  useEffect(() => {
    if (!jumpIds.size || !items.length) return;
    const first = items.findIndex((q) => jumpIds.has(String(q.id)));
    if (first < 0) return;
    setScrollTop(Math.max(0, first * ROW_H - VIEW_H / 3));
    const _cdTimer = window.setTimeout(() => {
      document
        .querySelector(`[data-row-id="${CSS.escape(String(items[first]!.id))}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    }, 50);
    return () => window.clearTimeout(_cdTimer);
  }, [jumpIds, items]);

  async function run(action: 'restore' | 'purge', ids: string[]) {
    if (!ids.length || !allowDelete) return;
    if (
      action === 'purge' &&
      !window.confirm(t('永久删除 {v0} 道题？不可恢复。', { v0: ids.length }))
    ) {
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ message?: string }>('/api/v1/questions/bulk', {
        method: 'POST',
        body: JSON.stringify({ classId, ids, action }),
      });
      toast.ok(r.message ?? t('完成'));
      await load();
    } catch (e) {
      toast.err(te(e, '操作失败'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>{t('题目回收站')}</h2>
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
          {t('全选（{v0}）', { v0: items.length })}
        </label>
        <button
          type="button"
          className="secondary"
          disabled={busy || selected.size === 0 || !allowDelete}
          onClick={() => void run('restore', [...selected])}
        >
          {t('恢复选中')}
        </button>
        <button
          type="button"
          disabled={busy || selected.size === 0 || !allowDelete}
          onClick={() => void run('purge', [...selected])}
        >
          {t('永久删除选中')}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy || items.length === 0 || !allowDelete}
          onClick={() =>
            void (async () => {
              if (!window.confirm(t('恢复全部 {v0} 道题？', { v0: items.length }))) return;
              setBusy(true);
              try {
                const r = await api<{ message?: string }>('/api/v1/questions/recycle/restore-all', {
                  method: 'POST',
                  body: JSON.stringify({ classId }),
                });
                toast.ok(r.message ?? t('已全部恢复'));
                await load();
              } catch (e) {
                toast.err(te(e, '恢复失败'));
              } finally {
                setBusy(false);
              }
            })()
          }
        >
          {t('一键恢复全部')}
        </button>
        <button
          type="button"
          data-testid="q-recycle-purge-all"
          disabled={busy || items.length === 0 || !allowDelete}
          onClick={() =>
            void (async () => {
              if (
                !window.confirm(t('永久清空回收站 {v0} 道题？', { v0: items.length }))
              ) {
                return;
              }
              setBusy(true);
              setPurgePct(0);
              try {
                const r = await streamPurgeAll(
                  '/api/v1/questions/recycle/purge-all',
                  { classId },
                  (p) => setPurgePct(p.pct),
                );
                toast.ok(r.message ?? t('已清空'));
                await load();
              } catch (e) {
                toast.err(te(e, '清空失败'));
              } finally {
                setBusy(false);
                setPurgePct(null);
              }
            })()
          }
        >
          一键清空全部
        </button>
      </div>
      {purgePct != null ? (
        <div className="purge-progress" data-testid="q-recycle-purge-progress" role="progressbar" aria-valuenow={purgePct} aria-valuemin={0} aria-valuemax={100}>
          <div className="purge-progress-bar" style={{ width: `${purgePct}%` }} />
          <span>清空中 {purgePct}%</span>
        </div>
      ) : null}
      {selected.size > 0 ? (
        <div className="selection-sticky" data-testid="q-recycle-selection-sticky">
          已选 {selected.size} 题 · Shift+点击连选 · ↑↓ / Space 多选
        </div>
      ) : null}
      {items.length === 0 ? <p className="hint">{t('回收站为空')}</p> : null}
      <div
        className="q-virtual"
        style={{ height: VIEW_H }}
        data-testid="q-recycle-virtual"
        tabIndex={0}
        role="listbox"
        aria-multiselectable
        aria-label={t('题目回收站列表')}
        onScroll={(e: UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop)}
        onKeyDown={(e) =>
          onKeyDown(e, {
            ensureVisible: (index) => {
              const top = index * ROW_H;
              const viewBottom = scrollTop + VIEW_H;
              if (top < scrollTop) setScrollTop(Math.max(0, top - ROW_H));
              else if (top + ROW_H > viewBottom) {
                setScrollTop(top + ROW_H - VIEW_H + ROW_H);
              }
            },
          })
        }
      >
        <div className="q-virtual-inner" style={{ height: virt.totalH }}>
          {items.slice(virt.start, virt.end).map((q, i) => {
            const idx = virt.start + i;
            const qid = String(q.id);
            const days =
              q.daysLeft != null ? Number(q.daysLeft) : recycleDaysLeft(q.deletedAt);
            const daysLabel = formatRecycleDaysLeft(days, t);
            return (
              <div
                key={qid}
                className={`q-virtual-row question-item${jumpIds.has(qid) ? ' cd-audit-jump-hl' : ''}`}
                style={{ top: idx * ROW_H, height: ROW_H }}
                data-testid={`q-recycle-row-${qid}`}
                data-row-id={qid}
                tabIndex={-1}
                role="option"
                aria-selected={selected.has(qid)}
              >
                <label className="choice">
                  <input
                    type="checkbox"
                    checked={selected.has(qid)}
                    onClick={(e) => {
                      if (!e.shiftKey) return;
                      e.preventDefault();
                      toggleOne(qid, !selected.has(qid), true);
                    }}
                    onChange={(e) => toggleOne(qid, e.target.checked, false)}
                  />
                </label>
                <span className="title">
                  [{String(q.type)}] {String(q.title)}
                  {q.deletedAt ? ` · ${String(q.deletedAt).slice(0, 19)}` : ''}
                  {daysLabel ? (
                    <span
                      className={`days-left${isRecycleUrgent(days, urgentDays) ? ' days-left-urgent' : ''}`}
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
        originalName: String(a.originalName ?? t('附件')),
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
      setMsg(te(e, '上传失败'));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="card">
      <p className="hint">点列表「编辑」加载选项；可改标题/题干/选项/附件后保存。班级 {classId}</p>
      <input value={qid} onChange={(e) => setQid(e.target.value)} placeholder={t('题目 ID')} readOnly />
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('标题')} />
      <textarea value={stem} onChange={(e) => setStem(e.target.value)} placeholder={t('题干')} />
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
            {t('正确')}
          </label>
        </div>
      ))}
      <label className="dropzone dropzone-wrap">
        <strong>{uploading ? t('上传中…') : t('更换/追加附件')}</strong>
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
        <p className="hint">{t('无附件')}</p>
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
              setMsg(t('已保存原题修改'));
              return onSaved();
            })
            .catch((e) => setMsg(te(e, '失败')))
        }
      >
        {t('保存编辑')}
      </button>{' '}
      <button
        type="button"
        className="secondary"
        disabled={!qid}
        onClick={() => {
          if (!window.confirm(t('确定删除题目「{v0}」？', { v0: title || qid }))) return;
          void api(`/api/v1/questions/${qid}`, { method: 'DELETE' })
            .then(() => {
              setMsg(t('已删除'));
              return onDeleted?.() ?? onSaved();
            })
            .catch((e) => setMsg(te(e, '删除失败')));
        }}
      >
        {t('删除题目')}
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
      setExportMsg(e instanceof Error ? e.message : t('导出失败'));
    }
  }

  async function downloadAbsent() {
    setExportMsg('');
    if (!sessionId) {
      setExportMsg(t('请先选择单场课次再导出缺勤名单'));
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
      setExportMsg(e instanceof Error ? e.message : t('导出失败'));
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
      <h2>{t('出勤报表')}</h2>
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
            <option value="">{t('整月全部课次')}</option>
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
        {t('刷新')}
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
          title={sessionId ? t('导出本场缺勤名单') : t('请先选择单场课次')}
          onClick={() => void downloadAbsent()}
        >
          本场缺勤名单
        </button>
      </div>
      {exportMsg ? <p className="hint">{exportMsg}</p> : null}
      {stats ? (
        <>
          <p>
            {sessionId ? t('本场') : t('本月')}场次 {stats.sessionCount} · 班级出勤率{' '}
            {(stats.classAttendanceRate * 100).toFixed(1)}%
            {sessionId ? ' · 表格已按单场重算' : ''}
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('学号')}</th>
                <th>{t('姓名')}</th>
                <th>{sessionId ? t('本场出勤') : t('出勤次数')}</th>
                <th>{t('出勤率')}</th>
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
      <h2>{t('导出（多格式）')}</h2>
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
          {t('加分')}
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
  const [manualReason, setManualReason] = useState(t('表扬'));
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
    const _cdTimer = window.setInterval(() => void load().catch(() => undefined), 5000);
    return () => window.clearInterval(_cdTimer);
  }, [classId]);

  useEffect(() => {
    void loadBoard().catch(() => setBoard([]));
    void api<{ items: Array<Record<string, unknown>> }>(`/api/v1/classes/${classId}/students`)
      .then((r) => setStudents(r.items))
      .catch(() => setStudents([]));
  }, [classId, month, period]);

  return (
    <section>
      <h2>{t('加分 · 排行榜')}</h2>
      <h3>{t('快捷手动加分')}</h3>
      <div className="row">
        <select value={manualStudentId} onChange={(e) => setManualStudentId(e.target.value)}>
          <option value="">{t('选择学生')}</option>
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
        <input value={manualReason} onChange={(e) => setManualReason(e.target.value)} placeholder={t('理由')} />
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
                reasonSummary: manualReason.trim() || t('教师手动加分'),
              }),
            })
              .then(async () => {
                setManualMsg(t('已加分'));
                await loadBoard();
              })
              .catch((e) => setManualMsg(e instanceof Error ? e.message : t('失败')))
          }
        >
          {t('加分')}
        </button>
      </div>
      <div className="chip-row">
        {POINT_REASON_CHIPS.map((c) => (
          <button key={c} type="button" className="chip" onClick={() => setManualReason(c)}>
            {t(c)}
          </button>
        ))}
      </div>
      {manualMsg ? <p className="hint">{manualMsg}</p> : null}

      <h3>{t('学生加分请求审核')}</h3>
      <p className="hint">{t('学生在名单点选姓名后提交请求；通过后写入积分。')}</p>
      {items.length === 0 ? <p>{t('暂无待审请求')}</p> : null}
      {items.map((item) => (
        <div key={String(item.id)} className="row request-row">
          <span>
            {String(item.studentName)} · {String(item.reason || t('（无理由）'))} · {String(item.points)} 分
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

      <h3>{t('积分排行（投影）')}</h3>
      <div className="chip-row">
        {(
          [
            ['week', t('本周')],
            ['month', t('本月')],
            ['semester', t('本学期')],
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
          {t('刷新')}
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
      {board.length === 0 ? <p className="hint">{t('该时段暂无积分流水')}</p> : null}
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
    void load().catch((e) => setErr(e instanceof Error ? e.message : t('加载失败')));
  }, [classId]);

  return (
    <section>
      <h2>{t('留言')}</h2>
      <p className="hint">{t('含学生→老师、学生↔学生；可回复任意一条。')}</p>
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
              .catch((ex) => setErr(ex instanceof Error ? ex.message : t('保存失败')))
          }
        />
        允许学生留言（关闭后学生端与本侧「留言」入口一并隐藏）
      </label>
      <button type="button" className="secondary" onClick={() => void load().catch((e) => setErr(String(e)))}>
        {t('刷新')}
      </button>
      {items.length === 0 ? <p className="hint">{t('暂无留言')}</p> : null}
      {items.map((msg) => {
        const peer = Boolean(msg.toStudentId);
        const heading = peer
          ? `${String(msg.studentName)} → ${String(msg.toStudentName ?? t('同学'))}`
          : `${String(msg.studentName)} → 老师`;
        return (
          <div key={String(msg.id)} className="card">
            <strong>{heading}</strong>
            <p>{String(msg.body)}</p>
            <p className="hint">{msg.createdAt ? new Date(String(msg.createdAt)).toLocaleString() : ''}</p>
            {((msg.replies as Array<{ id?: string; authorName?: string; body: string }>) ?? []).map((r, i) => (
              <p key={r.id ?? i} className="hint">
                {r.authorName ?? t('回复')}：{r.body}
              </p>
            ))}
            <input
              value={reply[String(msg.id)] ?? ''}
              onChange={(e) => setReply((prev) => ({ ...prev, [String(msg.id)]: e.target.value }))}
              placeholder={t('回复内容')}
            />
            <button
              type="button"
              onClick={() => {
                const text = (reply[String(msg.id)] ?? '').trim();
                if (!text) {
                  setErr(t('回复不能为空'));
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
                  .catch((ex) => setErr(ex instanceof Error ? ex.message : t('回复失败')));
              }}
            >
              {t('回复')}
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
  const toast = useToast();
  const [diag, setDiag] = useState('');
  const [ttl, setTtl] = useState(60);
  const [saveMsg, setSaveMsg] = useState('');
  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [pwdMsg, setPwdMsg] = useState('');
  const [messagesOn, setMessagesOn] = useState(true);
  const [quizConfirmOn, setQuizConfirmOn] = useState(true);
  const [uiLocale, setUiLocaleState] = useState<UiLocale>('zh-CN');
  const [uiLocaleMsg, setUiLocaleMsg] = useState('');
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
  /** False until first settings/SSE read of hasExitUnlockCode (avoid false「尚未设置」flash). */
  const [exitCodeStatusReady, setExitCodeStatusReady] = useState(false);
  const [exitMinutes, setExitMinutes] = useState(15);
  const [exitCodeDraft, setExitCodeDraft] = useState('');
  /** One-time plaintext from system rotate — copy into password book then dismiss. */
  const [generatedExitCode, setGeneratedExitCode] = useState<string | null>(null);
  const [exitCodeGenerateBusy, setExitCodeGenerateBusy] = useState(false);
  const [exitMsg, setExitMsg] = useState('');
  const [csvExportBusy, setCsvExportBusy] = useState(false);
  const csvExportAbortRef = useRef<AbortController | null>(null);
  const csvPartialRowsRef = useRef<
    Array<{
      createdAt: string;
      kind: string;
      actorRole?: string | null;
      detail: string;
      clientIp?: string | null;
      id: string;
    }>
  >([]);
  const [csvPartialCount, setCsvPartialCount] = useState(0);
  const [healthPollMsDraft, setHealthPollMsDraft] = useState(() => {
    const fromLs = Number(localStorage.getItem('cd_health_poll_ms') || '');
    if (Number.isFinite(fromLs) && fromLs > 0) return String(Math.round(fromLs));
    return import.meta.env.PROD ? '30000' : '8000';
  });
  const [healthPollMsg, setHealthPollMsg] = useState('');
  const [healthPollTick, setHealthPollTick] = useState(0);
  const healthPollEffectiveMs = (() => {
    void healthPollTick;
    const fromLs = Number(localStorage.getItem('cd_health_poll_ms') || '');
    const fromEnv = Number(import.meta.env.VITE_HEALTH_POLL_MS || '');
    const fallback = import.meta.env.PROD ? 30_000 : 8_000;
    const raw =
      Number.isFinite(fromLs) && fromLs > 0
        ? fromLs
        : Number.isFinite(fromEnv) && fromEnv > 0
          ? fromEnv
          : fallback;
    return Math.min(120_000, Math.max(3_000, raw));
  })();
  const healthPollSource = localStorage.getItem('cd_health_poll_ms')
    ? 'localStorage'
    : import.meta.env.VITE_HEALTH_POLL_MS
      ? 'VITE_HEALTH_POLL_MS'
      : t('默认');
  const [bulkUnlockOpen, setBulkUnlockOpen] = useState(false);
  const [bulkUnlockBusy, setBulkUnlockBusy] = useState(false);
  const [bulkUnlockMeta, setBulkUnlockMeta] = useState<{
    classId: string;
    className: string;
    onlineCount: number;
  } | null>(null);
  const [inputLock, setInputLock] = useState({
    keyboard: false,
    mouse: false,
    voice: false,
    camera: false,
  });
  const [inputLockBusy, setInputLockBusy] = useState(false);
  const [inputLockScope, setInputLockScope] = useState<'global' | 'class' | 'seat'>('global');
  const [inputLockSeatId, setInputLockSeatId] = useState('');
  const [inputLockSeatOptions, setInputLockSeatOptions] = useState<
    Array<{ value: string; label: string; group: 'seated' | 'clientOnly' }>
  >([]);
  const [examModeBusy, setExamModeBusy] = useState(false);
  const [examModeSnapshot, setExamModeSnapshot] = useState(false);
  const [inputLockScopeLabel, setInputLockScopeLabel] = useState(t('全校全局'));
  /** Effective coverage from store summary (assistant badge). */
  const [inputLockCoverage, setInputLockCoverage] = useState<'global' | 'class' | 'seat'>('global');
  /** Last known store summary counts for clearAll confirm. */
  const [inputLockClassCount, setInputLockClassCount] = useState(0);
  const [inputLockSeatCount, setInputLockSeatCount] = useState(0);
  const [inputLockExpiresAt, setInputLockExpiresAt] = useState<string | null>(null);
  const [inputLockSsePolling, setInputLockSsePolling] = useState(false);
  const [inputLockSessionId, setInputLockSessionId] = useState('');
  const [attendanceSessions, setAttendanceSessions] = useState<
    Array<{ id: string; startAt: string; endAt: string; status: string }>
  >([]);
  const [seatIdCopied, setSeatIdCopied] = useState(false);
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [clearAllBusy, setClearAllBusy] = useState(false);
  const [clearAllMeta, setClearAllMeta] = useState<{
    classN: number;
    seatN: number;
    clearExamSnap: boolean;
  } | null>(null);
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
  const [asstName, setAsstName] = useState(t('助教'));
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
  const [recycleDays, setRecycleDays] = useState(RECYCLE_RETENTION_DAYS);
  const [recycleUrgentDays, setRecycleUrgentDays] = useState(RECYCLE_URGENT_DAYS);
  const [healthAlert, setHealthAlert] = useState<{
    exportTmpLeaked?: number;
    exportTmpDir?: string;
    auditRetryPending?: number;
    auditRetryDegraded?: boolean;
  } | null>(null);
  const [assistantsLiveMode, setAssistantsLiveMode] = useState<'sse' | 'poll'>('sse');
  const [exportTmpMsg, setExportTmpMsg] = useState('');
  const [flushMsg, setFlushMsg] = useState('');
  const [restoreFile, setRestoreFile] = useState('');
  const [restorePass, setRestorePass] = useState('');
  const [restoreChecklist, setRestoreChecklist] = useState<string[]>([]);
  const [restoreSha, setRestoreSha] = useState('');
  const [restoreConfirmCode, setRestoreConfirmCode] = useState('');
  const [restoreConfirmInput, setRestoreConfirmInput] = useState('');
  const [restoreConfirmEmail, setRestoreConfirmEmail] = useState('');
  const [restoreMailtoUrl, setRestoreMailtoUrl] = useState('');
  const [restoreEmailDelivered, setRestoreEmailDelivered] = useState(false);
  const [upgradeMsg, setUpgradeMsg] = useState('');
  const [upgradeFiles, setUpgradeFiles] = useState<string[]>([]);
  const [grantEditId, setGrantEditId] = useState<string | null>(null);
  const [grantRows, setGrantRows] = useState<
    Array<{ classId: string; name: string; canExport: boolean; canAwardPoints: boolean }>
  >([]);
  const [grantWasEmpty, setGrantWasEmpty] = useState(false);
  const [grantMsg, setGrantMsg] = useState('');
  const [grantMigrateOpen, setGrantMigrateOpen] = useState(false);
  const [grantMigrateBusy, setGrantMigrateBusy] = useState(false);
  const [grantLoseNames, setGrantLoseNames] = useState<string[]>([]);
  const [driftMins, setDriftMins] = useState(5);
  const [unhardenedThresh, setUnhardenedThresh] = useState(0.25);
  const [driftLastAt, setDriftLastAt] = useState<string | null>(null);
  const [driftSnapBusy, setDriftSnapBusy] = useState(false);
  const [upgradesKeep, setUpgradesKeep] = useState(3);
  const [studentAutoUpdate, setStudentAutoUpdate] = useState(false);
  const [prunedFiles, setPrunedFiles] = useState<string[]>([]);
  const [purgeJumpHint, setPurgeJumpHint] = useState('');

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
      recycleUrgentDays?: number;
      fleetDriftSnapshotMinutes?: number;
      unhardenedAlertThreshold?: number;
      fleetDriftSnapshotLastAt?: string | null;
      upgradesKeepCount?: number;
      studentAutoUpdate?: boolean;
      restoreConfirmEmail?: string;
      clientExitAllowed?: boolean;
      clientExitUnlockUntil?: string | null;
      hasExitUnlockCode?: boolean;
      exitUnlockMaxFails?: number;
      exitUnlockWindowMinutes?: number;
      exitUnlockLockoutMinutes?: number;
      exitUnlockCodeRotateDays?: number;
      exitUnlockCodeAgeDays?: number | null;
      exitUnlockCodeRotationDue?: boolean;
      inputLock?: {
        keyboard?: boolean;
        mouse?: boolean;
        voice?: boolean;
        camera?: boolean;
      };
      examModeSnapshot?: boolean;
      uiLocale?: string;
      inputLockSummary?: {
        global?: string;
        byClass?: unknown[];
        bySeat?: unknown[];
      };
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
    setUiLocaleState(normalizeUiLocale(s.uiLocale));
    if (s.liveboardReadonlyAfterMinutes != null) {
      setReadonlyAfterMins(Number(s.liveboardReadonlyAfterMinutes) || 0);
    }
    if (s.recycleRetentionDays != null && Number.isFinite(Number(s.recycleRetentionDays))) {
      setRecycleDays(Number(s.recycleRetentionDays));
    }
    if (s.fleetDriftSnapshotMinutes != null && Number.isFinite(Number(s.fleetDriftSnapshotMinutes))) {
      setDriftMins(Number(s.fleetDriftSnapshotMinutes));
    }
    if (s.unhardenedAlertThreshold != null && Number.isFinite(Number(s.unhardenedAlertThreshold))) {
      setUnhardenedThresh(Number(s.unhardenedAlertThreshold));
    }
    setDriftLastAt(s.fleetDriftSnapshotLastAt ?? null);
    if (typeof s.restoreConfirmEmail === 'string') setRestoreConfirmEmail(s.restoreConfirmEmail);
    if (s.upgradesKeepCount != null && Number.isFinite(Number(s.upgradesKeepCount))) {
      setUpgradesKeep(Number(s.upgradesKeepCount));
    }
    setStudentAutoUpdate(s.studentAutoUpdate === true);
    if (s.recycleUrgentDays != null && Number.isFinite(Number(s.recycleUrgentDays))) {
      setRecycleUrgentDays(Number(s.recycleUrgentDays));
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
      if (typeof s.hasExitUnlockCode === 'boolean') {
        setHasExitCode(s.hasExitUnlockCode);
        setExitCodeStatusReady(true);
      }
    setMaxFails(s.exitUnlockMaxFails ?? 5);
    setWindowMin(s.exitUnlockWindowMinutes ?? 15);
    setLockoutMin(s.exitUnlockLockoutMinutes ?? 15);
    setRotateDays(s.exitUnlockCodeRotateDays ?? 90);
    setCodeAgeDays(s.exitUnlockCodeAgeDays ?? null);
    setCodeRotationDue(s.exitUnlockCodeRotationDue === true);
    if (s.inputLock) {
      setInputLock({
        keyboard: Boolean(s.inputLock.keyboard),
        mouse: Boolean(s.inputLock.mouse),
        voice: Boolean(s.inputLock.voice),
        camera: Boolean(s.inputLock.camera),
      });
    }
    setExamModeSnapshot(s.examModeSnapshot === true);
    setInputLockExpiresAt(
      (s as { inputLockExpiresAt?: string | null }).inputLockExpiresAt ?? null,
    );
    setInputLockSessionId(
      String((s as { inputLockAttendanceSessionId?: string | null }).inputLockAttendanceSessionId ?? ''),
    );
    const sum = s.inputLockSummary;
    const classN = Array.isArray(sum?.byClass) ? sum!.byClass!.length : 0;
    const seatN = Array.isArray(sum?.bySeat) ? sum!.bySeat!.length : 0;
    setInputLockClassCount(classN);
    setInputLockSeatCount(seatN);
    if (seatN > 0) {
      setInputLockCoverage('seat');
      setInputLockScopeLabel(`机位覆盖 ${seatN}`);
    } else if (classN > 0) {
      setInputLockCoverage('class');
      setInputLockScopeLabel(`班级覆盖 ${classN}`);
    } else {
      setInputLockCoverage('global');
      setInputLockScopeLabel(sum?.global && sum.global !== t('无') ? `全局 ${sum.global}` : t('全校全局'));
    }
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

    const classId = currentTeacherClassId();
    if (classId) {
      try {
        const sessions = await api<{
          items?: Array<{ id: string; startAt: string; endAt: string; status: string }>;
        }>(`/api/v1/attendance/sessions?classId=${encodeURIComponent(classId)}`);
        setAttendanceSessions(
          (sessions.items ?? []).filter((x) => x.status === 'open').slice(0, 20),
        );
      } catch {
        setAttendanceSessions([]);
      }
      try {
        const [presence, seats] = await Promise.all([
          api<{
            items: Array<{
              studentId: string;
              clientId?: string;
              displayName: string;
              seatId?: string | null;
              seatLabel?: string | null;
            }>;
          }>(`/api/v1/presence/clients?classId=${encodeURIComponent(classId)}`),
          api<{
            items: Array<{ id: string; label: string; displayName?: string | null; studentId?: string | null }>;
          }>(`/api/v1/classes/${encodeURIComponent(classId)}/seats`),
        ]);
        const opts: Array<{ value: string; label: string; group: 'seated' | 'clientOnly' }> = [];
        const seen = new Set<string>();
        // Prefer seat_map.id (physical seat) — teacher seat-scope PATCH keys by classId:seatId.
        for (const s of seats.items ?? []) {
          if (!s.id || seen.has(s.id)) continue;
          seen.add(s.id);
          opts.push({
            value: s.id,
            group: 'seated',
            label: `座位 ${s.label || s.id}${s.displayName ? ` · ${s.displayName}` : s.studentId ? '' : ' · 空座'}`,
          });
        }
        for (const p of presence.items ?? []) {
          const cid = String(p.clientId ?? '').trim();
          if (!cid || seen.has(cid) || p.seatId) continue;
          seen.add(cid);
          opts.push({
            value: cid,
            group: 'clientOnly',
            label: `${p.displayName || p.studentId} · 仅 clientId（${cid.slice(0, 8)}…）`,
          });
        }
        setInputLockSeatOptions(opts);
      } catch {
        setInputLockSeatOptions([]);
      }
    } else {
      setInputLockSeatOptions([]);
    }
  }

  function exitLockKindLabel(kind: string): string {
    const map: Record<string, string> = {
      batch_unlock: t('批量解除'),
      relock: t('重新锁定'),
      unlock_flag_off: t('关闭锁定标志'),
      code_ok: t('解除码成功'),
      code_fail: t('解除码失败'),
      code_rate_limited: t('解除码限流'),
      code_set: t('首次设置解除码'),
      code_rotated: t('轮换解除码'),
      rate_config: t('限流/轮换配置'),
      input_lock: t('物理输入锁'),
      exam_mode: t('考试模式'),
      exam_mode_end: t('解除考试模式'),
      client_reconcile: t('断线对账冲突'),
    };
    return map[kind] ? `${map[kind]}（${kind}）` : kind;
  }

  function auditActionLabel(action: string): string {
    const map: Record<string, string> = {
      'settings.input_lock': t('物理输入锁变更'),
      'settings.exam_mode': t('一键考试模式'),
      'settings.exam_mode_end': t('解除考试模式'),
      'settings.unhardened_threshold': t('未加固告警阈值'),
      'session.raise_hand': t('学生举手'),
    };
    return map[action] ? `${map[action]}（${action}）` : action;
  }

  function jumpToInputLockSettings(opts?: { seatId?: string | null; classId?: string | null }) {
    sessionStorage.setItem('cd_goto_input_lock', '1');
    const seat = String(opts?.seatId ?? '').trim();
    if (seat) {
      sessionStorage.setItem('cd_goto_input_lock_seat', seat);
      sessionStorage.setItem('cd_input_lock_scope', 'seat');
    }
    const cid = String(opts?.classId ?? '').trim();
    if (cid) localStorage.setItem('cd_teacher_class_id', cid);
    try {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#input-lock-settings`);
    } catch {
      /* ignore */
    }
    hardReloadTeacherNav({
      tab: isAssistant() ? 'settings' : 'prep',
      prepTab: 'settings',
      classId: cid || currentTeacherClassId() || undefined,
    });
  }

  function currentTeacherClassId(): string {
    return localStorage.getItem('cd_teacher_class_id')?.trim() || '';
  }

  function patchInputLock(next: typeof inputLock) {
    setInputLock(next);
    setInputLockBusy(true);
    const classId = currentTeacherClassId();
    const body: Record<string, unknown> = {
      inputLock: {
        ...next,
        scope: inputLockScope,
        classId: inputLockScope === 'global' ? undefined : classId || undefined,
        seatId: inputLockScope === 'seat' ? inputLockSeatId.trim() || undefined : undefined,
      },
    };
    void api<{ inputLock?: typeof inputLock }>('/api/v1/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
      .then((r) => {
        if (r.inputLock) {
          setInputLock({
            keyboard: Boolean(r.inputLock.keyboard),
            mouse: Boolean(r.inputLock.mouse),
            voice: Boolean(r.inputLock.voice),
            camera: Boolean(r.inputLock.camera),
          });
        }
        const scopeZh =
          inputLockScope === 'seat'
            ? `机位 ${inputLockSeatId || '—'}`
            : inputLockScope === 'class'
              ? t('当前班级')
              : t('全局');
        setInputLockScopeLabel(scopeZh);
        setExitMsg(`物理输入锁已更新（${scopeZh}，已推送到学生端）`);
        void loadAudit().catch(() => undefined);
        void refreshExitLock().catch(() => undefined);
      })
      .catch((err) => setExitMsg(err instanceof Error ? err.message : t('输入锁保存失败')))
      .finally(() => setInputLockBusy(false));
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

  function downloadExitLockCsvRows(
    rows: Array<{
      createdAt: string;
      kind: string;
      actorRole?: string | null;
      detail: string;
      clientIp?: string | null;
      id: string;
    }>,
    filename: string,
  ) {
    const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
    const lines = [
      ['时间', '类型', '角色', t('详情'), 'IP', 'ID'].join(','),
      ...rows.map((e) =>
        [e.createdAt, e.kind, e.actorRole ?? '', e.detail, e.clientIp ?? '', e.id].map(esc).join(','),
      ),
    ];
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /** Page through JSON API and build full CSV (no 500 hard cap). */
  async function exportExitLockCsvAll(filename: string) {
    csvExportAbortRef.current?.abort();
    const ac = new AbortController();
    csvExportAbortRef.current = ac;
    setCsvExportBusy(true);
    setCsvPartialCount(0);
    csvPartialRowsRef.current = [];
    const token = getToken() || '';
    const pageSize = 200;
    const rows: Array<{
      createdAt: string;
      kind: string;
      actorRole?: string | null;
      detail: string;
      clientIp?: string | null;
      id: string;
    }> = [];
    let offset = 0;
    let total = Infinity;
    setExitMsg(t('正在分页拉取全部 CSV…'));
    try {
      while (offset < total) {
        if (ac.signal.aborted) {
          csvPartialRowsRef.current = rows;
          setCsvPartialCount(rows.length);
          setExitMsg(t('已取消导出（已取 {v0} 条，可下载已拉取部分）', { v0: rows.length }));
          return;
        }
        const q = new URLSearchParams({
          limit: String(pageSize),
          offset: String(offset),
        });
        if (exitKindFilter) q.set('kind', exitKindFilter);
        const res = await fetch(`${API_BASE}/api/v1/settings/exit-lock-events?${q}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: ac.signal,
        });
        if (!res.ok) {
          setExitMsg(t('导出失败 HTTP {v0}', { v0: res.status }));
          return;
        }
        const body = (await res.json()) as { items?: typeof rows; total?: number };
        const items = body.items ?? [];
        total = Number(body.total ?? items.length);
        rows.push(...items);
        csvPartialRowsRef.current = rows;
        setCsvPartialCount(rows.length);
        const denom = Number.isFinite(total) && total > 0 ? total : Math.max(rows.length, 1);
        setExitMsg(
          t('导出进度 {v0} / {v1}…', { v0: Math.min(rows.length, denom), v1: denom }),
        );
        if (!items.length) break;
        offset += items.length;
        if (offset > 50_000) {
          setExitMsg(t('导出中止：超过 50000 条安全上限（已取 {v0}）', { v0: rows.length }));
          break;
        }
      }
      if (ac.signal.aborted) {
        csvPartialRowsRef.current = rows;
        setCsvPartialCount(rows.length);
        setExitMsg(t('已取消导出（已取 {v0} 条，可下载已拉取部分）', { v0: rows.length }));
        return;
      }
      downloadExitLockCsvRows(rows, filename);
      setCsvPartialCount(0);
      csvPartialRowsRef.current = [];
      setExitMsg(t('已导出全部 CSV（{v0} 条）', { v0: rows.length }));
    } catch (err) {
      if (ac.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        csvPartialRowsRef.current = rows;
        setCsvPartialCount(rows.length);
        setExitMsg(t('已取消导出（已取 {v0} 条，可下载已拉取部分）', { v0: rows.length }));
        return;
      }
      setExitMsg(err instanceof Error ? err.message : t('导出失败'));
    } finally {
      if (csvExportAbortRef.current === ac) csvExportAbortRef.current = null;
      setCsvExportBusy(false);
    }
  }

  function cancelExitLockCsvExport() {
    csvExportAbortRef.current?.abort();
  }

  function downloadExitLockCsvPartial() {
    const rows = csvPartialRowsRef.current;
    if (!rows.length) return;
    downloadExitLockCsvRows(rows, 'exit-lock-events-partial.csv');
    setExitMsg(t('已下载已拉取部分（{v0} 条）', { v0: rows.length }));
  }

  useEffect(() => {
    try {
      const seat = sessionStorage.getItem('cd_goto_input_lock_seat')?.trim();
      const scope = sessionStorage.getItem('cd_input_lock_scope')?.trim();
      if (scope === 'seat' || seat) setInputLockScope('seat');
      if (seat) {
        setInputLockSeatId(seat);
        sessionStorage.removeItem('cd_goto_input_lock_seat');
        sessionStorage.removeItem('cd_input_lock_scope');
        window.setTimeout(() => {
          const pick = document.querySelector(
            '[data-testid="input-lock-seat-pick"]',
          ) as HTMLSelectElement | null;
          if (pick) {
            pick.value = seat;
            pick.classList.add('cd-audit-jump-hl');
            pick.focus();
            window.setTimeout(() => pick.classList.remove('cd-audit-jump-hl'), 4000);
          }
          const el = document.querySelector(
            '[data-testid="input-lock-seat-id-readonly"]',
          ) as HTMLElement | null;
          el?.classList.add('cd-audit-jump-hl');
          window.setTimeout(() => el?.classList.remove('cd-audit-jump-hl'), 4000);
        }, 400);
      }
    } catch {
      /* ignore */
    }
  }, []);

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

    const token = getToken() || '';
    let cancelled = false;
    let es: EventSource | null = null;
    let reconnectTimer: number | undefined;
    let pollTimer: number | undefined;
    let backoffMs = 1000;
    let failStreak = 0;

    function stopPoll() {
      if (pollTimer != null) {
        window.clearInterval(pollTimer);
        pollTimer = undefined;
      }
    }

    function startPollFallback() {
      if (pollTimer != null || cancelled) return;
      setAssistantsLiveMode('poll');
      pollTimer = window.setInterval(() => {
        void loadAssistants().catch(() => undefined);
      }, 8_000);
    }

    function connectAssistantsSse() {
      if (cancelled || !token || typeof EventSource === 'undefined') {
        startPollFallback();
        return;
      }
      try {
        es?.close();
      } catch {
        /* ignore */
      }
      es = new EventSource(
        `${API_BASE}/api/v1/auth/assistants/stream?token=${encodeURIComponent(token)}`,
      );
      const onUpdated = () => {
        failStreak = 0;
        backoffMs = 1000;
        stopPoll();
        setAssistantsLiveMode('sse');
        void loadAssistants().catch(() => undefined);
      };
      es.addEventListener('assistants.updated', onUpdated);
      es.onopen = () => {
        failStreak = 0;
        backoffMs = 1000;
        stopPoll();
        setAssistantsLiveMode('sse');
      };
      es.onerror = () => {
        failStreak += 1;
        try {
          es?.close();
        } catch {
          /* ignore */
        }
        es = null;
        if (cancelled) return;
        if (failStreak >= 2) startPollFallback();
        const wait = Math.min(30_000, backoffMs);
        backoffMs = Math.min(30_000, Math.round(backoffMs * 1.8));
        reconnectTimer = window.setTimeout(() => connectAssistantsSse(), wait);
      };
    }
    connectAssistantsSse();

    // Assistant coverage badge: subscribe /input-lock/stream (not only refreshExitLock poll).
    let inputLockEs: EventSource | null = null;
    function applyInputLockCoverage(summary: {
      global?: string;
      byClass?: unknown[];
      bySeat?: unknown[];
    } | null | undefined) {
      if (!summary) return;
      const classN = Array.isArray(summary.byClass) ? summary.byClass.length : 0;
      const seatN = Array.isArray(summary.bySeat) ? summary.bySeat.length : 0;
      setInputLockClassCount(classN);
      setInputLockSeatCount(seatN);
      if (seatN > 0) {
        setInputLockCoverage('seat');
        setInputLockScopeLabel(`机位覆盖 ${seatN}`);
      } else if (classN > 0) {
        setInputLockCoverage('class');
        setInputLockScopeLabel(`班级覆盖 ${classN}`);
      } else {
        setInputLockCoverage('global');
        setInputLockScopeLabel(
          summary.global && summary.global !== t('无') ? `全局 ${summary.global}` : t('全校全局'),
        );
      }
    }
    let inputLockFailStreak = 0;
    let inputLockPollTimer: number | undefined;
    let inputLockUsingPoll = false;
    function pollInputLockOnce() {
      void api<{
        inputLock?: typeof inputLock;
        inputLockExpiresAt?: string | null;
        hasExitUnlockCode?: boolean;
        clientExitAllowed?: boolean;
        clientExitUnlockUntil?: string | null;
        exitUnlockCodeAgeDays?: number | null;
        exitUnlockCodeRotationDue?: boolean;
        inputLockSummary?: {
          global?: string;
          byClass?: unknown[];
          bySeat?: unknown[];
        };
      }>('/api/v1/settings')
        .then((s) => {
          if (s.inputLock) {
            setInputLock({
              keyboard: Boolean(s.inputLock.keyboard),
              mouse: Boolean(s.inputLock.mouse),
              voice: Boolean(s.inputLock.voice),
              camera: Boolean(s.inputLock.camera),
            });
          }
          if ('inputLockExpiresAt' in s) {
            setInputLockExpiresAt(
              s.inputLockExpiresAt != null && String(s.inputLockExpiresAt).trim()
                ? String(s.inputLockExpiresAt)
                : null,
            );
          }
          if (typeof s.hasExitUnlockCode === 'boolean') {
            setHasExitCode(s.hasExitUnlockCode);
            setExitCodeStatusReady(true);
          }
          if (typeof s.clientExitAllowed === 'boolean') {
            setExitAllowed(s.clientExitAllowed);
          }
          if ('clientExitUnlockUntil' in s) {
            setExitUnlockUntil(s.clientExitUnlockUntil ?? null);
          }
          if ('exitUnlockCodeAgeDays' in s) {
            setCodeAgeDays(s.exitUnlockCodeAgeDays ?? null);
          }
          if (typeof s.exitUnlockCodeRotationDue === 'boolean') {
            setCodeRotationDue(s.exitUnlockCodeRotationDue);
          }
          applyInputLockCoverage(s.inputLockSummary);
        })
        .catch(() => undefined);
    }
    function startInputLockPollFallback() {
      if (cancelled || inputLockPollTimer != null) return;
      inputLockUsingPoll = true;
      setInputLockSsePolling(true);
      pollInputLockOnce();
      inputLockPollTimer = window.setInterval(() => pollInputLockOnce(), 5_000);
    }
    function connectInputLockSse() {
      if (cancelled || typeof EventSource === 'undefined') {
        startInputLockPollFallback();
        return;
      }
      try {
        inputLockEs?.close();
      } catch {
        /* ignore */
      }
      inputLockEs = new EventSource(`${API_BASE}/api/v1/input-lock/stream`);
      const onLock = (ev: MessageEvent) => {
        inputLockFailStreak = 0;
        if (inputLockUsingPoll) {
          inputLockUsingPoll = false;
          setInputLockSsePolling(false);
          if (inputLockPollTimer != null) {
            window.clearInterval(inputLockPollTimer);
            inputLockPollTimer = undefined;
          }
        }
        try {
          const data = JSON.parse(String(ev.data)) as {
            type?: string;
            inputLock?: typeof inputLock;
            inputLockExpiresAt?: string | null;
            summary?: {
              global?: string;
              byClass?: unknown[];
              bySeat?: unknown[];
            };
          };
          if (data.inputLock) {
            setInputLock({
              keyboard: Boolean(data.inputLock.keyboard),
              mouse: Boolean(data.inputLock.mouse),
              voice: Boolean(data.inputLock.voice),
              camera: Boolean(data.inputLock.camera),
            });
          }
          if ('inputLockExpiresAt' in data) {
            setInputLockExpiresAt(
              data.inputLockExpiresAt != null && String(data.inputLockExpiresAt).trim()
                ? String(data.inputLockExpiresAt)
                : null,
            );
          }
          applyInputLockCoverage(data.summary);
        } catch {
          /* ignore */
        }
      };
      inputLockEs.addEventListener('input_lock', onLock as EventListener);
      inputLockEs.onmessage = onLock;
      inputLockEs.onerror = () => {
        inputLockFailStreak += 1;
        if (inputLockFailStreak >= 2) startInputLockPollFallback();
      };
    }
    // e2e / DevTools: force assistant settings input-lock SSE → 5s poll (expiresAt still updates).
    (window as unknown as { __cdForceAssistantInputLockSseFallback?: () => void }).__cdForceAssistantInputLockSseFallback =
      () => {
        try {
          inputLockEs?.close();
        } catch {
          /* ignore */
        }
        inputLockEs = null;
        if (inputLockPollTimer != null) {
          // Already on poll: nudge an immediate fetch (e2e after teacher PATCH).
          pollInputLockOnce();
          return;
        }
        startInputLockPollFallback();
      };
    connectInputLockSse();

    // Keep hasExitUnlockCode / lock window in sync (avoid stale「尚未设置解除码」).
    let exitLockEs: EventSource | null = null;
    function applyExitLockPayload(data: {
      clientExitAllowed?: boolean;
      clientExitUnlockUntil?: string | null;
      hasExitUnlockCode?: boolean;
      exitUnlockCodeAgeDays?: number | null;
      exitUnlockCodeRotationDue?: boolean;
      exitUnlockCodeRotateDays?: number;
    }) {
      if (typeof data.clientExitAllowed === 'boolean') {
        setExitAllowed(data.clientExitAllowed);
      }
      if ('clientExitUnlockUntil' in data) {
        setExitUnlockUntil(data.clientExitUnlockUntil ?? null);
      }
      if (typeof data.hasExitUnlockCode === 'boolean') {
        setHasExitCode(data.hasExitUnlockCode);
        setExitCodeStatusReady(true);
      }
      if ('exitUnlockCodeAgeDays' in data) {
        setCodeAgeDays(data.exitUnlockCodeAgeDays ?? null);
      }
      if (typeof data.exitUnlockCodeRotationDue === 'boolean') {
        setCodeRotationDue(data.exitUnlockCodeRotationDue);
      }
      if (
        data.exitUnlockCodeRotateDays != null &&
        Number.isFinite(Number(data.exitUnlockCodeRotateDays))
      ) {
        setRotateDays(Number(data.exitUnlockCodeRotateDays));
      }
    }
    if (typeof EventSource !== 'undefined') {
      try {
        exitLockEs = new EventSource(`${API_BASE}/api/v1/exit-lock/stream`);
        const onExit = (ev: MessageEvent) => {
          try {
            applyExitLockPayload(JSON.parse(String(ev.data)) as Parameters<typeof applyExitLockPayload>[0]);
          } catch {
            /* ignore */
          }
        };
        exitLockEs.addEventListener('message', onExit as EventListener);
        exitLockEs.onmessage = onExit;
      } catch {
        exitLockEs = null;
      }
    }

    async function pollHealthAlert() {
      try {
        const res = await fetch(`${API_BASE}/health`, { cache: 'no-store' });
        const body = (await res.json()) as {
          exportTmp?: { tmpLeaked?: number; tmpDir?: string };
          audit?: { retryQueueSize?: number; degraded?: boolean };
        };
        const leaked = Number(body.exportTmp?.tmpLeaked ?? 0);
        const pending = Number(body.audit?.retryQueueSize ?? 0);
        const degraded = Boolean(body.audit?.degraded);
        if (leaked > 0 || pending > 0 || degraded) {
          setHealthAlert({
            exportTmpLeaked: leaked,
            exportTmpDir: body.exportTmp?.tmpDir,
            auditRetryPending: pending,
            auditRetryDegraded: degraded,
          });
        } else {
          setHealthAlert(null);
        }
      } catch {
        /* ignore */
      }
    }
    void pollHealthAlert();
    const healthPoll = window.setInterval(() => void pollHealthAlert(), 15_000);

    return () => {
      cancelled = true;
      try {
        delete (window as unknown as { __cdForceAssistantInputLockSseFallback?: () => void })
          .__cdForceAssistantInputLockSseFallback;
      } catch {
        /* ignore */
      }
      try {
        es?.close();
      } catch {
        /* ignore */
      }
      try {
        inputLockEs?.close();
      } catch {
        /* ignore */
      }
      try {
        exitLockEs?.close();
      } catch {
        /* ignore */
      }
      if (inputLockPollTimer != null) window.clearInterval(inputLockPollTimer);
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
      stopPoll();
      window.clearInterval(healthPoll);
    };
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
    const wasEmpty = (gr.items ?? []).length === 0;
    setGrantWasEmpty(wasEmpty);
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
    if (wasEmpty) {
      setGrantMsg(
        t('当前为空表：助教仍可全局只读导出。首次勾选并保存后将改为仅授权班级可导出/加分。'),
      );
    }
  }

  function classesLosingExport(
    rows: Array<{ name: string; canExport: boolean }>,
  ): string[] {
    return rows.filter((r) => !r.canExport).map((r) => r.name);
  }

  function updateGrantRow(classId: string, patch: { canExport?: boolean; canAwardPoints?: boolean }) {
    const next = grantRows.map((x) => (x.classId === classId ? { ...x, ...patch } : x));
    setGrantRows(next);
    if (!grantWasEmpty) return;
    const touched = next.some((r) => r.canExport || r.canAwardPoints);
    if (!touched) {
      setGrantMsg(
        t('当前为空表：助教仍可全局只读导出。首次勾选并保存后将改为仅授权班级可导出/加分。'),
      );
      return;
    }
    const lose = classesLosingExport(next);
    setGrantMsg(
      lose.length
        ? t('首次勾选后将失去导出的班级（未勾选可导出）：{v0}', { v0: lose.join('、') })
        : t('所有班级都已勾选可导出。'),
    );
  }

  async function commitAssistantGrants() {
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
    setGrantWasEmpty(grants.length === 0);
    setGrantMsg(
      grants.length === 0
        ? t('已清空按班授权（助教恢复全局只读导出）')
        : t('已保存 {v0} 个班级授权', { v0: grants.length }),
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
    if (grantWasEmpty && grants.length > 0) {
      setGrantLoseNames(classesLosingExport(grantRows));
      setGrantMigrateOpen(true);
      return;
    }
    await commitAssistantGrants();
  }

  useEffect(() => {
    void loadAudit().catch(() => undefined);
  }, [auditClassId, auditAction]);

  useEffect(() => {
    const _cdTimer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(_cdTimer);
  }, []);

  function focusRecyclePurgeConfirm(meta?: {
    classId?: string | null;
    count?: number | null;
    students?: number | null;
    questions?: number | null;
  }) {
    if (meta?.classId) {
      localStorage.setItem('cd_teacher_class_id', meta.classId);
      window.dispatchEvent(
        new CustomEvent('cd-select-class', { detail: { classId: meta.classId } }),
      );
    }
    const count = meta?.count ?? null;
    const emptyExpired =
      count === 0 ||
      (count == null &&
        meta?.students === 0 &&
        meta?.questions === 0);
    if (emptyExpired) {
      setPurgeJumpHint(
        t('审计预览：当前无已过期可硬删项（学生 0 · 题目 0），无需执行清理'),
      );
      setSaveMsg(t('无过期回收站条目可 purge'));
      const elEmpty = document.getElementById('recycle-purge-confirm');
      elEmpty?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      elEmpty?.classList.add('cd-audit-jump-hl');
      window.setTimeout(() => elEmpty?.classList.remove('cd-audit-jump-hl'), 3200);
      if (window.location.hash.startsWith('#recycle-purge-confirm')) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      }
      return;
    }
    const parts: string[] = [];
    if (meta?.count != null) parts.push(t('预览共 {v0} 条', { v0: meta.count }));
    if (meta?.students != null) parts.push(t('学生 {v0}', { v0: meta.students }));
    if (meta?.questions != null) parts.push(t('题目 {v0}', { v0: meta.questions }));
    if (meta?.classId) parts.push(t('班级已选中'));
    setPurgeJumpHint(parts.join(' · ') || t('跳转清理确认'));
    const el = document.getElementById('recycle-purge-confirm');
    if (!el) {
      setSaveMsg(t('当前账号看不到回收站清理确认'));
      if (window.location.hash.startsWith('#recycle-purge-confirm')) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      }
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('cd-audit-jump-hl');
    const btn = document.getElementById('recycle-purge-confirm-btn');
    if (btn instanceof HTMLElement) btn.focus();
    window.setTimeout(() => el.classList.remove('cd-audit-jump-hl'), 3200);
  }

  useEffect(() => {
    const flagged = sessionStorage.getItem('cd_goto_purge_confirm') === '1';
    const hash = window.location.hash || '';
    const hashed = hash.startsWith('#recycle-purge-confirm');
    if (!flagged && !hashed) return;
    sessionStorage.removeItem('cd_goto_purge_confirm');
    let meta: {
      classId?: string | null;
      count?: number | null;
      students?: number | null;
      questions?: number | null;
    } = {};
    try {
      const raw = sessionStorage.getItem('cd_purge_jump');
      if (raw) meta = JSON.parse(raw) as typeof meta;
      sessionStorage.removeItem('cd_purge_jump');
    } catch {
      /* ignore */
    }
    if (hashed) {
      const qIdx = hash.indexOf('?');
      if (qIdx >= 0) {
        const q = new URLSearchParams(hash.slice(qIdx + 1));
        if (q.get('classId')) meta.classId = q.get('classId');
        if (q.get('count')) meta.count = Number(q.get('count'));
        if (q.get('students')) meta.students = Number(q.get('students'));
        if (q.get('questions')) meta.questions = Number(q.get('questions'));
      }
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    const _cdTimer = window.setTimeout(() => focusRecyclePurgeConfirm(meta), 80);
    return () => window.clearTimeout(_cdTimer);
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
        audit?: {
          lastError?: { message?: string } | null;
          retryQueueSize?: number;
          degraded?: boolean;
        };
        exportTmp?: { tmpLeaked?: number; tmpDir?: string };
      };
      const err = body.backup?.lastError;
      const auditErr = body.audit?.lastError;
      const leaked = Number(body.exportTmp?.tmpLeaked ?? 0);
      setHealthAlert({
        exportTmpLeaked: leaked,
        exportTmpDir: body.exportTmp?.tmpDir,
        auditRetryPending: Number(body.audit?.retryQueueSize ?? 0),
        auditRetryDegraded: Boolean(body.audit?.degraded),
      });
      setDiag(
        body.ok
          ? `正常 ${ms}ms · LAN ${body.lanIps?.join(', ') || '—'} · ${body.suggestedApiBase ?? ''}${
              err ? ` · backupError：${err.message ?? JSON.stringify(err)}` : ''
            }${auditErr ? ` · auditError：${auditErr.message}` : ' · 无 lastError'}${
              leaked > 0 ? ` · exportTmp 泄漏 ${leaked}` : ''
            }`
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
      <h2>{t('设置')}</h2>
      {forcePasswordOnly ? (
        <p className="error">{t('首次/联调口令登录：必须先改成个人密码才能使用其它功能。')}</p>
      ) : null}
      {!forcePasswordOnly ? (
        <>
          <label data-testid="ui-locale-select-label">
            {t('界面语言')}
            <select
              data-testid="ui-locale-select"
              value={uiLocale}
              onChange={(e) => {
                const next = normalizeUiLocale(e.target.value);
                setUiLocaleState(next);
                void api('/api/v1/settings', {
                  method: 'PATCH',
                  body: JSON.stringify({ uiLocale: next }),
                })
                  .then(() => {
                    setUiLocaleMsg(t('已保存界面语言'));
                    window.dispatchEvent(
                      new CustomEvent('cd-ui-locale', { detail: { uiLocale: next } }),
                    );
                  })
                  .catch((err) =>
                    setUiLocaleMsg(err instanceof Error ? err.message : t('保存失败')),
                  );
              }}
            >
              {UI_LOCALES.map((loc) => (
                <option key={loc} value={loc}>
                  {UI_LOCALE_LABELS[loc]}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">{t('学生端跟随教室语言，学生不可自行更改。')}</p>
          {uiLocaleMsg ? (
            <p className="hint" data-testid="ui-locale-save-msg">
              {uiLocaleMsg}
            </p>
          ) : null}
          <button type="button" onClick={() => void runDiag()}>
            {t('一键检测 /health')}
          </button>
          <p className="hint">
            {t('顶栏 /health 轮询：生产默认 30s，开发默认 8s。也可构建时设 VITE_HEALTH_POLL_MS。')}
          </p>
          <label>
            {t('/health 轮询间隔（毫秒，3000–120000）')}
            <input
              type="number"
              min={3000}
              max={120000}
              step={1000}
              data-testid="health-poll-ms"
              value={healthPollMsDraft}
              onChange={(e) => setHealthPollMsDraft(e.target.value)}
              onBlur={(e) => {
                const raw = Math.trunc(Number(e.currentTarget.value));
                const ms = Math.min(120_000, Math.max(3_000, Number.isFinite(raw) && raw > 0 ? raw : 30_000));
                setHealthPollMsDraft(String(ms));
                localStorage.setItem('cd_health_poll_ms', String(ms));
                setHealthPollMsg(`已写入 localStorage.cd_health_poll_ms=${ms}（立即重载轮询）`);
                setHealthPollTick((n) => n + 1);
                window.dispatchEvent(new Event('cd-health-poll-changed'));
              }}
            />
          </label>
          <p className="hint" data-testid="health-poll-effective">
            {t('当前生效间隔：{v0}ms（{v1}）', {
              v0: healthPollEffectiveMs,
              v1: healthPollSource,
            })}
          </p>
          <div className="row">
            <button
              type="button"
              className="secondary"
              data-testid="health-poll-reset"
              onClick={() => {
                localStorage.removeItem('cd_health_poll_ms');
                const fallback = import.meta.env.PROD ? 30_000 : 8_000;
                setHealthPollMsDraft(String(fallback));
                setHealthPollMsg(`已恢复默认 ${fallback}ms`);
                setHealthPollTick((n) => n + 1);
                window.dispatchEvent(new Event('cd-health-poll-changed'));
              }}
            >
              恢复默认间隔
            </button>
            {healthPollMsg ? <p className="hint">{healthPollMsg}</p> : null}
          </div>
          {diag ? <p className="hint">{diag}</p> : null}
          {healthAlert && (healthAlert.exportTmpLeaked ?? 0) > 0 ? (
            <div className="error" data-testid="export-tmp-leak-alert" role="alert">
              <p>
                导出临时文件泄漏 {healthAlert.exportTmpLeaked} 个（/health.exportTmp.tmpLeaked）。
                {healthAlert.exportTmpDir ? (
                  <>
                    {' '}
                    目录：<code data-testid="export-tmp-dir">{healthAlert.exportTmpDir}</code>
                  </>
                ) : null}
              </p>
              <div className="row">
                <button
                  type="button"
                  className="secondary"
                  data-testid="export-tmp-copy-dir"
                  onClick={() => {
                    const dir = healthAlert.exportTmpDir ?? '';
                    if (!dir) return;
                    void navigator.clipboard?.writeText(dir).then(
                      () => setExportTmpMsg('已复制临时目录路径（请在教师机访达/资源管理器打开）'),
                      () => setExportTmpMsg(dir),
                    );
                  }}
                >
                  复制临时目录路径
                </button>
                <button
                  type="button"
                  className="secondary"
                  data-testid="export-tmp-cleanup"
                  onClick={() =>
                    void api<{ message?: string }>('/api/v1/ops/export-tmp/cleanup', {
                      method: 'POST',
                      body: '{}',
                    })
                      .then((r) => {
                        setExportTmpMsg(r.message ?? '已清理');
                        void runDiag();
                      })
                      .catch((e) =>
                        setExportTmpMsg(e instanceof Error ? e.message : '清理失败'),
                      )
                  }
                >
                  一键清理泄漏临时文件
                </button>
              </div>
            </div>
          ) : null}
          {exportTmpMsg ? (
            <p className="hint" data-testid="export-tmp-cleanup-msg" role="status">
              {exportTmpMsg}
            </p>
          ) : null}
          {healthAlert &&
          ((healthAlert.auditRetryPending ?? 0) > 0 || healthAlert.auditRetryDegraded) ? (
            <div className="row" data-testid="audit-retry-flush-bar">
              <p className="error" role="alert">
                {t('审计重试队列积压 {v0}', { v0: healthAlert.auditRetryPending ?? 0 })}
                {healthAlert.auditRetryDegraded ? t('（degraded）') : ''}
              </p>
              <button
                type="button"
                className="secondary"
                data-testid="audit-retry-flush"
                onClick={() =>
                  void api<{ message?: string }>('/api/v1/ops/audit-retry/flush', {
                    method: 'POST',
                    body: '{}',
                  })
                    .then((r) => {
                      setFlushMsg(r.message ?? t('已 flush'));
                      void runDiag();
                    })
                    .catch((e) =>
                      setFlushMsg(e instanceof Error ? e.message : t('flush 失败')),
                    )
                }
              >
                {t('立即 flush 审计队列')}
              </button>
            </div>
          ) : null}
          {flushMsg ? (
            <p className="hint" data-testid="audit-retry-flush-msg" role="status">
              {flushMsg}
            </p>
          ) : null}
        </>
      ) : null}

      <h3>{t('教师登录密码')}</h3>
      <p className={pwdWeakExact || pwdTooShort || pwdNeedMixed ? 'error' : 'hint'}>{pwdHint}</p>
      {newPwd.length > 0 ? (
        <div className="pwd-meter" aria-hidden>
          <span className={newPwd.length >= 8 ? 'on' : ''} />
          <span className={/[A-Za-z]/.test(newPwd) && /[0-9]/.test(newPwd) ? 'on' : ''} />
          <span className={pwdOk ? 'on' : ''} />
        </div>
      ) : null}
      <label>
        {t('当前密码')}
        <input type="password" value={curPwd} onChange={(e) => setCurPwd(e.target.value)} autoComplete="current-password" />
      </label>
      <label>
        {t('新密码')}
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
          <h3>{t('数据库备份')}</h3>
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
            <code>docs/EXIT_LOCK_MDM.md</code>{t('（备份段落）与')} <code>npm run backup:db</code>。
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
                    setBackupMsg(r.ok ? t('备份成功') : r.error ?? t('备份失败'));
                  })
                  .catch((e) => setBackupMsg(e instanceof Error ? e.message : t('备份失败')))
              }
            >
              {t('立即备份')}
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
                      setBackupMsg(t('已在教师机打开备份目录：{v0}', { v0: r.dir ?? '' }));
                    } else {
                      setBackupMsg(
                        r.dir
                          ? t('备份目录：{v0}{v1} — 可用「复制路径」', {
                              v0: r.dir,
                              v1: r.message ? `（${r.message}）` : t('（无图形环境）'),
                            })
                          : r.message ?? t('无法读取备份目录'),
                      );
                    }
                  })
                  .catch((e) => setBackupMsg(e instanceof Error ? e.message : t('打开失败')))
              }
            >
              {t('显示备份目录')}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={!backupDirPath && !backupInfo?.dir}
              onClick={() => {
                const dir = backupDirPath || backupInfo?.dir || '';
                if (!dir) {
                  setBackupMsg(t('尚无备份目录路径'));
                  return;
                }
                void navigator.clipboard
                  .writeText(dir)
                  .then(() => setBackupMsg(t('已复制路径：{v0}', { v0: dir })))
                  .catch(() => {
                    window.prompt(t('复制备份目录路径'), dir);
                    setBackupMsg(t('路径：{v0}', { v0: dir }));
                  });
              }}
            >
              {t('复制路径')}
            </button>
          </div>
          {backupMsg ? <p className="hint">{backupMsg}</p> : null}

          <h3>{t('弱口令扩展列表')}</h3>
          <p className="hint">{t('每行一条；与内置联调口令合并后用于改密校验（单一策略数据源）。')}</p>
          <label>
            {t('额外弱口令')}
            <textarea
              rows={4}
              value={weakExtraDraft}
              onChange={(e) => setWeakExtraDraft(e.target.value)}
              placeholder={t('每行一条弱口令（不含演示账号）')}
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
                    setSaveMsg(
                      t('已保存扩展弱口令 {v0} 条（合计策略 {v1}）', {
                        v0: list.length,
                        v1: (r.weakPasswords ?? []).length,
                      }),
                    );
                  }),
                )
                .catch((e) => setSaveMsg(e instanceof Error ? e.message : t('保存失败')));
            }}
          >
            {t('保存弱口令扩展')}
          </button>

          <h3>{t('数据保留 / 备份加密')}</h3>
          <p className="hint">
            {t(
              '回收站默认 {v0} 天（与 @classroom-desk/shared · docs/PERMISSIONS.md 对齐）；调度按 recycle_retention_days 自动 purge。即将到期高亮阈值默认 ≤{v1} 天。',
              { v0: RECYCLE_RETENTION_DAYS, v1: RECYCLE_URGENT_DAYS },
            )}
          </p>
          <label>
            {t('回收站保留天数')}
            <input
              type="number"
              min={1}
              max={365}
              id="recycle-retention-days"
              data-testid="recycle-retention-days"
              value={recycleDays}
              onChange={(e) => setRecycleDays(Number(e.target.value) || 1)}
              onBlur={(e) => {
                const days = Math.max(
                  1,
                  Math.min(365, Math.trunc(Number(e.currentTarget.value)) || RECYCLE_RETENTION_DAYS),
                );
                setRecycleDays(days);
                void api('/api/v1/settings', {
                  method: 'PATCH',
                  body: JSON.stringify({ recycleRetentionDays: days }),
                })
                  .then(() =>
                    setSaveMsg(t('回收站保留 {v0} 天（调度按此 purge）', { v0: days })),
                  )
                  .catch((err) => setSaveMsg(te(err, '保存失败')));
              }}
            />
          </label>
          {recycleDays !== RECYCLE_RETENTION_DAYS ? (
            <p className="hint" data-testid="recycle-retention-mismatch">
              {t(
                '当前 {v0} 天，与 shared / 文档默认 {v1} 天不一致（可改回默认；升级时仅会自动把历史默认 30 迁到 {v1}）。',
                { v0: recycleDays, v1: RECYCLE_RETENTION_DAYS },
              )}
            </p>
          ) : null}
          <label>
            {t('即将到期高亮（剩余天数 ≤）')}
            <input
              type="number"
              min={0}
              max={30}
              data-testid="recycle-urgent-days"
              value={recycleUrgentDays}
              onChange={(e) => setRecycleUrgentDays(Number(e.target.value) || 0)}
              onBlur={(e) => {
                // Read from the input — avoid stale state if blur races ahead of onChange re-render.
                const days = Math.max(0, Math.min(30, Math.trunc(Number(e.currentTarget.value)) || 0));
                setRecycleUrgentDays(days);
                void api('/api/v1/settings', {
                  method: 'PATCH',
                  body: JSON.stringify({ recycleUrgentDays: days }),
                })
                  .then(() =>
                    setSaveMsg(t('即将到期阈值：剩余 ≤{v0} 天时醒目', { v0: days })),
                  )
                  .catch((err) => setSaveMsg(te(err, '保存失败')));
              }}
            />
          </label>
          {/即将到期阈值|Urgent due-soon threshold/.test(saveMsg) ? (
            <p className="hint" data-testid="recycle-urgent-save-msg">
              {saveMsg}
            </p>
          ) : null}
          {purgeJumpHint ? (
            <p
              className={
                /无已过期|无过期|no expired|尚未有過期|期限切れなし|만료된/.test(purgeJumpHint)
                  ? 'error'
                  : 'hint'
              }
              data-testid="purge-jump-hint"
            >
              {t('审计跳转：')}
              {purgeJumpHint}
              {/无已过期|无过期|no expired|尚未有過期|期限切れなし|만료된/.test(purgeJumpHint) ? (
                <>
                  {' '}
                  <button
                    type="button"
                    className="linkish"
                    data-testid="purge-jump-retention"
                    onClick={() => {
                      const el = document.getElementById('recycle-retention-days');
                      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      if (el instanceof HTMLInputElement) el.focus();
                    }}
                  >
                    {t('去改保留天数')}
                  </button>
                </>
              ) : null}
            </p>
          ) : null}
          <div className="row" id="recycle-purge-confirm" data-testid="recycle-purge-confirm">
            <button
              type="button"
              className="secondary"
              onClick={() =>
                void api<{ message?: string; students?: number; questions?: number }>(
                  '/api/v1/settings/recycle-purge-now',
                  { method: 'POST', body: JSON.stringify({ dryRun: true }) },
                )
                  .then((r) =>
                    setSaveMsg(
                      r.message ??
                        t('预览 学生{v0} 题目{v1}', { v0: r.students, v1: r.questions }),
                    ),
                  )
                  .catch((e) => setSaveMsg(e instanceof Error ? e.message : t('预览失败')))
              }
            >
              {t('预览将 purge 数量')}
            </button>
            <button
              type="button"
              id="recycle-purge-confirm-btn"
              className="secondary"
              onClick={() => {
                void api<{ message?: string; students?: number; questions?: number }>(
                  '/api/v1/settings/recycle-purge-now',
                  { method: 'POST', body: JSON.stringify({ dryRun: true }) },
                )
                  .then((preview) => {
                    if (
                      !window.confirm(
                        `${
                          preview.message ??
                          t('将删学生 {v0} · 题目 {v1}', {
                            v0: preview.students,
                            v1: preview.questions,
                          })
                        }\n${t('确认执行硬删？')}`,
                      )
                    ) {
                      return;
                    }
                    return api<{ message?: string; students?: number; questions?: number }>(
                      '/api/v1/settings/recycle-purge-now',
                      { method: 'POST', body: JSON.stringify({ dryRun: false }) },
                    ).then((r) =>
                      setSaveMsg(
                        r.message ??
                          t('已清理 学生{v0} 题目{v1}', { v0: r.students, v1: r.questions }),
                      ),
                    );
                  })
                  .catch((e) => setSaveMsg(e instanceof Error ? e.message : t('清理失败')));
              }}
            >
              {t('预览后执行 purge')}
            </button>
          </div>
          <label>
            {t('备份加密口令（可留空）')}
            <input
              type="password"
              value={restorePass}
              onChange={(e) => setRestorePass(e.target.value)}
              autoComplete="new-password"
              placeholder={t('设置后立即备份将额外写 .enc')}
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
                .then(() =>
                  setSaveMsg(restorePass ? t('已保存备份加密口令') : t('已清空备份加密口令')),
                )
                .catch((e) => setSaveMsg(e instanceof Error ? e.message : t('保存失败')));
            }}
          >
            {t('保存备份口令')}
          </button>

          <h3>{t('备份恢复向导')}</h3>
          <p className="hint">{t('先解密/校验哈希并查看停服清单；确认后再 commit 替换 live DB（会先写 .pre-restore-*）。')}</p>
          <label>
            {t('恢复确认码邮箱')}
            <input
              type="email"
              value={restoreConfirmEmail}
              onChange={(e) => setRestoreConfirmEmail(e.target.value)}
              autoComplete="email"
              placeholder={t('用于接收恢复确认码')}
            />
          </label>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              void api('/api/v1/settings', {
                method: 'PATCH',
                body: JSON.stringify({ restoreConfirmEmail: restoreConfirmEmail.trim() }),
              })
                .then(() =>
                  setBackupMsg(
                    restoreConfirmEmail.trim()
                      ? t('已保存恢复确认码邮箱（确认码不会显示在页面上）')
                      : t('已清空恢复确认码邮箱'),
                  ),
                )
                .catch((e) => setBackupMsg(e instanceof Error ? e.message : t('保存失败')));
            }}
          >
            {t('保存确认码邮箱')}
          </button>
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
                  emailDelivered?: boolean;
                  mailtoUrl?: string | null;
                }>('/api/v1/settings/backup-restore-preview', {
                  method: 'POST',
                  body: JSON.stringify({
                    fileName: restoreFile,
                    passphrase: restorePass,
                    commit: false,
                  }),
                })
                  .then(
                    (r: {
                      checklist?: string[];
                      sha256?: string;
                      confirmCode?: string;
                      mailtoUrl?: string | null;
                      emailDelivered?: boolean;
                      webhookError?: string | null;
                      restoredPath?: string;
                    }) => {
                    setRestoreChecklist(r.checklist ?? []);
                    setRestoreSha(r.sha256 ?? '');
                    setRestoreConfirmCode(r.confirmCode ?? '');
                    setRestoreConfirmInput('');
                    setRestoreMailtoUrl(r.mailtoUrl ?? '');
                    setRestoreEmailDelivered(r.emailDelivered === true);
                    if (r.webhookError) {
                      toast.err(`邮件 webhook 失败：${r.webhookError}（已写审计，请用剪贴板确认码）`);
                    }
                    const channel =
                      r.emailDelivered === true
                        ? t('已投递 webhook')
                        : r.webhookError
                          ? `webhook 失败（${r.webhookError}）`
                          : r.mailtoUrl
                            ? '可点「发到邮箱/打开邮件」'
                            : '请复制确认码，或先保存确认码邮箱后重新校验';
                    setBackupMsg(
                      `校验通过 · ${channel}（页面不回显确认码）${r.restoredPath ? ` → ${r.restoredPath}` : ''}`,
                    );
                  },
                  )
                  .catch((e) => setBackupMsg(e instanceof Error ? e.message : t('恢复失败')));
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
                    setRestoreMailtoUrl('');
                    setRestoreEmailDelivered(false);
                    setBackupMsg(r.message ?? t('已替换 live DB，请重启服务'));
                  })
                  .catch((e) => setBackupMsg(e instanceof Error ? e.message : t('替换失败')));
              }}
            >
              {t('2. 输入确认码后替换 live DB')}
            </button>
          </div>
          {restoreSha ? <p className="hint">sha256={restoreSha}</p> : null}
          {restoreConfirmCode ? (
            <div className="row">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(restoreConfirmCode)
                    .then(() => {
                      setBackupMsg(t('确认码已复制到剪贴板（仅此一次，页面不回显）'));
                      setRestoreConfirmCode('');
                    })
                    .catch(() => {
                      setBackupMsg(
                        t('无法写入剪贴板：请允许站点剪贴板权限后重试，或查收邮件中的确认码'),
                      );
                      /* keep restoreConfirmCode so user can retry copy — never echo digits into UI */
                    });
                }}
              >
                {t('复制确认码（一次）')}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={restoreEmailDelivered || !restoreMailtoUrl}
                onClick={() => {
                  if (restoreEmailDelivered || !restoreMailtoUrl) return;
                  window.location.href = restoreMailtoUrl;
                  setBackupMsg(t('已打开邮件草稿（确认码在邮件正文，页面不回显）'));
                }}
              >
                {restoreEmailDelivered ? t('已投递 webhook') : t('发到邮箱/打开邮件')}
              </button>
              {restoreEmailDelivered ? <p className="hint">{t('已投递 webhook')}</p> : null}
              <label>
                {t('粘贴二次确认码')}
                <input
                  value={restoreConfirmInput}
                  onChange={(e) => setRestoreConfirmInput(e.target.value)}
                  placeholder={t('从剪贴板或邮件粘贴')}
                  autoComplete="one-time-code"
                />
              </label>
            </div>
          ) : restoreSha ? (
            <div className="row">
              <button
                type="button"
                className="secondary"
                disabled={restoreEmailDelivered || !restoreMailtoUrl}
                onClick={() => {
                  if (restoreEmailDelivered || !restoreMailtoUrl) return;
                  window.location.href = restoreMailtoUrl;
                  setBackupMsg(t('已打开邮件草稿（确认码在邮件正文，页面不回显）'));
                }}
              >
                {restoreEmailDelivered ? t('已投递 webhook') : t('发到邮箱/打开邮件')}
              </button>
              {restoreEmailDelivered ? <p className="hint">{t('已投递 webhook')}</p> : null}
              <label>
                {t('粘贴二次确认码')}
                <input
                  value={restoreConfirmInput}
                  onChange={(e) => setRestoreConfirmInput(e.target.value)}
                  placeholder={t('从剪贴板或邮件粘贴')}
                  autoComplete="one-time-code"
                />
              </label>
            </div>
          ) : null}
          {restoreChecklist.length ? (
            <ol className="hint">
              {restoreChecklist.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          ) : null}

          <h3>{t('运维调度')}</h3>
          <label>
            漂移快照间隔（分钟，0=关闭）
            <input
              type="number"
              min={0}
              max={1440}
              value={driftMins}
              onChange={(e) => setDriftMins(Number(e.target.value) || 0)}
              onBlur={(e) => {
                const mins = Math.max(0, Math.min(1440, Math.trunc(Number(e.currentTarget.value)) || 0));
                setDriftMins(mins);
                void api('/api/v1/settings', {
                  method: 'PATCH',
                  body: JSON.stringify({ fleetDriftSnapshotMinutes: mins }),
                })
                  .then(() => setSaveMsg(`漂移快照间隔 ${mins} 分钟`))
                  .catch((err) => setSaveMsg(te(err, '保存失败')));
              }}
            />
          </label>
          <label id="unhardened-alert-threshold">
            未加固告警阈值（0–1，健康仪表盘；默认 0.25=25%）
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              data-testid="unhardened-alert-threshold"
              value={unhardenedThresh}
              onChange={(e) => setUnhardenedThresh(Number(e.target.value))}
              onBlur={(e) => {
                let thresh = Number(e.currentTarget.value);
                if (!Number.isFinite(thresh)) thresh = 0.25;
                thresh = Math.max(0, Math.min(1, thresh));
                setUnhardenedThresh(thresh);
                void api('/api/v1/settings', {
                  method: 'PATCH',
                  body: JSON.stringify({ unhardenedAlertThreshold: thresh }),
                })
                  .then(() => setSaveMsg(`未加固告警阈值 ${(thresh * 100).toFixed(0)}%`))
                  .catch((err) => setSaveMsg(te(err, '保存失败')));
              }}
            />
          </label>
          <div className="row">
            <p className="hint" data-testid="fleet-drift-snapshot-last" style={{ margin: 0 }}>
              上次 fleet.drift_snapshot：
              {driftLastAt ? new Date(driftLastAt).toLocaleString() : '尚无'}
            </p>
            <button
              type="button"
              className="secondary"
              data-testid="fleet-drift-snapshot-now"
              disabled={driftSnapBusy}
              onClick={() => {
                setDriftSnapBusy(true);
                void api<{ at?: string; message?: string }>('/api/v1/ops/fleet-drift-snapshot', {
                  method: 'POST',
                  body: '{}',
                })
                  .then((r) => {
                    if (r.at) setDriftLastAt(r.at);
                    else setDriftLastAt(new Date().toISOString());
                    setSaveMsg(r.message ?? '已拍漂移快照');
                  })
                  .catch((e) => setSaveMsg(e instanceof Error ? e.message : '快照失败'))
                  .finally(() => setDriftSnapBusy(false));
              }}
            >
              {driftSnapBusy ? '拍摄中…' : '立即拍一次'}
            </button>
          </div>
          <label>
            升级包保留份数（1–20）
            <input
              type="number"
              min={1}
              max={20}
              value={upgradesKeep}
              onChange={(e) => setUpgradesKeep(Number(e.target.value) || 1)}
              onBlur={(e) => {
                const n = Math.max(1, Math.min(20, Math.trunc(Number(e.currentTarget.value)) || 3));
                setUpgradesKeep(n);
                void api<{ pruned?: string[] }>('/api/v1/settings', {
                  method: 'PATCH',
                  body: JSON.stringify({ upgradesKeepCount: n }),
                })
                  .then((r) => {
                    const pruned = Array.isArray(r.pruned) ? r.pruned : [];
                    setPrunedFiles(pruned);
                    setSaveMsg(
                      `升级包保留最新 ${n} 份${
                        pruned.length ? `，已清理 ${pruned.length} 个旧文件` : ''
                      }`,
                    );
                  })
                  .catch((err) => setSaveMsg(te(err, '保存失败')));
              }}
            />
          </label>
          {prunedFiles.length ? (
            <div data-testid="upgrades-pruned-list">
              <p className="hint">{t('本次已删旧包：')}</p>
              <ul className="hint">
                {prunedFiles.map((f) => (
                  <li key={f}>
                    <code>{f}</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <h3>{t('学生机升级包')}</h3>
          <p className="hint">{t('上传 Setup.exe → 自动 sha256 → 旧包自动删。')}</p>
          <label className="row" data-testid="student-auto-update-toggle">
            <input
              type="checkbox"
              checked={studentAutoUpdate}
              onChange={(e) => {
                const on = e.target.checked;
                setStudentAutoUpdate(on);
                void api('/api/v1/settings', {
                  method: 'PATCH',
                  body: JSON.stringify({ studentAutoUpdate: on }),
                })
                  .then(() =>
                    setUpgradeMsg(
                      on
                        ? t('已开启：学生机强制跟教师端同版本（学生不可取消）')
                        : t('已关闭学生强制同版本'),
                    ),
                  )
                  .catch((err) => {
                    setStudentAutoUpdate(!on);
                    setUpgradeMsg(te(err, '保存失败'));
                  });
              }}
            />
            {t('学生机强制跟教师端同版本（教师可选，默认关；开启后学生不可取消）')}
          </label>
          <p className="hint">
            {t('须先上传本版 Setup.exe。开启后版本不一致的学生机会下载局域网安装包并静默安装。')}
          </p>
          <label className="secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {t('上传 Setup.exe')}
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
                    const uploaded = body.name ?? file.name;
                    if (/\.exe$/i.test(uploaded)) {
                      try {
                        const v = await api<{ message?: string; match?: boolean | null }>(
                          '/api/v1/upgrades/verify-sha256',
                          { method: 'POST', body: JSON.stringify({ name: uploaded }) },
                        );
                        setUpgradeMsg(
                          t('已上传并校验：{v0}{v1}', {
                            v0: uploaded,
                            v1: v.message ? ` · ${v.message}` : '',
                          }),
                        );
                      } catch {
                        setUpgradeMsg(
                          t('已上传 {v0}（sha256 校验失败，请删包重传）', { v0: uploaded }),
                        );
                      }
                    } else {
                      setUpgradeMsg(t('已上传 {v0}', { v0: uploaded }));
                    }
                    return api<{ files?: Array<{ name: string } | string> }>('/api/v1/upgrades');
                  })
                  .then((r) =>
                    setUpgradeFiles(
                      (r.files ?? []).map((f) => (typeof f === 'string' ? f : f.name)).filter(Boolean),
                    ),
                  )
                  .catch((err) => setUpgradeMsg(err instanceof Error ? err.message : t('上传失败')));
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
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        if (!window.confirm(t('删除 {v0}？', { v0: f }))) return;
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
                            setUpgradeMsg(t('已删除 {v0}', { v0: f }));
                          })
                          .catch((e) =>
                            setUpgradeMsg(e instanceof Error ? e.message : t('删除失败')),
                          );
                      }}
                    >
                      {t('删除')}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">{t('尚无升级包')}</p>
          )}

          <h3>{t('投影只读自动开启')}</h3>
          <p className="hint">{t('按本场出勤课次 startAt 起算，N 分钟后投影自动只读。0 = 关闭。')}</p>
          <label>
            {t('上课后分钟数')}
            <input
              type="number"
              min={0}
              max={240}
              data-testid="liveboard-readonly-mins"
              value={readonlyAfterMins}
              onChange={(e) => setReadonlyAfterMins(Number(e.target.value) || 0)}
              onBlur={(e) => {
                const mins = Math.max(0, Math.min(240, Math.trunc(Number(e.currentTarget.value)) || 0));
                setReadonlyAfterMins(mins);
                void api('/api/v1/settings', {
                  method: 'PATCH',
                  body: JSON.stringify({ liveboardReadonlyAfterMinutes: mins }),
                })
                  .then(() =>
                    setSaveMsg(t('投影只读自动开启已设为 {v0} 分钟', { v0: mins })),
                  )
                  .catch((err) => setSaveMsg(te(err, '保存失败')));
              }}
            />
          </label>
          <p className="hint">{t('失焦即保存（与回收站天数等数字框一致）。')}</p>
          <h3>{t('留言')}</h3>
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
                  .catch((err) => setSaveMsg(te(err, '保存失败')))
              }
            />
            {t('允许学生留言（关闭后侧栏隐藏「留言」）')}
          </label>

          <h3>{t('答题确认')}</h3>
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
                  .catch((err) => setSaveMsg(te(err, '保存失败')))
              }
            />
            {t('单选/判断二次确认提交（默认开启）')}
          </label>

          <h3>{t('加分请求')}</h3>
          <label>
            {t('有效期（分钟）')}
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
                .catch((e) => setSaveMsg(e instanceof Error ? e.message : t('保存失败')))
            }
          >
            保存设置
          </button>
          {saveMsg ? (
            <p className="hint" data-testid="settings-save-msg">
              {saveMsg}
            </p>
          ) : null}

          <div className="card">
            <h3>{t('创建助教账号')}</h3>
            {assistantsLiveMode === 'poll' ? (
              <p className="hint" data-testid="assistants-sse-fallback-badge" role="status">
                <span className="badge" data-testid="assistants-sse-polling-badge">
                  {t('轮询中')}
                </span>{' '}
                {t('实时通道降级为轮询（弱网/SSE 断开，恢复后自动切回）')}
              </p>
            ) : (
              <p className="hint" data-testid="assistants-sse-live-badge">
                {t('助教列表：SSE 实时推送')}
              </p>
            )}
            <p className="hint">{t('助教可登录后台只读导出/出勤，不可批量删除。详见 docs/PERMISSIONS.md。')}</p>
            <label>
              {t('用户名')}
              <input
                value={asstUser}
                onChange={(e) => setAsstUser(e.target.value)}
                placeholder={t('用户名（登录用）')}
                autoComplete="off"
              />
            </label>
            <label>
              {t('显示名')}
              <input value={asstName} onChange={(e) => setAsstName(e.target.value)} placeholder={t('助教')} />
            </label>
            <label>
              {t('初始口令')}
              <input
                type="password"
                value={asstPass}
                onChange={(e) => setAsstPass(e.target.value)}
                placeholder={t('至少 8 位，含字母数字')}
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
                        displayName: asstName.trim() || t('助教'),
                      }),
                    });
                    setAsstMsg(r.message ?? t('已创建'));
                    setAsstUser('');
                    setAsstPass('');
                    await loadAssistants();
                  } catch (e) {
                    setAsstMsg(e instanceof Error ? e.message : t('创建失败'));
                  }
                })()
              }
            >
              {t('创建助教')}
            </button>
            {asstMsg ? <p className={/失败|错误|已存在/.test(asstMsg) ? 'error' : 'hint'}>{asstMsg}</p> : null}
            {assistants.length ? (
              <ul data-testid="assistants-list">
                {assistants.map((a) => (
                  <li key={a.id} data-testid={`assistant-row-${a.username}`}>
                    {a.username} · {a.displayName}
                    {a.disabledAt ? t(' · 已停用') : ''} · {new Date(a.createdAt).toLocaleString()}
                    <div className="row" style={{ marginTop: 4 }}>
                      {a.disabledAt ? (
                        <button
                          type="button"
                          className="secondary"
                          data-testid={`assistant-enable-${a.username}`}
                          onClick={() =>
                            void api(`/api/v1/auth/assistants/${a.id}/enable`, {
                              method: 'POST',
                              body: '{}',
                            })
                              .then(async () => {
                                setAsstMsg(t('已启用 {v0}', { v0: a.username }));
                                await loadAssistants();
                              })
                              .catch((e) =>
                                setAsstMsg(e instanceof Error ? e.message : t('启用失败')),
                              )
                          }
                        >
                          {t('启用')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="secondary"
                          data-testid={`assistant-disable-${a.username}`}
                          onClick={() => {
                            if (
                              !window.confirm(
                                t('确认停用助教「{v0}」？停用后无法登录。', { v0: a.username }),
                              )
                            ) {
                              return;
                            }
                            void api(`/api/v1/auth/assistants/${a.id}/disable`, {
                              method: 'POST',
                              body: '{}',
                            })
                              .then(async () => {
                                setAsstMsg(t('已停用 {v0}', { v0: a.username }));
                                await loadAssistants();
                              })
                              .catch((e) =>
                                setAsstMsg(e instanceof Error ? e.message : t('停用失败')),
                              );
                          }}
                        >
                          {t('停用')}
                        </button>
                      )}
                      <input
                        type="password"
                        placeholder={t('新口令')}
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
                            if (
                              !window.confirm(
                                t('确认重置助教「{v0}」口令？', { v0: a.username }),
                              )
                            ) {
                              return;
                            }
                            try {
                              const r = await api<{ message?: string }>(
                                `/api/v1/auth/assistants/${a.id}/reset-password`,
                                { method: 'POST', body: JSON.stringify({ password }) },
                              );
                              setAsstMsg(r.message ?? t('已重置口令'));
                              setResetPwdDraft((prev) => ({ ...prev, [a.id]: '' }));
                            } catch (e) {
                              setAsstMsg(e instanceof Error ? e.message : t('重置失败'));
                            }
                          })()
                        }
                      >
                        {t('重置口令')}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          void openAssistantGrants(a.id).catch((e) =>
                            setAsstMsg(e instanceof Error ? e.message : t('加载授权失败')),
                          )
                        }
                      >
                        {t('按班授权')}
                      </button>
                    </div>
                    {grantEditId === a.id ? (
                      <div style={{ marginTop: 8 }}>
                        <p className="hint">{t('勾选「可导出 / 可加分」；全不勾 = 清空授权（全局只读导出）。')}</p>
                        {grantRows.length === 0 ? (
                          <p className="hint">{t('尚无班级')}</p>
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
                                      updateGrantRow(row.classId, { canExport: e.target.checked })
                                    }
                                  />
                                  {t('可导出')}
                                </label>
                                <label className="row">
                                  <input
                                    type="checkbox"
                                    checked={row.canAwardPoints}
                                    onChange={(e) =>
                                      updateGrantRow(row.classId, { canAwardPoints: e.target.checked })
                                    }
                                  />
                                  {t('可加分')}
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
                                setGrantMsg(e instanceof Error ? e.message : t('保存失败')),
                              )
                            }
                          >
                            {t('保存授权')}
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
                            {t('关闭')}
                          </button>
                        </div>
                        {grantMsg ? <p className="hint">{grantMsg}</p> : null}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">{t('尚无助教账号')}</p>
            )}
            <p className="hint">
              <a href={permissionsDocHref()} target="_blank" rel="noreferrer">
                {t('权限说明（PERMISSIONS.md）')}
              </a>
            </p>
          </div>
          </>
          ) : (
            <p className="hint">
              {t('助教可改本人密码、查看退出锁定审计（只读）与导出；无批量解除/轮换码。完整权限见')}{' '}
              <a href={permissionsDocHref()} target="_blank" rel="noreferrer" data-testid="permissions-doc-link">
                {t('权限说明')}
              </a>
              。
            </p>
          )}

          <h3 id="exit-lock-settings">{t('学生端退出锁定')}</h3>
          <p className="hint">
            {t('默认禁止学生关闭客户端。批量解除后，全班可在时限内退出；或本机输入解除码退出。')}
            {(() => {
              void nowTick;
              if (!exitAllowed) return t(' 当前：已锁定');
              if (!exitUnlockUntil) return t(' 当前：已允许退出');
              const left = Math.max(0, Date.parse(exitUnlockUntil) - Date.now());
              const sec = Math.ceil(left / 1000);
              const m = Math.floor(sec / 60);
              const s = String(sec % 60).padStart(2, '0');
              return t(' 当前：可退出剩余 {v0}:{v1}（至 {v2}）', {
                v0: m,
                v1: s,
                v2: new Date(exitUnlockUntil).toLocaleString(),
              });
            })()}
            <span data-testid="exit-unlock-code-status">
              {!exitCodeStatusReady
                ? t(' · 解除码状态加载中…')
                : hasExitCode
                  ? t(' · 已设置解除码')
                  : t(' · 尚未单独设置解除码（可用管理密码）')}
            </span>
            {exitCodeStatusReady && codeAgeDays != null
              ? t(' · 解除码已使用 {v0} 天', { v0: codeAgeDays })
              : ''}
          </p>
          {codeRotationDue ? (
            <p className="error">
              {t('解除码已超过轮换周期（{v0} 天），请尽快更换。', { v0: rotateDays })}
            </p>
          ) : null}
          <h4 id="input-lock-settings">{t('物理输入锁')}</h4>
          <p className="hint">
            {t(
              '上课页也有同样的快捷锁定。这里可改范围（全校/机位）与课次到期。仅限制本应用（退出锁 / 键鼠语音相机），不管其它进程、浏览器标签或系统 App；整机请学校 IT 配 Assigned Access / Intune（见 docs/EXIT_LOCK_MDM.md）。',
            )}{' '}
            <a
              href="https://github.com/otas0/classroom-desk/blob/main/docs/EXIT_LOCK_MDM.md"
              target="_blank"
              rel="noreferrer"
            >
              docs/EXIT_LOCK_MDM.md
            </a>
          </p>
          <ClassroomLockBar classId={currentTeacherClassId()} />
          <DeepLockBar classId={currentTeacherClassId()} />
          <NetworkZonesPanel />
          {isAssistant() ? (
            <div data-testid="input-lock-readonly">
              <p className="hint">
                {t('当前：键盘 {v0} · 鼠标 {v1} · 语音 {v2} · 相机 {v3}（助教只读）', {
                  v0: inputLock.keyboard ? t('锁') : t('开'),
                  v1: inputLock.mouse ? t('锁') : t('开'),
                  v2: inputLock.voice ? t('锁') : t('开'),
                  v3: inputLock.camera ? t('锁') : t('开'),
                })}
              </p>
              <p className="row" data-testid="input-lock-scope-badge">
                <span className="hint">{t('作用范围')}</span>
                <span
                  className="badge"
                  data-testid={`input-lock-scope-badge-${inputLockCoverage}`}
                  title={inputLockScopeLabel}
                >
                  {inputLockCoverage === 'seat'
                    ? '机位'
                    : inputLockCoverage === 'class'
                      ? t('班级')
                      : t('全局')}
                  {inputLockScopeLabel ? ` · ${inputLockScopeLabel}` : ''}
                </span>
                {examModeSnapshot ? (
                  <span className="badge" data-testid="exam-mode-snapshot-badge">
                    考试模式快照中
                  </span>
                ) : null}
              </p>
              <p className="hint" data-testid="input-lock-expires-readonly">
                课次自动到期：
                {inputLockExpiresAt
                  ? new Date(inputLockExpiresAt).toLocaleString()
                  : '未绑定'}
                {inputLockSsePolling ? (
                  <>
                    {' '}
                    <span className="badge" data-testid="input-lock-sse-polling-badge">
                      轮询中
                    </span>
                  </>
                ) : null}
              </p>
            </div>
          ) : (
            <div className="card" data-testid="input-lock-controls">
              <details className="lock-advanced" data-testid="input-lock-advanced">
                <summary>{t('高级选项（范围 / 机位 / 课次到期）')}</summary>
          <label>
                {t('作用范围')}
                <select
                  data-testid="input-lock-scope"
                  value={inputLockScope}
                  onChange={(e) =>
                    setInputLockScope(e.target.value as 'global' | 'class' | 'seat')
                  }
                >
                  <option value="global">{t('全校全局')}</option>
                  <option value="class">{t('当前班级')}</option>
                  <option value="seat">{t('当前班级 · 指定机位')}</option>
                </select>
              </label>
              {inputLockScope === 'seat' ? (
                <>
                  <label>
                    在线机位（自动，无需手填）
                    <select
                      data-testid="input-lock-seat-pick"
                      value={
                        inputLockSeatOptions.some((o) => o.value === inputLockSeatId)
                          ? inputLockSeatId
                          : ''
                      }
                      onChange={(e) => setInputLockSeatId(e.target.value)}
                    >
                      <option value="">{t('选择座位 / 机位…')}</option>
                      <optgroup label="已排座（seat_map.id）">
                        {inputLockSeatOptions
                          .filter((o) => o.group === 'seated')
                          .map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                      </optgroup>
                      <optgroup label="未排座 / 仅 clientId">
                        {inputLockSeatOptions
                          .filter((o) => o.group === 'clientOnly')
                          .map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                      </optgroup>
                    </select>
                  </label>
                  <label>
                    或手动机位 / 客户端 ID
            <input
                      data-testid="input-lock-seat-id"
                      value={inputLockSeatId}
                      onChange={(e) => setInputLockSeatId(e.target.value)}
                      placeholder="通常从上方选择即可"
            />
          </label>
                  {inputLockSeatId.trim() ? (
                    <p className="hint row" data-testid="input-lock-seat-id-readonly">
                      当前选中 seat_map.id（只读核对）：
                      <code>{inputLockSeatId.trim()}</code>
                      <button
                        type="button"
                        className="secondary"
                        data-testid="input-lock-seat-id-copy"
                        onClick={() => {
                          const id = inputLockSeatId.trim();
                          void navigator.clipboard
                            ?.writeText(id)
                            .then(() => {
                              setSeatIdCopied(true);
                              setExitMsg(t('已复制 seat_map.id：{v0}', { v0: id }));
                              window.setTimeout(() => setSeatIdCopied(false), 2000);
                            })
                            .catch(() => setExitMsg(t('复制失败，请手动选中复制')));
                        }}
                      >
                        {seatIdCopied ? t('已复制') : t('复制 id')}
                      </button>
                    </p>
                  ) : null}
                </>
              ) : null}
              {(
                [
                  ['keyboard', t('禁止键盘输入')],
                  ['mouse', t('禁止鼠标/点击（保留「向教师举手」）')],
                  ['voice', t('禁止语音/麦克风')],
                  ['camera', t('禁止相机')],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="row">
                  <input
                    type="checkbox"
                    checked={inputLock[key]}
                    disabled={inputLockBusy}
                    data-testid={`input-lock-${key}`}
                    onChange={(e) => patchInputLock({ ...inputLock, [key]: e.target.checked })}
                  />
                  {label}
                </label>
              ))}
          <div className="row">
            <button
              type="button"
                  className="secondary"
                  disabled={inputLockBusy}
                  data-testid="input-lock-all"
              onClick={() =>
                    patchInputLock({
                      keyboard: true,
                      mouse: true,
                      voice: true,
                      camera: true,
                    })
                  }
                >
                  全部锁定
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={inputLockBusy || clearAllBusy}
                  data-testid="input-lock-none"
                  title={t('清空全局 / 班级 / 机位全部物理输入锁')}
                  onClick={() => {
                    setClearAllMeta({
                      classN: inputLockClassCount,
                      seatN: inputLockSeatCount,
                      clearExamSnap: examModeSnapshot,
                    });
                    setClearAllOpen(true);
                  }}
                >
                  全部解除
                </button>
              </div>
              <div className="row" data-testid="input-lock-ttl">
                <label>
                  课次自动到期（出勤 session）
                  <select
                    data-testid="input-lock-ttl-session"
                    value={inputLockSessionId}
                    disabled={inputLockBusy}
                    onChange={(e) => setInputLockSessionId(e.target.value)}
                  >
                    <option value="">{t('不绑定课次')}</option>
                    {attendanceSessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {new Date(s.startAt).toLocaleString()} → {new Date(s.endAt).toLocaleString()}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="secondary"
                  disabled={inputLockBusy || !inputLockSessionId}
                  data-testid="input-lock-ttl-bind"
                  onClick={() => {
                    if (!inputLockSessionId) return;
                    setInputLockBusy(true);
                    void api('/api/v1/settings', {
                      method: 'PATCH',
                      body: JSON.stringify({
                        inputLock: { bindAttendanceSessionId: inputLockSessionId },
                      }),
                    })
                      .then(async (r) => {
                        const body = r as { inputLockExpiresAt?: string | null };
                        setInputLockExpiresAt(body.inputLockExpiresAt ?? null);
                        setExitMsg(
                          body.inputLockExpiresAt
                            ? `已绑定课次到期：${new Date(body.inputLockExpiresAt).toLocaleString()}`
                            : '已绑定课次到期',
                        );
                        await refreshExitLock().catch(() => undefined);
                      })
                      .catch((e) => setExitMsg(e instanceof Error ? e.message : '绑定课次失败'))
                      .finally(() => setInputLockBusy(false));
                  }}
                >
                  绑定到期
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={inputLockBusy || !inputLockExpiresAt}
                  data-testid="input-lock-ttl-clear"
                  onClick={() => {
                    setInputLockBusy(true);
                    void api('/api/v1/settings', {
                      method: 'PATCH',
                      body: JSON.stringify({ inputLock: { clearTtl: true } }),
                    })
                      .then(async () => {
                        setInputLockExpiresAt(null);
                        setInputLockSessionId('');
                        setExitMsg(t('已清除课次到期'));
                        await refreshExitLock().catch(() => undefined);
                      })
                      .catch((e) =>
                        setExitMsg(e instanceof Error ? e.message : t('清除到期失败')),
                      )
                      .finally(() => setInputLockBusy(false));
                  }}
                >
                  {t('清除到期')}
                </button>
                {inputLockExpiresAt ? (
                  <span className="hint" data-testid="input-lock-expires-at">
                    {t('到期：{v0}', { v0: new Date(inputLockExpiresAt).toLocaleString() })}
                  </span>
                ) : (
                  <span className="hint">{t('未绑定课次到期')}</span>
                )}
              </div>
              <div className="row">
                <button
                  type="button"
                  disabled={examModeBusy || inputLockBusy}
                  data-testid="exam-mode-btn"
                  onClick={() => {
                    if (
                      !window.confirm(
                        t('开启考试模式？将锁定键鼠语音相机，并重新锁定学生端退出。'),
                      )
                    ) {
                      return;
                    }
                    setExamModeBusy(true);
                    const classId = currentTeacherClassId();
                    void api('/api/v1/settings', {
                      method: 'PATCH',
                      body: JSON.stringify({
                        examMode: true,
                        examModeClassId: inputLockScope === 'global' ? '' : classId,
                      }),
                    })
                      .then(async () => {
                        setInputLock({
                          keyboard: true,
                          mouse: true,
                          voice: true,
                          camera: true,
                        });
                        setExamModeSnapshot(true);
                        setExitMsg(
                          t('考试模式已开启：输入全锁 + 退出锁定（已保存进考前快照）'),
                        );
                        await refreshExitLock().catch(() => undefined);
                        await loadAudit().catch(() => undefined);
                      })
                      .catch((e) =>
                        setExitMsg(e instanceof Error ? e.message : t('考试模式失败')),
                      )
                      .finally(() => setExamModeBusy(false));
                  }}
                >
                  {examModeBusy ? t('开启中…') : t('一键考试模式')}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={examModeBusy || inputLockBusy || !examModeSnapshot}
                  data-testid="exam-mode-restore-btn"
                  title={
                    examModeSnapshot
                      ? t('恢复进考前物理输入锁快照（不影响退出锁定）')
                      : t('尚无考试模式快照')
                  }
                  onClick={() => {
                    if (
                      !window.confirm(
                        t('解除考试模式？将恢复进考前的物理输入锁快照（退出锁定状态不变）。'),
                      )
                    ) {
                      return;
                    }
                    setExamModeBusy(true);
                void api<{
                      inputLock?: typeof inputLock;
                      examModeRestored?: boolean;
                }>('/api/v1/settings', {
                  method: 'PATCH',
                      body: JSON.stringify({ examModeRestore: true }),
                    })
                      .then(async (r) => {
                        if (r.inputLock) {
                          setInputLock({
                            keyboard: Boolean(r.inputLock.keyboard),
                            mouse: Boolean(r.inputLock.mouse),
                            voice: Boolean(r.inputLock.voice),
                            camera: Boolean(r.inputLock.camera),
                          });
                        }
                        setExamModeSnapshot(false);
                        setExitMsg(
                          r.examModeRestored
                            ? t('已解除考试模式并恢复进考前输入锁')
                            : t('已解除考试模式（无快照，输入锁已全开）'),
                        );
                        await refreshExitLock().catch(() => undefined);
                        await loadAudit().catch(() => undefined);
                      })
                      .catch((e) =>
                        setExitMsg(e instanceof Error ? e.message : t('解除考试模式失败')),
                      )
                      .finally(() => setExamModeBusy(false));
                  }}
                >
                  {t('解除考试模式')}
                </button>
              </div>
              </details>
            </div>
          )}

          {isAssistant() ? (
            <div data-testid="exit-lock-readonly">
              <p className="hint">
                {t(
                  '助教 / 投影只读：不可改解除码与轮换天数；批量解除 / 解除码轮换 / 物理输入锁由教师操作。',
                )}
              </p>
              <p className="hint" data-testid="exit-lock-readonly-rotate">
                {t('当前轮换提醒：{v0} 天', { v0: rotateDays })}
                {codeAgeDays != null ? t(' · 已使用 {v0} 天', { v0: codeAgeDays }) : ''}
              </p>
            </div>
          ) : (
            <>
              <label>
                {t('批量解除时长（分钟）')}
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
                  data-testid="bulk-exit-unlock-btn"
                  onClick={() => {
                    void (async () => {
                      try {
                        const classId =
                          localStorage.getItem('cd_teacher_class_id')?.trim() ||
                          '';
                        const classes = await api<{ items: ClassItem[] }>('/api/v1/classes');
                        const klass =
                          classes.items.find((c) => c.id === classId) ?? classes.items[0];
                        let onlineCount = 0;
                        if (klass?.id) {
                          const clients = await api<{ count?: number }>(
                            `/api/v1/presence/clients?classId=${encodeURIComponent(klass.id)}`,
                          );
                          onlineCount = Number(clients.count ?? 0);
                        }
                        setBulkUnlockMeta({
                          classId: klass?.id ?? classId,
                          className: klass?.name ?? '（未选班级）',
                          onlineCount,
                        });
                        setBulkUnlockOpen(true);
                      } catch (e) {
                        setExitMsg(e instanceof Error ? e.message : '无法加载班级/在线机位');
                      }
                    })();
                  }}
            >
              {t('批量允许关闭学生端')}
            </button>
            <button
              type="button"
              className="secondary"
                  onClick={() => {
                    if (!window.confirm(t('确认重新锁定？学生端将无法退出。'))) return;
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
                    setExitMsg(t('已重新锁定：学生端无法退出'));
                        await refreshExitLock().catch(() => undefined);
                  })
                      .catch((e) => setExitMsg(e instanceof Error ? e.message : t('锁定失败')))
                  }}
            >
              {t('重新锁定')}
            </button>
          </div>
          <label>
            {t('手动设置/更换解除码（至少 6 位，不预填）')}
            <input
              type="password"
              value={exitCodeDraft}
              onChange={(e) => setExitCodeDraft(e.target.value)}
              autoComplete="new-password"
              placeholder={t('输入新解除码后点保存')}
            />
          </label>
          <div className="row">
            <button
              type="button"
              onClick={() =>
                void api<{ hasExitUnlockCode?: boolean }>('/api/v1/settings', {
                  method: 'PATCH',
                  body: JSON.stringify({ exitUnlockCode: exitCodeDraft }),
                })
                  .then(async (r) => {
                    if (typeof r.hasExitUnlockCode === 'boolean') {
                      setHasExitCode(r.hasExitUnlockCode);
                      setExitCodeStatusReady(true);
                    } else {
                      setHasExitCode(true);
                      setExitCodeStatusReady(true);
                    }
                    setExitCodeDraft('');
                    setGeneratedExitCode(null);
                    setExitMsg(t('解除码已更新（请自行记入密码本）'));
                    await refreshExitLock().catch(() => undefined);
                  })
                  .catch((e) => setExitMsg(e instanceof Error ? e.message : t('保存解除码失败')))
              }
            >
              {t('保存解除码')}
            </button>
            <button
              type="button"
              className="secondary"
              data-testid="exit-unlock-generate-btn"
              disabled={exitCodeGenerateBusy}
              onClick={() => {
                if (
                  !window.confirm(
                    t(
                      '系统将生成新解除码（明文仅显示一次）。旧码立即失效。轮换最快间隔 30 秒。确认？',
                    ),
                  )
                ) {
                  return;
                }
                setExitCodeGenerateBusy(true);
                void api<{
                  hasExitUnlockCode?: boolean;
                  generatedExitUnlockCode?: string;
                }>('/api/v1/settings', {
                  method: 'PATCH',
                  body: JSON.stringify({ exitUnlockCodeGenerate: true }),
                })
                  .then(async (r) => {
                    if (typeof r.hasExitUnlockCode === 'boolean') {
                      setHasExitCode(r.hasExitUnlockCode);
                    } else {
                      setHasExitCode(true);
                    }
                    setExitCodeStatusReady(true);
                    setExitCodeDraft('');
                    const plain = r.generatedExitUnlockCode?.trim() ?? '';
                    if (plain) {
                      setGeneratedExitCode(plain);
                      setExitMsg(
                        t('新解除码已生成 — 请立即复制并记入密码本（关闭后无法再查看明文）'),
                      );
                    } else {
                      setGeneratedExitCode(null);
                      setExitMsg(t('解除码已轮换，但响应未含明文，请重试生成'));
                    }
                    await refreshExitLock().catch(() => undefined);
                  })
                  .catch((e) =>
                    setExitMsg(e instanceof Error ? e.message : t('系统生成解除码失败')),
                  )
                  .finally(() => setExitCodeGenerateBusy(false));
              }}
            >
              {exitCodeGenerateBusy ? t('生成中…') : t('系统生成并轮换')}
            </button>
          </div>
          {generatedExitCode ? (
            <div className="card" data-testid="exit-unlock-generated-reveal">
              <p className="hint">{t('新解除码（仅此一次，请写入密码本）：')}</p>
              <p>
                <code data-testid="exit-unlock-generated-code">{generatedExitCode}</code>
              </p>
              <div className="row">
                <button
                  type="button"
                  data-testid="exit-unlock-generated-copy"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(generatedExitCode)
                      .then(() => setExitMsg(t('已复制到剪贴板 — 请同步记入密码本')))
                      .catch(() => setExitMsg(t('复制失败，请手动选中上方码值')));
                  }}
                >
                  {t('复制')}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setGeneratedExitCode(null);
                    setExitMsg(t('已关闭明文显示（服务端仅存哈希，无法再找回）'));
                  }}
                >
                  {t('已记入密码本并关闭')}
                </button>
              </div>
            </div>
          ) : null}
          {exitMsg ? <p className="hint">{exitMsg}</p> : null}

              <h4>{t('解除码限流 / 轮换')}</h4>
              <p className="hint" data-testid="exit-unlock-rotate-days-display">
                当前轮换提醒天数：{rotateDays}
              </p>
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
                    data-testid="exit-unlock-rotate-days-input"
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
                      setExitMsg(t('限流/轮换设置已保存'));
                      await refreshExitLock().catch(() => undefined);
                    })
                    .catch((e) => setExitMsg(e instanceof Error ? e.message : t('保存失败')))
                }
              >
                {t('保存限流与轮换')}
              </button>
            </>
          )}

          <div className="card">
            <p className="hint">
              {t('退出锁定审计（每页 {v0} 条）', { v0: EXIT_PAGE_SIZE })}
              {isAssistant() ? t(' · 助教只读') : ''}
            </p>
            <label>
              {t('按类型筛选')}
              <select
                value={exitKindFilter}
                onChange={(e) => {
                  setExitEventsPage(0);
                  setExitKindFilter(e.target.value);
                }}
              >
                <option value="">{t('全部')}</option>
                <option value="batch_unlock">{t('批量解除')}</option>
                <option value="relock">{t('重新锁定')}</option>
                <option value="code_ok">{t('解除码成功')}</option>
                <option value="code_fail">{t('解除码失败')}</option>
                <option value="code_rate_limited">{t('解除码限流')}</option>
                <option value="code_set">{t('首次设置解除码')}</option>
                <option value="code_rotated">{t('轮换解除码')}</option>
                <option value="rate_config">{t('限流/轮换配置')}</option>
                <option value="client_reconcile">{t('断线对账冲突')}</option>
                <option value="input_lock">{t('物理输入锁')}</option>
                <option value="exam_mode">{t('考试模式')}</option>
                <option value="exam_mode_end">{t('解除考试模式')}</option>
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
                {t('导出当前页 CSV')}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={csvExportBusy}
                data-testid="exit-lock-csv-export-all"
                onClick={(e) => {
                  e.preventDefault();
                  if (exitEventsTotal > 2000) {
                    const ok = window.confirm(
                      t('当前筛选约 {v0} 条，将分页拉取后合并导出（可能较慢）。继续？', {
                        v0: exitEventsTotal,
                      }),
                    );
                    if (!ok) return;
                  }
                  void exportExitLockCsvAll('exit-lock-events-all.csv');
                }}
              >
                {csvExportBusy ? t('导出中…') : t('导出全部 CSV')}
              </button>
              {csvExportBusy ? (
                <button
                  type="button"
                  className="secondary"
                  data-testid="exit-lock-csv-export-cancel"
                  onClick={(e) => {
                    e.preventDefault();
                    cancelExitLockCsvExport();
                  }}
                >
                  {t('取消导出')}
                </button>
              ) : null}
              {!csvExportBusy && csvPartialCount > 0 ? (
                <button
                  type="button"
                  className="secondary"
                  data-testid="exit-lock-csv-export-partial"
                  onClick={(e) => {
                    e.preventDefault();
                    downloadExitLockCsvPartial();
                  }}
                >
                  {t('下载已拉取部分（{v0}）', { v0: csvPartialCount })}
                </button>
              ) : null}
            </div>
            <ul>
              {exitEvents.map((e) => (
                <li key={e.id}>
                  {new Date(e.createdAt).toLocaleString()} · {exitLockKindLabel(e.kind)}
                  {e.actorRole ? ` · ${e.actorRole}` : ''} · {e.detail}
                  {e.kind === 'input_lock' ||
                  e.kind === 'exam_mode' ||
                  e.kind === 'exam_mode_end' ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="linkish"
                        data-testid="audit-jump-input-lock"
                        onClick={() => jumpToInputLockSettings()}
                      >
                        {t('跳转物理输入锁')}
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
            {!exitEvents.length ? <p className="hint">{t('暂无记录')}</p> : null}
          </div>

          <div className="card">
            <button type="button" className="secondary" onClick={() => setShowExitHelp((v) => !v)}>
              {showExitHelp ? t('收起帮助') : t('帮助：锁定状态机')}
            </button>
            {showExitHelp ? (
              <div className="hint">
                <p>
                  {t('完整说明（含 C2 手测表 / Assigned Access / Intune）：')}{' '}
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
            <h3>{t('操作审计（批量删除等）')}</h3>
            <div className="row">
              <label>
                {t('班级')}
                <select value={auditClassId} onChange={(e) => setAuditClassId(e.target.value)}>
                  <option value="">{t('全部班级')}</option>
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
                  <option value="">{t('全部类型')}</option>
                  {auditActions.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="secondary"
                data-testid="audit-filter-unhardened-threshold"
                onClick={() => {
                  setAuditAction('settings.unhardened_threshold');
                  // Ensure action is in the select options even if actions list lagged.
                  setAuditActions((prev) =>
                    prev.includes('settings.unhardened_threshold')
                      ? prev
                      : [...prev, 'settings.unhardened_threshold'],
                  );
                }}
              >
                筛 settings.unhardened_threshold
              </button>
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
            {auditItems.length === 0 ? <p className="hint">{t('暂无审计记录')}</p> : null}
            <ul>
              {auditItems.map((a) => (
                <li key={a.id}>
                  {new Date(a.createdAt).toLocaleString()} · {auditActionLabel(a.action)}
                  {a.actorRole ? ` · ${a.actorRole}` : ''}
                  {a.action === 'settings.input_lock' ||
                  a.action === 'settings.exam_mode' ||
                  a.action === 'settings.exam_mode_end' ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="linkish"
                        data-testid="audit-jump-input-lock"
                        onClick={() => {
                          try {
                            const obj = JSON.parse(a.detail) as {
                              seatId?: string | null;
                              classId?: string | null;
                            };
                            jumpToInputLockSettings({
                              seatId: obj.seatId ? String(obj.seatId) : null,
                              classId: obj.classId
                                ? String(obj.classId)
                                : a.classId
                                  ? String(a.classId)
                                  : null,
                            });
                          } catch {
                            jumpToInputLockSettings({
                              classId: a.classId ? String(a.classId) : null,
                            });
                          }
                        }}
                      >
                        跳转物理输入锁
                      </button>
                    </>
                  ) : null}
                  {a.detail ? (
                    <>
                      {' · '}
                      <AuditDetail
                        detail={a.detail}
                        action={a.action}
                        onJumpIds={({ target, ids, action }) => {
                          if (a.classId) localStorage.setItem('cd_teacher_class_id', String(a.classId));
                          const openRecycle =
                            /soft_delete|bulk_soft/i.test(action) ||
                            target === 'q-recycle' ||
                            /delete|purge/i.test(action);
                          stashAuditJumpIds(ids, openRecycle);
                          hardReloadTeacherNav({
                            tab: 'prep',
                            prepTab: target,
                            classId: a.classId ? String(a.classId) : undefined,
                          });
                        }}
                        onJumpPurgeConfirm={(jump) => {
                          sessionStorage.setItem('cd_goto_purge_confirm', '1');
                          sessionStorage.setItem('cd_purge_jump', JSON.stringify(jump));
                          const q = new URLSearchParams();
                          if (jump.classId) q.set('classId', jump.classId);
                          if (jump.count != null) q.set('count', String(jump.count));
                          if (jump.students != null) q.set('students', String(jump.students));
                          if (jump.questions != null) q.set('questions', String(jump.questions));
                          const qs = q.toString();
                          const base = `${window.location.pathname}${window.location.search}`;
                          window.history.replaceState(
                            null,
                            '',
                            `${base}#recycle-purge-confirm${qs ? `?${qs}` : ''}`,
                          );
                          focusRecyclePurgeConfirm(jump);
                          sessionStorage.removeItem('cd_goto_purge_confirm');
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
            {t('数据库：服务进程每天自动备份一次（保留约 14 份）；也可手动 npm run backup:db。确认 /health 无 backup/audit lastError。')}
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
      <ConfirmModal
        open={grantMigrateOpen}
        title={t('离开「空表 = 全班可导出」')}
        busy={grantMigrateBusy}
        confirmLabel={t('确定保存')}
        body={
          <div data-testid="grants-migrate-confirm">
            <p>
              {t('保存后仅勾选了「可导出」的班级可以导出。将失去导出的班级（未勾选可导出）：')}
            </p>
            {grantLoseNames.length === 0 ? (
              <p className="hint">{t('（无 — 所有班级都已勾选可导出）')}</p>
            ) : (
              <ul className="grants-lose-list" data-testid="grants-lose-list">
                {grantLoseNames.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            )}
          </div>
        }
        onCancel={() => {
          if (grantMigrateBusy) return;
          setGrantMigrateOpen(false);
        }}
        onConfirm={() => {
          setGrantMigrateBusy(true);
          void commitAssistantGrants()
            .then(() => {
              setGrantMigrateOpen(false);
            })
            .catch((e) => setGrantMsg(e instanceof Error ? e.message : t('保存失败')))
            .finally(() => setGrantMigrateBusy(false));
        }}
      />
      <ConfirmModal
        open={clearAllOpen}
        title="全部解除物理输入锁"
        busy={clearAllBusy}
        confirmLabel={t('确认全部解除')}
        body={
          <div data-testid="input-lock-clear-all-confirm">
            <p>
              将清空：班级覆盖{' '}
              <strong data-testid="input-lock-clear-all-class-count">
                {clearAllMeta?.classN ?? 0}
              </strong>{' '}
              条 · 机位覆盖{' '}
              <strong data-testid="input-lock-clear-all-seat-count">
                {clearAllMeta?.seatN ?? 0}
              </strong>{' '}
              条，以及全局标志。
            </p>
            {clearAllMeta?.clearExamSnap ? (
              <p className="hint" data-testid="input-lock-clear-all-exam-note">
                同时清除考试模式输入锁快照（无法再「解除考试模式」恢复旧锁）。
              </p>
            ) : (
              <p className="hint">{t('当前无考试模式快照。')}</p>
            )}
          </div>
        }
        onCancel={() => {
          if (clearAllBusy) return;
          setClearAllOpen(false);
          setClearAllMeta(null);
        }}
        onConfirm={() => {
          const willClearExamSnap = Boolean(clearAllMeta?.clearExamSnap);
          setClearAllBusy(true);
          setInputLockBusy(true);
          void api<{
            inputLock?: typeof inputLock;
            examModeSnapshot?: boolean;
          }>('/api/v1/settings', {
            method: 'PATCH',
            body: JSON.stringify({ inputLock: { clearAll: true } }),
          })
            .then((r) => {
              setInputLock({
                keyboard: Boolean(r.inputLock?.keyboard),
                mouse: Boolean(r.inputLock?.mouse),
                voice: Boolean(r.inputLock?.voice),
                camera: Boolean(r.inputLock?.camera),
              });
              setInputLockCoverage('global');
              setInputLockScopeLabel(t('全校全局'));
              setInputLockClassCount(0);
              setInputLockSeatCount(0);
              setExamModeSnapshot(r.examModeSnapshot === true);
              setExitMsg(
                willClearExamSnap
                  ? '已全部解除物理输入锁，并清除考试模式快照'
                  : '已全部解除物理输入锁（清空全局/班级/机位）',
              );
              setClearAllOpen(false);
              setClearAllMeta(null);
              void loadAudit().catch(() => undefined);
              void refreshExitLock().catch(() => undefined);
            })
            .catch((err) => setExitMsg(err instanceof Error ? err.message : '全部解除失败'))
            .finally(() => {
              setClearAllBusy(false);
              setInputLockBusy(false);
            });
        }}
      />
      <ConfirmModal
        open={bulkUnlockOpen}
        title="批量允许关闭学生端"
        busy={bulkUnlockBusy}
        confirmLabel={`允许 ${exitMinutes} 分钟`}
        body={
          <div data-testid="bulk-exit-unlock-confirm">
            <p>
              确认批量允许关闭学生端 <strong>{exitMinutes}</strong> 分钟？时限结束后将自动恢复锁定。
            </p>
            <p className="hint" data-testid="bulk-exit-unlock-class">
              班级：{bulkUnlockMeta?.className ?? '—'}
            </p>
            <p className="hint" data-testid="bulk-exit-unlock-online">
              预计在线机位：{bulkUnlockMeta?.onlineCount ?? 0}（按当前 presence；解锁对全班生效）
            </p>
            {isAssistant() ? (
              <p className="error">{t('助教不可执行批量解除（只读）。')}</p>
            ) : null}
          </div>
        }
        onCancel={() => {
          if (bulkUnlockBusy) return;
          setBulkUnlockOpen(false);
        }}
        onConfirm={() => {
          if (isAssistant()) {
            setBulkUnlockOpen(false);
            setExitMsg(t('助教不可批量解除'));
            return;
          }
          setBulkUnlockBusy(true);
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
              setExitMsg(
                `已批量允许关闭 ${exitMinutes} 分钟` +
                  (bulkUnlockMeta
                    ? `（${bulkUnlockMeta.className} · 在线约 ${bulkUnlockMeta.onlineCount}）`
                    : ''),
              );
              setBulkUnlockOpen(false);
              await refreshExitLock().catch(() => undefined);
            })
            .catch((e) => setExitMsg(e instanceof Error ? e.message : t('解除失败')))
            .finally(() => setBulkUnlockBusy(false));
        }}
      />
    </section>
  );
}

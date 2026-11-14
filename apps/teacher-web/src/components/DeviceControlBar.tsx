import { useCallback, useEffect, useState } from 'react';
import { t, te } from '@classroom-desk/i18n';
import type {
  DeviceControlPolicy,
  DeviceControlStore,
  OfflineLockMode,
  OfflineLockPolicy,
  OfflineLockScope,
  OfflineLockStore,
} from '@classroom-desk/shared';
import {
  DEFAULT_OFFLINE_LOCK_POLICY,
  EMPTY_DEVICE_CONTROL_POLICY,
  EMPTY_DEVICE_CONTROL_STORE,
  EMPTY_OFFLINE_LOCK_STORE,
  normalizeDeviceControlStore,
  normalizeOfflineLockStore,
  resolveDeviceControlPolicy,
  resolveOfflineLockPolicy,
  SECURITY_BUREAU_OFFLINE_LOCK_POLICY,
} from '@classroom-desk/shared';
import { API_BASE, api } from '../api';
import { isAssistant } from '../authRole';

type RosterRow = { id: string; displayName?: string; studentNo?: string | null };

/**
 * Compact student-device controls: open/close apps & URLs, block lists,
 * and offline hard-lock policy — configurable globally, per class, or per student.
 */
export function DeviceControlBar({
  classId,
  securityBureauAllowed = false,
  securityBureauBlockReason = '',
}: {
  classId: string;
  /** From AssignedAccessBanner — false disables「一键武装」. */
  securityBureauAllowed?: boolean;
  securityBureauBlockReason?: string;
}) {
  const [policy, setPolicy] = useState<DeviceControlPolicy>(EMPTY_DEVICE_CONTROL_POLICY());
  const [policyStore, setPolicyStore] = useState<DeviceControlStore>(EMPTY_DEVICE_CONTROL_STORE());
  const [store, setStore] = useState<OfflineLockStore>(EMPTY_OFFLINE_LOCK_STORE());
  const [offline, setOffline] = useState<OfflineLockPolicy>(DEFAULT_OFFLINE_LOCK_POLICY());
  const [scope, setScope] = useState<OfflineLockScope>('class');
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [appsText, setAppsText] = useState('');
  const [hostsText, setHostsText] = useState('');
  const [openUrl, setOpenUrl] = useState('');
  const [openApp, setOpenApp] = useState('');
  const [closeApps, setCloseApps] = useState('');
  /** Commands: empty = whole class; otherwise only checked students. */
  const [cmdTargetStudents, setCmdTargetStudents] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const readonly = isAssistant();

  const resolveOpts = useCallback(
    (sc: OfflineLockScope, studentIds: string[]) => {
      if (sc === 'student' && studentIds[0]) {
        return { classId, studentId: studentIds[0] };
      }
      if (sc === 'class') return { classId };
      return {};
    },
    [classId],
  );

  const refresh = useCallback(async () => {
    const q = classId.trim() ? `?classId=${encodeURIComponent(classId.trim())}` : '';
    const r = await api<{
      policy?: DeviceControlPolicy;
      policyStore?: DeviceControlStore;
      offline?: OfflineLockPolicy;
      offlineStore?: OfflineLockStore;
    }>(`/api/v1/device-control${q}`);
    setPolicyStore(normalizeDeviceControlStore(r.policyStore ?? null));
    setStore(normalizeOfflineLockStore(r.offlineStore ?? null));
  }, [classId]);

  useEffect(() => {
    void refresh().catch(() => undefined);
    const es = new EventSource(`${API_BASE}/api/v1/device-control/stream`);
    es.addEventListener('device_control', () => {
      void refresh().catch(() => undefined);
    });
    es.onmessage = () => {
      void refresh().catch(() => undefined);
    };
    return () => es.close();
  }, [refresh]);

  useEffect(() => {
    if (!classId.trim()) {
      setRoster([]);
      return;
    }
    let cancelled = false;
    void api<{ items?: RosterRow[] }>(`/api/v1/classes/${encodeURIComponent(classId)}/students`)
      .then((r) => {
        if (cancelled) return;
        setRoster(
          (r.items ?? []).map((row) => ({
            id: String(row.id),
            displayName: row.displayName,
            studentNo: row.studentNo ?? null,
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setRoster([]);
      });
    return () => {
      cancelled = true;
    };
  }, [classId]);

  // Re-resolve editors when scope / selected students / stores change.
  useEffect(() => {
    const opts = resolveOpts(scope, selectedStudentIds);
    const nextOffline = resolveOfflineLockPolicy(store, opts);
    const nextPolicy = resolveDeviceControlPolicy(policyStore, opts);
    setOffline(nextOffline);
    setPolicy(nextPolicy);
    setAppsText(nextPolicy.blockedApps.join(', '));
    setHostsText(nextPolicy.blockedHosts.join(', '));
  }, [store, policyStore, scope, selectedStudentIds, resolveOpts]);

  function parseList(raw: string): string[] {
    return raw
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function requireScopeTargets(): boolean {
    if (scope === 'class' && !classId.trim()) {
      setMsg(t('请先选择班级'));
      return false;
    }
    if (scope === 'student' && selectedStudentIds.length === 0) {
      setMsg(t('请先勾选要限制的学生'));
      return false;
    }
    return true;
  }

  function savePolicy() {
    if (readonly) return;
    if (!requireScopeTargets()) return;
    setBusy(true);
    const body: Record<string, unknown> = {
      scope,
      policy: {
        blockedApps: parseList(appsText),
        blockedHosts: parseList(hostsText),
      },
    };
    if (scope === 'class' || scope === 'student') body.classId = classId.trim();
    if (scope === 'student') body.studentIds = selectedStudentIds;
    void api('/api/v1/device-control/policy', {
      method: 'PUT',
      body: JSON.stringify(body),
    })
      .then(async () => {
        setMsg(
          scope === 'global'
            ? t('已保存全校拉黑名单')
            : scope === 'class'
              ? t('已保存本班拉黑名单')
              : t('已保存所选学生拉黑名单'),
        );
        await refresh();
      })
      .catch((e) => setMsg(te(e, '保存失败')))
      .finally(() => setBusy(false));
  }

  function offlineBody(next: OfflineLockPolicy) {
    const body: Record<string, unknown> = { offline: next, scope };
    if (scope === 'class' || scope === 'student') body.classId = classId.trim();
    if (scope === 'student') body.studentIds = selectedStudentIds;
    return body;
  }

  function saveOffline(patch: Partial<OfflineLockPolicy>) {
    if (readonly) return;
    if (!requireScopeTargets()) return;
    const next = { ...offline, ...patch };
    setBusy(true);
    void api('/api/v1/device-control/offline-policy', {
      method: 'PUT',
      body: JSON.stringify(offlineBody(next)),
    })
      .then(async () => {
        setMsg(
          scope === 'global'
            ? t('已保存全校掉线策略')
            : scope === 'class'
              ? t('已保存本班掉线策略')
              : t('已保存所选学生掉线策略'),
        );
        await refresh();
      })
      .catch((e) => setMsg(te(e, '保存失败')))
      .finally(() => setBusy(false));
  }

  function clearScopeOverride() {
    if (readonly) return;
    if (scope === 'global') return;
    if (scope === 'class' && !classId.trim()) return;
    if (scope === 'student' && selectedStudentIds.length === 0) return;
    setBusy(true);
    void api('/api/v1/device-control/scope', {
      method: 'DELETE',
      body: JSON.stringify({
        scope,
        classId: classId.trim() || undefined,
        studentIds: scope === 'student' ? selectedStudentIds : undefined,
      }),
    })
      .then(async () => {
        setMsg(t('已清除本范围拉黑与掉线覆盖，改用上级策略'));
        await refresh();
      })
      .catch((e) => setMsg(te(e, '清除失败')))
      .finally(() => setBusy(false));
  }

  /** Arm max-secrecy app-layer custody (最高保密级). Requires AA gate + online hardened fleet. */
  function armSecurityBureauMode() {
    if (readonly || !classId.trim()) return;
    if (!securityBureauAllowed) {
      setMsg(
        securityBureauBlockReason ||
          t('未达机房上线门禁，禁止武装最高保密级'),
      );
      return;
    }
    const armScope: OfflineLockScope = scope === 'student' ? 'student' : 'class';
    if (armScope === 'student' && selectedStudentIds.length === 0) {
      setMsg(t('请先勾选要限制的学生'));
      return;
    }
    const ok = window.confirm(
      armScope === 'student'
        ? t(
            '对所选学生启用最高保密级？\n\n将：约 1 秒掉线全屏监管、杀浏览器/聊天/游戏、重连/重启仍须解除码。\n\n系统热键仍须学校 Assigned Access。已通过 L3 门禁。确定武装？',
          )
        : t(
            '对本班启用最高保密级？\n\n将：约 1 秒掉线全屏监管、杀浏览器/聊天/游戏、重连/重启仍须解除码、有人掉线则全班踢网+冻结。\n\n系统热键仍须学校 Assigned Access。已通过 L3 门禁。确定武装？',
          ),
    );
    if (!ok) return;
    setBusy(true);
    const next = SECURITY_BUREAU_OFFLINE_LOCK_POLICY();
    // Student-scope arm: still max custody flags, but peer-drop 连坐 is class-level — leave off.
    const offlinePayload =
      armScope === 'student' ? { ...next, freezeClassOnPeerDrop: false } : next;
    void api('/api/v1/device-control/offline-policy', {
      method: 'PUT',
      body: JSON.stringify({
        offline: offlinePayload,
        scope: armScope,
        classId: classId.trim(),
        studentIds: armScope === 'student' ? selectedStudentIds : undefined,
        armMaxSecrecy: true,
      }),
    })
      .then(() => {
        // Deep-lock is class-scoped; only apply when arming the whole class.
        if (armScope !== 'class') return Promise.resolve(null);
        return api('/api/v1/deep-lock/action', {
          method: 'POST',
          body: JSON.stringify({
            action: 'patch',
            classId: classId.trim(),
            patch: {
              frozen: true,
              netMode: 'deny',
              killForeignBrowsers: true,
              killDistractions: true,
              focusFreeze: true,
            },
          }),
        });
      })
      .then(async () => {
        setScope(armScope);
        setOffline(offlinePayload);
        setMsg(
          armScope === 'student'
            ? t('已武装所选学生最高保密级（仍须学校 Assigned Access 才能锁住系统热键）')
            : t('已武装本班最高保密级（含全班连坐；仍须学校 Assigned Access 才能锁住系统热键）'),
        );
        await refresh();
      })
      .catch((e) => setMsg(te(e, '武装失败')))
      .finally(() => setBusy(false));
  }

  function send(kind: 'open_url' | 'open_app' | 'close_apps') {
    if (readonly || !classId.trim()) return;
    if (cmdTargetStudents && selectedStudentIds.length === 0) {
      setMsg(t('请先勾选要下发的学生，或取消「仅所选学生」'));
      return;
    }
    setBusy(true);
    const body: Record<string, unknown> = { kind, classId: classId.trim() };
    if (cmdTargetStudents) body.studentIds = selectedStudentIds;
    if (kind === 'open_url') body.url = openUrl.trim();
    if (kind === 'open_app') body.app = openApp.trim();
    if (kind === 'close_apps') body.apps = parseList(closeApps);
    void api('/api/v1/device-control/command', {
      method: 'POST',
      body: JSON.stringify(body),
    })
      .then(() =>
        setMsg(
          kind === 'open_url'
            ? t('已下发打开网页')
            : kind === 'open_app'
              ? t('已下发打开应用')
              : t('已下发关闭应用'),
        ),
      )
      .catch((e) => setMsg(te(e, '下发失败')))
      .finally(() => setBusy(false));
  }

  function toggleStudent(id: string) {
    setSelectedStudentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  const hasClassOverride = Boolean(
    classId.trim() &&
      (store.byClass[classId.trim()] || policyStore.byClass[classId.trim()]),
  );
  const hasStudentOverride =
    scope === 'student' &&
    selectedStudentIds.some(
      (id) => Boolean(store.byStudent[id] || policyStore.byStudent[id]),
    );

  return (
    <section className="device-control-bar" data-testid="device-control-bar">
      <h3>{t('学生机应用与网页')}</h3>
      <p className="hint">
        {t(
          '打开/关闭、拉黑名单、掉线监管均可按全校 / 本班 / 个别学生配置。拉黑在学生端持续拦截；上课页「部署 DeskDNS」启用后 DNS 对名单域名返回 0.0.0.0（取各范围并集，与讲台策略互通）。',
        )}
      </p>

      <label>
        {t('配置范围')}
        <select
          value={scope}
          disabled={readonly || busy}
          data-testid="device-control-scope"
          onChange={(e) => setScope(e.target.value as OfflineLockScope)}
        >
          <option value="global">{t('全校默认')}</option>
          <option value="class">{t('本班覆盖')}</option>
          <option value="student">{t('个别学生')}</option>
        </select>
      </label>
      <p className="hint" data-testid="device-control-scope-hint">
        {scope === 'global'
          ? t('保存后影响未单独覆盖的所有班级/学生（拉黑 + 掉线）')
          : scope === 'class'
            ? hasClassOverride
              ? t('本班已有独立覆盖（优先于全校）')
              : t('本班尚无覆盖，保存将写入班级拉黑与掉线策略')
            : hasStudentOverride
              ? t('所选学生中已有个人覆盖（优先于班级/全校）')
              : t('勾选学生后保存，仅这些人使用下列拉黑与掉线策略')}
      </p>

      {(scope === 'student' || cmdTargetStudents) && (
        <div className="device-control-students" data-testid="device-control-students">
          <p className="hint">{t('学生名单（可多选）')}</p>
          {roster.length === 0 ? (
            <p className="hint">{t('本班暂无学生，请先在名册中添加')}</p>
          ) : (
            <ul className="device-control-student-list">
              {roster.map((row) => (
                <li key={row.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedStudentIds.includes(row.id)}
                      disabled={readonly || busy}
                      onChange={() => toggleStudent(row.id)}
                    />{' '}
                    {row.displayName || row.id}
                    {row.studentNo ? ` (${row.studentNo})` : ''}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {roster.length > 0 ? (
            <div className="row">
              <button
                type="button"
                className="secondary"
                disabled={readonly || busy}
                onClick={() => setSelectedStudentIds(roster.map((r) => r.id))}
              >
                {t('全选本班')}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={readonly || busy}
                onClick={() => setSelectedStudentIds([])}
              >
                {t('清空选择')}
              </button>
            </div>
          ) : null}
        </div>
      )}

      <div className="device-control-grid">
        <label>
          {t('打开网页')}
          <input
            value={openUrl}
            disabled={readonly || busy}
            onChange={(e) => setOpenUrl(e.target.value)}
            placeholder="https://"
          />
        </label>
        <button type="button" disabled={readonly || busy || !openUrl.trim()} onClick={() => send('open_url')}>
          {t('打开')}
        </button>
        <label>
          {t('打开应用')}
          <input
            value={openApp}
            disabled={readonly || busy}
            onChange={(e) => setOpenApp(e.target.value)}
            placeholder={t('如 notepad.exe / Calculator')}
          />
        </label>
        <button type="button" disabled={readonly || busy || !openApp.trim()} onClick={() => send('open_app')}>
          {t('打开')}
        </button>
        <label>
          {t('关闭应用')}
          <input
            value={closeApps}
            disabled={readonly || busy}
            onChange={(e) => setCloseApps(e.target.value)}
            placeholder={t('逗号分隔进程名')}
          />
        </label>
        <button
          type="button"
          disabled={readonly || busy || !closeApps.trim()}
          onClick={() => send('close_apps')}
        >
          {t('关闭')}
        </button>
      </div>

      <label className="hint">
        <input
          type="checkbox"
          checked={cmdTargetStudents}
          disabled={readonly || busy}
          onChange={(e) => setCmdTargetStudents(e.target.checked)}
        />{' '}
        {t('打开/关闭仅下发给所选学生（不勾选则全班）')}
      </label>

      <details className="device-control-blocks" open>
        <summary>{t('拉黑网页 / 应用（持续）')}</summary>
        <p className="hint">{t('按上方配置范围保存；学生端强制无法打开名单中的应用与网站。')}</p>
        <label>
          {t('拉黑域名')}
          <input
            value={hostsText}
            disabled={readonly || busy}
            onChange={(e) => setHostsText(e.target.value)}
            placeholder="tiktok.com, bilibili.com"
          />
        </label>
        <label>
          {t('拉黑应用')}
          <input
            value={appsText}
            disabled={readonly || busy}
            onChange={(e) => setAppsText(e.target.value)}
            placeholder="WeChat.exe, QQ.exe"
          />
        </label>
        <button type="button" className="secondary" disabled={readonly || busy} onClick={() => savePolicy()}>
          {t('保存拉黑名单')}
        </button>
        {policy.blockedApps.length || policy.blockedHosts.length ? (
          <p className="hint">
            {t('当前范围拉黑：')}
            {[...policy.blockedHosts, ...policy.blockedApps].join(' · ') || '—'}
          </p>
        ) : null}
      </details>

      <details className="device-control-offline" open>
        <summary>{t('掉线监管（最高保密级）')}</summary>
        <p className="hint">
          {t(
            '日常默认：掉线只锁该学生。一键武装最高保密级：约 1 秒监管罩、密封外网、杀逃逸、重启仍锁，且有人掉线则全班踢网+冻结。系统 Alt+Tab / 任务管理器仍须学校 Assigned Access（L3）。范围与上方「配置范围」相同。',
          )}
        </p>

        <div className="row">
          <button
            type="button"
            disabled={readonly || busy || !classId.trim() || !securityBureauAllowed}
            title={
              securityBureauAllowed
                ? undefined
                : securityBureauBlockReason || t('未达机房上线门禁')
            }
            data-testid="arm-security-bureau"
            onClick={() => armSecurityBureauMode()}
          >
            {scope === 'student' ? t('武装所选学生最高保密级') : t('一键武装最高保密级')}
          </button>
          {scope !== 'global' ? (
            <button
              type="button"
              className="secondary"
              disabled={
                readonly ||
                busy ||
                (scope === 'class' ? !hasClassOverride : !hasStudentOverride)
              }
              data-testid="clear-offline-override"
              onClick={() => clearScopeOverride()}
            >
              {t('清除本范围覆盖')}
            </button>
          ) : null}
        </div>
        {!securityBureauAllowed ? (
          <p className="error" data-testid="arm-security-bureau-blocked">
            {securityBureauBlockReason || t('未达机房上线门禁，按钮已禁用')}
          </p>
        ) : null}
        <label>
          {t('策略')}
          <select
            value={offline.mode}
            disabled={readonly || busy}
            onChange={(e) => saveOffline({ mode: e.target.value as OfflineLockMode })}
          >
            <option value="hard_lock">{t('强硬监管锁（推荐）')}</option>
            <option value="warn">{t('仅提示，不锁屏')}</option>
            <option value="off">{t('不处理掉线')}</option>
          </select>
        </label>
        <label>
          {t('宽限（秒）')}
          <input
            type="number"
            min={1}
            max={120}
            step={1}
            value={Math.max(1, Math.round(offline.graceMs / 1000))}
            disabled={readonly || busy}
            onChange={(e) =>
              saveOffline({ graceMs: Math.round(Number(e.target.value) || 1.5) * 1000 })
            }
          />
        </label>
        <label className="hint">
          <input
            type="checkbox"
            checked={offline.unlockWithCode}
            disabled={readonly || busy}
            onChange={(e) => saveOffline({ unlockWithCode: e.target.checked })}
          />{' '}
          {t('允许用解除码解除掉线锁')}
        </label>
        <label className="hint">
          <input
            type="checkbox"
            checked={offline.collapseOnReconnect}
            disabled={readonly || busy}
            onChange={(e) => saveOffline({ collapseOnReconnect: e.target.checked })}
          />{' '}
          {t('重连教师机后自动回右下角')}
        </label>
        <label className="hint">
          <input
            type="checkbox"
            checked={offline.holdUntilUnlockCode}
            disabled={readonly || busy}
            onChange={(e) => saveOffline({ holdUntilUnlockCode: e.target.checked })}
          />{' '}
          {t('重连后仍须解除码才退出监管')}
        </label>
        <label className="hint">
          <input
            type="checkbox"
            checked={offline.custodyFullscreen !== false}
            disabled={readonly || busy}
            onChange={(e) => saveOffline({ custodyFullscreen: e.target.checked })}
          />{' '}
          {t('全屏监管罩（重启仍保持，须解除码）')}
        </label>
        <label className="hint">
          <input
            type="checkbox"
            checked={offline.killEscapesOnOffline !== false}
            disabled={readonly || busy}
            onChange={(e) => saveOffline({ killEscapesOnOffline: e.target.checked })}
          />{' '}
          {t('掉线时持续关闭浏览器/聊天/游戏')}
        </label>
        <label>
          {t('有学生掉线时')}
          <select
            value={offline.freezeClassOnPeerDrop ? 'class' : 'self'}
            disabled={readonly || busy || (!securityBureauAllowed && !offline.freezeClassOnPeerDrop)}
            title={
              !securityBureauAllowed
                ? securityBureauBlockReason || t('开启全班连坐须通过机房上线门禁')
                : undefined
            }
            data-testid="freeze-class-on-peer-drop"
            onChange={(e) =>
              saveOffline({ freezeClassOnPeerDrop: e.target.value === 'class' })
            }
          >
            <option value="self">{t('只锁该学生（默认）')}</option>
            <option value="class">{t('全班一起深锁冻结')}</option>
          </select>
        </label>
        <p className="hint">
          {offline.freezeClassOnPeerDrop
            ? t('开启后：任一在线学生从名单消失，教师端会对全班下发踢网+冻结。')
            : t('默认：掉线学生本机进入监管锁；其他在线学生不受影响。可随时改为全班一起锁。')}
        </p>
      </details>
      {msg ? <p className="hint">{msg}</p> : null}
    </section>
  );
}

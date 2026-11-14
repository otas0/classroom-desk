import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { t, te } from '@classroom-desk/i18n';
import { isAssistant } from '../authRole';

export type AssignedAccessGate = {
  /** IT declared AA/Intune ready in settings. */
  declaredReady: boolean;
  onlineCount: number;
  hardenedCount: number;
  unhardenedCount: number;
  /** May arm security-bureau mode. */
  canArm: boolean;
  /** Human reason when canArm is false. */
  blockReason: string;
};

const EMPTY_GATE: AssignedAccessGate = {
  declaredReady: false,
  onlineCount: 0,
  hardenedCount: 0,
  unhardenedCount: 0,
  canArm: false,
  blockReason: '',
};

/**
 * Session red banner: Assigned Access L3 must be declared, and no unhardened
 * online students — otherwise「一键武装安全局模式」stays disabled.
 */
export function AssignedAccessBanner({
  classId,
  onGateChange,
}: {
  classId: string;
  onGateChange?: (gate: AssignedAccessGate) => void;
}) {
  const [declaredReady, setDeclaredReady] = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);
  const [hardenedCount, setHardenedCount] = useState(0);
  const [unhardenedCount, setUnhardenedCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const readonly = isAssistant();

  const publish = useCallback(
    (next: {
      declaredReady: boolean;
      onlineCount: number;
      hardenedCount: number;
      unhardenedCount: number;
    }) => {
      const canArm =
        next.declaredReady && next.onlineCount > 0 && next.unhardenedCount === 0;
      let blockReason = '';
      if (!next.declaredReady) {
        blockReason = t('未声明本机房已配置 Assigned Access / Intune（L3）');
      } else if (next.onlineCount <= 0) {
        blockReason = t('当前班无在线学生机，无法武装最高保密级（见 docs/EXIT_LOCK_MDM.md）');
      } else if (next.unhardenedCount > 0) {
        blockReason = t('当前有 {v0} 台在线学生机未报告加固', {
          v0: String(next.unhardenedCount),
        });
      }
      const gate: AssignedAccessGate = {
        ...next,
        canArm,
        blockReason,
      };
      onGateChange?.(gate);
      return gate;
    },
    [onGateChange],
  );

  const refresh = useCallback(async () => {
    let declared = false;
    try {
      const s = await api<{ assignedAccessReady?: boolean }>('/api/v1/settings');
      declared = Boolean(s.assignedAccessReady);
      setDeclaredReady(declared);
    } catch {
      declared = false;
      setDeclaredReady(false);
    }
    let online = 0;
    let hard = 0;
    let unhard = 0;
    if (classId.trim()) {
      try {
        const p = await api<{
          items?: Array<{ hardened?: boolean }>;
          hardenedCount?: number;
          unhardenedCount?: number;
          count?: number;
        }>(`/api/v1/presence/clients?classId=${encodeURIComponent(classId)}`);
        const items = p.items ?? [];
        online = p.count != null ? Number(p.count) : items.length;
        hard =
          p.hardenedCount != null
            ? Number(p.hardenedCount)
            : items.filter((i) => i.hardened).length;
        unhard =
          p.unhardenedCount != null ? Number(p.unhardenedCount) : Math.max(0, online - hard);
      } catch {
        online = 0;
        hard = 0;
        unhard = 0;
      }
    }
    setOnlineCount(online);
    setHardenedCount(hard);
    setUnhardenedCount(unhard);
    publish({
      declaredReady: declared,
      onlineCount: online,
      hardenedCount: hard,
      unhardenedCount: unhard,
    });
  }, [classId, publish]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  async function setDeclared(next: boolean) {
    if (readonly) return;
    if (next) {
      const ok = window.confirm(
        t(
          '确认本校 IT 已按 docs/EXIT_LOCK_MDM.md 为学生机配置 Assigned Access（禁 Alt+Tab / 任务管理器）？\n假声明会导致「最高保密级」名不副实。',
        ),
      );
      if (!ok) return;
    }
    setBusy(true);
    setMsg('');
    try {
      await api('/api/v1/settings', {
        method: 'PATCH',
        body: JSON.stringify({ assignedAccessReady: next }),
      });
      setDeclaredReady(next);
      setMsg(next ? t('已记录 L3 就绪声明') : t('已清除 L3 声明'));
      publish({
        declaredReady: next,
        onlineCount,
        hardenedCount,
        unhardenedCount,
      });
    } catch (e) {
      setMsg(te(e, t('保存失败')));
    } finally {
      setBusy(false);
    }
  }

  const canArm = declaredReady && onlineCount > 0 && unhardenedCount === 0;
  const showRed = !canArm;

  return (
    <section
      className={showRed ? 'banner-alert' : 'hint'}
      data-testid="assigned-access-banner"
      data-can-arm={canArm ? '1' : '0'}
      role={showRed ? 'alert' : 'status'}
    >
      <h3>{t('Assigned Access（L3）门禁')}</h3>
      {showRed ? (
        <p>
          {!declaredReady
            ? t(
                '未达最高保密级：请先完成机房 Assigned Access / Intune，再声明就绪。「一键武装最高保密级」已禁用。详见 docs/EXIT_LOCK_MDM.md。',
              )
            : onlineCount <= 0
              ? t(
                  '未达最高保密级：当前班无在线学生机。「一键武装最高保密级」已禁用，请先让学生上线并确认加固。详见 docs/EXIT_LOCK_MDM.md。',
                )
              : t(
                  '未达最高保密级：有 {v0} 台在线机未加固。「一键武装最高保密级」已禁用，请先配 AA 或让学生重登。详见 docs/EXIT_LOCK_MDM.md。',
                  { v0: String(unhardenedCount) },
                )}
        </p>
      ) : (
        <p className="hint">
          {t('L3 已声明就绪')}
          {t(' · 在线 {v0} 台均已报告加固', { v0: String(onlineCount) })}
        </p>
      )}
      <p className="hint">
        {t('在线 {v0} · 已加固 {v1} · 未加固 {v2}', {
          v0: String(onlineCount),
          v1: String(hardenedCount),
          v2: String(unhardenedCount),
        })}{' '}
        ·{' '}
        <a
          href="https://github.com/otas0/classroom-desk/blob/main/docs/EXIT_LOCK_MDM.md"
          target="_blank"
          rel="noreferrer"
        >
          docs/EXIT_LOCK_MDM.md
        </a>
      </p>
      <label className="hint">
        <input
          type="checkbox"
          checked={declaredReady}
          disabled={readonly || busy}
          data-testid="assigned-access-declare"
          onChange={(e) => void setDeclared(e.target.checked)}
        />{' '}
        {t('本校 IT 已配置 Assigned Access / Intune（学生机禁 Alt+Tab / 任务管理器）')}
      </label>
      {msg ? <p className="hint">{msg}</p> : null}
    </section>
  );
}

export { EMPTY_GATE as EMPTY_ASSIGNED_ACCESS_GATE };

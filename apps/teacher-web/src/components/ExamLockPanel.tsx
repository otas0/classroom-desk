import { useCallback, useEffect, useState } from 'react';
import { t, te } from '@classroom-desk/i18n';
import type { DeepLockState } from '@classroom-desk/shared';
import { API_BASE, api } from '../api';
import { isAssistant } from '../authRole';
import { ClassroomLockBar } from './ClassroomLockBar';

type ShieldInfo = { id: string; displayName: string; ok?: boolean; detail?: string };

const IDLE: DeepLockState = {
  frozen: false,
  netMode: 'allow',
  allowlistHosts: [],
  examUrl: '',
  killForeignBrowsers: false,
  killDistractions: false,
  focusFreeze: false,
  updatedAt: '',
};

/**
 * One exam-lock path: L1 input-only → L2 freeze/net → L3 exam allowlist.
 * Makes Shield=off unmistakable before any “断网” action.
 */
export function ExamLockPanel({
  classId,
  onOpenAdvanced,
}: {
  classId: string;
  onOpenAdvanced?: () => void;
}) {
  const [state, setState] = useState<DeepLockState>(IDLE);
  const [examUrl, setExamUrl] = useState('');
  const [hosts, setHosts] = useState('');
  const [shield, setShield] = useState<ShieldInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const readonly = isAssistant();
  const shieldOff = !shield?.id || shield.id === 'off';

  const refresh = useCallback(async () => {
    const cid = classId.trim();
    const q = cid ? `?classId=${encodeURIComponent(cid)}` : '';
    const [s, h] = await Promise.all([
      api<{
        state?: DeepLockState;
        shield?: { id: string; displayName: string };
      }>(`/api/v1/deep-lock${q}`),
      api<{ id?: string; displayName?: string; ok?: boolean; detail?: string }>(
        '/api/v1/deep-lock/shield/health',
      ).catch(() => null),
    ]);
    if (s.state) {
      setState(s.state);
      if (s.state.examUrl) setExamUrl(s.state.examUrl);
      if (s.state.allowlistHosts?.length) setHosts(s.state.allowlistHosts.join(', '));
    }
    const id = h?.id || s.shield?.id || 'off';
    setShield({
      id,
      displayName: h?.displayName || s.shield?.displayName || id,
      ok: h?.ok,
      detail: h?.detail,
    });
  }, [classId]);

  useEffect(() => {
    void refresh().catch(() => undefined);
    const es = new EventSource(`${API_BASE}/api/v1/deep-lock/stream`);
    es.addEventListener('deep_lock', () => {
      void refresh().catch(() => undefined);
    });
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 15_000);
    return () => {
      es.close();
      window.clearInterval(timer);
    };
  }, [refresh]);

  function shieldWarn(actionLabel: string): boolean {
    if (!shieldOff) return true;
    return window.confirm(
      `${actionLabel}\n\n${t('Shield 未配置：仅客户端锁，网关未断。学生仍可能走别的网/热点上网。')}\n${t('继续？')}`,
    );
  }

  function run(action: string, confirmText: string) {
    if (readonly) return;
    if (!window.confirm(confirmText)) return;
    if ((action === 'freeze' || action === 'exam_net' || action === 'kick_class') && !shieldWarn(confirmText)) {
      return;
    }
    setBusy(true);
    const allowlistHosts = hosts
      .split(/[,;\s]+/)
      .map((h) => h.trim())
      .filter(Boolean);
    void api<{ easyJoinCleared?: boolean }>('/api/v1/deep-lock/action', {
      method: 'POST',
      body: JSON.stringify({
        action,
        classId: classId.trim() || undefined,
        examUrl: examUrl.trim() || undefined,
        allowlistHosts,
      }),
    })
      .then(async (r) => {
        if (action === 'end') {
          setMsg(
            r.easyJoinCleared
              ? t('结局 A：已结束深锁 · 已关一键连班（未清 epoch/放行表/DNS）')
              : t('结局 A：已结束深锁（未清 epoch/放行表/DNS；全清请用下课收工）'),
          );
        } else if (action === 'freeze') {
          setMsg(
            shieldOff
              ? t('已冻结全班（仅客户端锁 · 网关未断）')
              : t('已冻结全班（断网+深锁）'),
          );
        } else if (action === 'exam_net') {
          setMsg(t('已切换仅试卷上网'));
        } else if (action === 'allow_net') {
          setMsg(t('已放行上网'));
        } else if (action === 'kick_class') {
          setMsg(t('已踢下线并冻结'));
        } else {
          setMsg(t('已更新'));
        }
        await refresh();
      })
      .catch((e) => setMsg(te(e, '深锁操作失败')))
      .finally(() => setBusy(false));
  }

  const statusText = state.frozen
    ? shieldOff
      ? t('状态：已冻结 · 仅客户端（网关未断）')
      : t('状态：已冻结 · 断网')
    : state.netMode === 'allowlist'
      ? t('状态：仅试卷域')
      : state.netMode === 'deny'
        ? t('状态：断网')
        : t('状态：空闲（未深锁）');

  return (
    <section className="exam-lock-panel deep-lock-bar" data-testid="exam-lock-panel">
      {/* deep-lock-* testids kept for e2e; panel also acts as deep-lock-bar */}
      <div data-testid="deep-lock-bar" hidden aria-hidden="true" />
      <div className="classroom-lock-bar-head">
        <h3>{t('考试锁（一条路径）')}</h3>
        <p className="hint">
          {t('L1 仅键鼠 → L2 冻结/踢网 → L3 仅试卷域。学校机 AA/Intune 另配，应用内不挂钩。')}
        </p>
      </div>
      <p
        className={shieldOff ? 'error' : 'hint'}
        data-testid="exam-lock-shield-truth"
      >
        Shield：{shieldOff ? t('未配置（需 OPNsense / UniFi / HTTP）') : `${shield?.displayName}（${shield?.id}）`}
        {shieldOff ? ` · ${t('深锁不会假断网')}` : ''}
        {shield?.ok === false && !shieldOff ? ` · ${t('心跳异常')}` : ''}
      </p>

      <h4 className="hint">{t('L1 · 仅客户端输入锁')}</h4>
      <ClassroomLockBar classId={classId} onOpenAdvanced={onOpenAdvanced} />

      <h4 className="hint">{t('L2 / L3 · 网关 + 深锁')}</h4>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button
          type="button"
          data-testid="deep-lock-freeze"
          disabled={busy || readonly}
          onClick={() =>
            run(
              'freeze',
              shieldOff
                ? t('冻结全班？Shield 未接：仅锁键鼠/失焦，网关不会断网。')
                : t('冻结全班？将断网、锁键鼠、重锁退出，并启用失焦冻结。'),
            )
          }
        >
          {t('L2 冻结全班')}
        </button>
        <button
          type="button"
          data-testid="deep-lock-exam-net"
          disabled={busy || readonly}
          onClick={() =>
            run(
              'exam_net',
              t('L3 仅试卷上网？将按白名单放行，并开启客户端深锁（杀无关浏览器/失焦）。'),
            )
          }
        >
          {t('L3 仅试卷上网')}
        </button>
        <button
          type="button"
          className="secondary"
          data-testid="deep-lock-allow-net"
          disabled={busy || readonly}
          onClick={() => run('allow_net', t('放行上网？'))}
        >
          {t('放行上网')}
        </button>
        <button
          type="button"
          data-testid="deep-lock-kick"
          disabled={busy || readonly}
          onClick={() =>
            run('kick_class', t('踢下线并冻结？将收回 Shield 会话并深锁本班。'))
          }
        >
          {t('踢下线')}
        </button>
        <button
          type="button"
          className="secondary"
          data-testid="deep-lock-end"
          disabled={busy || readonly}
          onClick={() =>
            run(
              'end',
              `${t('结局 A：仅结束深锁并恢复进考前输入锁？')}\n${t('不会清 epoch / 放行表 / DNS。全清请用「下课收工」。')}`,
            )
          }
        >
          {t('仅结束深锁（结局 A）')}
        </button>
      </div>
      <label className="hint" style={{ display: 'block', marginTop: 8 }}>
        {t('试卷 URL')}
        <input
          data-testid="deep-lock-exam-url"
          value={examUrl}
          disabled={readonly}
          onChange={(e) => setExamUrl(e.target.value)}
          placeholder="https://"
          style={{ display: 'block', width: '100%', maxWidth: 480 }}
        />
      </label>
      <label className="hint" style={{ display: 'block', marginTop: 8 }}>
        {t('允许域名（逗号分隔）')}
        <input
          data-testid="deep-lock-hosts"
          value={hosts}
          disabled={readonly}
          onChange={(e) => setHosts(e.target.value)}
          placeholder="exam.school.edu,cdn.school.edu"
          style={{ display: 'block', width: '100%', maxWidth: 480 }}
        />
      </label>
      <p className="hint" data-testid="deep-lock-status">
        {statusText}
        {readonly ? ` · ${t('助教只读')}` : ''}
      </p>
      {msg ? (
        <p className="hint" data-testid="deep-lock-msg">
          {msg}
        </p>
      ) : null}
    </section>
  );
}

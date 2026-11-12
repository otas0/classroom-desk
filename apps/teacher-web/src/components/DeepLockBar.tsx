import { useCallback, useEffect, useState } from 'react';
import { t, te } from '@classroom-desk/i18n';
import type { DeepLockState } from '@classroom-desk/shared';
import { API_BASE, api } from '../api';
import { isAssistant } from '../authRole';

type Violation = { studentId: string; classId: string; count: number; lastAt: string };

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
 * Aggressive classroom controls: freeze / exam allowlist / allow / kick / end.
 * Default-deny only after teacher arms a mode — idle stays permissive for normal labs.
 */
export function DeepLockBar({ classId }: { classId: string }) {
  const [state, setState] = useState<DeepLockState>(IDLE);
  const [examUrl, setExamUrl] = useState('');
  const [hosts, setHosts] = useState('');
  const [violations, setViolations] = useState<Violation[]>([]);
  const [shieldLabel, setShieldLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const readonly = isAssistant();

  const refresh = useCallback(async () => {
    const cid = classId.trim();
    const q = cid ? `?classId=${encodeURIComponent(cid)}` : '';
    const s = await api<{
      state?: DeepLockState;
      violations?: Violation[];
      shield?: { id: string; displayName: string };
    }>(`/api/v1/deep-lock${q}`);
    if (s.state) {
      setState(s.state);
      if (s.state.examUrl) setExamUrl(s.state.examUrl);
      if (s.state.allowlistHosts?.length) setHosts(s.state.allowlistHosts.join(', '));
    }
    setViolations(Array.isArray(s.violations) ? s.violations : []);
    setShieldLabel(s.shield ? `${s.shield.displayName}` : '');
  }, [classId]);

  useEffect(() => {
    void refresh().catch(() => undefined);
    const es = new EventSource(`${API_BASE}/api/v1/deep-lock/stream`);
    es.addEventListener('deep_lock', () => {
      void refresh().catch(() => undefined);
    });
    es.onmessage = () => {
      void refresh().catch(() => undefined);
    };
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 15_000);
    return () => {
      es.close();
      window.clearInterval(timer);
    };
  }, [refresh]);

  function run(action: string, confirmText?: string) {
    if (readonly) return;
    if (confirmText && !window.confirm(confirmText)) return;
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
        setMsg(
          action === 'freeze'
            ? t('已冻结全班（断网+深锁）')
            : action === 'exam_net'
              ? t('已切换仅试卷上网')
              : action === 'allow_net'
                ? t('已放行上网')
                : action === 'kick_class'
                  ? t('已踢下线并冻结')
                  : action === 'end'
                    ? r.easyJoinCleared
                      ? t('已结束深锁并恢复 · 已自动关一键连班')
                      : t('已结束深锁并恢复')
                    : t('已更新'),
        );
        await refresh();
      })
      .catch((e) => setMsg(te(e, '深锁操作失败')))
      .finally(() => setBusy(false));
  }

  const statusText = state.frozen
    ? t('状态：已冻结 · 断网')
    : state.netMode === 'allowlist'
      ? t('状态：仅试卷域')
      : state.netMode === 'deny'
        ? t('状态：断网')
        : t('状态：空闲（未深锁）');

  const classViolations = violations.filter(
    (v) => !classId.trim() || v.classId === classId.trim(),
  );

  return (
    <section className="deep-lock-bar" data-testid="deep-lock-bar">
      <div className="classroom-lock-bar-head">
        <h3>{t('深锁控制台')}</h3>
        <p className="hint">
          {t(
            '冻结 / 仅试卷 / 放行。学校机考试锁须配 Assigned Access + Intune（禁 Alt+Tab / 任务管理器）；应用内不挂钩。',
          )}
        </p>
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button
          type="button"
          data-testid="deep-lock-freeze"
          disabled={busy || readonly}
          onClick={() =>
            run('freeze', t('冻结全班？将断网、锁键鼠、重锁退出，并启用失焦冻结。'))
          }
        >
          {t('冻结全班')}
        </button>
        <button
          type="button"
          data-testid="deep-lock-exam-net"
          disabled={busy || readonly}
          onClick={() =>
            run(
              'exam_net',
              t('仅试卷上网？将按白名单放行，并开启客户端深锁（杀无关浏览器/失焦）。'),
            )
          }
        >
          {t('仅试卷上网')}
        </button>
        <button
          type="button"
          className="secondary"
          data-testid="deep-lock-allow-net"
          disabled={busy || readonly}
          onClick={() => run('allow_net')}
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
          onClick={() => run('end', t('结束深锁并恢复进考前输入锁快照？'))}
        >
          {t('结束深锁')}
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
        {shieldLabel ? ` · Shield: ${shieldLabel}` : ''}
        {readonly ? ` · ${t('助教只读')}` : ''}
      </p>
      {classViolations.length ? (
        <div className="deep-lock-violations" data-testid="deep-lock-violations">
          <p className="error">
            {t('失焦违规座位（高亮）')} · {classViolations.length}
          </p>
          <ul>
            {classViolations.slice(0, 12).map((v) => (
              <li key={v.studentId} className="row-danger">
                {v.studentId.slice(0, 10)}… ×{v.count}
              </li>
            ))}
          </ul>
          <div className="row">
            <button
              type="button"
              data-testid="deep-lock-kick-violators"
              disabled={busy || readonly}
              onClick={() =>
                run('kick_class', t('对违规班执行踢网并冻结？'))
              }
            >
              {t('一键踢网')}
            </button>
            <button
              type="button"
              className="secondary"
              data-testid="deep-lock-end-from-violations"
              disabled={busy || readonly}
              onClick={() => run('end', t('结束深锁并恢复？'))}
            >
              {t('结束深锁')}
            </button>
          </div>
        </div>
      ) : null}
      {msg ? (
        <p className="hint" data-testid="deep-lock-msg">
          {msg}
        </p>
      ) : null}
    </section>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { t } from '@classroom-desk/i18n';
import { API_BASE, api } from '../api';
import { isAssistant } from '../authRole';

type LockFlags = {
  keyboard: boolean;
  mouse: boolean;
  voice: boolean;
  camera: boolean;
};

const EMPTY: LockFlags = { keyboard: false, mouse: false, voice: false, camera: false };

const FEATURES: Array<{ key: keyof LockFlags; label: string; testId: string }> = [
  { key: 'keyboard', label: '键盘', testId: 'lock-chip-keyboard' },
  { key: 'mouse', label: '鼠标', testId: 'lock-chip-mouse' },
  { key: 'voice', label: '语音', testId: 'lock-chip-voice' },
  { key: 'camera', label: '相机', testId: 'lock-chip-camera' },
];

/**
 * Teaching-time shortcuts for physical input lock.
 * Default scope = current class (not global) so teachers rarely touch advanced settings.
 */
export function ClassroomLockBar({
  classId,
  onOpenAdvanced,
}: {
  classId: string;
  onOpenAdvanced?: () => void;
}) {
  const [flags, setFlags] = useState<LockFlags>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [examSnap, setExamSnap] = useState(false);
  const [msg, setMsg] = useState('');
  const readonly = isAssistant();

  const refresh = useCallback(async () => {
    const s = await api<{
      inputLock?: Partial<LockFlags>;
      examModeSnapshot?: boolean;
    }>('/api/v1/settings');
    setFlags({
      keyboard: Boolean(s.inputLock?.keyboard),
      mouse: Boolean(s.inputLock?.mouse),
      voice: Boolean(s.inputLock?.voice),
      camera: Boolean(s.inputLock?.camera),
    });
    setExamSnap(Boolean(s.examModeSnapshot));
  }, []);

  useEffect(() => {
    void refresh().catch(() => undefined);
    const es = new EventSource(`${API_BASE}/api/v1/input-lock/stream`);
    es.onmessage = () => {
      void refresh().catch(() => undefined);
    };
    es.onerror = () => {
      /* poll fallback below */
    };
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 12_000);
    return () => {
      es.close();
      window.clearInterval(timer);
    };
  }, [refresh]);

  function patch(next: LockFlags, label: string) {
    if (readonly) return;
    setBusy(true);
    setFlags(next);
    const scope = classId.trim() ? 'class' : 'global';
    void api<{ inputLock?: Partial<LockFlags> }>('/api/v1/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        inputLock: {
          ...next,
          scope,
          classId: scope === 'class' ? classId : undefined,
        },
      }),
    })
      .then((r) => {
        if (r.inputLock) {
          setFlags({
            keyboard: Boolean(r.inputLock.keyboard),
            mouse: Boolean(r.inputLock.mouse),
            voice: Boolean(r.inputLock.voice),
            camera: Boolean(r.inputLock.camera),
          });
        }
        setMsg(label);
      })
      .catch((e) => setMsg(e instanceof Error ? e.message : t('输入锁保存失败')))
      .finally(() => setBusy(false));
  }

  function toggle(key: keyof LockFlags) {
    patch({ ...flags, [key]: !flags[key] }, t('已更新锁定项'));
  }

  function lockKm() {
    patch(
      { ...flags, keyboard: true, mouse: true },
      classId.trim() ? t('已锁本班键鼠') : t('已锁全校键鼠'),
    );
  }

  function unlockAllFeatures() {
    patch(EMPTY, classId.trim() ? t('已解除本班输入锁') : t('已解除全校输入锁'));
  }

  function examMode(on: boolean) {
    if (readonly) return;
    if (on && !window.confirm(t('开启考试模式？将锁定键鼠语音相机，并重新锁定学生端退出。'))) {
      return;
    }
    setBusy(true);
    void api('/api/v1/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        examMode: on,
        examModeClassId: classId.trim() || '',
      }),
    })
      .then(async () => {
        setMsg(on ? t('考试模式已开启') : t('考试模式已解除'));
        await refresh();
      })
      .catch((e) => setMsg(e instanceof Error ? e.message : t('操作失败')))
      .finally(() => setBusy(false));
  }

  const anyLocked = flags.keyboard || flags.mouse || flags.voice || flags.camera;

  return (
    <section className="classroom-lock-bar" data-testid="classroom-lock-bar">
      <div className="classroom-lock-bar-head">
        <h3>{t('课堂锁定')}</h3>
        <p className="hint">
          {t('对本班学生端一键开关。默认只锁当前班级；指定机位/全校请用高级选项。')}
        </p>
      </div>
      {!classId.trim() ? (
        <p className="hint">{t('未选班级时快捷锁作用于全校；选班后默认只锁本班。')}</p>
      ) : null}
      <div className="classroom-lock-actions row">
        <button
          type="button"
          data-testid="lock-quick-km"
          disabled={busy || readonly}
          onClick={() => lockKm()}
        >
          {t('锁键鼠')}
        </button>
        <button
          type="button"
          data-testid="lock-quick-exam"
          disabled={busy || readonly || examSnap}
          onClick={() => examMode(true)}
        >
          {t('考试模式')}
        </button>
        <button
          type="button"
          className="secondary"
          data-testid="lock-quick-unlock"
          disabled={busy || readonly || (!anyLocked && !examSnap)}
          onClick={() => {
            if (examSnap) examMode(false);
            else unlockAllFeatures();
          }}
        >
          {examSnap ? t('结束考试') : t('全部解除')}
        </button>
      </div>
      <div className="chip-row classroom-lock-chips" role="group" aria-label={t('锁定功能')}>
        {FEATURES.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`chip${flags[f.key] ? ' active-chip lock-on' : ''}`}
            data-testid={f.testId}
            disabled={busy || readonly}
            aria-pressed={flags[f.key]}
            onClick={() => toggle(f.key)}
          >
            {t(f.label)}
            {flags[f.key] ? ` · ${t('锁')}` : ` · ${t('开')}`}
          </button>
        ))}
      </div>
      <p className="hint" data-testid="classroom-lock-status">
        {examSnap
          ? t('状态：考试模式中')
          : anyLocked
            ? `${t('状态：已锁')} ${FEATURES.filter((f) => flags[f.key])
                .map((f) => t(f.label))
                .join(' / ')}`
            : t('状态：未锁定')}
        {readonly ? ` · ${t('助教只读')}` : ''}
      </p>
      {msg ? (
        <p className="hint" data-testid="classroom-lock-msg">
          {msg}
        </p>
      ) : null}
      {onOpenAdvanced ? (
        <button
          type="button"
          className="linkish"
          data-testid="lock-open-advanced"
          onClick={onOpenAdvanced}
        >
          {t('高级：机位 / 全校 / 课次到期…')}
        </button>
      ) : null}
    </section>
  );
}

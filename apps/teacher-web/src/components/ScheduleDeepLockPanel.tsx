import { useEffect, useState } from 'react';
import { api } from '../api';
import { t } from '@classroom-desk/i18n';

/** Link attendance schedule periods to quiz / self-study deep-lock profiles. */
export function ScheduleDeepLockPanel({ classId }: { classId: string }) {
  const [follow, setFollow] = useState(false);
  const [schedules, setSchedules] = useState<
    Array<{ id: string; startTime: string; endTime: string; deepLockProfile?: string }>
  >([]);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    void (async () => {
      const settings = await api<{ deepLockFollowSchedule?: boolean }>('/api/v1/settings');
      setFollow(settings.deepLockFollowSchedule === true);
    })().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!classId) {
      setSchedules([]);
      return;
    }
    void api<{ items?: typeof schedules }>(
      `/api/v1/attendance/schedules?classId=${encodeURIComponent(classId)}`,
    )
      .then((r) => setSchedules(r.items ?? []))
      .catch(() => setSchedules([]));
  }, [classId]);

  async function toggleFollow(on: boolean) {
    await api('/api/v1/settings', {
      method: 'PATCH',
      body: JSON.stringify({ deepLockFollowSchedule: on }),
    });
    setFollow(on);
    setMsg(on ? t('已开启：节次内自动套用深锁档位') : t('已关闭课表深锁联动'));
  }

  async function setProfile(scheduleId: string, profile: string) {
    await api(`/api/v1/attendance/schedules/${encodeURIComponent(scheduleId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ deepLockProfile: profile }),
    });
    setSchedules((prev) =>
      prev.map((s) => (s.id === scheduleId ? { ...s, deepLockProfile: profile } : s)),
    );
    setMsg(t('已保存节次深锁档位'));
  }

  return (
    <section data-testid="schedule-deep-lock-panel">
      <h3>{t('课表 · 深锁档位')}</h3>
      <p className="hint">
        {t('在出勤节次上选择 quiz（冻结+断网）或 self-study（宽松）。节次结束自动恢复开课前深锁状态。')}
      </p>
      <label className="row">
        <input
          type="checkbox"
          checked={follow}
          disabled={!classId}
          data-testid="deep-lock-follow-schedule"
          onChange={(e) => void toggleFollow(e.target.checked).catch((err) => setMsg(String(err)))}
        />
        {t('按课表节次自动套用/恢复深锁档位')}
      </label>
      {!classId ? <p className="hint">{t('请先选择班级')}</p> : null}
      {classId && !schedules.length ? (
        <p className="hint" data-testid="schedule-deep-lock-empty">
          {t('暂无出勤节次；在出勤面板添加节次后可在此选档位。')}
        </p>
      ) : null}
      {schedules.length ? (
        <table className="compact-table" data-testid="schedule-deep-lock-table">
          <thead>
            <tr>
              <th>{t('时段')}</th>
              <th>{t('深锁档位')}</th>
            </tr>
          </thead>
          <tbody>
            {schedules.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.startTime}–{s.endTime}
                </td>
                <td>
                  <select
                    value={s.deepLockProfile ?? ''}
                    data-testid={`schedule-deep-lock-profile-${s.id}`}
                    onChange={(e) => void setProfile(s.id, e.target.value)}
                  >
                    <option value="">{t('（不联动）')}</option>
                    <option value="quiz">quiz</option>
                    <option value="self-study">self-study</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {msg ? <p className="hint">{msg}</p> : null}
    </section>
  );
}

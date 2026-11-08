import { useEffect, useMemo, useState } from 'react';
import { GITHUB_RELEASES_BASE } from '@classroom-desk/shared';
import { api } from '../api';
import { t } from '@classroom-desk/i18n';

type HealthBody = {
  ok?: boolean;
  degraded?: boolean;
  version?: string;
  studentDesktopVersion?: string;
  hostName?: string;
  suggestedApiBase?: string;
  time?: string;
};

type PresenceItem = {
  studentId: string;
  displayName: string;
  studentNo: string | null;
  clientVersion: string;
  hardened?: boolean;
  seatLabel?: string | null;
  lastSeenAt: string;
};

/**
 * 加固体检：聚合 /health 与本班 presence hardened 汇总（无假数据）。
 */
export function HardeningHealthPanel({ classId }: { classId: string }) {
  const [health, setHealth] = useState<HealthBody | null>(null);
  const [healthErr, setHealthErr] = useState('');
  const [items, setItems] = useState<PresenceItem[]>([]);
  const [hardenedCount, setHardenedCount] = useState(0);
  const [unhardenedCount, setUnhardenedCount] = useState(0);
  const [presenceErr, setPresenceErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [lanTip, setLanTip] = useState('');
  const [copyMsg, setCopyMsg] = useState('');
  const [copyFallback, setCopyFallback] = useState('');

  const expected = String(health?.studentDesktopVersion ?? health?.version ?? '');
  const unhardenedRows = useMemo(
    () => items.filter((i) => !i.hardened),
    [items],
  );

  async function load() {
    setBusy(true);
    setHealthErr('');
    setPresenceErr('');
    try {
      const h = (await fetch('/health', { cache: 'no-store' }).then(async (r) => {
        if (!r.ok) throw new Error(`health HTTP ${r.status}`);
        return r.json();
      })) as HealthBody;
      setHealth(h);
    } catch (e) {
      setHealth(null);
      setHealthErr(e instanceof Error ? e.message : t('无法读取 /health'));
    }
    try {
      const u = await api<{ tipTemplate?: string }>('/api/v1/upgrades');
      setLanTip(u.tipTemplate ?? '');
    } catch {
      setLanTip('');
    }
    if (!classId) {
      setItems([]);
      setHardenedCount(0);
      setUnhardenedCount(0);
      setBusy(false);
      return;
    }
    try {
      const p = await api<{
        items: PresenceItem[];
        hardenedCount?: number;
        unhardenedCount?: number;
        count?: number;
      }>(`/api/v1/presence/clients?classId=${encodeURIComponent(classId)}`);
      const list = p.items ?? [];
      setItems(list);
      const hc =
        p.hardenedCount != null
          ? Number(p.hardenedCount)
          : list.filter((i) => i.hardened).length;
      const uc =
        p.unhardenedCount != null
          ? Number(p.unhardenedCount)
          : list.length - hc;
      setHardenedCount(hc);
      setUnhardenedCount(uc);
    } catch (e) {
      setItems([]);
      setHardenedCount(0);
      setUnhardenedCount(0);
      setPresenceErr(e instanceof Error ? e.message : t('presence 加载失败'));
    }
    setBusy(false);
  }

  useEffect(() => {
    void load();
    const _cdTimer = window.setInterval(() => void load(), 20_000);
    return () => window.clearInterval(_cdTimer);
  }, [classId]);

  async function copyUnhardenedTip() {
    setCopyMsg('');
    setCopyFallback('');
    if (!unhardenedRows.length) {
      setCopyMsg(t('当前无未加固在线机位'));
      return;
    }
    const ver = expected || t('（见教师机 /health）');
    const lines = [
      `【Classroom Desk 加固 / 升级提示】学生端期望 v${ver}`,
      lanTip || `下载：${GITHUB_RELEASES_BASE}/tag/v${ver}`,
      t('请学校 IT 配置 Assigned Access / Intune（见 docs/EXIT_LOCK_MDM.md）；勿写隐蔽 Run 键。'),
      '',
      t('未加固在线机位（真实 presence）：'),
      ...unhardenedRows.map((r) => {
        const seat = r.seatLabel ? ` · 座 ${r.seatLabel}` : '';
        const verNow = r.clientVersion ? ` · v${r.clientVersion}` : '';
        return `- ${r.studentNo ? `${r.studentNo} ` : ''}${r.displayName}${seat}${verNow}`;
      }),
    ];
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopyMsg(`已复制 ${unhardenedRows.length} 台未加固机位提示`);
    } catch {
      setCopyMsg(t('剪贴板不可用，请手动选择下方文本'));
      setCopyFallback(text);
    }
  }

  function exportAaChecklist() {
    const day = new Date().toISOString().slice(0, 10);
    const filename = `assigned-access-checklist-${day}.json`;
    const payload = {
      productName: 'Classroom Desk',
      exportedAt: new Date().toISOString(),
      desktopAppPath: 'C:\\Program Files\\Classroom Desk\\Classroom Desk.exe',
      accountHint: 'StudentKiosk',
      // Keep keys/wording aligned with docs/assigned-access-checklist.example.json
      blockedAppsHint: [
        'Taskmgr.exe',
        'cmd.exe',
        'powershell.exe',
        'regedit.exe',
        'msedge.exe',
        'chrome.exe',
        'explorer.exe (shell replace via AA — do not dual-run)',
      ],
      intuneProfiles: [
        'docs/intune-student-kiosk.example.xml (HideTaskManager + USB deny write/execute)',
        'docs/intune-student-kiosk.rollback.xml (trial-group rollback)',
      ],
      health: health
        ? {
            ok: health.ok,
            degraded: health.degraded,
            version: health.version,
            studentDesktopVersion: health.studentDesktopVersion,
            hostName: health.hostName,
            suggestedApiBase: health.suggestedApiBase,
          }
        : null,
      presence: {
        classId: classId || null,
        online: items.length,
        hardenedCount,
        unhardenedCount,
        unhardened: unhardenedRows.map((r) => ({
          studentId: r.studentId,
          displayName: r.displayName,
          studentNo: r.studentNo,
          seatLabel: r.seatLabel ?? null,
          clientVersion: r.clientVersion,
        })),
      },
      watchdog: {
        allowed:
          'MDM / Assigned Access restart policy or documented Startup folder for Classroom Desk only',
        forbidden: 'Hidden Run key, silent persistence, antivirus evasion',
      },
      verify: [
        'Alt+Tab / Win key blocked or ineffective under AA',
        'Task Manager end-task denied',
        'USB write denied on trial devices',
      ],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.setAttribute('data-testid', 'aa-checklist-download-name');
    a.dataset.filename = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section data-testid="hardening-health-panel">
      <h2>{t('加固体检')}</h2>
      <p className="hint">
        读取服务 <code>/health</code> 与本班学生 presence 的 Assigned Access / MDM 信号汇总。空班显示真实空状态；不写假机位。
      </p>
      <div className="row">
        <button type="button" disabled={busy} onClick={() => void load()}>
          {busy ? t('刷新中…') : t('刷新')}
        </button>
        <button
          type="button"
          className="secondary"
          data-testid="hardening-copy-unhardened-tip"
          disabled={unhardenedRows.length === 0}
          onClick={() => void copyUnhardenedTip()}
        >
          复制未加固升级提示（{unhardenedRows.length}）
        </button>
        <button
          type="button"
          className="secondary"
          data-testid="aa-checklist-export"
          onClick={exportAaChecklist}
        >
          导出 Assigned Access 清单
        </button>
      </div>
      {copyMsg ? (
        <p className="hint" data-testid="hardening-copy-msg">
          {copyMsg}
        </p>
      ) : null}
      {copyFallback ? (
        <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}>
          <textarea
            data-testid="hardening-copy-fallback"
            readOnly
            rows={8}
            value={copyFallback}
            aria-label={t('加固提示全文（剪贴板不可用时手动复制）')}
            style={{ width: '100%', fontFamily: 'inherit', fontSize: '0.9rem' }}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            className="secondary"
            data-testid="hardening-copy-fallback-select-all"
            onClick={() => {
              const el = document.querySelector<HTMLTextAreaElement>(
                '[data-testid="hardening-copy-fallback"]',
              );
              if (!el) return;
              el.focus();
              el.select();
            }}
          >
            一键全选
          </button>
        </div>
      ) : null}

      <h3>{t('服务 /health')}</h3>
      {healthErr ? (
        <p className="error" role="alert">
          {healthErr}
        </p>
      ) : health ? (
        <ul className="hint" data-testid="hardening-health-summary">
          <li>
            状态：{health.ok ? 'ok' : t('异常')}
            {health.degraded ? '（degraded）' : ''}
          </li>
          <li>服务版本：{health.version || '—'}</li>
          <li>学生端期望版本：{health.studentDesktopVersion || health.version || '—'}</li>
          <li>主机：{health.hostName || '—'}</li>
          <li>建议 API：{health.suggestedApiBase || '—'}</li>
          <li>时间：{health.time || '—'}</li>
        </ul>
      ) : (
        <p className="hint">{t('尚未拉取 /health')}</p>
      )}

      <h3>{t('本班加固信号（presence）')}</h3>
      {!classId ? (
        <p className="hint" data-testid="hardening-need-class">
          {t('请先选择班级')}
        </p>
      ) : presenceErr ? (
        <p className="error" role="alert">
          {presenceErr}
        </p>
      ) : (
        <>
          <p className="hint" data-testid="hardening-presence-summary">
            在线 {items.length} · 已加固 {hardenedCount} · 未加固 {unhardenedCount}
          </p>
          {items.length === 0 ? (
            <p className="hint" data-testid="hardening-presence-empty">
              当前无在线学生机（心跳窗口内）
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{t('学生')}</th>
                  <th>{t('座位')}</th>
                  <th>{t('版本')}</th>
                  <th>{t('加固')}</th>
                  <th>{t('最近心跳')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.studentId}>
                    <td>
                      {i.displayName}
                      {i.studentNo ? ` · ${i.studentNo}` : ''}
                    </td>
                    <td>{i.seatLabel || '—'}</td>
                    <td>{i.clientVersion || '—'}</td>
                    <td>{i.hardened ? t('是') : t('否')}</td>
                    <td>{i.lastSeenAt ? new Date(i.lastSeenAt).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

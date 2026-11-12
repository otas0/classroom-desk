import { useEffect, useMemo, useState } from 'react';
import { GITHUB_RELEASES_BASE } from '@classroom-desk/shared';
import { api } from '../api';
import { t } from '@classroom-desk/i18n';

type ClientRow = {
  studentId: string;
  displayName: string;
  studentNo: string | null;
  clientVersion: string;
  clientArch?: string;
};

function archLabel(raw: string): string {
  const a = raw.trim().toLowerCase();
  if (!a) return t('未知架构');
  if (a === 'x64' || a === 'amd64' || a === 'x86_64') return 'x64';
  if (a === 'arm64' || a === 'aarch64') return 'arm64';
  return raw.trim() || t('未知架构');
}

export function FleetDriftNudge({
  classId,
  onOpenUpgrades,
  onOpenPresence,
}: {
  classId: string;
  onOpenUpgrades?: () => void;
  onOpenPresence?: () => void;
}) {
  const [items, setItems] = useState<ClientRow[]>([]);
  const [expected, setExpected] = useState('');
  const [lanTip, setLanTip] = useState('');
  const [studentAutoUpdate, setStudentAutoUpdate] = useState(true);
  const [copyMsg, setCopyMsg] = useState('');
  const [toggleMsg, setToggleMsg] = useState('');
  const [err, setErr] = useState('');

  async function load() {
    if (!classId) {
      setItems([]);
      return;
    }
    setErr('');
    try {
      const health = (await fetch('/health', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({}))) as {
        studentDesktopVersion?: string;
        version?: string;
      };
      setExpected(String(health.studentDesktopVersion ?? health.version ?? ''));
      const clients = await api<{ items: ClientRow[] }>(
        `/api/v1/presence/clients?classId=${encodeURIComponent(classId)}`,
      );
      setItems(clients.items ?? []);
      try {
        const u = await api<{ tipTemplate?: string; studentAutoUpdate?: boolean }>('/api/v1/upgrades');
        setLanTip(u.tipTemplate ?? '');
        if (typeof u.studentAutoUpdate === 'boolean') setStudentAutoUpdate(u.studentAutoUpdate);
      } catch {
        setLanTip('');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('加载失败'));
    }
  }

  useEffect(() => {
    let cancelled = false;
    void load().catch(() => {
      if (!cancelled) setItems([]);
    });
    const timer = window.setInterval(() => void load().catch(() => undefined), 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [classId]);

  const driftRows = useMemo(
    () => items.filter((row) => expected && row.clientVersion && row.clientVersion !== expected),
    [items, expected],
  );

  const byArch = useMemo(() => {
    const map = new Map<string, ClientRow[]>();
    for (const row of driftRows) {
      const key = archLabel(row.clientArch ?? '');
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [driftRows]);

  async function copyUpgradeTip() {
    setCopyMsg('');
    if (!expected || driftRows.length === 0) return;
    const lines = [
      `【Classroom Desk 升级提示】请安装学生端 v${expected}`,
      lanTip || `下载：${GITHUB_RELEASES_BASE}/tag/v${expected}`,
      '',
      t('需升级机位：'),
      ...driftRows.map(
        (r) =>
          `- ${r.studentNo ? `${r.studentNo} ` : ''}${r.displayName}（${archLabel(r.clientArch ?? '')} · v${r.clientVersion}）`,
      ),
    ];
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopyMsg(t('已复制升级提示（{v0} 台）', { v0: String(driftRows.length) }));
    } catch {
      window.prompt(t('复制升级提示'), text);
    }
  }

  async function toggleForceSameVersion() {
    setToggleMsg('');
    const next = !studentAutoUpdate;
    try {
      await api('/api/v1/settings', {
        method: 'PATCH',
        body: JSON.stringify({ studentAutoUpdate: next }),
      });
      setStudentAutoUpdate(next);
      setToggleMsg(next ? t('已对本机房开启强制同版（student_auto_update）') : t('已关闭强制同版'));
    } catch (e) {
      setToggleMsg(e instanceof Error ? e.message : t('保存失败'));
    }
  }

  if (!classId || driftRows.length === 0) return null;

  return (
    <section className="fleet-drift-nudge" data-testid="fleet-drift-nudge">
      <h2>{t('版本漂移')}</h2>
      <p className="hint">
        {t('期望 v{expected} · 漂移 {count} 台', {
          expected,
          count: String(driftRows.length),
        })}
      </p>
      {err ? <p className="error">{err}</p> : null}
      {byArch.map(([arch, rows]) => (
        <details key={arch} open>
          <summary>
            {arch} · {rows.length}
          </summary>
          <ul>
            {rows.map((r) => (
              <li key={r.studentId}>
                {r.studentNo ? `${r.studentNo} · ` : ''}
                {r.displayName} · v{r.clientVersion || '—'}
              </li>
            ))}
          </ul>
        </details>
      ))}
      <div className="row">
        <button type="button" className="secondary" onClick={() => void copyUpgradeTip()}>
          {t('复制升级提示')}
        </button>
        {onOpenUpgrades ? (
          <button type="button" className="secondary" onClick={onOpenUpgrades}>
            {t('打开升级包设置')}
          </button>
        ) : null}
        {onOpenPresence ? (
          <button type="button" className="linkish" onClick={onOpenPresence}>
            {t('在线机位详情')}
          </button>
        ) : null}
        <label className="row" title={t('对应设置项 student_auto_update')}>
          <input
            type="checkbox"
            checked={studentAutoUpdate}
            onChange={() => void toggleForceSameVersion()}
            data-testid="fleet-force-same-version"
          />
          {t('对本班开启强制同版')}
        </label>
      </div>
      {copyMsg ? <p className="hint">{copyMsg}</p> : null}
      {toggleMsg ? <p className="hint">{toggleMsg}</p> : null}
    </section>
  );
}

import { useState } from 'react';
import { t } from '@classroom-desk/i18n';
import { api } from '../api';

/** Single button: bump portal epoch, clear allowlist, DNS profile fallback, close easy-join. */
export function EndOfClassChecklist({ classId }: { classId: string }) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!classId) return;
    setBusy(true);
    setMsg('');
    try {
      const r = await api<{
        ok: boolean;
        portalEpoch?: number;
        allowlistCleared?: boolean;
        dnsProfile?: string;
        easyJoinCleared?: boolean;
      }>('/api/v1/classes/end-of-lesson', {
        method: 'POST',
        body: JSON.stringify({ classId }),
      });
      setMsg(
        t('下课清单完成：epoch={v0} · 放行表已清 · DNS={v1} · 一键连班={v2}', {
          v0: String(r.portalEpoch ?? '—'),
          v1: String(r.dnsProfile ?? 'normal'),
          v2: r.easyJoinCleared ? t('已关') : t('未开'),
        }),
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('失败'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="end-of-class" data-testid="end-of-class-checklist">
      <button type="button" disabled={!classId || busy} onClick={() => void run()}>
        {t('下课收工（epoch + 放行表 + DNS 回落 + 关一键连班）')}
      </button>
      {msg ? <p className="hint">{msg}</p> : null}
    </div>
  );
}

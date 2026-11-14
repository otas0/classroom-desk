import { useState } from 'react';
import { t } from '@classroom-desk/i18n';
import { api } from '../api';

const END_PREVIEW = () =>
  [
    t('门户会话 epoch 作废（学生须重新认证）'),
    t('网关放行表清空'),
    t('DeskDNS 课策略回落 normal'),
    t('一键连班关闭'),
    t('本班深锁结束并恢复'),
  ].join('\n• ');

/** Confirmed one-shot: bump portal epoch, clear allowlist, DNS fallback, close easy-join. */
export function EndOfClassChecklist({ classId }: { classId: string }) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!classId) return;
    const ok = window.confirm(
      `${t('确认下课收工？将立即：')}\n\n• ${END_PREVIEW()}\n\n${t('误触后学生须重新认证 / 重新连班。')}`,
    );
    if (!ok) return;
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
      <button
        type="button"
        className="secondary"
        data-testid="end-of-class-btn"
        disabled={!classId || busy}
        onClick={() => void run()}
      >
        {t('下课收工（需确认）')}
      </button>
      <p className="hint">
        {t('结局 B：全清（epoch + 放行表 + DNS + 连班 + 深锁）。与「仅结束深锁」不同。')}
      </p>
      {msg ? <p className="hint">{msg}</p> : null}
    </div>
  );
}

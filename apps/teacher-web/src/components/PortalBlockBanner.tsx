import { useEffect, useState } from 'react';
import { t } from '@classroom-desk/i18n';
import { api } from '../api';

type Block = {
  at: string;
  reason: string;
  ssid: string;
  ipv4?: string;
  studentNo?: string | null;
  displayName?: string | null;
  message?: string;
};

/** Loud teacher banner when portal admit blocks (esp. unmapped SSID). */
export function PortalBlockBanner({ classId }: { classId?: string }) {
  const [blocks, setBlocks] = useState<Block[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const body = await api<{ portalBlocks?: Block[] }>('/api/v1/gateway/allowlist-live');
        if (cancelled) return;
        setBlocks(Array.isArray(body.portalBlocks) ? body.portalBlocks : []);
      } catch {
        if (!cancelled) setBlocks([]);
      }
    }
    void load();
    const id = window.setInterval(() => void load(), 6_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [classId]);

  // Show latest blocks for the teacher console (all classes — mis-map often cross-SSID).
  const relevant = blocks;
  const top = relevant[0];
  void classId;
  if (!top) return null;

  const who =
    [top.displayName, top.studentNo].filter(Boolean).join(' · ') || t('未知学生');
  const unmapped = top.reason === 'unmapped_zone';

  return (
    <div
      className="portal-block-banner"
      data-testid="portal-block-banner"
      role="alert"
    >
      <p className="portal-block-banner-title">
        {unmapped
          ? t('网络档未映射 · 已拦截认证')
          : t('门户认证已拦截')}
      </p>
      <p className="portal-block-banner-body">
        {who}
        {' · '}
        SSID：<strong>{top.ssid || '—'}</strong>
        {top.ipv4 ? ` · ${top.ipv4}` : ''}
        {top.reason ? ` · ${top.reason}` : ''}
      </p>
      {top.message ? <p className="hint">{top.message}</p> : null}
      {relevant.length > 1 ? (
        <p className="hint">
          {t('近 {v0} 条拦截', { v0: String(relevant.length) })}
        </p>
      ) : null}
    </div>
  );
}

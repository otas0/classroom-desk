import { useEffect, useMemo, useState } from 'react';
import { encodeRoomCode } from '@classroom-desk/shared';
import { API_BASE, api } from '../api';
import { t } from '@classroom-desk/i18n';
import { RoomJoinQr } from './RoomJoinQr';

/** Large room code + easy-join countdown for projection / first viewport of live board. */
export function ProjectionRoomBanner({ classId }: { classId: string }) {
  const [displayName, setDisplayName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [easyJoin, setEasyJoin] = useState(false);
  const [openedAt, setOpenedAt] = useState('');
  const [ttlMinutes, setTtlMinutes] = useState(0);
  const [remainSec, setRemainSec] = useState<number | null>(null);
  const [shieldActive, setShieldActive] = useState('off');
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function loadNetTruth() {
      try {
        const [live, pend] = await Promise.all([
          api<{ shield?: { active?: string } }>('/api/v1/gateway/allowlist-live').catch(() => null),
          api<{ items?: unknown[] }>('/api/v1/classroom/join/pending-devices').catch(() => ({
            items: [],
          })),
        ]);
        if (cancelled) return;
        setShieldActive(String(live?.shield?.active ?? 'off'));
        setPendingCount(Array.isArray(pend.items) ? pend.items.length : 0);
      } catch {
        /* ignore */
      }
    }
    void loadNetTruth();
    const id = window.setInterval(() => void loadNetTruth(), 8_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [classId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [settings, health] = await Promise.all([
          api<{
            classroomDisplayName?: string;
            classroomRoomId?: string;
            studentEasyJoin?: boolean;
            studentEasyJoinClassId?: string;
            studentEasyJoinOpenedAt?: string;
            studentEasyJoinTtlMinutes?: number;
            classroomApiBase?: string;
            advertiseLanIp?: string;
          }>('/api/v1/settings'),
          fetch(`${API_BASE}/health`, { cache: 'no-store' }).then((r) => r.json()) as Promise<{
            lanIps?: string[];
            advertiseLanIp?: string | null;
            suggestedApiBase?: string;
          }>,
        ]);
        if (cancelled) return;
        setDisplayName(String(settings.classroomDisplayName ?? '').trim());
        setRoomId(String(settings.classroomRoomId ?? '').trim());
        setOpenedAt(String(settings.studentEasyJoinOpenedAt ?? '').trim());
        setTtlMinutes(Number(settings.studentEasyJoinTtlMinutes ?? 0) || 0);
        setEasyJoin(
          settings.studentEasyJoin === true &&
            Boolean(settings.studentEasyJoinClassId) &&
            settings.studentEasyJoinClassId === classId,
        );
        const advertise = String(
          settings.advertiseLanIp ?? health.advertiseLanIp ?? '',
        ).trim();
        let ip = advertise;
        if (!ip) {
          try {
            const base = String(settings.classroomApiBase || health.suggestedApiBase || '').replace(
              /\/$/,
              '',
            );
            if (base) ip = new URL(base).hostname;
          } catch {
            ip = '';
          }
          if (!ip || /127\.0\.0\.1|localhost/i.test(ip)) ip = health.lanIps?.[0] ?? '';
        }
        setRoomCode(ip ? encodeRoomCode(ip) : null);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [classId]);

  useEffect(() => {
    if (!easyJoin || !ttlMinutes || !openedAt) {
      setRemainSec(null);
      return;
    }
    const end = Date.parse(openedAt) + ttlMinutes * 60_000;
    const tick = () => {
      const left = Math.max(0, Math.floor((end - Date.now()) / 1000));
      setRemainSec(left);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [easyJoin, ttlMinutes, openedAt]);

  const joinUrl = useMemo(() => {
    const base = String(API_BASE).replace(/\/$/, '');
    return roomCode ? `${base}/ready` : '';
  }, [roomCode]);

  const shieldOff = !shieldActive || shieldActive === 'off';
  // Always render when Shield is off or pending join exists (projection net truth).
  if (!roomCode && !displayName && !roomId && !shieldOff && pendingCount === 0) return null;

  const mm = remainSec != null ? Math.floor(remainSec / 60) : 0;
  const ss = remainSec != null ? remainSec % 60 : 0;

  return (
    <section className="projection-room-banner" data-testid="projection-room-banner">
      <p
        className={shieldOff || pendingCount > 0 ? 'projection-net-truth warn' : 'projection-net-truth'}
        data-testid="projection-net-truth"
        role="status"
      >
        {shieldOff
          ? t('网关未断 · Shield 未配置')
          : t('Shield：{v0}', { v0: shieldActive })}
        {' · '}
        {t('待批准 {v0}', { v0: String(pendingCount) })}
      </p>
      {displayName ? <p className="projection-room-name">{displayName}</p> : null}
      {roomId ? (
        <p className="hint">
          {t('教室号')}：<strong>{roomId}</strong>
        </p>
      ) : null}
      {roomCode ? (
        <>
          <p className="projection-room-code" aria-label={t('房间码')}>
            {roomCode}
          </p>
          <div className="projection-room-qr-row">
            <RoomJoinQr
              payload={roomCode}
              width={160}
              label={t('扫房间码连接（仍可手输 XXXX-XXXX）')}
              testId="projection-room-code-qr"
            />
            {joinUrl ? (
              <RoomJoinQr
                payload={joinUrl}
                width={120}
                label={t('健康检测页（/ready）')}
                testId="projection-ready-qr"
              />
            ) : null}
          </div>
        </>
      ) : null}
      <p className="hint">
        {easyJoin
          ? remainSec != null
            ? t('一键连班已开 · 剩余 {v0}:{v1}', {
                v0: String(mm).padStart(2, '0'),
                v1: String(ss).padStart(2, '0'),
              })
            : t('一键连班已开放 · 学生可查找或输房间码')
          : t('一键连班未开 · 学生可用房间码仍可找到本机，但需老师开班后连班')}
      </p>
    </section>
  );
}

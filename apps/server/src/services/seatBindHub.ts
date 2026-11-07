import type { Response } from 'express';

export type SeatBindPayload = {
  type: 'seat_bind';
  at: string;
  classId: string;
  /** Students whose binding changed (cleared and/or newly seated). */
  changes: Array<{
    studentId: string;
    seat: { id: string; label: string } | null;
  }>;
  /** Bulk grid ops: students should re-fetch /auth/me. */
  reloadAll?: boolean;
};

type Sub = { res: Response; classId?: string };

const sseClients = new Set<Sub>();

export function broadcastSeatBind(payload: Omit<SeatBindPayload, 'type' | 'at'>) {
  if (!payload.changes.length && !payload.reloadAll) return;
  const full: SeatBindPayload = {
    type: 'seat_bind',
    at: new Date().toISOString(),
    changes: payload.changes ?? [],
    classId: payload.classId,
    reloadAll: payload.reloadAll,
  };
  const line = `event: seat_bind\ndata: ${JSON.stringify(full)}\n\n`;
  for (const sub of sseClients) {
    if (sub.classId && sub.classId !== payload.classId) continue;
    try {
      sub.res.write(line);
    } catch {
      sseClients.delete(sub);
    }
  }
}

/** Public SSE — students filter by their user id client-side. Optional ?classId=. */
export function addSeatBindSseClient(res: Response, classId?: string) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const sub: Sub = { res, classId: classId || undefined };
  sseClients.add(sub);
  res.write(`: connected\n\n`);
  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      clearInterval(heartbeat);
      sseClients.delete(sub);
    }
  }, 25000);
  res.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(sub);
  });
}

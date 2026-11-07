import type { Response } from 'express';
import { openDb } from '../db/client.js';

type AssistantRow = {
  id: string;
  username: string;
  displayName: string;
  createdAt: string;
  disabledAt: string | null;
};

type AssistantsPayload = {
  type: 'assistants.updated';
  at: string;
  items: AssistantRow[];
};

type Sub = { res: Response };

const sseClients = new Set<Sub>();

export function listAssistants(): AssistantRow[] {
  return openDb()
    .prepare(
      `SELECT id, username, display_name AS displayName, created_at AS createdAt,
              disabled_at AS disabledAt
       FROM users WHERE role = 'assistant'
       ORDER BY created_at DESC`,
    )
    .all() as AssistantRow[];
}

export function assistantsSnapshot(): AssistantsPayload {
  return {
    type: 'assistants.updated',
    at: new Date().toISOString(),
    items: listAssistants(),
  };
}

export function broadcastAssistantsUpdated() {
  const payload = JSON.stringify(assistantsSnapshot());
  const line = `event: assistants.updated\ndata: ${payload}\n\n`;
  for (const sub of sseClients) {
    try {
      sub.res.write(line);
    } catch {
      sseClients.delete(sub);
    }
  }
}

/** SSE for teacher settings assistant list. Auth via ?token=. */
export function addAssistantsSseClient(res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const sub: Sub = { res };
  sseClients.add(sub);
  const snap = JSON.stringify(assistantsSnapshot());
  res.write(`event: assistants.updated\ndata: ${snap}\n\n`);
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

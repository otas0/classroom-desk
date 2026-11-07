import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from '../db/client.js';

const ERR_FILE = () => path.join(getDataDir(), 'audit-last-error.json');

export function recordAuditWriteFailure(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const payload = { at: new Date().toISOString(), message };
  try {
    fs.mkdirSync(path.dirname(ERR_FILE()), { recursive: true });
    fs.writeFileSync(ERR_FILE(), JSON.stringify(payload), 'utf8');
  } catch {
    console.error('[audit] failed to persist audit write error', message);
  }
  console.error('[audit] write failed:', message);
}

export function clearAuditWriteFailure(): void {
  try {
    if (fs.existsSync(ERR_FILE())) fs.unlinkSync(ERR_FILE());
  } catch {
    /* ignore */
  }
}

export function readAuditWriteFailure(): { at: string; message: string } | null {
  try {
    if (!fs.existsSync(ERR_FILE())) return null;
    const raw = JSON.parse(fs.readFileSync(ERR_FILE(), 'utf8')) as {
      at?: string;
      message?: string;
    };
    if (!raw.message) return null;
    return { at: String(raw.at ?? ''), message: String(raw.message) };
  } catch {
    return { at: new Date().toISOString(), message: 'unreadable audit-last-error.json' };
  }
}

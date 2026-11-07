import type { DatabaseSync } from 'node:sqlite';
import { getSetting } from '../db/migrate.js';
import { recordExitLockEvent, upsertSetting } from './exitLock.js';

const KEY = 'client_input_lock_json';

export type InputLockFlags = {
  /** Block keyboard in student app (capture-phase). */
  keyboard: boolean;
  /** Block mouse / touch / click in student app. */
  mouse: boolean;
  /** Block microphone / speech recognition getUserMedia(audio). */
  voice: boolean;
  /** Block camera getUserMedia(video). */
  camera: boolean;
};

export const DEFAULT_INPUT_LOCK: InputLockFlags = {
  keyboard: false,
  mouse: false,
  voice: false,
  camera: false,
};

function parseFlags(raw: string | null | undefined): InputLockFlags {
  if (!raw) return { ...DEFAULT_INPUT_LOCK };
  try {
    const o = JSON.parse(raw) as Partial<InputLockFlags>;
    return {
      keyboard: Boolean(o.keyboard),
      mouse: Boolean(o.mouse),
      voice: Boolean(o.voice),
      camera: Boolean(o.camera),
    };
  } catch {
    return { ...DEFAULT_INPUT_LOCK };
  }
}

export function getInputLockFlags(db: DatabaseSync): InputLockFlags {
  return parseFlags(getSetting(db, KEY));
}

export function inputLockActive(flags: InputLockFlags): boolean {
  return flags.keyboard || flags.mouse || flags.voice || flags.camera;
}

export function setInputLockFlags(
  db: DatabaseSync,
  patch: Partial<InputLockFlags>,
  meta?: { actorUserId?: string; actorRole?: string; clientIp?: string },
): InputLockFlags {
  const prev = getInputLockFlags(db);
  const next: InputLockFlags = {
    keyboard: patch.keyboard != null ? Boolean(patch.keyboard) : prev.keyboard,
    mouse: patch.mouse != null ? Boolean(patch.mouse) : prev.mouse,
    voice: patch.voice != null ? Boolean(patch.voice) : prev.voice,
    camera: patch.camera != null ? Boolean(patch.camera) : prev.camera,
  };
  upsertSetting(db, KEY, JSON.stringify(next));
  recordExitLockEvent(db, {
    kind: 'input_lock',
    actorUserId: meta?.actorUserId,
    actorRole: meta?.actorRole,
    detail: JSON.stringify({ prev, next }),
    clientIp: meta?.clientIp,
  });
  return next;
}

import { t } from '@classroom-desk/i18n';
/** Teacher-controlled physical input lock (visible kiosk; app-scoped only). */

export type InputLockFlags = {
  keyboard: boolean;
  mouse: boolean;
  voice: boolean;
  camera: boolean;
};

export type InputLockStore = {
  global: InputLockFlags;
  byClass: Record<string, InputLockFlags>;
  bySeat: Record<string, InputLockFlags>;
};

export const EMPTY_INPUT_LOCK: InputLockFlags = {
  keyboard: false,
  mouse: false,
  voice: false,
  camera: false,
};

export function normalizeInputLock(raw: unknown): InputLockFlags {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_INPUT_LOCK };
  const o = raw as Partial<InputLockFlags>;
  return {
    keyboard: Boolean(o.keyboard),
    mouse: Boolean(o.mouse),
    voice: Boolean(o.voice),
    camera: Boolean(o.camera),
  };
}

export function normalizeInputLockStore(raw: unknown): InputLockStore {
  if (!raw || typeof raw !== 'object') {
    return { global: { ...EMPTY_INPUT_LOCK }, byClass: {}, bySeat: {} };
  }
  const o = raw as Partial<InputLockStore>;
  const byClass: Record<string, InputLockFlags> = {};
  for (const [k, v] of Object.entries(o.byClass ?? {})) byClass[k] = normalizeInputLock(v);
  const bySeat: Record<string, InputLockFlags> = {};
  for (const [k, v] of Object.entries(o.bySeat ?? {})) bySeat[k] = normalizeInputLock(v);
  return {
    global: normalizeInputLock(o.global),
    byClass,
    bySeat,
  };
}

export function resolveInputLockClient(
  store: InputLockStore | null | undefined,
  flat: InputLockFlags | null | undefined,
  opts: { classId?: string; seatId?: string; seatIds?: string[] },
): InputLockFlags {
  if (store) {
    const classId = String(opts.classId ?? '').trim();
    const candidates = [
      ...new Set(
        [opts.seatId, ...(opts.seatIds ?? [])]
          .map((s) => String(s ?? '').trim())
          .filter(Boolean),
      ),
    ];
    if (classId) {
      for (const seatId of candidates) {
        const sk = `${classId}:${seatId}`;
        if (store.bySeat[sk]) return { ...store.bySeat[sk]! };
      }
      if (store.byClass[classId]) return { ...store.byClass[classId]! };
    }
    return { ...store.global };
  }
  return normalizeInputLock(flat);
}

/** Stable per-machine id; teacher seat-scope can target this without hand-typing. */
export function getOrCreatePresenceClientId(): string {
  const key = 'cd_presence_client_id';
  try {
    const existing = localStorage.getItem(key)?.trim();
    if (existing) return existing;
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `pc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(key, id);
    return id;
  } catch {
    return `pc_${Date.now().toString(36)}`;
  }
}

export function inputLockSummary(flags: InputLockFlags): string {
  const parts: string[] = [];
  if (flags.keyboard) parts.push(t('键盘'));
  if (flags.mouse) parts.push(t('鼠标/点击'));
  if (flags.voice) parts.push(t('语音'));
  if (flags.camera) parts.push(t('相机'));
  return parts.length ? parts.join('、') : '';
}

export function anyInputLocked(flags: InputLockFlags): boolean {
  return flags.keyboard || flags.mouse || flags.voice || flags.camera;
}

/** True when store has any active bySeat entry (optionally scoped to classId). */
export function storeHasActiveSeatLocks(
  store: InputLockStore | null | undefined,
  classId?: string | null,
): boolean {
  if (!store) return false;
  const cid = String(classId ?? '').trim();
  for (const [key, flags] of Object.entries(store.bySeat ?? {})) {
    if (!anyInputLocked(flags)) continue;
    if (!cid) return true;
    if (key === cid || key.startsWith(`${cid}:`)) return true;
  }
  return false;
}

/** Global or class-scope locks that apply without a seat binding. */
export function storeHasActiveNonSeatLocks(
  store: InputLockStore | null | undefined,
  classId?: string | null,
): boolean {
  if (!store) return false;
  if (anyInputLocked(store.global)) return true;
  const cid = String(classId ?? '').trim();
  if (cid && store.byClass[cid] && anyInputLocked(store.byClass[cid]!)) return true;
  return false;
}

export function stopAllMediaTracks(): void {
  try {
    document.querySelectorAll('video, audio').forEach((el) => {
      const media = el as HTMLMediaElement & { srcObject?: MediaStream | null };
      const stream = media.srcObject;
      if (stream && typeof stream.getTracks === 'function') {
        stream.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {
            /* ignore */
          }
        });
      }
      media.srcObject = null;
    });
  } catch {
    /* ignore */
  }
}

function wantsAudio(c: boolean | MediaTrackConstraints | undefined): boolean {
  if (c === true) return true;
  if (!c || typeof c !== 'object') return false;
  return true;
}

function wantsVideo(c: boolean | MediaTrackConstraints | undefined): boolean {
  if (c === true) return true;
  if (!c || typeof c !== 'object') return false;
  return true;
}

function isWhitelistedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('[data-cd-input-allow]'));
}

/**
 * Install capture-phase blockers + getUserMedia guard.
 * Mouse lock allows clicks on `[data-cd-input-allow]` (e.g. 向教师举手).
 */
export function installInputLockGuards(
  flags: InputLockFlags,
  onBlocked?: (kind: 'keyboard' | 'mouse' | 'voice' | 'camera') => void,
): () => void {
  const cleanups: Array<() => void> = [];

  if (flags.keyboard) {
    const block = (e: Event) => {
      if (isWhitelistedTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      onBlocked?.('keyboard');
    };
    for (const type of ['keydown', 'keyup', 'keypress'] as const) {
      window.addEventListener(type, block, true);
      cleanups.push(() => window.removeEventListener(type, block, true));
    }
  }

  if (flags.mouse) {
    const block = (e: Event) => {
      if (isWhitelistedTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      onBlocked?.('mouse');
    };
    for (const type of [
      'mousedown',
      'mouseup',
      'click',
      'dblclick',
      'contextmenu',
      'pointerdown',
      'pointerup',
      'touchstart',
      'touchend',
      'wheel',
    ] as const) {
      window.addEventListener(type, block, true);
      cleanups.push(() => window.removeEventListener(type, block, true));
    }
  }

  if (flags.voice || flags.camera) {
    stopAllMediaTracks();
    const md = navigator.mediaDevices;
    if (md?.getUserMedia) {
      const original = md.getUserMedia.bind(md);
      md.getUserMedia = (constraints?: MediaStreamConstraints) => {
        if (flags.camera && wantsVideo(constraints?.video)) {
          onBlocked?.('camera');
          return Promise.reject(
            new DOMException(
              t('教师已锁定相机，无法打开摄像头。扫码请改用粘贴 JSON，或请教师解除相机锁。'),
              'NotAllowedError',
            ),
          );
        }
        if (flags.voice && wantsAudio(constraints?.audio)) {
          onBlocked?.('voice');
          return Promise.reject(new DOMException(t('教师已锁定麦克风/语音输入'), 'NotAllowedError'));
        }
        const next: MediaStreamConstraints = { ...(constraints ?? {}) };
        if (flags.camera) next.video = false;
        if (flags.voice) next.audio = false;
        if (!next.audio && !next.video) {
          return Promise.reject(new DOMException(t('媒体输入已被教师锁定'), 'NotAllowedError'));
        }
        return original(next);
      };
      cleanups.push(() => {
        md.getUserMedia = original;
      });
    }
  }

  if (flags.voice) {
    const w = window as unknown as {
      SpeechRecognition?: new () => { abort: () => void; stop: () => void };
      webkitSpeechRecognition?: new () => { abort: () => void; stop: () => void };
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (Ctor) {
      const Orig = Ctor;
      const Locked = function LockedSpeechRecognition(this: unknown) {
        onBlocked?.('voice');
        throw new DOMException(t('语音输入已被教师锁定'), 'NotAllowedError');
      } as unknown as typeof Ctor;
      w.SpeechRecognition = Locked;
      w.webkitSpeechRecognition = Locked;
      cleanups.push(() => {
        w.SpeechRecognition = Orig;
        w.webkitSpeechRecognition = Orig;
      });
    }
  }

  return () => {
    for (const c of cleanups) c();
  };
}
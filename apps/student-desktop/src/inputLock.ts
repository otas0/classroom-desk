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
  opts: { classId?: string; seatId?: string },
): InputLockFlags {
  if (store) {
    const classId = String(opts.classId ?? '').trim();
    const seatId = String(opts.seatId ?? '').trim();
    if (classId && seatId) {
      const sk = `${classId}:${seatId}`;
      if (store.bySeat[sk]) return { ...store.bySeat[sk]! };
    }
    if (classId && store.byClass[classId]) return { ...store.byClass[classId]! };
    return { ...store.global };
  }
  return normalizeInputLock(flat);
}

export function inputLockSummary(flags: InputLockFlags): string {
  const parts: string[] = [];
  if (flags.keyboard) parts.push('键盘');
  if (flags.mouse) parts.push('鼠标/点击');
  if (flags.voice) parts.push('语音');
  if (flags.camera) parts.push('相机');
  return parts.length ? parts.join('、') : '';
}

export function anyInputLocked(flags: InputLockFlags): boolean {
  return flags.keyboard || flags.mouse || flags.voice || flags.camera;
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
              '教师已锁定相机，无法打开摄像头。扫码请改用粘贴 JSON，或请教师解除相机锁。',
              'NotAllowedError',
            ),
          );
        }
        if (flags.voice && wantsAudio(constraints?.audio)) {
          onBlocked?.('voice');
          return Promise.reject(new DOMException('教师已锁定麦克风/语音输入', 'NotAllowedError'));
        }
        const next: MediaStreamConstraints = { ...(constraints ?? {}) };
        if (flags.camera) next.video = false;
        if (flags.voice) next.audio = false;
        if (!next.audio && !next.video) {
          return Promise.reject(new DOMException('媒体输入已被教师锁定', 'NotAllowedError'));
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
        throw new DOMException('语音输入已被教师锁定', 'NotAllowedError');
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

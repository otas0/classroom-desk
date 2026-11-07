/** Teacher-controlled physical input lock (visible kiosk; app-scoped only). */

export type InputLockFlags = {
  keyboard: boolean;
  mouse: boolean;
  voice: boolean;
  camera: boolean;
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

type MediaConstraint = MediaStreamConstraints | boolean | undefined;

function wantsAudio(c: MediaConstraint): boolean {
  if (c === true) return true;
  if (!c || typeof c !== 'object') return false;
  return Boolean((c as MediaStreamConstraints).audio);
}

function wantsVideo(c: MediaConstraint): boolean {
  if (c === true) return true;
  if (!c || typeof c !== 'object') return false;
  return Boolean((c as MediaStreamConstraints).video);
}

/**
 * Install capture-phase blockers + getUserMedia guard.
 * Returns cleanup. Re-call when flags change (cleanup first).
 */
export function installInputLockGuards(
  flags: InputLockFlags,
  onBlocked?: (kind: 'keyboard' | 'mouse' | 'voice' | 'camera') => void,
): () => void {
  const cleanups: Array<() => void> = [];

  if (flags.keyboard) {
    const block = (e: Event) => {
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
    const md = navigator.mediaDevices;
    if (md?.getUserMedia) {
      const original = md.getUserMedia.bind(md);
      md.getUserMedia = (constraints?: MediaStreamConstraints) => {
        if (flags.camera && wantsVideo(constraints?.video)) {
          onBlocked?.('camera');
          return Promise.reject(new DOMException('相机已被教师锁定', 'NotAllowedError'));
        }
        if (flags.voice && wantsAudio(constraints?.audio)) {
          onBlocked?.('voice');
          return Promise.reject(new DOMException('麦克风已被教师锁定', 'NotAllowedError'));
        }
        // Strip locked channels from mixed constraints
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

    // Stop live tracks when locking media
    try {
      // Best-effort: pages holding streams should also react to flag change
      void navigator.mediaDevices?.enumerateDevices?.();
    } catch {
      /* ignore */
    }
  }

  // Web Speech API
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

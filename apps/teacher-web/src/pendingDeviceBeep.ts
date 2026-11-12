const MUTE_KEY = 'cd_pending_device_beep_mute';

let audioCtx: AudioContext | null = null;

export function pendingDeviceBeepMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setPendingDeviceBeepMuted(mute: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, mute ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** Call once after a user gesture so later polls can beep. */
export function unlockPendingDeviceAudio(): void {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
  } catch {
    audioCtx = null;
  }
}

export function playPendingDeviceBeep(): void {
  if (pendingDeviceBeepMuted()) return;
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const t0 = audioCtx.currentTime;
    gain.gain.setValueAtTime(0.08, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
    osc.start(t0);
    osc.stop(t0 + 0.13);
  } catch {
    /* ignore */
  }
}

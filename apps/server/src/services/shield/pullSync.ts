import { openDb } from '../../db/client.js';
import { resyncShieldFromDesk } from '../deepLock.js';
import { getShieldConnector } from './registry.js';

let timer: ReturnType<typeof setInterval> | null = null;

const INTERVAL_MS = 60_000;

/**
 * Periodic Shield re-push from Desk deep-lock + presence.
 * Covers missed push after gateway/OPNsense blips (pull fallback).
 */
export function startShieldPullSync() {
  if (timer) return;
  const tick = () => {
    try {
      const id = getShieldConnector().id;
      if (!id || id === 'off') return;
      void resyncShieldFromDesk(openDb()).catch(() => undefined);
    } catch {
      /* ignore */
    }
  };
  timer = setInterval(tick, INTERVAL_MS);
  // First tick after a short delay so boot can finish.
  setTimeout(tick, 8_000);
}

export function stopShieldPullSync() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

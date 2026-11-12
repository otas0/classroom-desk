import { principalReconnectDelayMs } from './principalWsBackoff';

export type PrincipalWsLike = {
  onopen: ((ev?: unknown) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  close: () => void;
};

/**
 * Principal WS reconnect loop (testable). Inject wsFactory + schedule for mocks.
 */
export function attachPrincipalWsReconnect(opts: {
  buildUrl: () => string | null;
  wsFactory: (url: string) => PrincipalWsLike;
  schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearSchedule: (id: ReturnType<typeof setTimeout>) => void;
  onLive: (live: boolean) => void;
  onMessage?: (data: unknown) => void;
  delayForAttempt?: (attempt: number) => number;
}): { dispose: () => void; getAttempt: () => number; getDelays: () => number[] } {
  let cancelled = false;
  let ws: PrincipalWsLike | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  const delays: number[] = [];
  const delayFor = opts.delayForAttempt ?? principalReconnectDelayMs;

  function clearTimer() {
    if (timer != null) {
      opts.clearSchedule(timer);
      timer = null;
    }
  }

  function connect() {
    if (cancelled) return;
    const url = opts.buildUrl();
    if (!url) return;
    try {
      ws = opts.wsFactory(url);
      ws.onopen = () => {
        if (cancelled) return;
        attempt = 0;
        opts.onLive(true);
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(String(ev.data));
          opts.onMessage?.(data);
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        if (cancelled) return;
        opts.onLive(false);
        attempt += 1;
        const wait = delayFor(attempt);
        delays.push(wait);
        clearTimer();
        timer = opts.schedule(() => connect(), wait);
      };
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
      };
    } catch {
      /* REST only */
    }
  }

  connect();

  return {
    dispose() {
      cancelled = true;
      clearTimer();
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    },
    getAttempt: () => attempt,
    getDelays: () => [...delays],
  };
}

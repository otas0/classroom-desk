/** Principal WS reconnect delay (ms). attempt is 1-based after a close. */
export function principalReconnectDelayMs(attempt: number): number {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(30_000, 1_000 * 2 ** Math.min(n - 1, 5));
}

/** Expected backoff sequence for the first N reconnect attempts. */
export function principalBackoffSequence(n: number): number[] {
  return Array.from({ length: Math.max(0, n) }, (_, i) => principalReconnectDelayMs(i + 1));
}

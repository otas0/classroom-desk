/** Process-local Shield last error (exposed on /health). */

export type ShieldLastError = { at: string; message: string };

let lastError: ShieldLastError | null = null;

export function recordShieldLastError(message: string): ShieldLastError {
  lastError = { at: new Date().toISOString(), message: String(message).slice(0, 500) };
  return lastError;
}

export function getShieldLastError(): ShieldLastError | null {
  return lastError;
}

export function clearShieldLastError(): void {
  lastError = null;
}

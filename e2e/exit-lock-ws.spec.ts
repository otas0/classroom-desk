import { expect, test } from '@playwright/test';
import { ensureTeacherPasswordReady } from './helpers/teacherLogin';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

async function teacherToken(request: Parameters<typeof ensureTeacherPasswordReady>[0]) {
  const password = await ensureTeacherPasswordReady(request);
  const login = await request.post(`${API}/api/v1/auth/login`, {
    data: { username: 'teacher', password },
  });
  expect(login.ok()).toBeTruthy();
  const { token } = (await login.json()) as { token: string };
  return token;
}

/** Minimal SSE reader (Node EventSource is flaky across versions). */
async function openExitLockSse(signal: AbortSignal) {
  const res = await fetch(`${API}/api/v1/exit-lock/stream`, {
    headers: { Accept: 'text/event-stream' },
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`SSE HTTP ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';

  async function nextPayload(): Promise<Record<string, unknown>> {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) throw new Error('SSE stream ended');
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      for (const block of parts) {
        const dataLine = block.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        const data = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;
        if (data.type === 'exit_lock') return data;
      }
    }
  }

  return { nextPayload, cancel: () => reader.cancel().catch(() => undefined) };
}

test.describe('exit-lock realtime push', () => {
  test('batch unlock notifies WS clients', async ({ request }) => {
    const token = await teacherToken(request);

    await request.patch(`${API}/api/v1/settings`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { clientExitRelock: true },
    });

    const wsUrl = API.replace(/^http/i, 'ws') + '/api/v1/exit-lock/ws';
    const messages: Array<Record<string, unknown>> = [];

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('WS timeout waiting for batch_unlock push'));
      }, 12_000);

      ws.addEventListener('message', (ev) => {
        try {
          const data = JSON.parse(String(ev.data)) as Record<string, unknown>;
          if (data.type === 'exit_lock') messages.push(data);
          if (data.clientExitAllowed === true) {
            clearTimeout(timer);
            ws.close();
            resolve();
          }
        } catch (e) {
          clearTimeout(timer);
          ws.close();
          reject(e);
        }
      });

      ws.addEventListener('open', () => {
        void request
          .patch(`${API}/api/v1/settings`, {
            headers: { Authorization: `Bearer ${token}` },
            data: { clientExitUnlockMinutes: 2 },
          })
          .then((r) => {
            if (!r.ok()) throw new Error(`batch unlock HTTP ${r.status()}`);
          })
          .catch((e) => {
            clearTimeout(timer);
            ws.close();
            reject(e);
          });
      });

      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('WS connection error'));
      });
    });

    expect(messages.some((m) => m.clientExitAllowed === true)).toBeTruthy();

    await request.patch(`${API}/api/v1/settings`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { clientExitRelock: true },
    });
  });

  test('after WS closes, SSE still receives batch_unlock', async ({ request }) => {
    test.setTimeout(30_000);
    const token = await teacherToken(request);

    await request.patch(`${API}/api/v1/settings`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { clientExitRelock: true },
    });

    const wsUrl = API.replace(/^http/i, 'ws') + '/api/v1/exit-lock/ws';
    // Drop WS first (student failover path); do not block the test on close quirks.
    try {
      const ws = new WebSocket(wsUrl);
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        ws.addEventListener('open', () => {
          ws.close();
          done();
        });
        ws.addEventListener('error', done);
        setTimeout(done, 3_000);
      });
    } catch {
      /* WS optional for this assertion */
    }

    const ac = new AbortController();
    const abortTimer = setTimeout(() => ac.abort(), 20_000);
    try {
      const sse = await openExitLockSse(ac.signal);
      const hello = await sse.nextPayload();
      expect(hello.type).toBe('exit_lock');

      const unlockRes = await fetch(`${API}/api/v1/settings`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ clientExitUnlockMinutes: 2 }),
      });
      expect(unlockRes.ok).toBeTruthy();

      const pushed = await Promise.race([
        (async () => {
          for (;;) {
            const data = await sse.nextPayload();
            if (data.clientExitAllowed === true) return data;
          }
        })(),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('SSE did not receive clientExitAllowed')), 12_000),
        ),
      ]);
      expect(pushed.clientExitAllowed).toBe(true);
      await sse.cancel();
    } finally {
      clearTimeout(abortTimer);
    }

    await request.patch(`${API}/api/v1/settings`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { clientExitRelock: true },
    });
  });
});

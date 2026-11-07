import { expect, test } from '@playwright/test';
import { ensureTeacherPasswordReady } from './helpers/teacherLogin';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

test.describe('exit-lock WebSocket push', () => {
  test('batch unlock notifies WS clients', async ({ request }) => {
    const password = await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: 'teacher', password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };

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
});

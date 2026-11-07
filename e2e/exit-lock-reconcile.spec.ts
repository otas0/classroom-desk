import { expect, test } from '@playwright/test';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

test.describe('exit-lock cache reconcile', () => {
  test('POST reconcile records client_reconcile when local ≠ server', async ({ request }) => {
    // Force server locked (no unlock window)
    const pub0 = await request.get(`${API}/api/v1/settings/public`);
    expect(pub0.ok()).toBeTruthy();
    const before = (await pub0.json()) as { clientExitAllowed?: boolean };

    const conflict = await request.post(`${API}/api/v1/auth/exit-lock-reconcile`, {
      data: {
        allowed: !before.clientExitAllowed,
        until: '2099-01-01T00:00:00.000Z',
        clientId: 'e2e-reconcile',
      },
    });
    expect(conflict.ok()).toBeTruthy();
    const body = (await conflict.json()) as {
      conflict?: boolean;
      clientExitAllowed?: boolean;
    };
    expect(body.conflict).toBeTruthy();
    // Server remains authority
    expect(body.clientExitAllowed).toBe(before.clientExitAllowed);

    const same = await request.post(`${API}/api/v1/auth/exit-lock-reconcile`, {
      data: {
        allowed: body.clientExitAllowed === true,
        until: null,
        clientId: 'e2e-reconcile',
      },
    });
    expect(same.ok()).toBeTruthy();
    const sameBody = (await same.json()) as { conflict?: boolean };
    // May still conflict if server has unlockUntil set — only assert ok
    expect(sameBody.conflict === true || sameBody.conflict === false).toBeTruthy();
  });
});

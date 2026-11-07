import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { openPrepTab } from './helpers/navPrep';
import { loginTeacherWeb } from './helpers/teacherWebLogin';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

test.describe('settings health alerts', () => {
  test('exportTmp leak → 告警条；enqueue+flush → 队列清空', async ({ page, request }) => {
    const { password } = await loginTeacherWeb(page, request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: 'teacher', password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const leakPath = path.join(os.tmpdir(), `cd-export-e2e-leak-${Date.now()}.tmp`);
    fs.writeFileSync(leakPath, 'leak');
    const old = new Date(Date.now() - 120_000);
    fs.utimesSync(leakPath, old, old);

    try {
      await openPrepTab(page, '设置');
      await page.getByRole('button', { name: '一键检测 /health' }).click();
      await expect(page.getByTestId('export-tmp-leak-alert')).toBeVisible({ timeout: 10_000 });

      const enq = await request.post(`${API}/api/v1/ops/audit-retry/enqueue`, {
        headers: auth,
        data: { action: 'e2e.flush_seed', detail: { note: 'settings-health-alerts' } },
      });
      expect(enq.ok()).toBeTruthy();

      await page.getByRole('button', { name: '一键检测 /health' }).click();
      await expect(page.getByTestId('audit-retry-flush')).toBeVisible({ timeout: 10_000 });
      await page.getByTestId('audit-retry-flush').click();
      await expect(page.getByText(/已重试写入|已 flush|剩余 0/)).toBeVisible({ timeout: 10_000 });

      const health = await request.get(`${API}/health`);
      expect(health.ok()).toBeTruthy();
      const body = (await health.json()) as { audit?: { retryQueueSize?: number } };
      expect(Number(body.audit?.retryQueueSize ?? -1)).toBe(0);
    } finally {
      try {
        fs.unlinkSync(leakPath);
      } catch {
        /* ignore */
      }
    }
  });
});

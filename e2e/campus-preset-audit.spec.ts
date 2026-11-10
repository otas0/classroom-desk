import { expect, test } from '@playwright/test';
import { loginTeacherWeb } from './helpers/teacherWebLogin';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

test.describe('campus preset audit', () => {
  test('network zones: apply campus preset writes settings.campus_preset', async ({
    page,
    request,
  }) => {
    const { password } = await loginTeacherWeb(page, request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: 'teacher', password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    await page
      .locator('aside')
      .getByRole('button', { name: /^(上课|Live class|上課|授業|수업)$/ })
      .click();
    const panel = page.getByTestId('network-zones-panel');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await panel.scrollIntoViewIfNeeded();
    const apply = panel.getByTestId('campus-preset-apply');
    await expect(apply).toBeVisible({ timeout: 15_000 });
    await apply.click();
    await expect(
      page.getByText(
        /已应用校园网预设|Applied campus preset|已套用校園網預設|学内プリセット適用済み|캠퍼스 프리셋 적용됨/,
      ),
    ).toBeVisible({
      timeout: 15_000,
    });

    const audit = await request.get(`${API}/api/v1/audit?action=settings.campus_preset&limit=5`, {
      headers: auth,
    });
    expect(audit.ok()).toBeTruthy();
    const body = (await audit.json()) as { items?: Array<{ action?: string; detail?: string }> };
    const hit = (body.items ?? []).find((x) => x.action === 'settings.campus_preset');
    expect(hit).toBeTruthy();
    expect(String(hit?.detail ?? '')).toMatch(/portal_ssid_require_sig=1/);
  });
});

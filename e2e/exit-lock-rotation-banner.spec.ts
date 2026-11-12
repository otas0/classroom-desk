import { expect, test } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { ensureTeacherPasswordReady, TEACHER_USER } from './helpers/teacherLogin';
import { resetUiLocaleZhCN } from './helpers/uiLocale';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';
const TEACHER_WEB = process.env.TEACHER_WEB ?? 'http://127.0.0.1:5174';

function backdateUnlockCodeSetAtViaSqlite() {
  const dbPath = path.join(process.cwd(), 'apps/server/data/classroom.db');
  if (!fs.existsSync(dbPath)) throw new Error(`missing ${dbPath}`);
  const db = new DatabaseSync(dbPath);
  const old = new Date(Date.now() - 10 * 24 * 60 * 60_000).toISOString();
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('exit_unlock_code_set_at', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(old);
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {
    /* ignore */
  }
  db.close();
}

test.describe('exit-lock rotation banner', () => {
  test('login banner deep-links to settings exit-lock', async ({ page, request }) => {
    await resetUiLocaleZhCN(request);
    const password = await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: {
        exitUnlockCode: `BannerE2e${Date.now() % 1_000_000}`,
        exitUnlockCodeRotateDays: 7,
      },
    });

    const old = new Date(Date.now() - 10 * 24 * 60 * 60_000).toISOString();
    const clock = await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: { exitUnlockCodeSetAt: old },
    });
    // Prefer API clock (no WAL race). Fall back to sqlite+checkpoint when E2E clock hook is off.
    if (!clock.ok()) {
      backdateUnlockCodeSetAtViaSqlite();
    }

    await expect
      .poll(
        async () => {
          const pub = await request.get(`${API}/api/v1/settings/public`);
          if (!pub.ok()) return false;
          const body = (await pub.json()) as { exitUnlockCodeRotationDue?: boolean };
          return body.exitUnlockCodeRotationDue === true;
        },
        { timeout: 20_000, intervals: [250, 500, 1000] },
      )
      .toBe(true);

    await page.goto(`${TEACHER_WEB}/`);
    const banner = page.getByRole('status').filter({ hasText: /解除码已使用|unlock code has been in use|解除碼已使用|解除コード|해제 코드/i });
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /去设置更换解除码|Change unlock code|去設定更換解除碼|設定で解除コード|설정에서 해제 코드/ }).click();

    await page.getByLabel(/用户名|Username|使用者名稱|ユーザー名|사용자/).fill(TEACHER_USER);
    await page.getByLabel(/密码|Password|密碼|パスワード|비밀번호/).fill(password);
    await page.getByRole('button', { name: /登录|Sign in|登入|ログイン|로그인/ }).click();

    const gate = page.getByText(/请先修改个人密码|Change your personal password|必須先改成個人密碼|個人パスワード|개인 비밀번호/);
    const exitLock = page.locator('#exit-lock-settings');
    await gate.or(exitLock).waitFor({ state: 'visible', timeout: 20_000 });
    if (await gate.isVisible()) {
      test.skip(true, 'must-change-password gate; set password_ok / re-run ensure-teacher');
    }

    await expect(exitLock).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /学生端退出锁定|Student exit lock|學生端退出鎖定|退出ロック|학생 종료 잠금/ })).toBeVisible();
  });
});

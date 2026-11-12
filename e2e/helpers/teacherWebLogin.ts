import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import {
  ensureTeacherPasswordReady,
  TEACHER_NEW_PASSWORD,
  TEACHER_USER,
} from './teacherLogin.js';
import { LIVE_CLASS_NAV } from './navPrep.js';

const TEACHER_WEB = process.env.TEACHER_WEB ?? 'http://localhost:5174';

/** Ensure teacher password is usable, then UI-login on Vite teacher-web. */
export async function loginTeacherWeb(
  page: Page,
  request: APIRequestContext,
): Promise<{ password: string }> {
  const password = await ensureTeacherPasswordReady(request);
  await page.goto(TEACHER_WEB);

  const loginHeading = page.getByRole('heading', { name: /教师后台|Teacher console|教師後台|教師コンソール|교사/ });
  // Exact live-class label — bare /수업/ also matches Korean 수업 준비.
  const sessionNav = page
    .locator('aside')
    .getByRole('button', { name: LIVE_CLASS_NAV });
  const prepNav = page
    .locator('aside')
    .getByRole('button', { name: /备课|Lesson prep|備課|授業準備|수업 준비/ });
  await loginHeading.or(sessionNav).or(prepNav).first().waitFor({ state: 'visible', timeout: 20_000 });

  if (await loginHeading.isVisible()) {
    const user = page.getByLabel(/用户名|Username|使用者名稱|ユーザー名|사용자/);
    const pass = page.getByLabel(/密码|Password|密碼|パスワード|비밀번호/);
    await user.fill(TEACHER_USER);
    await pass.fill(password);
    await page.getByRole('button', { name: /登录|Sign in|登入|ログイン|로그인/ }).click();
  }

  // Match the full force-change banner only — bare "개인 비밀번호" also appears on the login hint.
  const forceGate = page.getByText(
    /必须先改成个人密码才能使用其它功能|change it to a personal password before using other features|必須先改成個人密碼才能使用其它功能|個人パスワードへ変更する必要があります|먼저 개인 비밀번호로 바꿔야 합니다/,
  );
  await expect(forceGate.or(sessionNav).or(prepNav).first()).toBeVisible({ timeout: 20_000 });
  if (await forceGate.isVisible().catch(() => false)) {
    // panels.tsx still hardcodes 当前密码 / 新密码 labels (not locale-swapped).
    await page.getByLabel(/当前密码|Current password|目前密碼|現在のパスワード|현재 비밀번호/).fill(password);
    await page.getByLabel(/新密码|New password|新密碼|新しいパスワード|새 비밀번호/).fill(TEACHER_NEW_PASSWORD);
    await page.getByRole('button', { name: /修改登录密码|Change login password|變更登入密碼|ログインパスワード|로그인 비밀번호/ }).click();
    await expect(sessionNav.or(prepNav).first()).toBeVisible({ timeout: 20_000 });
    return { password: TEACHER_NEW_PASSWORD };
  }
  return { password };
}

/** Login as assistant (or any staff). Completes first-login password change when required. */
export async function loginStaffWeb(
  page: Page,
  username: string,
  password: string,
): Promise<string> {
  await page.goto(TEACHER_WEB);
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();

  const forceGate = page.getByText(
    /必须先改成个人密码才能使用其它功能|change it to a personal password before using other features|必須先改成個人密碼才能使用其它功能|個人パスワードへ変更する必要があります|먼저 개인 비밀번호로 바꿔야 합니다/,
  );
  const attendance = page.getByRole('heading', {
    name: /出勤报表|Attendance report|出勤報表|出席レポート|출석 보고서/,
  });
  const prepNav = page
    .locator('aside')
    .getByRole('button', { name: /备课|Lesson prep|備課|授業準備|수업 준비/ });
  await expect(forceGate.or(attendance).or(prepNav).first()).toBeVisible({ timeout: 20_000 });

  if (await forceGate.isVisible().catch(() => false)) {
    const next = `${password}Ok9`;
    await page.getByLabel(/当前密码|Current password|目前密碼|現在のパスワード|현재 비밀번호/).fill(password);
    await page.getByLabel(/新密码|New password|新密碼|新しいパスワード|새 비밀번호/).fill(next);
    await page.getByRole('button', { name: /修改登录密码|Change login password|變更登入密碼|ログインパスワード|로그인 비밀번호/ }).click();
    await expect(attendance.or(prepNav).first()).toBeVisible({ timeout: 20_000 });
    // Assistants land on 出勤 after force change; open 备课 if only nav is visible
    if (!(await attendance.isVisible().catch(() => false))) {
      await prepNav.click();
      const attTab = page
        .locator('.prep-subnav')
        .getByRole('button', { name: /出勤报表|Attendance report|出勤報表|出席レポート|출석 보고서/ });
      if (await attTab.isVisible().catch(() => false)) await attTab.click();
    }
    await expect(attendance).toBeVisible({ timeout: 15_000 });
    return next;
  }
  return password;
}

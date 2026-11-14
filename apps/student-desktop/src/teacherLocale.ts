/** Last teacher-forced UI locale (kept offline after bond). */

const KEY = 'cd_teacher_ui_locale';

export function readTeacherUiLocale(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeTeacherUiLocale(locale: string): void {
  try {
    localStorage.setItem(KEY, locale);
  } catch {
    /* quota / private mode */
  }
}

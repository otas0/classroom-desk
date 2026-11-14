/** Persist whether this machine has ever reached a real teacher host. */

const KEY = 'cd_teacher_bonded';

export function isTeacherBonded(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Mark first successful classroom connect. Irreversible for this profile. */
export function markTeacherBonded(): boolean {
  const was = isTeacherBonded();
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* quota / private mode */
  }
  return !was;
}

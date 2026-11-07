export type StaffRole = 'teacher' | 'admin' | 'assistant';

const KEY = 'cd_staff_role';

export function setStaffRole(role: string | null | undefined) {
  if (role === 'teacher' || role === 'admin' || role === 'assistant') {
    sessionStorage.setItem(KEY, role);
  } else {
    sessionStorage.removeItem(KEY);
  }
}

export function getStaffRole(): StaffRole | null {
  const v = sessionStorage.getItem(KEY);
  if (v === 'teacher' || v === 'admin' || v === 'assistant') return v;
  return null;
}

export function canBulkDelete(): boolean {
  const r = getStaffRole();
  return r === 'teacher' || r === 'admin' || r == null;
}

/** Teacher/admin write powers (roster import, publish questions, settings mutators). */
export function canWriteClass(): boolean {
  return canBulkDelete();
}

export function isAssistant(): boolean {
  return getStaffRole() === 'assistant';
}

/** Prep tabs visible to assistants (read-oriented). */
export function assistantPrepTabs(): Array<
  'attendance' | 'exports' | 'questions' | 'roster' | 'messages'
> {
  return ['attendance', 'exports', 'questions', 'roster', 'messages'];
}

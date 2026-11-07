export type TeacherTab = 'session' | 'prep' | 'assign' | 'settings';
export type TeacherPrepTab =
  | 'roster'
  | 'questions'
  | 'q-recycle'
  | 'requests'
  | 'attendance'
  | 'exports'
  | 'messages'
  | 'settings';

export const NAV_TAB_KEY = 'cd_teacher_tab';
export const NAV_PREP_KEY = 'cd_teacher_prep_tab';
export const NAV_CLASS_KEY = 'cd_teacher_class_id';

const TABS: TeacherTab[] = ['session', 'prep', 'assign', 'settings'];
const PREP_TABS: TeacherPrepTab[] = [
  'roster',
  'questions',
  'q-recycle',
  'requests',
  'attendance',
  'exports',
  'messages',
  'settings',
];

export function readStoredTab(): TeacherTab {
  if (sessionStorage.getItem('cd_must_change_password') === '1') return 'settings';
  const saved = localStorage.getItem(NAV_TAB_KEY);
  return TABS.includes(saved as TeacherTab) ? (saved as TeacherTab) : 'session';
}

export function readStoredPrepTab(): TeacherPrepTab {
  const saved = localStorage.getItem(NAV_PREP_KEY);
  return PREP_TABS.includes(saved as TeacherPrepTab) ? (saved as TeacherPrepTab) : 'roster';
}

/** Persist nav then hard-reload (structural settings like 留言开关). */
export function hardReloadTeacherNav(patch?: {
  tab?: TeacherTab;
  prepTab?: TeacherPrepTab;
  classId?: string;
}) {
  if (patch?.tab) localStorage.setItem(NAV_TAB_KEY, patch.tab);
  if (patch?.prepTab) localStorage.setItem(NAV_PREP_KEY, patch.prepTab);
  if (patch?.classId != null) localStorage.setItem(NAV_CLASS_KEY, patch.classId);
  window.location.reload();
}

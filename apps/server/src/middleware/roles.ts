import type { Role } from '../types.js';

/** Can view staff UI (teacher console). */
export const STAFF_ROLES: Role[] = ['teacher', 'admin', 'assistant'];

/** Can run destructive / bulk-delete mutations. */
export const MANAGER_ROLES: Role[] = ['teacher', 'admin'];

export function canBulkDelete(role: Role | undefined): boolean {
  return role === 'teacher' || role === 'admin';
}

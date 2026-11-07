/** Resolve PERMISSIONS.md for Vite `/`, production `/admin/`, and file:// shells. */
export function permissionsDocHref(): string {
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    try {
      return new URL('PERMISSIONS.md', window.location.href).href;
    } catch {
      /* fall through */
    }
  }
  const base = String(import.meta.env.BASE_URL || '/');
  const root = base.endsWith('/') ? base : `${base}/`;
  return `${root}PERMISSIONS.md`;
}

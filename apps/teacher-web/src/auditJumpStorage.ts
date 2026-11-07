/**
 * Audit → list jump ids survive React StrictMode remount (effect runs twice and
 * used to clear sessionStorage on the first pass, leaving the remount empty).
 */
let memoryIds: string[] | null = null;
let memoryOpenRecycle: boolean | null = null;
let clearTimer: number | null = null;

function scheduleClear() {
  if (clearTimer != null) window.clearTimeout(clearTimer);
  clearTimer = window.setTimeout(() => {
    memoryIds = null;
    memoryOpenRecycle = null;
    try {
      sessionStorage.removeItem('cd_audit_jump_ids');
      sessionStorage.removeItem('cd_audit_jump_open_recycle');
    } catch {
      /* ignore */
    }
    clearTimer = null;
  }, 12_000);
}

export function stashAuditJumpIds(ids: string[], openRecycle = false) {
  memoryIds = ids.map(String);
  memoryOpenRecycle = openRecycle;
  try {
    sessionStorage.setItem('cd_audit_jump_ids', JSON.stringify(memoryIds));
    if (openRecycle) sessionStorage.setItem('cd_audit_jump_open_recycle', '1');
    else sessionStorage.removeItem('cd_audit_jump_open_recycle');
  } catch {
    /* ignore */
  }
  scheduleClear();
}

export function consumeAuditJumpIds(): string[] {
  if (memoryIds?.length) {
    scheduleClear();
    return [...memoryIds];
  }
  try {
    const raw = sessionStorage.getItem('cd_audit_jump_ids');
    if (!raw) return [];
    const ids = JSON.parse(raw) as string[];
    if (!Array.isArray(ids) || !ids.length) return [];
    memoryIds = ids.map(String);
    scheduleClear();
    return [...memoryIds];
  } catch {
    return [];
  }
}

export function consumeAuditJumpOpenRecycle(): boolean {
  if (memoryOpenRecycle != null) {
    scheduleClear();
    return memoryOpenRecycle;
  }
  try {
    const v = sessionStorage.getItem('cd_audit_jump_open_recycle') === '1';
    memoryOpenRecycle = v;
    scheduleClear();
    return v;
  } catch {
    return false;
  }
}

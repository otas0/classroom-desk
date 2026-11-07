/** Pure helpers for ConfirmModal keyboard a11y (unit-tested without DOM React). */

export function shouldCancelOnEscape(key: string, busy: boolean): boolean {
  return key === 'Escape' && !busy;
}

export function nextTabFocusIndex(
  focusableCount: number,
  activeIndex: number,
  shiftKey: boolean,
): number | null {
  if (focusableCount <= 0) return null;
  if (focusableCount === 1) return 0;
  if (shiftKey) {
    return activeIndex <= 0 ? focusableCount - 1 : activeIndex - 1;
  }
  return activeIndex >= focusableCount - 1 ? 0 : activeIndex + 1;
}

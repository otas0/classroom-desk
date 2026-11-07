import { useCallback, useRef, useState, type KeyboardEvent } from 'react';

export type ListSelectionOpts = {
  onActivate?: (id: string) => void;
  /** Called when focus moves (↑↓); parent should scroll virtual list so row is mounted. */
  ensureVisible?: (index: number, id: string) => void;
};

/** Checkbox + Shift-range + keyboard ↑↓/Space selection for virtual lists. */
export function useListSelection(orderedIds: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchorId = useRef<string | null>(null);
  const focusIndex = useRef(0);

  const clear = useCallback(() => {
    setSelected(new Set());
    anchorId.current = null;
  }, []);

  const toggleOne = useCallback((id: string, on: boolean, shift?: boolean) => {
    if (shift && anchorId.current) {
      const a = orderedIds.indexOf(anchorId.current);
      const b = orderedIds.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelected((prev) => {
          const next = new Set(prev);
          for (let k = lo; k <= hi; k++) {
            const rid = orderedIds[k]!;
            if (on) next.add(rid);
            else next.delete(rid);
          }
          return next;
        });
        focusIndex.current = b;
        return;
      }
    }
    anchorId.current = id;
    focusIndex.current = Math.max(0, orderedIds.indexOf(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, [orderedIds]);

  const focusRow = useCallback(
    (index: number, opts?: ListSelectionOpts) => {
      const id = orderedIds[index];
      if (!id) return;
      focusIndex.current = index;
      opts?.ensureVisible?.(index, id);
      requestAnimationFrame(() => {
        const el = document.querySelector(
          `[data-row-id="${CSS.escape(id)}"]`,
        ) as HTMLElement | null;
        el?.focus();
        el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    },
    [orderedIds],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent, opts?: ListSelectionOpts) => {
      if (!orderedIds.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        const next = Math.min(
          orderedIds.length - 1,
          Math.max(0, focusIndex.current + delta),
        );
        const id = orderedIds[next]!;
        if (e.shiftKey) {
          toggleOne(id, true, true);
        } else {
          anchorId.current = id;
        }
        focusRow(next, opts);
        return;
      }
      if (e.key === ' ' || e.key === 'Spacebar') {
        const id = orderedIds[focusIndex.current];
        if (!id) return;
        e.preventDefault();
        if (e.shiftKey) toggleOne(id, !selected.has(id), true);
        else toggleOne(id, !selected.has(id), false);
        return;
      }
      if (e.key === 'Enter') {
        const id = orderedIds[focusIndex.current];
        if (id) opts?.onActivate?.(id);
      }
    },
    [orderedIds, selected, toggleOne, focusRow],
  );

  return {
    selected,
    setSelected,
    clear,
    toggleOne,
    onKeyDown,
    focusIndex,
    anchorId,
    focusRow,
  };
}

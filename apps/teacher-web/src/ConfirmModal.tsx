import { useEffect, useId, useRef, type ReactNode } from 'react';
import { nextTabFocusIndex, shouldCancelOnEscape } from './confirmModalA11y';
import { t } from '@classroom-desk/i18n';

export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel = t('确定'),
  cancelLabel = t('取消'),
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const _cdTimer = window.setTimeout(() => confirmRef.current?.focus(), 0);

    function focusables(): HTMLElement[] {
      if (!cardRef.current) return [];
      return [
        ...cardRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.tabIndex !== -1);
    }

    function onKey(e: KeyboardEvent) {
      if (shouldCancelOnEscape(e.key, busy)) {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (!list.length) return;
      const activeIndex = list.findIndex((el) => el === document.activeElement);
      const next = nextTabFocusIndex(list.length, activeIndex < 0 ? 0 : activeIndex, e.shiftKey);
      if (next == null) return;
      // Only trap when leaving ends
      if (
        (e.shiftKey && activeIndex <= 0) ||
        (!e.shiftKey && activeIndex >= list.length - 1) ||
        activeIndex < 0
      ) {
        e.preventDefault();
        list[next]!.focus();
      }
    }

    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(_cdTimer);
      document.removeEventListener('keydown', onKey);
      previouslyFocused.current?.focus?.();
    };
  }, [open, busy, onCancel]);

  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        ref={cardRef}
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId}>{title}</h3>
        <div className="modal-body">{body}</div>
        <div className="row modal-actions">
          <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button ref={confirmRef} type="button" disabled={busy} onClick={onConfirm}>
            {busy ? t('处理中…') : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

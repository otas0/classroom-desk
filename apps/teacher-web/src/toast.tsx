import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

type ToastKind = 'ok' | 'err' | 'info';
type ToastItem = { id: number; text: string; kind: ToastKind };

type ToastApi = {
  push: (text: string, kind?: ToastKind) => void;
  ok: (text: string) => void;
  err: (text: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = ++seq;
    setItems((prev) => [...prev.slice(-4), { id, text, kind }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const api: ToastApi = {
    push,
    ok: (text) => push(text, 'ok'),
    err: (text) => push(text, 'err'),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast-item toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      push: () => undefined,
      ok: () => undefined,
      err: () => undefined,
    };
  }
  return ctx;
}

/** Keep hook dependency quiet when provider remounts. */
export function useToastEffectReady(onReady: (t: ToastApi) => void) {
  const toast = useToast();
  useEffect(() => {
    onReady(toast);
  }, [toast, onReady]);
}

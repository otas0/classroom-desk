import {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { DEFAULT_UI_LOCALE, type UiLocale } from './locales.js';
import { getUiLocale, setUiLocale, t as runtimeT } from './runtime.js';
import type { Vars } from './translate.js';

type I18nCtx = {
  locale: UiLocale;
  setLocale: (locale: UiLocale) => void;
  t: (msgid: string, vars?: Vars) => string;
};

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({
  locale: localeProp,
  onLocaleChange,
  children,
}: {
  locale?: UiLocale;
  onLocaleChange?: (locale: UiLocale) => void;
  children: ReactNode;
}) {
  const [inner, setInner] = useState<UiLocale>(() =>
    localeProp ?? getUiLocale() ?? DEFAULT_UI_LOCALE,
  );
  const locale = localeProp ?? inner;

  const setLocale = useCallback(
    (next: UiLocale) => {
      const n = setUiLocale(next);
      if (localeProp == null) setInner(n);
      onLocaleChange?.(n);
    },
    [localeProp, onLocaleChange],
  );

  const value = useMemo(() => {
    setUiLocale(locale);
    return { locale, setLocale, t: runtimeT };
  }, [locale, setLocale]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useI18n requires I18nProvider');
  return ctx;
}

export function useT() {
  return useI18n().t;
}

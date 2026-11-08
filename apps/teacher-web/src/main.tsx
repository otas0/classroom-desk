import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DEFAULT_UI_LOCALE,
  normalizeUiLocale,
  setUiLocale,
  type UiLocale,
} from '@classroom-desk/i18n';
import { I18nProvider } from '@classroom-desk/i18n/react';
import { App } from './App';
import { ToastProvider } from './toast';
import { api, getToken } from './api';
import './styles.css';

function Root() {
  const [locale, setLocale] = useState<UiLocale>(DEFAULT_UI_LOCALE);

  const applyLocale = useCallback((next: UiLocale) => {
    const n = setUiLocale(next);
    setLocale(n);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        if (!getToken()) {
          const pub = await api<{ uiLocale?: string }>('/api/v1/settings/public');
          if (!cancelled) applyLocale(normalizeUiLocale(pub.uiLocale));
          return;
        }
        const s = await api<{ uiLocale?: string }>('/api/v1/settings');
        if (!cancelled) applyLocale(normalizeUiLocale(s.uiLocale));
      } catch {
        if (!cancelled) applyLocale(DEFAULT_UI_LOCALE);
      }
    }
    void load();
    const onLocale = (ev: Event) => {
      const detail = (ev as CustomEvent<{ uiLocale?: string }>).detail;
      if (detail?.uiLocale) applyLocale(normalizeUiLocale(detail.uiLocale));
    };
    window.addEventListener('cd-ui-locale', onLocale as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener('cd-ui-locale', onLocale as EventListener);
    };
  }, [applyLocale]);

  return (
    <I18nProvider locale={locale}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </I18nProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

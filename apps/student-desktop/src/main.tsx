import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  detectSystemUiLocale,
  normalizeUiLocale,
  setUiLocale,
  type UiLocale,
} from '@classroom-desk/i18n';
import { I18nProvider } from '@classroom-desk/i18n/react';
import { App } from './App';
import { isTeacherBonded } from './teacherBond';
import { readTeacherUiLocale } from './teacherLocale';
import './styles.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element #root not found');
}

function initialStudentLocale(): UiLocale {
  if (isTeacherBonded()) {
    const cached = readTeacherUiLocale();
    if (cached) return normalizeUiLocale(cached);
  }
  return detectSystemUiLocale();
}

function Root() {
  const [locale, setLocale] = useState<UiLocale>(() => setUiLocale(initialStudentLocale()));

  const applyLocale = useCallback((next: UiLocale) => {
    setLocale(setUiLocale(next));
  }, []);

  useEffect(() => {
    const onLocale = (ev: Event) => {
      const detail = (ev as CustomEvent<{ uiLocale?: string }>).detail;
      if (detail?.uiLocale) applyLocale(normalizeUiLocale(detail.uiLocale));
    };
    window.addEventListener('cd-ui-locale', onLocale as EventListener);
    return () => window.removeEventListener('cd-ui-locale', onLocale as EventListener);
  }, [applyLocale]);

  return (
    <I18nProvider locale={locale} key={locale}>
      <App onUiLocale={applyLocale} />
    </I18nProvider>
  );
}

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

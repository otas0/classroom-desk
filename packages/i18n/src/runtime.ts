import { CATALOGS } from './catalogs.js';
import { DEFAULT_UI_LOCALE, normalizeUiLocale, type UiLocale } from './locales.js';
import { createTranslator, type Translator, type Vars } from './translate.js';

let active: Translator = createTranslator(DEFAULT_UI_LOCALE, CATALOGS);

export function getUiLocale(): UiLocale {
  return active.locale;
}

export function setUiLocale(locale: UiLocale | string): UiLocale {
  const next = normalizeUiLocale(locale);
  active = createTranslator(next, CATALOGS);
  const doc = (globalThis as { document?: { documentElement: { lang: string } } }).document;
  if (doc) doc.documentElement.lang = next;
  return next;
}

/** Module-level translator; call setUiLocale before render when locale changes. */
export function t(msgid: string, vars?: Vars): string {
  return active.t(msgid, vars);
}

/** Localize API/Error.message (Chinese msgid) with fallback copy. */
export function te(e: unknown, fallbackMsgid: string): string {
  const raw = e instanceof Error && e.message.trim() ? e.message : fallbackMsgid;
  return t(raw);
}

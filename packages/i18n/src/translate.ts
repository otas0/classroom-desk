import { DEFAULT_UI_LOCALE, type UiLocale } from './locales.js';

export type Catalog = Record<string, string>;
export type Vars = Record<string, string | number | boolean | null | undefined>;

export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, name: string) => {
    const v = vars[name];
    return v == null ? '' : String(v);
  });
}

/** msgid = zh-CN source string (or patterned template with {v0}). */
export function createTranslator(locale: UiLocale, catalogs: Record<UiLocale, Catalog>) {
  const cat = catalogs[locale] ?? catalogs[DEFAULT_UI_LOCALE] ?? {};
  const fallback = catalogs[DEFAULT_UI_LOCALE] ?? {};

  function t(msgid: string, vars?: Vars): string {
    if (!msgid) return msgid;
    let out = cat[msgid];
    if (out == null && locale !== DEFAULT_UI_LOCALE) out = fallback[msgid];
    if (out == null) out = msgid; // zh-CN identity / missing key
    return interpolate(out, vars);
  }

  return { t, locale };
}

export type Translator = ReturnType<typeof createTranslator>;

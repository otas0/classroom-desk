/** Supported classroom UI locales (BCP-47). Default zh-CN. */
export const UI_LOCALES = ['zh-CN', 'en', 'zh-TW', 'ja', 'ko'] as const;
export type UiLocale = (typeof UI_LOCALES)[number];

export const UI_LOCALE_LABELS: Record<UiLocale, string> = {
  'zh-CN': '简体中文',
  en: 'English',
  'zh-TW': '繁體中文',
  ja: '日本語',
  ko: '한국어',
};

export const DEFAULT_UI_LOCALE: UiLocale = 'zh-CN';

export function isUiLocale(v: unknown): v is UiLocale {
  return typeof v === 'string' && (UI_LOCALES as readonly string[]).includes(v);
}

export function normalizeUiLocale(v: unknown): UiLocale {
  if (isUiLocale(v)) return v;
  const s = String(v ?? '').trim();
  if (s === 'zh' || s === 'zh-Hans' || s === 'zh_CN') return 'zh-CN';
  if (s === 'zh-Hant' || s === 'zh_TW' || s === 'zh-HK') return 'zh-TW';
  if (s.startsWith('en')) return 'en';
  if (s.startsWith('ja')) return 'ja';
  if (s.startsWith('ko')) return 'ko';
  return DEFAULT_UI_LOCALE;
}

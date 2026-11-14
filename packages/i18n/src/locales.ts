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
  const s = String(v ?? '').trim().replace(/_/g, '-');
  if (!s) return DEFAULT_UI_LOCALE;
  const lower = s.toLowerCase();
  if (lower === 'zh' || lower.startsWith('zh-hans') || lower === 'zh-cn') return 'zh-CN';
  if (
    lower.startsWith('zh-hant') ||
    lower === 'zh-tw' ||
    lower === 'zh-hk' ||
    lower === 'zh-mo'
  ) {
    return 'zh-TW';
  }
  if (lower.startsWith('zh')) return 'zh-CN';
  if (lower.startsWith('en')) return 'en';
  if (lower.startsWith('ja')) return 'ja';
  if (lower.startsWith('ko')) return 'ko';
  return DEFAULT_UI_LOCALE;
}

function readHostLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  if (navigator.languages?.length) return [...navigator.languages];
  if (navigator.language) return [navigator.language];
  return [];
}

/**
 * Map the host OS / browser language list to a supported classroom locale.
 * Used by student first-setup before a teacher bond forces classroom uiLocale.
 */
export function detectSystemUiLocale(
  languages?: readonly string[] | string | null,
): UiLocale {
  const source =
    languages == null
      ? readHostLanguages()
      : Array.isArray(languages)
        ? languages
        : [String(languages)];
  for (const raw of source) {
    const lower = String(raw ?? '')
      .trim()
      .toLowerCase()
      .replace(/_/g, '-');
    if (!lower) continue;
    if (
      !(
        lower.startsWith('zh') ||
        lower.startsWith('en') ||
        lower.startsWith('ja') ||
        lower.startsWith('ko')
      )
    ) {
      continue;
    }
    return normalizeUiLocale(raw);
  }
  return DEFAULT_UI_LOCALE;
}

export {
  UI_LOCALES,
  UI_LOCALE_LABELS,
  DEFAULT_UI_LOCALE,
  isUiLocale,
  normalizeUiLocale,
  type UiLocale,
} from './locales.js';
export { createTranslator, interpolate, type Catalog, type Vars, type Translator } from './translate.js';
export { CATALOGS } from './catalogs.js';
export { t, te, setUiLocale, getUiLocale } from './runtime.js';

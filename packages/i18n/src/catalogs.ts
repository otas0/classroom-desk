import type { UiLocale } from './locales.js';
import type { Catalog } from './translate.js';
import zhCN from '../locales/zh-CN.json' with { type: 'json' };
import en from '../locales/en.json' with { type: 'json' };
import zhTW from '../locales/zh-TW.json' with { type: 'json' };
import ja from '../locales/ja.json' with { type: 'json' };
import ko from '../locales/ko.json' with { type: 'json' };

export const CATALOGS: Record<UiLocale, Catalog> = {
  'zh-CN': zhCN as Catalog,
  en: en as Catalog,
  'zh-TW': zhTW as Catalog,
  ja: ja as Catalog,
  ko: ko as Catalog,
};

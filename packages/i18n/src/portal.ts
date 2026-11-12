import type { UiLocale } from './locales.js';
import zhCN from '../locales/portal/zh-CN.json' with { type: 'json' };
import en from '../locales/portal/en.json' with { type: 'json' };
import zhTW from '../locales/portal/zh-TW.json' with { type: 'json' };
import ja from '../locales/portal/ja.json' with { type: 'json' };
import ko from '../locales/portal/ko.json' with { type: 'json' };

/** Captive portal catalogs — kept in sync with /portal via GET /api/v1/portal/i18n/:locale */
export const PORTAL_CATALOGS: Record<UiLocale, Record<string, string>> = {
  'zh-CN': zhCN as Record<string, string>,
  en: en as Record<string, string>,
  'zh-TW': zhTW as Record<string, string>,
  ja: ja as Record<string, string>,
  ko: ko as Record<string, string>,
};

export function portalMessages(locale: UiLocale): Record<string, string> {
  return PORTAL_CATALOGS[locale] ?? PORTAL_CATALOGS['zh-CN'];
}

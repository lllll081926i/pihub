import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import zhCN from './locales/zh-CN.json';

/**
 * Only the default locale is bundled into the startup chunk; the other locale
 * file (~64 KB raw, ~15 KB gzip) is fetched via dynamic import on first use.
 */
export const resources = {
  'zh-CN': { translation: zhCN },
} as const;

export type Language = 'zh-CN' | 'en-US';

export const languages: { value: Language; label: string }[] = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English' },
];

/**
 * Ensure the translation bundle for `language` is registered. The startup
 * locale (zh-CN) is always present; others are imported on demand.
 * Call before `i18n.changeLanguage(language)`.
 */
export const loadLanguageResources = async (language: Language): Promise<void> => {
  if (i18n.hasResourceBundle(language, 'translation')) {
    return;
  }

  const bundle = language === 'en-US'
    ? (await import('./locales/en-US.json')).default
    : (await import('./locales/zh-CN.json')).default;
  i18n.addResourceBundle(language, 'translation', bundle, true, true);
};

i18n.use(initReactI18next).init({
  resources,
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;

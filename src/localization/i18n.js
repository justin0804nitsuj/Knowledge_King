import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import en from './locales/en.js';
import zhTW from './locales/zh-TW.js';
import { loadSettings, saveSettings, LANGUAGE_PREF } from '../storage/settingsStorage';

// Supported locales
export const SUPPORTED_LOCALES = [LANGUAGE_PREF.ZH_TW, LANGUAGE_PREF.EN];

const resources = {
  en: { translation: en },
  'zh-TW': { translation: zhTW },
};

function resolveSystemLanguage() {
  const systemLocales = Localization.getLocales();
  if (systemLocales && systemLocales.length > 0) {
    const locale = systemLocales[0].languageTag;
    if (locale.startsWith('zh')) {
      return LANGUAGE_PREF.ZH_TW;
    }
    if (locale.startsWith('en')) {
      return LANGUAGE_PREF.EN;
    }
  }
  return LANGUAGE_PREF.ZH_TW; // Fallback
}

export const initI18n = async () => {
  const settings = await loadSettings();
  
  let targetLang = settings.language;
  if (targetLang === LANGUAGE_PREF.SYSTEM) {
    targetLang = resolveSystemLanguage();
  }

  return i18n
    .use(initReactI18next)
    .init({
      compatibilityJSON: 'v4', // Needed for Expo / React Native
      resources,
      lng: targetLang,
      fallbackLng: LANGUAGE_PREF.ZH_TW,
      interpolation: {
        escapeValue: false, // React already safe from XSS
      },
      react: {
        useSuspense: false,
      }
    });
};

export const changeLanguage = async (preference) => {
  await saveSettings({ language: preference });
  let targetLang = preference;
  if (targetLang === LANGUAGE_PREF.SYSTEM) {
    targetLang = resolveSystemLanguage();
  }
  return i18n.changeLanguage(targetLang);
};

export default i18n;

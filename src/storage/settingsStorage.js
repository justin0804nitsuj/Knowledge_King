import AsyncStorage from '@react-native-async-storage/async-storage';

const SETTINGS_KEY = 'gsat_settings';

export const LANGUAGE_PREF = {
  SYSTEM: 'system',
  ZH_TW: 'zh-TW',
  EN: 'en',
};

const defaultSettings = {
  language: LANGUAGE_PREF.SYSTEM,
};

export async function loadSettings() {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (raw) {
      return { ...defaultSettings, ...JSON.parse(raw) };
    }
    return defaultSettings;
  } catch (error) {
    console.error('Failed to load settings', error);
    return defaultSettings;
  }
}

export async function saveSettings(settings) {
  try {
    const current = await loadSettings();
    const nextSettings = { ...current, ...settings };
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(nextSettings));
    return nextSettings;
  } catch (error) {
    console.error('Failed to save settings', error);
    throw error;
  }
}

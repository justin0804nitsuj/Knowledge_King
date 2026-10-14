import AsyncStorage from '@react-native-async-storage/async-storage';
import { getActiveScopedKey, getScopedKey } from './storageIdentity';

const CURRENT_SCHEMA_VERSION = 1;
const MAX_HISTORY_SIZE = 100;

async function resolveKey(explicitIdentity) {
  if (explicitIdentity) {
    return getScopedKey('battleHistory', explicitIdentity);
  }
  return getActiveScopedKey('battleHistory');
}

export async function loadBattleHistory(explicitIdentity) {
  try {
    const key = await resolveKey(explicitIdentity);
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return createDefaultHistory();
    
    const data = JSON.parse(raw);
    if (data.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      return createDefaultHistory();
    }
    
    return data;
  } catch (err) {
    console.warn('Failed to load battle history', err);
    return createDefaultHistory();
  }
}

export async function saveBattleHistory(history, explicitIdentity) {
  try {
    const key = await resolveKey(explicitIdentity);
    await AsyncStorage.setItem(key, JSON.stringify(history));
  } catch (err) {
    console.error('Failed to save battle history', err);
    throw err;
  }
}

export function createDefaultHistory() {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    records: []
  };
}

export function addBattleRecord(history, record) {
  if (history.records.find(r => r.id === record.id)) {
    return history; // Idempotent: already exists
  }
  history.records.unshift(record); // Add to beginning
  if (history.records.length > MAX_HISTORY_SIZE) {
    history.records.pop(); // Remove oldest
  }
  return history;
}

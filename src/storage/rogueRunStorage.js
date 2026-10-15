/**
 * ROGUE EXPEDITION V0.1 — LOCAL PERSISTENCE STORAGE
 *
 * Account-scoped local storage for active Rogue runs:
 * - Scoped under `@KnowledgeKing:<identity>:rogueRun`
 * - Strict isolation: Account A vs Account B vs Guest
 * - Purely local (never synced to Firebase userProgress in V0.1)
 * - Cloud Sync schema is untouched
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getActiveScopedKey, getScopedKey } from './storageIdentity';

export const ROGUE_RUN_STORAGE_CATEGORY = 'rogueRun';

/**
 * Resolves the appropriate AsyncStorage key for the target identity.
 *
 * @param {string|object} [explicitIdentity]
 * @returns {Promise<string>}
 */
async function resolveKey(explicitIdentity) {
  if (explicitIdentity) {
    return getScopedKey(ROGUE_RUN_STORAGE_CATEGORY, explicitIdentity);
  }
  return getActiveScopedKey(ROGUE_RUN_STORAGE_CATEGORY);
}

/**
 * Loads the active rogue run defensively.
 *
 * @param {string|object} [explicitIdentity]
 * @returns {Promise<object|null>}
 */
export async function loadActiveRogueRun(explicitIdentity) {
  try {
    const key = await resolveKey(explicitIdentity);
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.schemaVersion !== 1) {
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn('[RogueRunStorage] Failed to load rogue run:', err);
    return null;
  }
}

/**
 * Persists the active rogue run.
 *
 * @param {object} run
 * @param {string|object} [explicitIdentity]
 * @returns {Promise<object>}
 */
export async function saveActiveRogueRun(run, explicitIdentity) {
  if (!run || typeof run !== 'object') {
    throw new Error('[RogueRunStorage] Cannot save invalid run');
  }

  try {
    const key = await resolveKey(explicitIdentity);
    await AsyncStorage.setItem(key, JSON.stringify(run));
    return run;
  } catch (err) {
    console.error('[RogueRunStorage] Failed to save rogue run:', err);
    throw err;
  }
}

/**
 * Clears the active rogue run for the target identity.
 *
 * @param {string|object} [explicitIdentity]
 * @returns {Promise<void>}
 */
export async function clearActiveRogueRun(explicitIdentity) {
  try {
    const key = await resolveKey(explicitIdentity);
    await AsyncStorage.removeItem(key);
  } catch (err) {
    console.warn('[RogueRunStorage] Failed to clear rogue run:', err);
  }
}

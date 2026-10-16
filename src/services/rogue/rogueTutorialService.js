/**
 * ROGUE EXPEDITION V0.1 — TUTORIAL & ONBOARDING SERVICE
 *
 * Manages local persistence for:
 * - First-time 4-page tutorial modal (auto-show once, re-openable from menu)
 * - Lightweight contextual teaching hints (Guard, Curse, Relic Draft, Heavy Attack)
 *
 * INVARIANT: Persists strictly to local AsyncStorage. Never synced to Firebase.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY_TUTORIAL_SEEN = '@KnowledgeKing:rogueTutorialCompleted';
const STORAGE_KEY_HINTS_SEEN = '@KnowledgeKing:rogueTutorialHints';

export const TUTORIAL_HINT_KEYS = Object.freeze({
  FIRST_GUARD: 'first_guard',
  FIRST_CURSE: 'first_curse',
  FIRST_RELIC_DRAFT: 'first_relic_draft',
  FIRST_HEAVY_ATTACK: 'first_heavy_attack',
});

/**
 * Checks if the player has completed or skipped the first-time tutorial.
 *
 * @returns {Promise<boolean>}
 */
export async function hasSeenTutorial() {
  try {
    const val = await AsyncStorage.getItem(STORAGE_KEY_TUTORIAL_SEEN);
    return val === 'true';
  } catch (err) {
    console.warn('[RogueTutorial] Failed to read tutorial state:', err);
    return false;
  }
}

/**
 * Marks the first-time tutorial as completed or skipped.
 *
 * @returns {Promise<void>}
 */
export async function markTutorialCompleted() {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_TUTORIAL_SEEN, 'true');
  } catch (err) {
    console.warn('[RogueTutorial] Failed to save tutorial state:', err);
  }
}

/**
 * Resets tutorial state (useful for testing).
 *
 * @returns {Promise<void>}
 */
export async function resetTutorial() {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY_TUTORIAL_SEEN);
    await AsyncStorage.removeItem(STORAGE_KEY_HINTS_SEEN);
  } catch (err) {
    console.warn('[RogueTutorial] Failed to reset tutorial state:', err);
  }
}

/**
 * Checks if a specific contextual hint has already been shown.
 *
 * @param {string} hintKey
 * @returns {Promise<boolean>}
 */
export async function hasSeenHint(hintKey) {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_HINTS_SEEN);
    if (!raw) return false;
    const hints = JSON.parse(raw);
    return Boolean(hints && hints[hintKey]);
  } catch (err) {
    console.warn('[RogueTutorial] Failed to read hint state:', err);
    return false;
  }
}

/**
 * Marks a specific contextual hint as seen.
 *
 * @param {string} hintKey
 * @returns {Promise<void>}
 */
export async function markHintSeen(hintKey) {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_HINTS_SEEN);
    const hints = raw ? JSON.parse(raw) : {};
    hints[hintKey] = true;
    await AsyncStorage.setItem(STORAGE_KEY_HINTS_SEEN, JSON.stringify(hints));
  } catch (err) {
    console.warn('[RogueTutorial] Failed to save hint state:', err);
  }
}

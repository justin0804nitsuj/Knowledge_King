import { ITEM_TYPES } from './pvpItems';

export const STORAGE_KEY_PVP_LOADOUT = '@knowledge_king:pvp_loadout';
export const PVP_LOADOUT_STORAGE_KEY = STORAGE_KEY_PVP_LOADOUT;

export const LOADOUT_SKILLS = [
  ITEM_TYPES.HEAL,
  ITEM_TYPES.SHIELD,
  ITEM_TYPES.POWER,
];

export const TOTAL_DECK_SIZE = 4;
export const MAX_COPIES_PER_SKILL = 2;

export const DEFAULT_PVP_LOADOUT = Object.freeze({
  [ITEM_TYPES.HEAL]: 2,
  [ITEM_TYPES.SHIELD]: 1,
  [ITEM_TYPES.POWER]: 1,
});

/**
 * Returns a new copy of the default deck.
 */
export function getDefaultPvpLoadout() {
  return { ...DEFAULT_PVP_LOADOUT };
}

/**
 * Validates a PvP deck loadout.
 * Rules:
 * 1. Must be an object with integer counts for HEAL, SHIELD, POWER.
 * 2. Each skill count must be between 0 and MAX_COPIES_PER_SKILL (2).
 * 3. Sum of all counts must be exactly TOTAL_DECK_SIZE (4).
 *
 * @param {any} loadout
 * @returns {boolean}
 */
export function validatePvpLoadout(loadout) {
  if (!loadout || typeof loadout !== 'object' || Array.isArray(loadout)) {
    return false;
  }

  let total = 0;
  for (const skill of LOADOUT_SKILLS) {
    const count = loadout[skill];
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > MAX_COPIES_PER_SKILL) {
      return false;
    }
    total += count;
  }

  // Ensure no unexpected extra keys
  for (const key of Object.keys(loadout)) {
    if (!LOADOUT_SKILLS.includes(key)) {
      return false;
    }
  }

  return total === TOTAL_DECK_SIZE;
}

/**
 * Converts a count-based loadout into an ordered array of 4 card strings.
 * Order: HEAL -> SHIELD -> POWER
 *
 * @param {object} loadout
 * @returns {string[]}
 */
export function loadoutToCardList(loadout) {
  const safe = validatePvpLoadout(loadout) ? loadout : getDefaultPvpLoadout();
  const cards = [];
  for (const skill of LOADOUT_SKILLS) {
    const count = safe[skill] || 0;
    for (let i = 0; i < count; i += 1) {
      cards.push(skill);
    }
  }
  return cards;
}

function getAsyncStorage() {
  const mod = require('@react-native-async-storage/async-storage');
  return mod.default || mod;
}

/**
 * Retrieves the user's saved PvP loadout from AsyncStorage.
 * Falls back to DEFAULT_PVP_LOADOUT if missing or corrupted.
 *
 * @returns {Promise<object>}
 */
export async function getSavedPvpLoadout() {
  try {
    const storage = getAsyncStorage();
    const raw = await storage.getItem(STORAGE_KEY_PVP_LOADOUT);
    if (!raw) {
      return getDefaultPvpLoadout();
    }
    const parsed = JSON.parse(raw);
    if (!validatePvpLoadout(parsed)) {
      if (__DEV__) console.warn('[PvP Loadout] Corrupted loadout in storage, falling back to default.');
      return getDefaultPvpLoadout();
    }
    return parsed;
  } catch (err) {
    if (__DEV__) console.warn('[PvP Loadout] Failed to read loadout from storage:', err);
    return getDefaultPvpLoadout();
  }
}

/**
 * Saves a validated PvP loadout to AsyncStorage.
 * Throws if the loadout is invalid.
 *
 * @param {object} loadout
 * @returns {Promise<boolean>}
 */
export async function savePvpLoadout(loadout) {
  if (!validatePvpLoadout(loadout)) {
    throw new Error('Invalid PvP loadout: must contain 4 cards with max 2 per skill.');
  }

  const payload = {
    [ITEM_TYPES.HEAL]: loadout[ITEM_TYPES.HEAL],
    [ITEM_TYPES.SHIELD]: loadout[ITEM_TYPES.SHIELD],
    [ITEM_TYPES.POWER]: loadout[ITEM_TYPES.POWER],
  };

  const storage = getAsyncStorage();
  await storage.setItem(STORAGE_KEY_PVP_LOADOUT, JSON.stringify(payload));
  return true;
}

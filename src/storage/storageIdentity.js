import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * CLOUD PROFILE SYNC V0.1 — STORAGE IDENTITY & SCOPING FOUNDATION
 * 
 * CORE FUTURE INVARIANTS:
 * 
 * Invariant A: A pending SyncOp is immutable.
 * Invariant B: Gameplay that occurs AFTER a pending op was constructed must not be
 *              lost when that op later receives its cloud acknowledgement.
 * Invariant C: Account A local data must never become visible to Account B.
 *              Identity namespaces provide strict physical storage isolation.
 * Invariant D: Unique reward values (e.g. first-clear, daily missions) will come from
 *              canonical domain reward definitions, not arbitrary UI-provided XP values.
 * 
 * DATA SEPARATION ARCHITECTURE:
 * 
 * 1. Account-Scoped Categories (partitioned by @KnowledgeKing:<identity>:<category>):
 *    - playerProgress       (XP, level, streaks, daily trackers)
 *    - campaignProgress     (stage clears, star ratings, high scores, combos)
 *    - mistakes             (spaced repetition mistake bank)
 *    - battleHistory        (past battle summaries)
 *    - syncSeq              (monotonically increasing local sync sequence)
 *    - pendingSyncOp        (in-flight sync operation payload)
 *    - lastSyncedSnapshot   (authoritative cloud baseline snapshot)
 * 
 * 2. Device-Wide Categories (shared across all accounts on this physical installation):
 *    - @KnowledgeKing:deviceId       (stable installation identifier)
 *    - @KnowledgeKing:activeIdentity (pointer to currently active namespace)
 *    - @KnowledgeKing:settings       (language, sound, music, haptics)
 *    - @KnowledgeKing:pvpLoadout     (local equipment & loadout configuration)
 */

export const GUEST_IDENTITY = 'guest';
export const ACTIVE_IDENTITY_KEY = '@KnowledgeKing:activeIdentity';
export const DEVICE_ID_KEY = '@KnowledgeKing:deviceId';

/**
 * Categories of local data that are owned by a specific account/identity.
 */
export const ACCOUNT_DATA_CATEGORIES = Object.freeze([
  'playerProgress',
  'campaignProgress',
  'mistakes',
  'battleHistory',
  'syncSeq',
  'pendingSyncOp',
  'lastSyncedSnapshot'
]);

/**
 * Categories of local data that remain device-wide and are intentionally NOT account-scoped.
 */
export const DEVICE_WIDE_DATA_CATEGORIES = Object.freeze([
  'deviceId',
  'activeIdentity',
  'settings',
  'pvpLoadout'
]);

/**
 * Standalone RFC4122 version 4 UUID generator.
 * Uses global crypto if available, falling back to secure random byte composition.
 * Does not require any external npm dependencies.
 */
export function generateUuidV4() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    try {
      return globalThis.crypto.randomUUID();
    } catch (_) {}
  }

  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    try {
      const bytes = new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
      bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant RFC4122
      bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
    } catch (_) {}
  }

  // RFC4122 v4 math fallback
  let d = Date.now();
  let d2 = (typeof performance !== 'undefined' && performance.now && performance.now() * 1000) || 0;
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    let r = Math.random() * 16;
    if (d > 0) {
      r = (d + r) % 16 | 0;
      d = Math.floor(d / 16);
    } else if (d2 > 0) {
      r = (d2 + r) % 16 | 0;
      d2 = Math.floor(d2 / 16);
    } else {
      r = r | 0;
    }
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Validates whether an identity string satisfies the required format:
 * 'guest' or 'uid:<firebaseUid>' (where uid is non-empty and contains no colons).
 * 
 * @param {any} identity
 * @returns {boolean}
 */
export function isValidIdentity(identity) {
  if (typeof identity !== 'string') return false;
  const trimmed = identity.trim();
  if (trimmed === GUEST_IDENTITY) return true;
  if (trimmed.startsWith('uid:')) {
    const uid = trimmed.slice(4).trim();
    return uid.length > 0 && !uid.includes(':');
  }
  return false;
}

/**
 * Normalizes an identity representation into a canonical string:
 * - 'guest' -> 'guest'
 * - 'uid:XYZ' -> 'uid:XYZ'
 * - 'XYZ' -> 'uid:XYZ' (if raw non-empty UID string)
 * - { uid: 'XYZ' } -> 'uid:XYZ'
 * - invalid / empty / null / undefined -> 'guest' (safe fallback)
 * 
 * @param {any} raw
 * @returns {string} Canonical identity string ('guest' or 'uid:<UID>')
 */
export function normalizeIdentity(raw) {
  if (!raw) return GUEST_IDENTITY;

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === GUEST_IDENTITY) {
      return GUEST_IDENTITY;
    }
    if (trimmed.startsWith('uid:')) {
      const uid = trimmed.slice(4).trim();
      return uid.length > 0 && !uid.includes(':') ? `uid:${uid}` : GUEST_IDENTITY;
    }
    // Raw UID string without 'uid:' prefix
    if (!trimmed.includes(':')) {
      return `uid:${trimmed}`;
    }
    // Malformed string containing invalid colons
    return GUEST_IDENTITY;
  }

  if (typeof raw === 'object' && raw.uid && typeof raw.uid === 'string') {
    return normalizeIdentity(raw.uid);
  }

  return GUEST_IDENTITY;
}

/**
 * Generates an account-scoped AsyncStorage key for the specified category and identity.
 * Format: @KnowledgeKing:<identity>:<category>
 * 
 * @param {string} category - Data category (e.g. 'playerProgress', 'campaignProgress', 'syncSeq')
 * @param {string|object} [identity] - Identity or raw UID. Defaults to GUEST_IDENTITY if omitted.
 * @returns {string} The scoped key string.
 */
export function getScopedKey(category, identity = GUEST_IDENTITY) {
  if (!category || typeof category !== 'string' || !category.trim()) {
    throw new Error('[StorageIdentity] Category must be a non-empty string');
  }
  const cleanCategory = category.trim();
  const normalizedIdentity = normalizeIdentity(identity);
  return `@KnowledgeKing:${normalizedIdentity}:${cleanCategory}`;
}

/**
 * Reads the active identity pointer from AsyncStorage.
 * Falls back to 'guest' if not set or invalid.
 * 
 * @returns {Promise<string>}
 */
export async function getActiveIdentity() {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_IDENTITY_KEY);
    if (!raw) return GUEST_IDENTITY;
    return normalizeIdentity(raw);
  } catch (err) {
    console.warn('[StorageIdentity] Failed to read active identity, defaulting to guest', err);
    return GUEST_IDENTITY;
  }
}

/**
 * Safely sets the active identity pointer in AsyncStorage.
 * 
 * @param {string|object} identity - The identity to switch to.
 * @returns {Promise<string>} The normalized identity that was saved.
 */
export async function setActiveIdentity(identity) {
  const normalized = normalizeIdentity(identity);
  try {
    await AsyncStorage.setItem(ACTIVE_IDENTITY_KEY, normalized);
    return normalized;
  } catch (err) {
    console.error('[StorageIdentity] Failed to set active identity', err);
    throw err;
  }
}

/**
 * Returns the scoped AsyncStorage key for the category using the currently active identity.
 * 
 * @param {string} category
 * @returns {Promise<string>}
 */
export async function getActiveScopedKey(category) {
  const activeIdentity = await getActiveIdentity();
  return getScopedKey(category, activeIdentity);
}

let cachedDeviceId = null;

/**
 * Retrieves the stable device identity.
 * Generated once per installation and persisted in AsyncStorage under @KnowledgeKing:deviceId.
 * Reused across logouts, logins, and account switches.
 * Never derived from Firebase UID.
 * 
 * @returns {Promise<string>} Stable installation UUID
 */
export async function getDeviceId() {
  if (cachedDeviceId) {
    return cachedDeviceId;
  }

  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing && typeof existing === 'string' && existing.trim().length > 0) {
      cachedDeviceId = existing.trim();
      return cachedDeviceId;
    }

    const newId = generateUuidV4();
    await AsyncStorage.setItem(DEVICE_ID_KEY, newId);
    cachedDeviceId = newId;
    return cachedDeviceId;
  } catch (err) {
    console.error('[StorageIdentity] Failed to get/generate device ID', err);
    if (!cachedDeviceId) {
      cachedDeviceId = generateUuidV4();
    }
    return cachedDeviceId;
  }
}

/**
 * For test resets only. Clears the in-memory deviceId cache.
 */
export function _resetCachedDeviceIdForTests() {
  cachedDeviceId = null;
}

/**
 * Reads the local sync sequence for the specified identity.
 * Returns integer (0 if uninitialized or missing).
 * 
 * @param {string} [identity]
 * @returns {Promise<number>}
 */
export async function getLocalSyncSeq(identity = GUEST_IDENTITY) {
  const key = getScopedKey('syncSeq', identity);
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return 0;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch (err) {
    console.warn(`[StorageIdentity] Failed to read local syncSeq for ${identity}`, err);
    return 0;
  }
}

/**
 * Saves the local sync sequence for the specified identity.
 * 
 * @param {string} identity
 * @param {number} seq
 * @returns {Promise<number>}
 */
export async function setLocalSyncSeq(identity = GUEST_IDENTITY, seq) {
  const parsed = parseInt(seq, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`[StorageIdentity] syncSeq must be a non-negative integer, received: ${seq}`);
  }
  const key = getScopedKey('syncSeq', identity);
  await AsyncStorage.setItem(key, parsed.toString());
  return parsed;
}

/**
 * Pure helper: Reconciles local sequence and cloud's highest applied sequence.
 * 
 * Invariants:
 * 1. If local is missing (null/0) and cloud reports N, base is N.
 * 2. If local is higher than cloud (e.g. local 20, cloud 15), base is 20 (never rolls backward).
 * 3. Base sequence is always Math.max(localSeq, cloudHighestAppliedSeq).
 * 
 * @param {number|null|undefined} localSeq - Current local sequence
 * @param {number|null|undefined} cloudHighestAppliedSeq - Cloud's highest applied sequence for this device
 * @returns {number} Reconciled base sequence (>= 0)
 */
export function reconcileSyncSequence(localSeq, cloudHighestAppliedSeq) {
  const local = Number.isFinite(Number(localSeq)) ? Math.max(0, Math.floor(Number(localSeq))) : 0;
  const cloud = Number.isFinite(Number(cloudHighestAppliedSeq)) ? Math.max(0, Math.floor(Number(cloudHighestAppliedSeq))) : 0;
  return Math.max(local, cloud);
}

/**
 * Pure helper: Computes the safe NEXT sync sequence given local and cloud sequences.
 * 
 * Invariants:
 * 1. If cloud reports N (e.g. 15), next sequence must be > 15 (e.g. 16).
 * 2. If local sequence is higher than cloud (e.g. 20 vs 15), next sequence is 21 (> 20),
 *    preventing backward roll.
 * 
 * @param {number|null|undefined} localSeq
 * @param {number|null|undefined} cloudHighestAppliedSeq
 * @returns {number} Next safe sequence (>= 1)
 */
export function computeSafeNextSequence(localSeq, cloudHighestAppliedSeq) {
  const base = reconcileSyncSequence(localSeq, cloudHighestAppliedSeq);
  return base + 1;
}

/**
 * Reconciles and persists local sequence against a reported cloud sequence.
 * Ensures the stored sequence is at least as high as cloud's highest applied sequence.
 * 
 * @param {string} identity
 * @param {number} cloudHighestAppliedSeq
 * @returns {Promise<number>} The updated reconciled base sequence.
 */
export async function reconcileAndSaveLocalSyncSeq(identity, cloudHighestAppliedSeq) {
  const currentLocal = await getLocalSyncSeq(identity);
  const reconciled = reconcileSyncSequence(currentLocal, cloudHighestAppliedSeq);
  if (reconciled > currentLocal) {
    await setLocalSyncSeq(identity, reconciled);
  }
  return reconciled;
}

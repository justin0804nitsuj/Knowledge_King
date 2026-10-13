import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  normalizeIdentity,
  getScopedKey,
  getLocalSyncSeq,
  setLocalSyncSeq
} from './storageIdentity';
import {
  createSyncOperation,
  validateSyncOperation,
  canAdoptLegacySave
} from '../domain/sync/syncOperation';

/**
 * CLOUD PROFILE SYNC V0.1 — SYNC OUTBOX STORAGE (PHASE 3)
 * 
 * CORE OUTBOX INVARIANTS:
 * 
 * 1. Queue Depth = 1:
 *    At most ONE pending operation may exist per identity at any given time.
 * 
 * 2. Pre-Network Persistence:
 *    A sync operation MUST be persisted to AsyncStorage BEFORE any network attempt.
 * 
 * 3. Immutable Pending Op:
 *    A pending operation cannot be overwritten by a newer operation while unresolved.
 * 
 * 4. Explicit Resolution:
 *    Pending operations can ONLY be cleared with an explicit resolution API that
 *    verifies the matching opId.
 * 
 * 5. Crash-Safe Sequence Reservation:
 *    Local sync sequence is incremented and stored to ensure sequences are never reused,
 *    even across app crashes or unexpected kills.
 * 
 * 6. Legacy Adoption Guardrail:
 *    A global record (@KnowledgeKing:legacyAdoptedByIdentity) tracks which account
 *    first adopted the pre-sync legacy storage, preventing multi-account claiming.
 */

export const LEGACY_ADOPTION_KEY = '@KnowledgeKing:legacyAdoptedByIdentity';

/**
 * Reads and validates the current pending operation for an identity.
 * 
 * @param {string} identity
 * @returns {Promise<object|null>} The validated SyncOp, or null if no op is pending.
 */
export async function getPendingSyncOp(identity) {
  const normalizedIdentity = normalizeIdentity(identity);
  const key = getScopedKey('pendingSyncOp', normalizedIdentity);

  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      console.warn(`[SyncOutbox] Malformed JSON in pendingSyncOp for ${normalizedIdentity}:`, parseErr);
      return { error: 'MALFORMED_JSON', raw };
    }

    try {
      return validateSyncOperation(parsed);
    } catch (valErr) {
      console.warn(`[SyncOutbox] Corrupted pendingSyncOp for ${normalizedIdentity}:`, valErr);
      return { error: 'INVALID_OP_STRUCTURE', raw: parsed, message: valErr.message };
    }
  } catch (err) {
    console.error(`[SyncOutbox] Failed to read pendingSyncOp for ${normalizedIdentity}:`, err);
    return null;
  }
}

/**
 * Checks whether an unresolved pending operation exists for an identity.
 * 
 * @param {string} identity
 * @returns {Promise<boolean>}
 */
export async function hasPendingSyncOp(identity) {
  const pending = await getPendingSyncOp(identity);
  return Boolean(pending && !pending.error);
}

/**
 * Creates, validates, and persists a new SyncOperation to the outbox.
 * Enforces sequence reservation and single pending op invariant.
 * 
 * @param {object} params
 * @param {string} params.identity - Account identity
 * @param {string} params.deviceId - Stable installation device ID
 * @param {number} [params.repeatableXpDelta] - Cumulative repeatable XP delta
 * @param {Array<{ claimId: string, xpReward?: number }>} [params.uniqueClaims] - Deterministic unique claims
 * @param {object} [params.campaignProgress] - Merge-safe campaign progress
 * @returns {Promise<object>} The persisted SyncOperation
 */
export async function createAndPersistSyncOp({
  identity,
  deviceId,
  repeatableXpDelta = 0,
  uniqueClaims = [],
  campaignProgress = {}
}) {
  const normalizedIdentity = normalizeIdentity(identity);

  // Invariant 1 & 3: Check if an unresolved pending op already exists
  const existing = await getPendingSyncOp(normalizedIdentity);
  if (existing && !existing.error) {
    throw new Error(
      `[SyncOutbox] Cannot create SyncOp: pending operation "${existing.opId}" already exists and must be confirmed first`
    );
  }

  // Invariant 5: Determine and reserve safe next sequence
  const currentSeq = await getLocalSyncSeq(normalizedIdentity);
  const nextSeq = currentSeq + 1;

  // Persist sequence reservation first
  await setLocalSyncSeq(normalizedIdentity, nextSeq);

  // Invariant 1: Construct deterministic SyncOp
  const op = createSyncOperation({
    deviceId,
    seq: nextSeq,
    createdAt: Date.now(),
    repeatableXpDelta,
    uniqueClaims,
    campaignProgress
  });

  // Invariant 2: Persist to AsyncStorage before returning for network transmission
  const key = getScopedKey('pendingSyncOp', normalizedIdentity);
  await AsyncStorage.setItem(key, JSON.stringify(op));

  return op;
}

/**
 * Explicitly clears a resolved pending operation after cloud acknowledgement.
 * 
 * @param {string} identity - Account identity
 * @param {string} expectedOpId - The operation ID confirmed by cloud
 * @returns {Promise<boolean>} True if successfully cleared, false if no pending op existed.
 */
export async function clearPendingSyncOp(identity, expectedOpId) {
  const normalizedIdentity = normalizeIdentity(identity);
  const key = getScopedKey('pendingSyncOp', normalizedIdentity);

  const existingRaw = await AsyncStorage.getItem(key);
  if (!existingRaw) {
    return false;
  }

  if (expectedOpId) {
    let parsed;
    try {
      parsed = JSON.parse(existingRaw);
      if (parsed.opId && parsed.opId !== expectedOpId) {
        throw new Error(
          `[SyncOutbox] Mismatched opId on clear: expected "${expectedOpId}", found "${parsed.opId}"`
        );
      }
    } catch (e) {
      if (e.message.startsWith('[SyncOutbox] Mismatched opId')) {
        throw e;
      }
      // If corrupted, allow clear
    }
  }

  await AsyncStorage.removeItem(key);
  return true;
}

/**
 * Reads the global legacy adoption record, if any.
 * 
 * @returns {Promise<{ adoptedBy: string, adoptedAt: number } | null>}
 */
export async function getLegacyAdoptionRecord() {
  try {
    const raw = await AsyncStorage.getItem(LEGACY_ADOPTION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[SyncOutbox] Failed to read legacy adoption record:', err);
    return null;
  }
}

/**
 * Records that an identity has adopted the legacy save data.
 * Throws if another identity has already adopted it.
 * 
 * @param {string} identity
 * @returns {Promise<{ adoptedBy: string, adoptedAt: number }>}
 */
export async function recordLegacyAdoption(identity) {
  const normalizedIdentity = normalizeIdentity(identity);
  const currentRecord = await getLegacyAdoptionRecord();

  const decision = canAdoptLegacySave(currentRecord, normalizedIdentity);
  if (!decision.allowed) {
    throw new Error(
      `[SyncOutbox] Legacy save is already adopted by "${decision.adoptedBy}". Cannot be adopted by "${normalizedIdentity}"`
    );
  }

  if (currentRecord && decision.isSameIdentity) {
    return currentRecord;
  }

  const newRecord = {
    adoptedBy: normalizedIdentity,
    adoptedAt: Date.now()
  };

  await AsyncStorage.setItem(LEGACY_ADOPTION_KEY, JSON.stringify(newRecord));
  return newRecord;
}

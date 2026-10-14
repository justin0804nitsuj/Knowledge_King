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
import {
  _getUnsyncedProgressInternal,
  _saveUnsyncedProgressInternal
} from './unsyncedProgressStorage';
import {
  drainStagedItems,
  isUnsyncedEmpty
} from '../domain/sync/unsyncedProgress';
import { withSyncMutationLock } from './syncLock';

/**
 * CLOUD PROFILE SYNC V0.1 — SYNC OUTBOX STORAGE (PHASE 3 / 3.5 / 3.6)
 *
 * CORE OUTBOX & CONCURRENCY INVARIANTS:
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
 * 6. Staged Accumulator Drain:
 *    When constructing a pending op from the local staging accumulator, the enqueued
 *    items are safely drained from unsyncedProgress so new gameplay can accumulate
 *    separately without polluting the pending batch.
 *
 * 7. Per-Identity Concurrency Serialization:
 *    All mutating operations acquire `withSyncMutationLock(identity)`.
 *    Concurrent callers for the same identity are serialized strictly in FIFO order.
 *
 * 8. Deadlock Prevention:
 *    Internal helpers (`_...Internal`) perform direct unlocked AsyncStorage access.
 *    Public locked APIs compose these internal helpers without attempting re-entrant lock acquisitions.
 */

export const LEGACY_ADOPTION_KEY = '@KnowledgeKing:legacyAdoptedByIdentity';

/**
 * Internal unlocked read & validation of pendingSyncOp.
 *
 * @param {string} normalizedIdentity
 * @returns {Promise<object|null>}
 */
export async function _getPendingSyncOpInternal(normalizedIdentity) {
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
 * Internal unlocked clear of pendingSyncOp.
 *
 * @param {string} normalizedIdentity
 * @param {string} [expectedOpId]
 * @returns {Promise<boolean>}
 */
export async function _clearPendingSyncOpInternal(normalizedIdentity, expectedOpId) {
  const key = getScopedKey('pendingSyncOp', normalizedIdentity);

  const existingRaw = await AsyncStorage.getItem(key);
  if (!existingRaw) {
    return false;
  }

  if (expectedOpId) {
    try {
      const parsed = JSON.parse(existingRaw);
      if (parsed.opId && parsed.opId !== expectedOpId) {
        throw new Error(
          `[SyncOutbox] Mismatched opId on clear: expected "${expectedOpId}", found "${parsed.opId}"`
        );
      }
    } catch (e) {
      if (e.message.startsWith('[SyncOutbox] Mismatched opId')) {
        throw e;
      }
    }
  }

  await AsyncStorage.removeItem(key);
  return true;
}

/**
 * Reads and validates the current pending operation for an identity.
 *
 * @param {string} identity
 * @returns {Promise<object|null>} The validated SyncOp, or null if no op is pending.
 */
export async function getPendingSyncOp(identity) {
  const normalizedIdentity = normalizeIdentity(identity);
  return _getPendingSyncOpInternal(normalizedIdentity);
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
 * Creates, validates, and persists a new SyncOperation by snapshotting the staged
 * unsynced accumulator. Enforces concurrency serialization, crash-safety, single
 * pending op invariant, and staging accumulator drain.
 *
 * @param {object} params
 * @param {string} params.identity - Account identity
 * @param {string} params.deviceId - Stable installation device ID
 * @returns {Promise<object|null>} The persisted SyncOperation, or null if no unsynced changes exist.
 */
export async function createPendingSyncOpFromStaged({ identity, deviceId }) {
  return withSyncMutationLock(identity, async () => {
    const normalizedIdentity = normalizeIdentity(identity);

    // Invariant 1: Check if an unresolved pending op already exists
    const existing = await _getPendingSyncOpInternal(normalizedIdentity);
    if (existing && !existing.error) {
      throw new Error(
        `[SyncOutbox] Cannot create SyncOp: pending operation "${existing.opId}" already exists and must be confirmed first`
      );
    }

    // Read current staged unsynced progress (crash-reconciled on read)
    const unsynced = await _getUnsyncedProgressInternal(normalizedIdentity);
    if (isUnsyncedEmpty(unsynced)) {
      return null;
    }

    // Invariant 5: Determine and reserve safe next sequence
    const currentSeq = await getLocalSyncSeq(normalizedIdentity);
    const nextSeq = currentSeq + 1;
    await setLocalSyncSeq(normalizedIdentity, nextSeq);

    // Construct deterministic SyncOp from staged accumulator
    const op = createSyncOperation({
      deviceId,
      seq: nextSeq,
      createdAt: Date.now(),
      repeatableXpDelta: unsynced.repeatableXpDelta,
      uniqueClaims: Object.values(unsynced.uniqueClaims),
      campaignProgress: {
        clearedStages: Object.keys(unsynced.campaignProgress.clearedStages || {}),
        stageStars: unsynced.campaignProgress.stageStars || {},
        stageScores: unsynced.campaignProgress.stageScores || {},
        bestCombo: unsynced.campaignProgress.bestCombo || 0
      }
    });

    // Crash-Safe Transition:
    // 1. Persist pendingSyncOp first to ensure no data is lost
    const key = getScopedKey('pendingSyncOp', normalizedIdentity);
    await AsyncStorage.setItem(key, JSON.stringify(op));

    // 2. Drain the staged items from the accumulator and record lastEnqueuedOpId
    const drained = drainStagedItems(unsynced, op);
    await _saveUnsyncedProgressInternal(normalizedIdentity, drained);

    return op;
  });
}

/**
 * Creates, validates, and persists a new SyncOperation to the outbox.
 * Supports explicit parameters for direct caller / backward compatibility.
 * Serialized per-identity via withSyncMutationLock.
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
  return withSyncMutationLock(identity, async () => {
    const normalizedIdentity = normalizeIdentity(identity);

    // Invariant 1 & 3: Check if an unresolved pending op already exists
    const existing = await _getPendingSyncOpInternal(normalizedIdentity);
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
  });
}

/**
 * Explicitly clears a resolved pending operation after cloud acknowledgement.
 * Serialized per-identity via withSyncMutationLock.
 *
 * @param {string} identity - Account identity
 * @param {string} expectedOpId - The operation ID confirmed by cloud
 * @returns {Promise<boolean>} True if successfully cleared, false if no pending op existed.
 */
export async function clearPendingSyncOp(identity, expectedOpId) {
  return withSyncMutationLock(identity, async () => {
    const normalizedIdentity = normalizeIdentity(identity);
    return _clearPendingSyncOpInternal(normalizedIdentity, expectedOpId);
  });
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

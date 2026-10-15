import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeIdentity, getScopedKey } from './storageIdentity';
import {
  createDefaultUnsyncedProgress,
  validateUnsyncedProgress,
  stageRepeatableXp,
  stageUniqueClaim,
  stageCampaignProgress,
  drainStagedItems
} from '../domain/sync/unsyncedProgress';
import { validateUniqueClaim } from '../domain/sync/uniqueRewards';
import { validateSyncOperation } from '../domain/sync/syncOperation';
import { withSyncMutationLock } from './syncLock';

/**
 * CLOUD PROFILE SYNC V0.1 — LOCAL UNSYNCED ACCUMULATOR STORAGE (PHASE 3.5 / 3.6)
 *
 * CORE STORAGE & CONCURRENCY INVARIANTS:
 *
 * 1. Account Scoping:
 *    Persists to `@KnowledgeKing:<identity>:unsyncedProgress`.
 *    Account A, Account B, and Guest staging accumulators are strictly isolated.
 *
 * 2. Independent Categories:
 *    Repeatable XP, unique claims, and campaign progress are staged in separate fields.
 *
 * 3. Crash Recovery On Read:
 *    If an app crash occurred right after a `pendingSyncOp` was persisted but before
 *    the accumulator was drained (`unsynced.lastEnqueuedOpId !== pendingOp.opId`),
 *    the recovery procedure automatically drains the enqueued items and marks `lastEnqueuedOpId`.
 *
 * 4. Concurrency Serialization & Deadlock Prevention:
 *    All public mutation functions acquire `withSyncMutationLock(identity)`.
 *    Internal methods (`_...Internal`) perform direct unlocked operations to prevent deadlocks
 *    when invoked from within composite locked operations like `createPendingSyncOpFromStaged`.
 */

/**
 * Helper to read raw pendingSyncOp without triggering circular imports.
 */
async function getRawPendingOp(normalizedIdentity) {
  try {
    const key = getScopedKey('pendingSyncOp', normalizedIdentity);
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return validateSyncOperation(parsed);
  } catch (_) {
    return null;
  }
}

/**
 * Internal unlocked read & crash-recovery logic.
 * Must only be called within a locked context or when lock acquisition is handled by the caller.
 *
 * @param {string} normalizedIdentity
 * @returns {Promise<object>}
 */
export async function _getUnsyncedProgressInternal(normalizedIdentity) {
  const key = getScopedKey('unsyncedProgress', normalizedIdentity);

  let unsynced;
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) {
      unsynced = createDefaultUnsyncedProgress();
    } else {
      try {
        const parsed = JSON.parse(raw);
        unsynced = validateUnsyncedProgress(parsed);
      } catch (parseErr) {
        console.warn(`[UnsyncedStorage] Malformed JSON in unsyncedProgress for ${normalizedIdentity}:`, parseErr);
        unsynced = createDefaultUnsyncedProgress();
      }
    }
  } catch (err) {
    console.error(`[UnsyncedStorage] Failed to read unsyncedProgress for ${normalizedIdentity}:`, err);
    unsynced = createDefaultUnsyncedProgress();
  }

  // Crash Recovery Invariant:
  // If a pendingSyncOp exists on disk, but unsyncedProgress was not marked with its opId,
  // the app crashed between saving the pending op and draining the accumulator.
  // Reconcile by draining the enqueued items now.
  const pendingOp = await getRawPendingOp(normalizedIdentity);
  if (pendingOp && unsynced.lastEnqueuedOpId !== pendingOp.opId) {
    const recovered = drainStagedItems(unsynced, pendingOp);
    await _saveUnsyncedProgressInternal(normalizedIdentity, recovered);
    return recovered;
  }

  return unsynced;
}

/**
 * Internal unlocked write logic.
 * Must only be called within a locked context or when lock acquisition is handled by the caller.
 *
 * @param {string} normalizedIdentity
 * @param {object} unsynced
 * @returns {Promise<object>}
 */
export async function _saveUnsyncedProgressInternal(normalizedIdentity, unsynced) {
  const key = getScopedKey('unsyncedProgress', normalizedIdentity);
  const validated = validateUnsyncedProgress(unsynced);

  await AsyncStorage.setItem(key, JSON.stringify(validated));
  return validated;
}

/**
 * Reads, validates, and recovers the unsynced progress accumulator for an identity.
 * Serialized per-identity via withSyncMutationLock.
 *
 * @param {string} identity
 * @returns {Promise<object>} The active, crash-reconciled unsynced progress accumulator
 */
export async function getUnsyncedProgress(identity) {
  return withSyncMutationLock(identity, async () => {
    const normalizedIdentity = normalizeIdentity(identity);
    return _getUnsyncedProgressInternal(normalizedIdentity);
  });
}

/**
 * Persists an unsynced progress accumulator to storage.
 * Serialized per-identity via withSyncMutationLock.
 *
 * @param {string} identity
 * @param {object} unsynced
 * @returns {Promise<object>} The saved validated unsynced progress
 */
export async function saveUnsyncedProgress(identity, unsynced) {
  return withSyncMutationLock(identity, async () => {
    const normalizedIdentity = normalizeIdentity(identity);
    return _saveUnsyncedProgressInternal(normalizedIdentity, unsynced);
  });
}

/**
 * Stages newly earned repeatable XP into local storage.
 * Serialized per-identity via withSyncMutationLock.
 *
 * @param {string} identity
 * @param {number} xpDelta
 * @returns {Promise<object>} Updated unsynced progress
 */
export async function addStagedRepeatableXp(identity, xpDelta) {
  return withSyncMutationLock(identity, async () => {
    const normalizedIdentity = normalizeIdentity(identity);
    const current = await _getUnsyncedProgressInternal(normalizedIdentity);
    const updated = stageRepeatableXp(current, xpDelta);
    return _saveUnsyncedProgressInternal(normalizedIdentity, updated);
  });
}

/**
 * Stages an optimistic unique claim into local storage.
 * Strictly prevents duplicate staged claims.
 * Serialized per-identity via withSyncMutationLock.
 *
 * @param {string} identity
 * @param {{ claimId: string, xpReward?: number }} claim
 * @returns {Promise<object>} Updated unsynced progress
 */
export async function addStagedUniqueClaim(identity, claim, options = {}) {
  return withSyncMutationLock(identity, async () => {
    const normalizedIdentity = normalizeIdentity(identity);
    const validated = validateUniqueClaim(claim);
    const current = await _getUnsyncedProgressInternal(normalizedIdentity);

    const isIdempotentEligible = options.idempotent || validated.claimId.startsWith('daily:');

    // 1. Check current unsynced accumulator
    if (current.uniqueClaims[validated.claimId]) {
      if (isIdempotentEligible) {
        return current;
      }
      throw new Error(`[UnsyncedProgress] Duplicate staged unique claim: "${validated.claimId}"`);
    }

    // 2. Check pendingSyncOp
    const pendingOp = await getRawPendingOp(normalizedIdentity);
    if (pendingOp && Array.isArray(pendingOp.uniqueClaims)) {
      if (pendingOp.uniqueClaims.some(c => c.claimId === validated.claimId)) {
        if (isIdempotentEligible) {
          return current;
        }
      }
    }

    // 3. Check lastSyncedSnapshot (cloud acknowledged unique claims)
    const snapshotKey = getScopedKey('lastSyncedSnapshot', normalizedIdentity);
    try {
      const rawSnapshot = await AsyncStorage.getItem(snapshotKey);
      if (rawSnapshot) {
        const snapshot = JSON.parse(rawSnapshot);
        if (snapshot?.uniqueClaims && snapshot.uniqueClaims[validated.claimId]) {
          if (isIdempotentEligible) {
            return current;
          }
        }
      }
    } catch (_) {}

    const updated = stageUniqueClaim(current, validated);
    return _saveUnsyncedProgressInternal(normalizedIdentity, updated);
  });
}

/**
 * Stages completed campaign progress into local storage.
 * Serialized per-identity via withSyncMutationLock.
 *
 * @param {string} identity
 * @param {object} campaignUpdate
 * @returns {Promise<object>} Updated unsynced progress
 */
export async function addStagedCampaignProgress(identity, campaignUpdate) {
  return withSyncMutationLock(identity, async () => {
    const normalizedIdentity = normalizeIdentity(identity);
    const current = await _getUnsyncedProgressInternal(normalizedIdentity);
    const updated = stageCampaignProgress(current, campaignUpdate);
    return _saveUnsyncedProgressInternal(normalizedIdentity, updated);
  });
}

/**
 * Resets the unsynced progress accumulator to empty default state.
 * Serialized per-identity via withSyncMutationLock.
 *
 * @param {string} identity
 * @returns {Promise<object>}
 */
export async function clearUnsyncedProgress(identity) {
  return withSyncMutationLock(identity, async () => {
    const normalizedIdentity = normalizeIdentity(identity);
    return _saveUnsyncedProgressInternal(normalizedIdentity, createDefaultUnsyncedProgress());
  });
}

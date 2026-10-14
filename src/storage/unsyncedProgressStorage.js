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
import { validateSyncOperation } from '../domain/sync/syncOperation';

/**
 * CLOUD PROFILE SYNC V0.1 — LOCAL UNSYNCED ACCUMULATOR STORAGE (PHASE 3.5)
 * 
 * CORE STORAGE INVARIANTS:
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
 * Reads, validates, and recovers the unsynced progress accumulator for an identity.
 * 
 * @param {string} identity
 * @returns {Promise<object>} The active, crash-reconciled unsynced progress accumulator
 */
export async function getUnsyncedProgress(identity) {
  const normalizedIdentity = normalizeIdentity(identity);
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
    await saveUnsyncedProgress(normalizedIdentity, recovered);
    return recovered;
  }

  return unsynced;
}

/**
 * Persists an unsynced progress accumulator to storage.
 * 
 * @param {string} identity
 * @param {object} unsynced
 * @returns {Promise<object>} The saved validated unsynced progress
 */
export async function saveUnsyncedProgress(identity, unsynced) {
  const normalizedIdentity = normalizeIdentity(identity);
  const key = getScopedKey('unsyncedProgress', normalizedIdentity);
  const validated = validateUnsyncedProgress(unsynced);

  await AsyncStorage.setItem(key, JSON.stringify(validated));
  return validated;
}

/**
 * Stages newly earned repeatable XP into local storage.
 * 
 * @param {string} identity
 * @param {number} xpDelta
 * @returns {Promise<object>} Updated unsynced progress
 */
export async function addStagedRepeatableXp(identity, xpDelta) {
  const current = await getUnsyncedProgress(identity);
  const updated = stageRepeatableXp(current, xpDelta);
  return saveUnsyncedProgress(identity, updated);
}

/**
 * Stages an optimistic unique claim into local storage.
 * Throws if the claimId is already staged.
 * 
 * @param {string} identity
 * @param {{ claimId: string, xpReward?: number }} claim
 * @returns {Promise<object>} Updated unsynced progress
 */
export async function addStagedUniqueClaim(identity, claim) {
  const current = await getUnsyncedProgress(identity);
  const updated = stageUniqueClaim(current, claim);
  return saveUnsyncedProgress(identity, updated);
}

/**
 * Stages completed campaign progress into local storage.
 * 
 * @param {string} identity
 * @param {object} campaignUpdate
 * @returns {Promise<object>} Updated unsynced progress
 */
export async function addStagedCampaignProgress(identity, campaignUpdate) {
  const current = await getUnsyncedProgress(identity);
  const updated = stageCampaignProgress(current, campaignUpdate);
  return saveUnsyncedProgress(identity, updated);
}

/**
 * Resets the unsynced progress accumulator to empty default state.
 * 
 * @param {string} identity
 * @returns {Promise<object>}
 */
export async function clearUnsyncedProgress(identity) {
  return saveUnsyncedProgress(identity, createDefaultUnsyncedProgress());
}

import { ref, get, runTransaction } from 'firebase/database';
import { db } from '../firebase/firebaseDatabase';
import { reduceCloudProgress } from '../../domain/sync/cloudProgressReducer';
import { reconcileLegacyWithCloud } from '../../domain/sync/cloudBootstrap';

/**
 * CLOUD PROFILE SYNC V0.1 — CLOUD PROGRESS SERVICE (PHASE 4 & 5A)
 * 
 * CORE SERVICE INVARIANTS:
 * 
 * 1. Explicit UID Scoping:
 *    Every function requires an explicit, non-empty uid argument.
 *    No AuthContext import, no implicit "current user" inference.
 * 
 * 2. Atomic Transaction:
 *    applySyncOperation and bootstrapCloudProgress execute via runTransaction() on `userProgress/${uid}`.
 *    No read-then-write anti-patterns.
 * 
 * 3. Pure Reducer Delegation:
 *    Transaction callback delegates state calculation strictly to reduceCloudProgress
 *    or reconcileLegacyWithCloud, guaranteeing deterministic, retry-safe behavior.
 * 
 * 4. Realtime Database Singleton:
 *    Reuses the existing Firebase RTDB instance from firebaseDatabase.js.
 */

/**
 * Reads the current cloud progress document for a given UID.
 * 
 * @param {string} uid - Target user ID
 * @returns {Promise<object|null>} The cloud progress data or null if not yet created
 */
export async function getCloudProgress(uid) {
  if (!uid || typeof uid !== 'string' || !uid.trim()) {
    throw new Error('[CloudProgress] Explicit UID string is required');
  }

  const userProgressRef = ref(db, `userProgress/${uid.trim()}`);
  const snapshot = await get(userProgressRef);
  return snapshot.exists() ? snapshot.val() : null;
}

/**
 * Applies a SyncOperation atomically using Firebase runTransaction().
 * 
 * @param {string} uid - Target user ID
 * @param {object} op - Validated SyncOperation
 * @returns {Promise<{ committed: boolean, snapshot: object }>} Transaction result
 */
export async function applySyncOperation(uid, op) {
  if (!uid || typeof uid !== 'string' || !uid.trim()) {
    throw new Error('[CloudProgress] Explicit UID string is required');
  }

  const userProgressRef = ref(db, `userProgress/${uid.trim()}`);

  const result = await runTransaction(userProgressRef, (current) => {
    return reduceCloudProgress(current, op);
  });

  return {
    committed: result.committed,
    snapshot: result.snapshot.val()
  };
}

/**
 * Atomically bootstraps or reconciles cloud progress for a given user.
 *
 * - If cloud state is null: seeds the bootstrap snapshot.
 * - If cloud state exists: performs conservative reconciliation.
 * - Repeated calls with identical state are completely idempotent.
 *
 * @param {string} uid - Explicit user ID
 * @param {object} localSnapshot - Validated local snapshot
 * @returns {Promise<{ committed: boolean, snapshot: object }>}
 */
export async function bootstrapCloudProgress(uid, localSnapshot) {
  if (!uid || typeof uid !== 'string' || !uid.trim()) {
    throw new Error('[CloudProgress] Explicit UID string is required');
  }

  const userProgressRef = ref(db, `userProgress/${uid.trim()}`);

  const result = await runTransaction(userProgressRef, (current) => {
    if (current === null) {
      return {
        ...localSnapshot,
        schemaVersion: 1,
        revision: Math.max(1, localSnapshot?.revision || 1),
        updatedAt: Date.now()
      };
    }
    return reconcileLegacyWithCloud(localSnapshot, current);
  });

  return {
    committed: result.committed,
    snapshot: result.snapshot.val()
  };
}

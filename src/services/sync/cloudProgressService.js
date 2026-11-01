import { ref, get, runTransaction, serverTimestamp } from 'firebase/database';
import { db } from '../firebase/firebaseDatabase';
import { reduceCloudProgress } from '../../domain/sync/cloudProgressReducer';
import { reconcileLegacyWithCloud } from '../../domain/sync/cloudBootstrap';
import { whenServerTimeReady, getCloudWriteTimestamp } from '../firebase/serverTimeService';

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
 *
 * 5. Safe Server Time Alignment:
 *    Awaits server-time offset readiness and passes server-aligned safeNow to reducers,
 *    preventing client clock drift from violating RTDB rules (`updatedAt <= now`, `claimedAt <= now`).
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
 * @param {object} [options] - Optional execution options (e.g. { now })
 * @returns {Promise<{ committed: boolean, snapshot: object }>} Transaction result
 */
export async function applySyncOperation(uid, op, options = {}) {
  if (!uid || typeof uid !== 'string' || !uid.trim()) {
    throw new Error('[CloudProgress] Explicit UID string is required');
  }

  // Ensure server time offset readiness before submitting transaction
  const isReady = await whenServerTimeReady(4000);
  const safeNow = Number.isFinite(options?.now)
    ? options.now
    : (isReady ? getCloudWriteTimestamp() : Date.now());

  const userProgressRef = ref(db, `userProgress/${uid.trim()}`);

  const result = await runTransaction(userProgressRef, (current) => {
    const reduced = reduceCloudProgress(current, op, { ...options, now: safeNow });
    if (reduced === current) {
      return reduced;
    }

    const uniqueClaims = { ...(reduced.uniqueClaims || {}) };
    const currentClaims = current?.uniqueClaims || {};
    for (const [claimId, claimData] of Object.entries(uniqueClaims)) {
      if (!currentClaims[claimId]) {
        uniqueClaims[claimId] = {
          ...claimData,
          claimedAt: Number.isFinite(options?.now) ? options.now : serverTimestamp()
        };
      }
    }

    return {
      ...reduced,
      updatedAt: Number.isFinite(options?.now) ? options.now : serverTimestamp(),
      uniqueClaims
    };
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
 * @param {object} [options] - Optional execution options (e.g. { now })
 * @returns {Promise<{ committed: boolean, snapshot: object }>}
 */
export async function bootstrapCloudProgress(uid, localSnapshot, options = {}) {
  if (!uid || typeof uid !== 'string' || !uid.trim()) {
    throw new Error('[CloudProgress] Explicit UID string is required');
  }

  // Ensure server time offset readiness before submitting transaction
  const isReady = await whenServerTimeReady(4000);
  const safeNow = Number.isFinite(options?.now)
    ? options.now
    : (isReady ? getCloudWriteTimestamp() : Date.now());

  const userProgressRef = ref(db, `userProgress/${uid.trim()}`);

  const result = await runTransaction(userProgressRef, (current) => {
    if (current === null) {
      const virginClaims = {};
      for (const [claimId, claimData] of Object.entries(localSnapshot?.uniqueClaims || {})) {
        virginClaims[claimId] = {
          ...claimData,
          claimedAt: Number.isFinite(options?.now) ? options.now : serverTimestamp()
        };
      }
      return {
        ...localSnapshot,
        schemaVersion: 1,
        revision: Math.max(1, localSnapshot?.revision || 1),
        updatedAt: Number.isFinite(options?.now) ? options.now : serverTimestamp(),
        uniqueClaims: virginClaims
      };
    }

    const reconciled = reconcileLegacyWithCloud(localSnapshot, current, { ...options, now: safeNow });
    if (reconciled === current) {
      return reconciled;
    }

    const uniqueClaims = { ...(reconciled.uniqueClaims || {}) };
    const currentClaims = current?.uniqueClaims || {};
    for (const [claimId, claimData] of Object.entries(uniqueClaims)) {
      if (!currentClaims[claimId]) {
        uniqueClaims[claimId] = {
          ...claimData,
          claimedAt: Number.isFinite(options?.now) ? options.now : serverTimestamp()
        };
      }
    }

    return {
      ...reconciled,
      updatedAt: Number.isFinite(options?.now) ? options.now : serverTimestamp(),
      uniqueClaims
    };
  });

  return {
    committed: result.committed,
    snapshot: result.snapshot.val()
  };
}

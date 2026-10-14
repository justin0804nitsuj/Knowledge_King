import { normalizeIdentity } from './storageIdentity';

/**
 * CLOUD PROFILE SYNC V0.1 — PER-IDENTITY MUTATION SERIALIZATION (PHASE 3.6)
 * 
 * CORE CONCURRENCY INVARIANTS:
 * 
 * 1. Per-Identity Serialization:
 *    All read-modify-write sync mutations for the SAME identity are executed sequentially.
 * 
 * 2. Multi-Account Isolation:
 *    Account A (uid:player_A), Account B (uid:player_B), and Guest (guest) have completely
 *    independent mutex queues. Operations for Account A NEVER block Account B.
 * 
 * 3. Guaranteed Lock Release:
 *    The lock releases unconditionally upon promise settlement (both on resolve and on reject).
 * 
 * 4. Zero Dependencies & Unhandled Rejection Safety:
 *    Implemented using an in-process Promise-chain mutex. Internal queue tracking absorbs
 *    chain rejections so errors are delivered exclusively to the caller.
 */

const lockQueues = new Map();

/**
 * Executes an async mutation exclusively for the specified identity.
 * Subsequent mutations for the same identity are queued and executed strictly in order.
 * 
 * @template T
 * @param {string} identity - Target account identity (guest, uid:...)
 * @param {() => Promise<T>} asyncMutation - The async critical section to execute
 * @returns {Promise<T>} Resolves or rejects with the result of asyncMutation
 */
export async function withSyncMutationLock(identity, asyncMutation) {
  if (typeof asyncMutation !== 'function') {
    throw new TypeError('[SyncLock] asyncMutation must be a function');
  }

  const key = normalizeIdentity(identity);

  // Retrieve current tail for this identity or start from resolved
  const prevTail = lockQueues.get(key) || Promise.resolve();

  let releaseCurrent;
  const currentGate = new Promise((resolve) => {
    releaseCurrent = resolve;
  });

  // Chain the execution: run when prevTail settles, whether resolved or rejected
  const runMutation = async () => {
    try {
      await prevTail;
    } catch (_) {
      // Prior mutation failure must NOT block subsequent queued operations
    }
    return asyncMutation();
  };

  const currentPromise = runMutation();

  // The queue tail is updated to wait until currentPromise completes.
  // We absorb any error on the queue tail so Node.js does not report an unhandled rejection,
  // while currentPromise itself still rejects for the actual caller.
  const nextTail = currentPromise
    .catch(() => {})
    .finally(() => {
      releaseCurrent();
      // Memory cleanup: If no other mutation chained behind this one, clean map
      if (lockQueues.get(key) === nextTail) {
        lockQueues.delete(key);
      }
    });

  lockQueues.set(key, nextTail);

  return currentPromise;
}

/**
 * Checks whether an identity currently has an active or queued mutation.
 * 
 * @param {string} identity
 * @returns {boolean}
 */
export function isIdentityLocked(identity) {
  const key = normalizeIdentity(identity);
  return lockQueues.has(key);
}

/**
 * Clears all active lock queues. Intended strictly for test teardowns.
 */
export function _resetSyncLocksForTesting() {
  lockQueues.clear();
}

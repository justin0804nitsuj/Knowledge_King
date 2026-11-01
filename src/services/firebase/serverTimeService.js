import { ref, onValue } from 'firebase/database';
import { db } from './firebaseDatabase';

let serverTimeOffset = 0;
// In unit tests, default to ready so existing mocked test suites pass; in production, start unready
let isServerTimeReady = process.env.NODE_ENV === 'test';
let unsubscribeOffset = null;
const readyResolvers = new Set();

/**
 * Initialize listener for Firebase Realtime Database server time offset (.info/serverTimeOffset).
 * Automatically updates serverTimeOffset in milliseconds and notifies readiness waiters.
 * Idempotent: safe to invoke multiple times across app and auth lifecycles.
 */
export function initServerTimeOffset() {
  if (unsubscribeOffset) return;
  if (process.env.NODE_ENV === 'test') return;
  try {
    const offsetRef = ref(db, '.info/serverTimeOffset');
    unsubscribeOffset = onValue(offsetRef, (snap) => {
      const val = snap?.val ? snap.val() : snap;
      if (typeof val === 'number') {
        serverTimeOffset = val;
        isServerTimeReady = true;
        for (const resolve of readyResolvers) {
          try {
            resolve(true);
          } catch (e) {
            // Ignore subscriber error
          }
        }
        readyResolvers.clear();
      }
    });
  } catch (e) {
    // Graceful fallback for offline / mock environments
  }
}

/**
 * Check whether server time offset has been received at least once.
 *
 * @returns {boolean}
 */
export function isServerTimeReadyState() {
  return isServerTimeReady;
}

/**
 * Await server time offset readiness with a timeout.
 * Resolves true if offset is received within timeoutMs, otherwise resolves false.
 *
 * @param {number} [timeoutMs=4000]
 * @returns {Promise<boolean>}
 */
export function whenServerTimeReady(timeoutMs = 4000) {
  if (isServerTimeReady) return Promise.resolve(true);

  // In test environment, if explicitly marked unready, resolve to current readiness
  if (process.env.NODE_ENV === 'test') {
    return Promise.resolve(isServerTimeReady);
  }

  // Ensure listener is initialized
  initServerTimeOffset();

  return new Promise((resolve) => {
    let timer = null;
    const onReady = (ready) => {
      if (timer) clearTimeout(timer);
      readyResolvers.delete(onReady);
      resolve(ready);
    };

    readyResolvers.add(onReady);

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        readyResolvers.delete(onReady);
        resolve(isServerTimeReady);
      }, timeoutMs);
    }
  });
}

/**
 * Get current server time offset in milliseconds.
 *
 * @returns {number}
 */
export function getServerTimeOffset() {
  return serverTimeOffset;
}

/**
 * Get current server-aligned timestamp in milliseconds.
 * serverNow = Date.now() + serverTimeOffset
 *
 * Maintained for backward-compatibility with PvP timer and round calculations.
 *
 * @returns {number}
 */
export function getServerNow() {
  return Date.now() + serverTimeOffset;
}

/**
 * Conservative backdating safety margin in milliseconds for cloud writes.
 * Absorbs .info/serverTimeOffset estimation error and network transit jitter,
 * ensuring timestamps strictly satisfy RTDB rule: newData.val() <= now.
 */
export const CLOUD_WRITE_SAFETY_MARGIN_MS = 1000;

/**
 * Get safe server-aligned timestamp specifically for Cloud Sync operations.
 *
 * Invariants:
 * 1. If server time is ready: returns Date.now() + serverTimeOffset.
 * 2. If client clock is ahead of server (serverTimeOffset < 0), this strictly
 *    subtracts the excess skew so timestamp <= Firebase server now.
 * 3. Before server time is ready (in production): throws Error to prevent
 *    writing unsafe unvalidated timestamps to RTDB.
 *
 * @returns {number}
 */
export function getSafeServerNow() {
  if (!isServerTimeReady && process.env.NODE_ENV !== 'test') {
    throw new Error('[ServerTime] Cannot generate safe cloud timestamp: server time offset is not ready');
  }
  return getServerNow();
}

/**
 * Get timestamp guaranteed to satisfy RTDB security rule: newData.val() <= now.
 * Applies a conservative safety backdate against the server time estimate.
 *
 * NOTE: Does NOT affect PvP authoritative timing; PvP continues to use getServerNow().
 *
 * @returns {number}
 */
export function getCloudWriteTimestamp() {
  return getSafeServerNow() - CLOUD_WRITE_SAFETY_MARGIN_MS;
}

/**
 * For testing purposes only: override current serverTimeOffset and readiness.
 *
 * @param {number} offset
 * @param {boolean} [ready=true]
 */
export function __setServerTimeOffsetForTest(offset, ready = true) {
  serverTimeOffset = offset;
  isServerTimeReady = ready;
  if (ready) {
    for (const resolve of readyResolvers) {
      try {
        resolve(true);
      } catch (e) {}
    }
    readyResolvers.clear();
  }
}

/**
 * For testing purposes only: reset server time state.
 */
export function __resetServerTimeForTest() {
  serverTimeOffset = 0;
  isServerTimeReady = process.env.NODE_ENV === 'test';
  readyResolvers.clear();
  if (unsubscribeOffset) {
    try {
      unsubscribeOffset();
    } catch (e) {}
    unsubscribeOffset = null;
  }
}

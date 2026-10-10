import { ref, onValue } from 'firebase/database';
import { db } from './firebaseDatabase';

let serverTimeOffset = 0;
let unsubscribeOffset = null;

/**
 * Initialize listener for Firebase Realtime Database server time offset (.info/serverTimeOffset).
 * Automatically updates serverTimeOffset in milliseconds.
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
      }
    });
  } catch (e) {
    // Graceful fallback for offline / mock environments
  }
}

/**
 * Get current server time offset in milliseconds.
 */
export function getServerTimeOffset() {
  return serverTimeOffset;
}

/**
 * Get current server-aligned timestamp in milliseconds.
 * serverNow = Date.now() + serverTimeOffset
 */
export function getServerNow() {
  return Date.now() + serverTimeOffset;
}

/**
 * For testing purposes only: override current serverTimeOffset.
 */
export function __setServerTimeOffsetForTest(offset) {
  serverTimeOffset = offset;
}

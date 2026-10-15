/**
 * Returns a stable local YYYY-MM-DD date key.
 */
export function getLocalDailyKey() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const DAILY_MISSIONS = {
  MISSION_1: {
    id: 'm1',
    description: 'Answer 20 questions',
    target: 20,
    xpReward: 30
  },
  MISSION_2: {
    id: 'm2',
    description: 'Win 2 Adventure battles',
    target: 2,
    xpReward: 40
  },
  MISSION_3: {
    id: 'm3',
    description: 'Earn one Perfect Victory',
    target: 1,
    xpReward: 50
  }
};

/**
 * Pure checker for mission claimed state.
 *
 * @param {object} playerProgress
 * @param {string} missionId
 * @returns {boolean}
 */
export function isDailyMissionClaimed(playerProgress, missionId) {
  const missions = playerProgress?.daily?.missions;
  if (!missions || !missions[missionId]) return false;
  return missions[missionId].claimed === true;
}

const dailyClaimLocks = new Map();

/**
 * Dedicated lock for Daily Mission claim operations per identity.
 * Prevents re-entrancy deadlocks with withSyncMutationLock used inside addStagedUniqueClaim.
 *
 * @param {string} identity
 * @param {() => Promise<any>} fn
 * @returns {Promise<any>}
 */
async function withDailyClaimLock(identity, fn) {
  const { normalizeIdentity } = require('../../storage/storageIdentity');
  const key = normalizeIdentity(identity);
  const prevTail = dailyClaimLocks.get(key) || Promise.resolve();
  const run = async () => {
    try {
      await prevTail;
    } catch (_) {}
    return fn();
  };
  const currentPromise = run();
  const nextTail = currentPromise
    .catch(() => {})
    .finally(() => {
      if (dailyClaimLocks.get(key) === nextTail) {
        dailyClaimLocks.delete(key);
      }
    });
  dailyClaimLocks.set(key, nextTail);
  return currentPromise;
}

/**
 * Test teardown helper for daily claim locks.
 */
export function _resetDailyClaimLocksForTests() {
  dailyClaimLocks.clear();
}

/**
 * Idempotently claims a daily mission reward for the given identity and date.
 *
 * INVARIANTS:
 * 1. For one identity and one calendar date, daily:<YYYY-MM-DD>:<missionId> may award XP AT MOST ONCE.
 * 2. Strict transition: claimed !== true -> claimed = true.
 * 3. If already claimed: returns strict NO-OP (0 XP, no unique claim staged, no progress reset).
 * 4. Serialized per identity via withDailyClaimLock to safely handle rapid double invocation.
 * 5. Persists claimed state before allowing any other invocation.
 *
 * @param {string} missionId - 'm1' | 'm2' | 'm3'
 * @param {object} [options]
 * @param {string} [options.identity] - Explicit identity (defaults to activeIdentity)
 * @param {string} [options.dateKey] - Date key override (defaults to getLocalDailyKey())
 * @param {boolean} [options.force] - If true, bypasses progress >= target check
 * @returns {Promise<{ success: boolean, alreadyClaimed: boolean, xpAwarded: number, playerProgress: object }>}
 */
export async function claimDailyMission(missionId, options = {}) {
  // Lazy require storage & sync dependencies to preserve pure domain isolation
  const { loadPlayerProgress, savePlayerProgress, processDayRollover, createDefaultPlayerProgress } = require('../../storage/playerProgressStorage');
  const { getActiveIdentity } = require('../../storage/storageIdentity');
  const { addStagedUniqueClaim, getUnsyncedProgress } = require('../../storage/unsyncedProgressStorage');
  const { getPendingSyncOp } = require('../../storage/syncOutboxStorage');
  const { getLastSyncedSnapshot } = require('../../services/sync/cloudRestoreAdapter');
  const { flushLiveProgress } = require('../../services/sync/liveProgressSync');
  const { buildDailyMissionClaimId } = require('../sync/uniqueRewards');

  const activeIdentity = options.identity || await getActiveIdentity();
  return withDailyClaimLock(activeIdentity, async () => {
    let playerProgress = await loadPlayerProgress(activeIdentity);
    const today = options.dateKey || getLocalDailyKey();

    if (!playerProgress.daily) {
      playerProgress.daily = createDefaultPlayerProgress().daily;
    }

    // Check if day rolled over
    if (playerProgress.daily.lastActiveDate !== today) {
      playerProgress = processDayRollover(playerProgress, today);
      await savePlayerProgress(playerProgress, activeIdentity);
    }

    const missionDef = Object.values(DAILY_MISSIONS).find(m => m.id === missionId);
    if (!missionDef) {
      throw new Error(`[DailySystem] Unknown missionId: "${missionId}"`);
    }

    if (!playerProgress.daily.missions) {
      playerProgress.daily.missions = createDefaultPlayerProgress().daily.missions;
    }

    const missionState = playerProgress.daily.missions[missionId];
    if (!missionState) {
      return { success: false, alreadyClaimed: false, xpAwarded: 0, playerProgress };
    }

    // 1. Strict local state check
    if (missionState.claimed === true) {
      return { success: false, alreadyClaimed: true, xpAwarded: 0, playerProgress };
    }

    const claimId = buildDailyMissionClaimId(today, missionId);

    // 2. Authoritative check against cloud uniqueClaims from lastSyncedSnapshot
    const lastSnapshot = await getLastSyncedSnapshot(activeIdentity);
    if (lastSnapshot?.uniqueClaims?.[claimId]) {
      missionState.claimed = true;
      await savePlayerProgress(playerProgress, activeIdentity);
      return { success: false, alreadyClaimed: true, xpAwarded: 0, playerProgress };
    }

    // 3. Staged unsynced check
    const unsynced = await getUnsyncedProgress(activeIdentity);
    if (unsynced?.uniqueClaims?.[claimId]) {
      missionState.claimed = true;
      await savePlayerProgress(playerProgress, activeIdentity);
      return { success: false, alreadyClaimed: true, xpAwarded: 0, playerProgress };
    }

    // 4. Pending op check
    const pendingOp = await getPendingSyncOp(activeIdentity);
    if (pendingOp && Array.isArray(pendingOp.uniqueClaims)) {
      if (pendingOp.uniqueClaims.some(c => c.claimId === claimId)) {
        missionState.claimed = true;
        await savePlayerProgress(playerProgress, activeIdentity);
        return { success: false, alreadyClaimed: true, xpAwarded: 0, playerProgress };
      }
    }

    // 5. Target progress check
    if (!options.force && missionState.progress < missionDef.target) {
      return { success: false, alreadyClaimed: false, xpAwarded: 0, reason: 'TARGET_NOT_MET', playerProgress };
    }

    // 6. Actual transition: claimed !== true -> claimed = true
    missionState.claimed = true;
    playerProgress.totalXp += missionDef.xpReward;
    if (playerProgress.stats) {
      playerProgress.stats.totalXpEarned = (playerProgress.stats.totalXpEarned || 0) + missionDef.xpReward;
    }

    // 7. Persist immediately before external staging
    await savePlayerProgress(playerProgress, activeIdentity);

    // 8. Stage deterministic unique claim
    await addStagedUniqueClaim(activeIdentity, {
      claimId,
      xpReward: missionDef.xpReward
    }, { idempotent: true });

    // 9. Dispatch background flush
    flushLiveProgress(activeIdentity).catch(() => {});

    return {
      success: true,
      alreadyClaimed: false,
      xpAwarded: missionDef.xpReward,
      playerProgress
    };
  });
}

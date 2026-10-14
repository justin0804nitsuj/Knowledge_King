import { validateUniqueClaim } from './uniqueRewards';

/**
 * CLOUD PROFILE SYNC V0.1 — LOCAL UNSYNCED ACCUMULATOR (PHASE 3.5)
 * 
 * CORE CONTRACT INVARIANTS:
 * 
 * 1. Independent XP Staging:
 *    - Repeatable XP (answers, victory, review) is tracked separately.
 *    - Unique optimistic claims (firstClear, daily missions) are tracked separately.
 *    - No data is ever inferred solely from totalXp differences.
 * 
 * 2. Deduplication & Idempotency:
 *    - The same deterministic claimId can never exist twice in the staged state.
 * 
 * 3. Batch Construction & Staging Drain:
 *    - Pending SyncOps snapshot the staged unsynced data.
 *    - Once enqueued, represented items are drained from the staging accumulator
 *      so new gameplay can accumulate separately while the op remains pending.
 * 
 * 4. Crash-Safe Staging Transition:
 *    - Tracks `lastEnqueuedOpId` to prevent duplicate enqueueing or data loss
 *      if an app crash occurs mid-transition.
 */

/**
 * Returns a new, pristine unsynced progress accumulator object.
 * 
 * @returns {object}
 */
export function createDefaultUnsyncedProgress() {
  return {
    repeatableXpDelta: 0,
    uniqueClaims: {}, // Map of { [claimId]: { claimId, xpReward } }
    campaignProgress: {
      clearedStages: {}, // Map of { [stageId]: true }
      stageStars: {},    // Map of { [stageId]: stars (1-3) }
      stageScores: {},   // Map of { [stageId]: score }
      bestCombo: 0
    },
    lastEnqueuedOpId: null,
    updatedAt: Date.now()
  };
}

/**
 * Validates and normalizes an unsynced progress object.
 * 
 * @param {object} unsynced
 * @returns {object} Validated unsynced progress
 */
export function validateUnsyncedProgress(unsynced) {
  if (!unsynced || typeof unsynced !== 'object') {
    return createDefaultUnsyncedProgress();
  }

  const repeatableXpDelta = Number.isInteger(unsynced.repeatableXpDelta) && unsynced.repeatableXpDelta >= 0
    ? unsynced.repeatableXpDelta
    : 0;

  const uniqueClaims = {};
  if (unsynced.uniqueClaims && typeof unsynced.uniqueClaims === 'object') {
    for (const [claimId, claimObj] of Object.entries(unsynced.uniqueClaims)) {
      try {
        const validated = validateUniqueClaim(claimObj || { claimId });
        uniqueClaims[validated.claimId] = validated;
      } catch (e) {
        console.warn(`[UnsyncedProgress] Ignoring invalid staged claim "${claimId}":`, e);
      }
    }
  }

  const cp = unsynced.campaignProgress || {};
  const clearedStages = {};
  if (cp.clearedStages && typeof cp.clearedStages === 'object') {
    if (Array.isArray(cp.clearedStages)) {
      for (const st of cp.clearedStages) {
        if (typeof st === 'string' && st.trim()) clearedStages[st.trim()] = true;
      }
    } else {
      for (const [st, val] of Object.entries(cp.clearedStages)) {
        if (val) clearedStages[st] = true;
      }
    }
  }

  const stageStars = {};
  if (cp.stageStars && typeof cp.stageStars === 'object') {
    for (const [st, stars] of Object.entries(cp.stageStars)) {
      if (Number.isInteger(stars) && stars >= 1 && stars <= 3) {
        stageStars[st] = stars;
      }
    }
  }

  const stageScores = {};
  if (cp.stageScores && typeof cp.stageScores === 'object') {
    for (const [st, score] of Object.entries(cp.stageScores)) {
      if (Number.isInteger(score) && score >= 0) {
        stageScores[st] = score;
      }
    }
  }

  const bestCombo = Number.isInteger(cp.bestCombo) && cp.bestCombo >= 0 ? cp.bestCombo : 0;

  return {
    repeatableXpDelta,
    uniqueClaims,
    campaignProgress: {
      clearedStages,
      stageStars,
      stageScores,
      bestCombo
    },
    lastEnqueuedOpId: typeof unsynced.lastEnqueuedOpId === 'string' ? unsynced.lastEnqueuedOpId : null,
    updatedAt: Number.isFinite(unsynced.updatedAt) ? unsynced.updatedAt : Date.now()
  };
}

/**
 * Stages newly earned repeatable XP into the accumulator.
 * 
 * @param {object} unsynced
 * @param {number} xpDelta - Non-negative integer XP
 * @returns {object} New immutable updated accumulator
 */
export function stageRepeatableXp(unsynced, xpDelta) {
  const current = validateUnsyncedProgress(unsynced);
  if (!Number.isInteger(xpDelta) || xpDelta < 0) {
    throw new Error(`[UnsyncedProgress] xpDelta must be a non-negative integer, received: ${xpDelta}`);
  }

  return {
    ...current,
    repeatableXpDelta: current.repeatableXpDelta + xpDelta,
    updatedAt: Date.now()
  };
}

/**
 * Stages an optimistic unique claim into the accumulator.
 * Strictly prevents duplicate staged claim IDs.
 * 
 * @param {object} unsynced
 * @param {{ claimId: string, xpReward?: number }} claim
 * @returns {object} New immutable updated accumulator
 */
export function stageUniqueClaim(unsynced, claim) {
  const current = validateUnsyncedProgress(unsynced);
  const validated = validateUniqueClaim(claim);

  if (current.uniqueClaims[validated.claimId]) {
    throw new Error(`[UnsyncedProgress] Duplicate staged unique claim: "${validated.claimId}"`);
  }

  return {
    ...current,
    uniqueClaims: {
      ...current.uniqueClaims,
      [validated.claimId]: validated
    },
    updatedAt: Date.now()
  };
}

/**
 * Stages newly completed campaign progress into the accumulator.
 * Applies high-water marks for stars, scores, and combo.
 * 
 * @param {object} unsynced
 * @param {object} campaignUpdate
 * @returns {object} New immutable updated accumulator
 */
export function stageCampaignProgress(unsynced, campaignUpdate = {}) {
  const current = validateUnsyncedProgress(unsynced);
  const { clearedStages = [], stageStars = {}, stageScores = {}, bestCombo = 0 } = campaignUpdate;

  const newCleared = { ...current.campaignProgress.clearedStages };
  if (Array.isArray(clearedStages)) {
    for (const st of clearedStages) {
      if (typeof st === 'string' && st.trim()) newCleared[st.trim()] = true;
    }
  } else if (typeof clearedStages === 'object' && clearedStages !== null) {
    for (const [st, val] of Object.entries(clearedStages)) {
      if (val) newCleared[st] = true;
    }
  }

  const newStars = { ...current.campaignProgress.stageStars };
  for (const [st, stars] of Object.entries(stageStars)) {
    if (Number.isInteger(stars) && stars >= 1 && stars <= 3) {
      newStars[st] = Math.max(newStars[st] || 0, stars);
    }
  }

  const newScores = { ...current.campaignProgress.stageScores };
  for (const [st, score] of Object.entries(stageScores)) {
    if (Number.isInteger(score) && score >= 0) {
      newScores[st] = Math.max(newScores[st] || 0, score);
    }
  }

  const newBestCombo = Math.max(
    current.campaignProgress.bestCombo,
    Number.isInteger(bestCombo) && bestCombo >= 0 ? bestCombo : 0
  );

  return {
    ...current,
    campaignProgress: {
      clearedStages: newCleared,
      stageStars: newStars,
      stageScores: newScores,
      bestCombo: newBestCombo
    },
    updatedAt: Date.now()
  };
}

/**
 * Drains items that were frozen into an enqueued SyncOperation.
 * Guarantees that items included in the pending batch are removed from the active staging accumulator,
 * while setting `lastEnqueuedOpId` for crash safety.
 * 
 * @param {object} unsynced
 * @param {object} op - The constructed SyncOperation
 * @returns {object} Drained unsynced progress object
 */
export function drainStagedItems(unsynced, op) {
  const current = validateUnsyncedProgress(unsynced);
  if (!op || !op.opId) {
    return current;
  }

  const remainingRepeatable = Math.max(0, current.repeatableXpDelta - (op.repeatableXpDelta || 0));

  const remainingClaims = { ...current.uniqueClaims };
  if (Array.isArray(op.uniqueClaims)) {
    for (const c of op.uniqueClaims) {
      if (c && c.claimId) {
        delete remainingClaims[c.claimId];
      }
    }
  }

  // Campaign progress remains unioned/high-water in staging
  return {
    ...current,
    repeatableXpDelta: remainingRepeatable,
    uniqueClaims: remainingClaims,
    lastEnqueuedOpId: op.opId,
    updatedAt: Date.now()
  };
}

/**
 * Checks whether the accumulator currently contains any un-enqueued progress.
 * 
 * @param {object} unsynced
 * @returns {boolean}
 */
export function isUnsyncedEmpty(unsynced) {
  const current = validateUnsyncedProgress(unsynced);
  const hasRepeatable = current.repeatableXpDelta > 0;
  const hasUnique = Object.keys(current.uniqueClaims).length > 0;
  const hasClears = Object.keys(current.campaignProgress.clearedStages).length > 0;
  const hasStars = Object.keys(current.campaignProgress.stageStars).length > 0;
  const hasScores = Object.keys(current.campaignProgress.stageScores).length > 0;
  const hasCombo = current.campaignProgress.bestCombo > 0;

  return !hasRepeatable && !hasUnique && !hasClears && !hasStars && !hasScores && !hasCombo;
}

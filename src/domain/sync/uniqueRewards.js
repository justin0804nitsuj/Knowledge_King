import { getStageById } from '../adventure/campaignConfig';
import { XP_REWARDS } from '../player/xpRewards';
import { DAILY_MISSIONS } from '../player/dailySystem';

/**
 * CLOUD PROFILE SYNC V0.1 — CANONICAL UNIQUE REWARD DEFINITIONS (PHASE 3)
 * 
 * CORE REWARD SAFETY INVARIANTS:
 * 
 * 1. Canonical Domain Derivation:
 *    Unique reward XP amounts are strictly derived from authoritative domain definitions:
 *    - firstClear:<stageId> -> XP_REWARDS.FIRST_CLEAR[stage.type]
 *    - daily:<date>:<missionId> -> DAILY_MISSIONS[missionId].xpReward
 *    UI code / screens must NEVER specify arbitrary XP values for unique claims.
 * 
 * 2. Deterministic Claim Families:
 *    - "firstClear:<stageId>" (e.g. "firstClear:L1-S1", "firstClear:L1-E1", "firstClear:L1-BOSS")
 *    - "daily:<YYYY-MM-DD>:<missionId>" (e.g. "daily:2026-10-13:m1")
 * 
 * 3. Strict Validation:
 *    Malformed or unknown claim IDs are rejected.
 *    Mismatch between provided xpReward and canonical reward is rejected.
 */

export const CLAIM_FAMILIES = Object.freeze({
  FIRST_CLEAR: 'firstClear',
  DAILY: 'daily'
});

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Builds a deterministic first-clear claim ID.
 * 
 * @param {string} stageId - Stage identifier (e.g. "L1-S1", "L1-E1", "L1-BOSS")
 * @returns {string} Deterministic claimId
 */
export function buildFirstClearClaimId(stageId) {
  if (!stageId || typeof stageId !== 'string' || !stageId.trim()) {
    throw new Error('[UniqueRewards] stageId must be a non-empty string');
  }
  return `firstClear:${stageId.trim()}`;
}

/**
 * Builds a deterministic daily mission claim ID.
 * 
 * @param {string} dateKey - Date string in YYYY-MM-DD format
 * @param {string} missionId - Mission identifier (e.g. "m1", "m2", "m3")
 * @returns {string} Deterministic claimId
 */
export function buildDailyMissionClaimId(dateKey, missionId) {
  if (!dateKey || typeof dateKey !== 'string' || !dateKey.trim()) {
    throw new Error('[UniqueRewards] dateKey must be a non-empty string (YYYY-MM-DD)');
  }
  if (!missionId || typeof missionId !== 'string' || !missionId.trim()) {
    throw new Error('[UniqueRewards] missionId must be a non-empty string');
  }
  return `daily:${dateKey.trim()}:${missionId.trim()}`;
}

/**
 * Parses and validates a deterministic claimId.
 * 
 * @param {string} claimId
 * @returns {{ family: string, stageId?: string, stage?: object, dateKey?: string, missionId?: string, mission?: object }}
 */
export function parseClaimId(claimId) {
  if (!claimId || typeof claimId !== 'string' || !claimId.trim()) {
    throw new Error('[UniqueRewards] claimId must be a non-empty string');
  }
  const trimmed = claimId.trim();
  const parts = trimmed.split(':');

  if (parts[0] === CLAIM_FAMILIES.FIRST_CLEAR) {
    if (parts.length !== 2 || !parts[1] || !parts[1].trim()) {
      throw new Error(`[UniqueRewards] Malformed firstClear claimId: "${claimId}"`);
    }
    const stageId = parts[1].trim();
    const stage = getStageById(stageId);
    if (!stage) {
      throw new Error(`[UniqueRewards] Unknown stageId in claimId: "${stageId}"`);
    }
    return {
      family: CLAIM_FAMILIES.FIRST_CLEAR,
      stageId,
      stage
    };
  }

  if (parts[0] === CLAIM_FAMILIES.DAILY) {
    if (parts.length !== 3 || !parts[1] || !parts[2] || !parts[1].trim() || !parts[2].trim()) {
      throw new Error(`[UniqueRewards] Malformed daily claimId: "${claimId}"`);
    }
    const dateKey = parts[1].trim();
    const missionId = parts[2].trim();
    if (!DATE_REGEX.test(dateKey)) {
      throw new Error(`[UniqueRewards] Invalid date format in daily claimId: "${dateKey}" (expected YYYY-MM-DD)`);
    }
    const mission = Object.values(DAILY_MISSIONS).find((m) => m.id === missionId);
    if (!mission) {
      throw new Error(`[UniqueRewards] Unknown missionId in daily claimId: "${missionId}"`);
    }
    return {
      family: CLAIM_FAMILIES.DAILY,
      dateKey,
      missionId,
      mission
    };
  }

  throw new Error(`[UniqueRewards] Unknown claim family in claimId: "${claimId}"`);
}

/**
 * Resolves the canonical XP reward amount from project domain definitions.
 * 
 * @param {string} claimId
 * @returns {number} Canonical XP reward (> 0)
 */
export function resolveCanonicalClaimReward(claimId) {
  const parsed = parseClaimId(claimId);

  if (parsed.family === CLAIM_FAMILIES.FIRST_CLEAR) {
    const stageType = parsed.stage.type;
    const reward = XP_REWARDS.FIRST_CLEAR[stageType];
    if (typeof reward !== 'number' || reward <= 0) {
      throw new Error(`[UniqueRewards] No canonical first-clear reward configured for stage type "${stageType}"`);
    }
    return reward;
  }

  if (parsed.family === CLAIM_FAMILIES.DAILY) {
    const reward = parsed.mission.xpReward;
    if (typeof reward !== 'number' || reward <= 0) {
      throw new Error(`[UniqueRewards] No canonical reward configured for mission "${parsed.missionId}"`);
    }
    return reward;
  }

  throw new Error(`[UniqueRewards] Cannot resolve reward for unknown family "${parsed.family}"`);
}

/**
 * Validates a unique claim object { claimId, xpReward }.
 * If xpReward is provided, it MUST match the canonical reward.
 * If xpReward is omitted, it is populated with the canonical reward.
 * 
 * @param {{ claimId: string, xpReward?: number }} claim
 * @returns {{ claimId: string, xpReward: number }} Validated canonical claim object
 */
export function validateUniqueClaim(claim) {
  if (!claim || typeof claim !== 'object') {
    throw new Error('[UniqueRewards] Claim must be an object');
  }
  const { claimId, xpReward } = claim;
  const canonicalReward = resolveCanonicalClaimReward(claimId);

  if (xpReward !== undefined && xpReward !== null) {
    if (xpReward !== canonicalReward) {
      throw new Error(
        `[UniqueRewards] Claim "${claimId}" xpReward mismatch. Provided: ${xpReward}, canonical: ${canonicalReward}`
      );
    }
  }

  return {
    claimId: claimId.trim(),
    xpReward: canonicalReward
  };
}

export const getCanonicalUniqueReward = resolveCanonicalClaimReward;

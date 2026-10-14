import { validateSyncOperation } from './syncOperation';
import { getCanonicalUniqueReward } from './uniqueRewards';

/**
 * CLOUD PROFILE SYNC V0.1 — PURE CLOUD TRANSACTION REDUCER (PHASE 4)
 * 
 * CORE TRANSACTION CONTRACT INVARIANTS:
 * 
 * 1. Pure Function:
 *    Takes (currentCloudState, op, options) and returns nextCloudState without side effects
 *    or direct database calls. Safe for repeated executions within RTDB runTransaction().
 * 
 * 2. Virgin State Initialization:
 *    If currentCloudState is null or empty, initializes schemaVersion = 1, revision = 0,
 *    and empty structured progression, campaign, uniqueClaims, and appliedOps.
 * 
 * 3. Lost-Ack & Duplicate Idempotency:
 *    If appliedOps[op.deviceId] >= op.seq, returns currentCloudState completely UNCHANGED.
 *    No XP is added, revision is not bumped, and no claims are processed.
 * 
 * 4. Canonical Reward Authority:
 *    The reducer re-resolves unique claim rewards from getCanonicalUniqueReward(claimId).
 *    Client-supplied xpReward fields in op payloads are strictly non-authoritative.
 * 
 * 5. Deterministic Deduplication:
 *    If a unique claimId is already recorded in cloud uniqueClaims, its reward is ignored.
 *    Repeatable XP delta is credited regardless of whether a unique claim was a duplicate.
 * 
 * 6. Merge-Safe Campaign Progress:
 *    Cleared stages are unioned. Star ratings, high scores, and best combo use high-water marks.
 */

/**
 * Creates an empty, validated cloud progress root.
 * 
 * @param {number} [now]
 * @returns {object}
 */
export function createVirginCloudProgress(now = Date.now()) {
  return {
    schemaVersion: 1,
    revision: 0,
    updatedAt: now,
    appliedOps: {},
    progression: {
      totalXp: 0
    },
    campaign: {
      clearedStages: {},
      stageStars: {},
      stageScores: {},
      bestCombo: 0
    },
    uniqueClaims: {}
  };
}

/**
 * Reduces a SyncOperation into the authoritative cloud progress state.
 * 
 * @param {object|null|undefined} currentCloudState - Current state from database
 * @param {object} op - The SyncOperation to apply
 * @param {object} [options]
 * @param {number} [options.now] - Explicit timestamp override (defaults to Date.now())
 * @returns {object} The updated cloud state, or currentCloudState unchanged if already applied
 */
export function reduceCloudProgress(currentCloudState, op, options = {}) {
  // 1. Strict validation of incoming SyncOperation
  const validatedOp = validateSyncOperation(op);

  const now = Number.isFinite(options.now) ? options.now : Date.now();

  // 2. Initialize virgin state if record does not yet exist
  const base = currentCloudState && typeof currentCloudState === 'object' && currentCloudState.schemaVersion === 1
    ? currentCloudState
    : createVirginCloudProgress(now);

  const appliedOps = { ...(base.appliedOps || {}) };
  const lastSeq = appliedOps[validatedOp.deviceId] || 0;

  // 3. Idempotency Check:
  // If this device's sequence was already applied, return current state completely unmodified
  if (lastSeq >= validatedOp.seq) {
    return base;
  }

  // 4. Progression (Repeatable XP)
  let currentTotalXp = base.progression?.totalXp || 0;
  currentTotalXp += validatedOp.repeatableXpDelta;

  // 5. Unique Claims Processing with Canonical Authority
  const uniqueClaims = { ...(base.uniqueClaims || {}) };

  for (const claim of validatedOp.uniqueClaims) {
    const claimId = claim.claimId;
    if (!claimId) continue;

    // Authoritative check: has this claim ever been granted to this account?
    if (!uniqueClaims[claimId]) {
      // Re-resolve canonical reward value from domain definition
      const canonicalReward = getCanonicalUniqueReward(claimId);
      if (canonicalReward !== null && canonicalReward > 0) {
        currentTotalXp += canonicalReward;
      }

      uniqueClaims[claimId] = {
        claimedAt: now,
        deviceId: validatedOp.deviceId
      };
    }
  }

  // 6. Campaign Progress Union & High-Water Marks
  const campaign = base.campaign || {};
  const clearedStages = { ...(campaign.clearedStages || {}) };
  const stageStars = { ...(campaign.stageStars || {}) };
  const stageScores = { ...(campaign.stageScores || {}) };

  const opCampaign = validatedOp.campaignProgress || {};

  // Cleared stages union
  for (const st of opCampaign.clearedStages || []) {
    if (typeof st === 'string' && st.trim()) {
      clearedStages[st.trim()] = true;
    }
  }

  // Star ratings high-water
  for (const [st, stars] of Object.entries(opCampaign.stageStars || {})) {
    if (Number.isInteger(stars) && stars >= 1 && stars <= 3) {
      stageStars[st] = Math.max(stageStars[st] || 0, stars);
    }
  }

  // High scores high-water
  for (const [st, score] of Object.entries(opCampaign.stageScores || {})) {
    if (Number.isInteger(score) && score >= 0) {
      stageScores[st] = Math.max(stageScores[st] || 0, score);
    }
  }

  // Best combo high-water
  const bestCombo = Math.max(
    campaign.bestCombo || 0,
    Number.isInteger(opCampaign.bestCombo) && opCampaign.bestCombo >= 0 ? opCampaign.bestCombo : 0
  );

  // 7. Advance Applied Sequence for this device
  appliedOps[validatedOp.deviceId] = validatedOp.seq;

  // 8. Increment revision monotonically
  const nextRevision = (base.revision || 0) + 1;

  return {
    schemaVersion: 1,
    revision: nextRevision,
    updatedAt: now,
    appliedOps,
    progression: {
      totalXp: currentTotalXp
    },
    campaign: {
      clearedStages,
      stageStars,
      stageScores,
      bestCombo
    },
    uniqueClaims
  };
}

import { validateUniqueClaim } from './uniqueRewards';

/**
 * CLOUD PROFILE SYNC V0.1 — SYNC OPERATION DOMAIN MODEL (PHASE 3)
 * 
 * CORE CONTRACT INVARIANTS:
 * 
 * 1. Deterministic Operation ID:
 *    opId is strictly `${deviceId}:${seq}`.
 * 
 * 2. Strict Separation of XP Sources:
 *    - repeatableXpDelta: Answers, completed battles, review completions, perfect bonuses.
 *    - uniqueClaims: Deterministic, canonical unique claims (firstClear, daily missions).
 *    Unique reward XP is NEVER merged anonymously into repeatableXpDelta.
 * 
 * 3. Merge-Safe Campaign Progress:
 *    - clearedStages (set union)
 *    - stageStars (high-water max 1-3)
 *    - stageScores (high-water max)
 *    - bestCombo (high-water max)
 *    Detailed lifetime counters are intentionally excluded from V0.1.
 * 
 * 4. Immutability:
 *    A constructed SyncOp is immutable once created.
 */

/**
 * Validates a SyncOperation object according to strict domain rules.
 * Throws an Error if any invariant is violated.
 * 
 * @param {object} op - The SyncOperation to validate
 * @returns {object} Validated SyncOperation
 */
export function validateSyncOperation(op) {
  if (!op || typeof op !== 'object') {
    throw new Error('[SyncOperation] Operation must be an object');
  }

  // 1. Device ID
  if (!op.deviceId || typeof op.deviceId !== 'string' || !op.deviceId.trim()) {
    throw new Error('[SyncOperation] deviceId must be a non-empty string');
  }

  // 2. Sequence
  if (!Number.isInteger(op.seq) || op.seq <= 0) {
    throw new Error(`[SyncOperation] seq must be a positive integer >= 1, received: ${op.seq}`);
  }

  // 3. Operation ID
  const expectedOpId = `${op.deviceId.trim()}:${op.seq}`;
  if (op.opId !== expectedOpId) {
    throw new Error(`[SyncOperation] opId mismatch. Expected "${expectedOpId}", received "${op.opId}"`);
  }

  // 4. Timestamp
  if (!Number.isFinite(op.createdAt) || op.createdAt <= 0) {
    throw new Error('[SyncOperation] createdAt must be a positive finite timestamp');
  }

  // 5. Repeatable XP Delta
  if (!Number.isInteger(op.repeatableXpDelta) || op.repeatableXpDelta < 0) {
    throw new Error(`[SyncOperation] repeatableXpDelta must be a non-negative integer, received: ${op.repeatableXpDelta}`);
  }

  // 6. Unique Claims
  if (!Array.isArray(op.uniqueClaims)) {
    throw new Error('[SyncOperation] uniqueClaims must be an array');
  }

  const seenClaimIds = new Set();
  const validatedClaims = [];

  for (const claim of op.uniqueClaims) {
    const validated = validateUniqueClaim(claim);
    if (seenClaimIds.has(validated.claimId)) {
      throw new Error(`[SyncOperation] Duplicate claimId within single operation: "${validated.claimId}"`);
    }
    seenClaimIds.add(validated.claimId);
    validatedClaims.push(validated);
  }

  // 7. Campaign Progress (merge-safe fields only)
  if (!op.campaignProgress || typeof op.campaignProgress !== 'object') {
    throw new Error('[SyncOperation] campaignProgress must be an object');
  }

  const { clearedStages = [], stageStars = {}, stageScores = {}, bestCombo = 0 } = op.campaignProgress;

  if (!Array.isArray(clearedStages)) {
    throw new Error('[SyncOperation] campaignProgress.clearedStages must be an array');
  }
  for (const st of clearedStages) {
    if (typeof st !== 'string' || !st.trim()) {
      throw new Error('[SyncOperation] clearedStages must contain only non-empty strings');
    }
  }

  if (typeof stageStars !== 'object' || stageStars === null) {
    throw new Error('[SyncOperation] campaignProgress.stageStars must be an object');
  }
  for (const [st, stars] of Object.entries(stageStars)) {
    if (!Number.isInteger(stars) || stars < 1 || stars > 3) {
      throw new Error(`[SyncOperation] stageStars for "${st}" must be integer between 1 and 3, received: ${stars}`);
    }
  }

  if (typeof stageScores !== 'object' || stageScores === null) {
    throw new Error('[SyncOperation] campaignProgress.stageScores must be an object');
  }
  for (const [st, score] of Object.entries(stageScores)) {
    if (!Number.isInteger(score) || score < 0) {
      throw new Error(`[SyncOperation] stageScores for "${st}" must be non-negative integer, received: ${score}`);
    }
  }

  if (!Number.isInteger(bestCombo) || bestCombo < 0) {
    throw new Error(`[SyncOperation] bestCombo must be a non-negative integer, received: ${bestCombo}`);
  }

  return {
    opId: expectedOpId,
    deviceId: op.deviceId.trim(),
    seq: op.seq,
    createdAt: op.createdAt,
    repeatableXpDelta: op.repeatableXpDelta,
    uniqueClaims: validatedClaims,
    campaignProgress: {
      clearedStages: [...clearedStages],
      stageStars: { ...stageStars },
      stageScores: { ...stageScores },
      bestCombo
    }
  };
}

/**
 * Constructs an immutable, validated SyncOperation.
 * 
 * @param {object} params
 * @param {string} params.deviceId
 * @param {number} params.seq
 * @param {number} [params.createdAt]
 * @param {number} [params.repeatableXpDelta]
 * @param {Array<{ claimId: string, xpReward?: number }>} [params.uniqueClaims]
 * @param {object} [params.campaignProgress]
 * @returns {Readonly<object>}
 */
export function createSyncOperation({
  deviceId,
  seq,
  createdAt = Date.now(),
  repeatableXpDelta = 0,
  uniqueClaims = [],
  campaignProgress = {}
}) {
  const raw = {
    opId: `${deviceId ? String(deviceId).trim() : ''}:${seq}`,
    deviceId,
    seq,
    createdAt,
    repeatableXpDelta,
    uniqueClaims,
    campaignProgress: {
      clearedStages: campaignProgress.clearedStages || [],
      stageStars: campaignProgress.stageStars || {},
      stageScores: campaignProgress.stageScores || {},
      bestCombo: campaignProgress.bestCombo !== undefined ? campaignProgress.bestCombo : 0
    }
  };

  const validated = validateSyncOperation(raw);
  return Object.freeze({
    ...validated,
    uniqueClaims: Object.freeze(validated.uniqueClaims.map((c) => Object.freeze({ ...c }))),
    campaignProgress: Object.freeze({
      clearedStages: Object.freeze([...validated.campaignProgress.clearedStages]),
      stageStars: Object.freeze({ ...validated.campaignProgress.stageStars }),
      stageScores: Object.freeze({ ...validated.campaignProgress.stageScores }),
      bestCombo: validated.campaignProgress.bestCombo
    })
  });
}

/**
 * Pure contract helper: Demonstrates and guarantees that gameplay progress
 * earned locally AFTER a pending SyncOp was constructed is strictly preserved
 * when that op receives cloud acknowledgement, while removing rejected/duplicate
 * unique claims without polluting repeatable XP.
 * 
 * Reconciled Total XP formula:
 * Reconciled = Authoritative Cloud Total XP
 *            + Repeatable XP staged AFTER the op (unsyncedProgress.repeatableXpDelta)
 *            + Unresolved unique claim XP staged AFTER the op (claims in unsyncedProgress not in cloudSnapshot.uniqueClaims)
 * 
 * @param {object} params
 * @param {object} [params.cloudSnapshot] - Authoritative cloud state { progression: { totalXp }, uniqueClaims, campaign }
 * @param {object} [params.unsyncedProgress] - Local staging accumulator with progress earned AFTER op creation
 * @param {number} [params.cloudSnapshotTotalXp] - Fallback total XP from cloud
 * @param {number} [params.localCurrentTotalXp] - Fallback total XP for legacy callers
 * @param {number} [params.localBaselineTotalXpAtOpCreation] - Fallback baseline for legacy callers
 * @param {object} [params.localCurrentCampaign] - Current local campaign state
 * @param {object} [params.cloudSnapshotCampaign] - Cloud snapshot campaign state
 * @returns {object} Reconciled local progression preserving post-op earnings
 */
export function reconcileProgressOnOpAck({
  cloudSnapshot,
  unsyncedProgress,
  cloudSnapshotTotalXp,
  localCurrentTotalXp,
  localBaselineTotalXpAtOpCreation,
  localCurrentCampaign = {},
  cloudSnapshotCampaign = {}
}) {
  const authoritativeCloudXp =
    cloudSnapshot?.progression?.totalXp !== undefined
      ? cloudSnapshot.progression.totalXp
      : (cloudSnapshotTotalXp || 0);

  let postOpEarnedRepeatableXp = 0;
  let postOpUnresolvedUniqueXp = 0;
  const acknowledgedUniqueClaims = cloudSnapshot?.uniqueClaims || {};

  if (unsyncedProgress && typeof unsyncedProgress === 'object') {
    // 1. Repeatable XP staged AFTER the acknowledged operation
    postOpEarnedRepeatableXp = Number.isInteger(unsyncedProgress.repeatableXpDelta)
      ? Math.max(0, unsyncedProgress.repeatableXpDelta)
      : 0;

    // 2. Optimistic unique claims staged AFTER the acknowledged operation
    // Only add if NOT already claimed in cloud!
    if (unsyncedProgress.uniqueClaims && typeof unsyncedProgress.uniqueClaims === 'object') {
      for (const [claimId, claim] of Object.entries(unsyncedProgress.uniqueClaims)) {
        if (!acknowledgedUniqueClaims[claimId]) {
          postOpUnresolvedUniqueXp += (claim?.xpReward || 0);
        }
      }
    }
  } else if (localCurrentTotalXp !== undefined && localBaselineTotalXpAtOpCreation !== undefined) {
    // Fallback for earlier tests where unsyncedProgress was not supplied
    postOpEarnedRepeatableXp = Math.max(0, localCurrentTotalXp - localBaselineTotalXpAtOpCreation);
  }

  const reconciledTotalXp = authoritativeCloudXp + postOpEarnedRepeatableXp + postOpUnresolvedUniqueXp;

  // Union campaign cleared stages
  const clearedStagesMap = {};
  const csCampaign = cloudSnapshot?.campaign || cloudSnapshotCampaign || {};
  const unsyncedCampaign = unsyncedProgress?.campaignProgress || localCurrentCampaign || {};

  for (const st of csCampaign.clearedStages || []) {
    clearedStagesMap[st] = true;
  }
  const localClears = Array.isArray(unsyncedCampaign.clearedStages)
    ? unsyncedCampaign.clearedStages
    : Object.keys(unsyncedCampaign.clearedStages || {});
  for (const st of localClears) {
    clearedStagesMap[st] = true;
  }
  const clearedStages = Object.keys(clearedStagesMap);

  // High-water stars
  const stageStars = { ...(csCampaign.stageStars || {}) };
  for (const [st, stars] of Object.entries(unsyncedCampaign.stageStars || {})) {
    stageStars[st] = Math.max(stageStars[st] || 0, stars);
  }

  // High-water scores
  const stageScores = { ...(csCampaign.stageScores || {}) };
  for (const [st, score] of Object.entries(unsyncedCampaign.stageScores || {})) {
    stageScores[st] = Math.max(stageScores[st] || 0, score);
  }

  const bestCombo = Math.max(
    csCampaign.bestCombo || 0,
    unsyncedCampaign.bestCombo || 0
  );

  return {
    progression: {
      totalXp: reconciledTotalXp,
      postOpEarnedXp: postOpEarnedRepeatableXp + postOpUnresolvedUniqueXp,
      postOpEarnedRepeatableXp,
      postOpUnresolvedUniqueXp
    },
    campaign: {
      clearedStages,
      stageStars,
      stageScores,
      bestCombo
    }
  };
}

/**
 * Pure guardrail helper: Verifies that legacy global data can be adopted by only ONE account.
 * 
 * @param {{ adoptedBy: string, adoptedAt: number } | null} currentRecord
 * @param {string} candidateIdentity
 * @returns {{ allowed: boolean, reason?: string, adoptedBy?: string }}
 */
export function canAdoptLegacySave(currentRecord, candidateIdentity) {
  if (!currentRecord) {
    return { allowed: true };
  }
  if (currentRecord.adoptedBy === candidateIdentity) {
    return { allowed: true, isSameIdentity: true };
  }
  return {
    allowed: false,
    reason: 'LEGACY_ALREADY_ADOPTED',
    adoptedBy: currentRecord.adoptedBy
  };
}

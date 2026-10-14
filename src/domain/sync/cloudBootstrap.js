import { buildFirstClearClaimId, buildDailyMissionClaimId } from './uniqueRewards';

/**
 * CLOUD PROFILE SYNC V0.1 — AUTH-AWARE CLOUD BOOTSTRAP DOMAIN (PHASE 5A)
 *
 * CORE INVARIANTS:
 * 1. Exact Local XP:
 *    Local totalXp is preserved exactly. Never re-award XP for already cleared stages
 *    or claimed missions during bootstrap.
 * 2. Provable Claims Reconstruction:
 *    - clearedStages -> reconstruct `firstClear:<stageId>` claim markers
 *    - today's claimed daily missions -> reconstruct `daily:<date>:<missionId>` markers
 *    - Historical daily claims are unavailable and must NEVER be fabricated.
 * 3. Conservative Reconciliation:
 *    When reconciling legacy local progress with existing cloud progress:
 *    - totalXp = max(local, cloud) (NEVER sum historical XP)
 *    - clearedStages = union
 *    - stageStars = per-stage max
 *    - stageScores = per-stage max
 *    - bestCombo = max
 *    - uniqueClaims = union of provable claims
 * 4. Idempotency:
 *    Re-running bootstrap or reconcile on identical state returns the existing state unchanged.
 */

/**
 * Normalizes clearedStages from array or object into a map of { [stageId]: true }.
 *
 * @param {Array<string>|object|null|undefined} cleared
 * @returns {Record<string, boolean>}
 */
export function normalizeClearedStagesMap(cleared) {
  const result = {};
  if (!cleared) return result;

  if (Array.isArray(cleared)) {
    for (const st of cleared) {
      if (typeof st === 'string' && st.trim()) {
        result[st.trim()] = true;
      }
    }
  } else if (typeof cleared === 'object') {
    for (const [st, val] of Object.entries(cleared)) {
      if (val && typeof st === 'string' && st.trim()) {
        result[st.trim()] = true;
      }
    }
  }

  return result;
}

/**
 * Builds a validated, self-consistent cloud progress bootstrap snapshot from
 * local playerProgress and campaignProgress data.
 *
 * @param {object} localPlayerProgress
 * @param {object} localCampaignProgress
 * @param {object} [options]
 * @param {number} [options.now] - Explicit timestamp override (defaults to Date.now())
 * @param {string} [options.deviceId] - Device identifier for claim markers (defaults to 'bootstrap')
 * @returns {object} Full cloud progress snapshot
 */
export function buildBootstrapSnapshot(localPlayerProgress = {}, localCampaignProgress = {}, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const deviceId = (options.deviceId && typeof options.deviceId === 'string' && options.deviceId.trim())
    ? options.deviceId.trim()
    : 'bootstrap';

  // 1. Preserve exact local totalXp (never re-add rewards)
  const totalXp = Number.isInteger(localPlayerProgress?.totalXp) && localPlayerProgress.totalXp >= 0
    ? localPlayerProgress.totalXp
    : 0;

  // 2. Campaign progression
  const clearedStages = normalizeClearedStagesMap(localCampaignProgress?.clearedStages);

  const stageStars = {};
  for (const [st, stars] of Object.entries(localCampaignProgress?.stageStars || {})) {
    if (Number.isInteger(stars) && stars >= 1 && stars <= 3 && typeof st === 'string' && st.trim()) {
      stageStars[st.trim()] = stars;
    }
  }

  const stageScores = {};
  for (const [st, score] of Object.entries(localCampaignProgress?.stageScores || {})) {
    if (Number.isInteger(score) && score >= 0 && typeof st === 'string' && st.trim()) {
      stageScores[st.trim()] = score;
    }
  }

  const bestCombo = Math.max(
    Number.isInteger(localCampaignProgress?.bestCombo) && localCampaignProgress.bestCombo >= 0 ? localCampaignProgress.bestCombo : 0,
    Number.isInteger(localPlayerProgress?.stats?.bestCombo) && localPlayerProgress.stats.bestCombo >= 0 ? localPlayerProgress.stats.bestCombo : 0
  );

  // 3. Reconstruct provable unique claims without adding XP
  const uniqueClaims = {};

  // A. Reconstruct firstClear claims for all cleared stages
  for (const stageId of Object.keys(clearedStages)) {
    try {
      const claimId = buildFirstClearClaimId(stageId);
      uniqueClaims[claimId] = {
        claimedAt: now,
        deviceId
      };
    } catch (_) {
      // Skip invalid stageId if any
    }
  }

  // B. Reconstruct today's claimed daily missions (ONLY from current day)
  const daily = localPlayerProgress?.daily;
  const lastActiveDate = daily?.lastActiveDate;
  if (lastActiveDate && typeof lastActiveDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(lastActiveDate)) {
    const missions = daily.missions || {};
    for (const [missionId, missionData] of Object.entries(missions)) {
      if (missionData && missionData.claimed === true) {
        try {
          const claimId = buildDailyMissionClaimId(lastActiveDate, missionId);
          uniqueClaims[claimId] = {
            claimedAt: now,
            deviceId
          };
        } catch (_) {
          // Skip invalid missionId if any
        }
      }
    }
  }

  return {
    schemaVersion: 1,
    revision: 0,
    updatedAt: now,
    appliedOps: {},
    progression: {
      totalXp
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

/**
 * Reconciles local progress (legacy or freshly prepared snapshot) with authoritative cloud progress.
 *
 * Conservative rules:
 * - totalXp = max(local, cloud) (NEVER sum historical XP)
 * - clearedStages = union
 * - stageStars = per-stage max
 * - stageScores = per-stage max
 * - bestCombo = max
 * - uniqueClaims = union of provable claims (cloud takes precedence for existing claim metadata)
 * - appliedOps = cloud appliedOps preserved
 *
 * @param {object} local - Local snapshot or { playerProgress, campaignProgress }
 * @param {object} cloud - Authoritative cloud progress state
 * @param {object} [options]
 * @param {number} [options.now]
 * @returns {object} Reconciled cloud progress state
 */
export function reconcileLegacyWithCloud(local, cloud, options = {}) {
  if (!cloud || typeof cloud !== 'object') {
    throw new Error('[CloudBootstrap] Authoritative cloud progress state is required for reconciliation');
  }

  const now = Number.isFinite(options.now) ? options.now : Date.now();

  // Extract local snapshot if local is raw player/campaign data
  let localSnapshot = local;
  if (!local?.progression || !local?.campaign) {
    localSnapshot = buildBootstrapSnapshot(local?.playerProgress || local, local?.campaignProgress || local, options);
  }

  const cloudProgression = cloud.progression || {};
  const cloudCampaign = cloud.campaign || {};
  const cloudUniqueClaims = cloud.uniqueClaims || {};
  const cloudAppliedOps = cloud.appliedOps || {};

  const localProgression = localSnapshot.progression || {};
  const localCampaign = localSnapshot.campaign || {};
  const localUniqueClaims = localSnapshot.uniqueClaims || {};

  // 1. High-water totalXp (never sum)
  const cloudXp = cloudProgression.totalXp || 0;
  const localXp = localProgression.totalXp || 0;
  const reconciledXp = Math.max(cloudXp, localXp);

  // 2. Cleared stages union
  const reconciledClearedStages = { ...(cloudCampaign.clearedStages || {}) };
  const localCleared = normalizeClearedStagesMap(localCampaign.clearedStages);
  for (const st of Object.keys(localCleared)) {
    reconciledClearedStages[st] = true;
  }

  // 3. Stage stars per-stage max
  const reconciledStars = { ...(cloudCampaign.stageStars || {}) };
  for (const [st, stars] of Object.entries(localCampaign.stageStars || {})) {
    if (Number.isInteger(stars) && stars >= 1 && stars <= 3) {
      reconciledStars[st] = Math.max(reconciledStars[st] || 0, stars);
    }
  }

  // 4. Stage scores per-stage max
  const reconciledScores = { ...(cloudCampaign.stageScores || {}) };
  for (const [st, score] of Object.entries(localCampaign.stageScores || {})) {
    if (Number.isInteger(score) && score >= 0) {
      reconciledScores[st] = Math.max(reconciledScores[st] || 0, score);
    }
  }

  // 5. Best combo max
  const reconciledBestCombo = Math.max(
    cloudCampaign.bestCombo || 0,
    localCampaign.bestCombo || 0
  );

  // 6. Unique claims union (cloud claim metadata preserved if existing)
  const reconciledUniqueClaims = { ...cloudUniqueClaims };
  for (const [claimId, claimData] of Object.entries(localUniqueClaims)) {
    if (!reconciledUniqueClaims[claimId]) {
      reconciledUniqueClaims[claimId] = claimData;
    }
  }

  // 7. Check if anything actually changed from cloud
  const xpChanged = reconciledXp !== cloudXp;
  const clearsChanged = Object.keys(reconciledClearedStages).length !== Object.keys(cloudCampaign.clearedStages || {}).length;
  const starsChanged = Object.keys(reconciledStars).some((st) => reconciledStars[st] !== (cloudCampaign.stageStars || {})[st]);
  const scoresChanged = Object.keys(reconciledScores).some((st) => reconciledScores[st] !== (cloudCampaign.stageScores || {})[st]);
  const comboChanged = reconciledBestCombo !== (cloudCampaign.bestCombo || 0);
  const claimsChanged = Object.keys(reconciledUniqueClaims).length !== Object.keys(cloudUniqueClaims).length;

  const hasChanges = xpChanged || clearsChanged || starsChanged || scoresChanged || comboChanged || claimsChanged;

  if (!hasChanges) {
    // Completely idempotent: return cloud state unmodified
    return cloud;
  }

  return {
    schemaVersion: 1,
    revision: (cloud.revision || 0) + 1,
    updatedAt: now,
    appliedOps: { ...cloudAppliedOps },
    progression: {
      totalXp: reconciledXp
    },
    campaign: {
      clearedStages: reconciledClearedStages,
      stageStars: reconciledStars,
      stageScores: reconciledScores,
      bestCombo: reconciledBestCombo
    },
    uniqueClaims: reconciledUniqueClaims
  };
}

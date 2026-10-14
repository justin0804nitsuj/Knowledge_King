import { normalizeIdentity, GUEST_IDENTITY, setActiveIdentity } from '../../storage/storageIdentity';
import {
  inspectLegacyStorage,
  getMigrationStatus,
  migrateLegacyStorageToIdentity
} from '../../storage/legacyStorageMigration';
import {
  getLegacyAdoptionRecord,
  recordLegacyAdoption,
  getPendingSyncOp
} from '../../storage/syncOutboxStorage';
import { getUnsyncedProgress } from '../../storage/unsyncedProgressStorage';
import { isUnsyncedEmpty } from '../../domain/sync/unsyncedProgress';
import { canAdoptLegacySave } from '../../domain/sync/syncOperation';
import { buildBootstrapSnapshot } from '../../domain/sync/cloudBootstrap';
import { getCloudProgress, bootstrapCloudProgress } from './cloudProgressService';
import {
  loadScopedPlayerProgress,
  loadScopedCampaignProgress,
  restoreCloudProgressToLocal,
  setLastSyncedSnapshot
} from './cloudRestoreAdapter';
import { setCloudSyncReady } from './liveProgressSync';

/**
 * CLOUD PROFILE SYNC V0.1 — ACCOUNT PROGRESS COORDINATOR (PHASE 5A)
 *
 * RESPONSIBILITIES:
 * 1. Auth-Aware Identity Routing:
 *    - Firebase user -> 'uid:<uid>'
 *    - null / signed out -> 'guest'
 * 2. Legacy Save Adoption Guardrails:
 *    - Inspects legacy storage
 *    - Enforces single-account adoption rule (Account A adopts, Account B cannot)
 *    - Guest use NEVER consumes the adoption right
 *    - Legacy keys are never deleted
 * 3. Cloud Progress Synchronization:
 *    - Cloud missing -> bootstrap with local snapshot
 *    - Cloud exists & local empty -> restore cloud to local
 *    - Both exist -> conservative reconcile via atomic cloud transaction
 * 4. Active Identity Pointer:
 *    - Updates @KnowledgeKing:activeIdentity pointer safely
 */

/**
 * Computes historical progress by subtracting staged (unsynced and pending) progress
 * from the current local progress snapshot.
 *
 * @param {object} localPlayer
 * @param {object} localCampaign
 * @param {object} [unsynced]
 * @param {object} [pendingOp]
 * @returns {{ historicalPlayer: object, historicalCampaign: object }}
 */
export function extractHistoricalProgress(localPlayer = {}, localCampaign = {}, unsynced = null, pendingOp = null) {
  let stagedRepeatableXp = 0;
  let stagedClaimsXp = 0;
  const stagedClearedStagesSet = new Set();

  if (unsynced && typeof unsynced === 'object') {
    if (Number.isInteger(unsynced.repeatableXpDelta) && unsynced.repeatableXpDelta > 0) {
      stagedRepeatableXp += unsynced.repeatableXpDelta;
    }
    if (unsynced.uniqueClaims && typeof unsynced.uniqueClaims === 'object') {
      for (const claim of Object.values(unsynced.uniqueClaims)) {
        if (claim && Number.isInteger(claim.xpReward) && claim.xpReward > 0) {
          stagedClaimsXp += claim.xpReward;
        }
        if (claim?.claimId?.startsWith('firstClear:')) {
          stagedClearedStagesSet.add(claim.claimId.slice('firstClear:'.length));
        }
      }
    }
    if (unsynced.campaignProgress?.clearedStages && Array.isArray(unsynced.campaignProgress.clearedStages)) {
      for (const st of unsynced.campaignProgress.clearedStages) {
        if (typeof st === 'string' && st.trim()) {
          stagedClearedStagesSet.add(st.trim());
        }
      }
    }
  }

  if (pendingOp && typeof pendingOp === 'object' && !pendingOp.error) {
    if (Number.isInteger(pendingOp.repeatableXpDelta) && pendingOp.repeatableXpDelta > 0) {
      stagedRepeatableXp += pendingOp.repeatableXpDelta;
    }
    if (Array.isArray(pendingOp.uniqueClaims)) {
      for (const claim of pendingOp.uniqueClaims) {
        if (claim && Number.isInteger(claim.xpReward) && claim.xpReward > 0) {
          stagedClaimsXp += claim.xpReward;
        }
        if (claim?.claimId?.startsWith('firstClear:')) {
          stagedClearedStagesSet.add(claim.claimId.slice('firstClear:'.length));
        }
      }
    }
    if (pendingOp.campaignProgress?.clearedStages && Array.isArray(pendingOp.campaignProgress.clearedStages)) {
      for (const st of pendingOp.campaignProgress.clearedStages) {
        if (typeof st === 'string' && st.trim()) {
          stagedClearedStagesSet.add(st.trim());
        }
      }
    }
  }

  const totalStagedXp = stagedRepeatableXp + stagedClaimsXp;
  const historicalTotalXp = Math.max(0, (localPlayer?.totalXp || 0) - totalStagedXp);

  const localClears = Array.isArray(localCampaign?.clearedStages)
    ? localCampaign.clearedStages
    : Object.keys(localCampaign?.clearedStages || {});

  const historicalClearedStages = localClears.filter(s => !stagedClearedStagesSet.has(s));

  const historicalStars = { ...(localCampaign?.stageStars || {}) };
  const historicalScores = { ...(localCampaign?.stageScores || {}) };
  for (const st of stagedClearedStagesSet) {
    delete historicalStars[st];
    delete historicalScores[st];
  }

  const historicalPlayer = {
    ...localPlayer,
    totalXp: historicalTotalXp
  };

  const historicalCampaign = {
    ...localCampaign,
    clearedStages: historicalClearedStages,
    stageStars: historicalStars,
    stageScores: historicalScores
  };

  return { historicalPlayer, historicalCampaign };
}

/**
 * Coordinates account bootstrap, migration, and restoration upon auth state resolution.
 *
 * @param {object|null} firebaseUser - Resolved Firebase user object, or null if signed out
 * @param {object} [options]
 * @returns {Promise<{ identity: string, status: string, cloudSyncSuccess: boolean, cloudProgress?: object, error?: any }>}
 */
export async function coordinateAccountProgress(firebaseUser, options = {}) {
  // 1. Resolve canonical identity
  if (!firebaseUser || !firebaseUser.uid) {
    // Guest flow
    const targetIdentity = GUEST_IDENTITY;

    try {
      // Guest may migrate legacy data to scoped guest storage without consuming adoption right
      const legacyInfo = await inspectLegacyStorage();
      if (legacyInfo.hasLegacyData) {
        const migrationStatus = await getMigrationStatus(targetIdentity);
        if (!migrationStatus.isMigrated) {
          await migrateLegacyStorageToIdentity(targetIdentity);
        }
      }
    } catch (err) {
      console.warn('[AccountCoordinator] Guest legacy inspection warning:', err);
    }

    setCloudSyncReady(targetIdentity, false);
    await setActiveIdentity(targetIdentity);
    return {
      identity: targetIdentity,
      status: 'guest_ready',
      cloudSyncSuccess: false
    };
  }

  // Authenticated user flow
  const uid = firebaseUser.uid.trim();
  const targetIdentity = normalizeIdentity(uid);

  // 2. Legacy adoption guardrail
  try {
    const adoptionRecord = await getLegacyAdoptionRecord();
    const decision = canAdoptLegacySave(adoptionRecord, targetIdentity);

    if (decision.allowed) {
      const legacyInfo = await inspectLegacyStorage();
      if (legacyInfo.hasLegacyData) {
        const migrationStatus = await getMigrationStatus(targetIdentity);
        if (!migrationStatus.isMigrated) {
          await migrateLegacyStorageToIdentity(targetIdentity);
        }
        if (!adoptionRecord) {
          await recordLegacyAdoption(targetIdentity);
        }
      }
    } else {
      // Account B cannot adopt legacy data adopted by Account A
      console.log(`[AccountCoordinator] Identity "${targetIdentity}" not eligible to adopt legacy data (adopted by "${decision.adoptedBy}")`);
    }
  } catch (err) {
    console.warn('[AccountCoordinator] Legacy adoption handling error:', err);
  }

  // 3. Load scoped local progress
  const localPlayer = await loadScopedPlayerProgress(targetIdentity);
  const localCampaign = await loadScopedCampaignProgress(targetIdentity);
  const hasLocalProgress = (localPlayer.totalXp > 0) || (Array.isArray(localCampaign.clearedStages) && localCampaign.clearedStages.length > 0);

  // 4. Fetch cloud progress
  let cloudProgress = null;
  let fetchFailed = false;
  let fetchError = null;
  try {
    cloudProgress = await getCloudProgress(uid);
  } catch (err) {
    console.warn(`[AccountCoordinator] Failed to read cloud progress for ${uid}:`, err);
    fetchFailed = true;
    fetchError = err;
  }

  let finalCloudProgress = null;
  let cloudSyncSuccess = false;
  let coordinatorError = fetchError;

  if (fetchFailed) {
    // Cloud read failed (offline/network error). Cannot bootstrap or reconcile.
    cloudSyncSuccess = false;
  } else if (cloudProgress === null) {
    // Cloud is missing: bootstrap cloud from local snapshot
    // Phase 5B.1: derive historical progress if offline gameplay was staged
    const unsynced = await getUnsyncedProgress(targetIdentity);
    const pendingOp = await getPendingSyncOp(targetIdentity);
    const { historicalPlayer, historicalCampaign } = extractHistoricalProgress(localPlayer, localCampaign, unsynced, pendingOp);

    const localSnapshot = buildBootstrapSnapshot(historicalPlayer, historicalCampaign, options);
    try {
      const res = await bootstrapCloudProgress(uid, localSnapshot);
      finalCloudProgress = res.snapshot || localSnapshot;
      cloudSyncSuccess = true;
      await setLastSyncedSnapshot(targetIdentity, finalCloudProgress);
      if (isUnsyncedEmpty(unsynced) && (!pendingOp || pendingOp.error)) {
        await restoreCloudProgressToLocal(targetIdentity, finalCloudProgress);
      }
    } catch (err) {
      console.error(`[AccountCoordinator] Failed to bootstrap cloud progress for ${uid}:`, err);
      coordinatorError = err;
      cloudSyncSuccess = false;
    }
  } else if (!hasLocalProgress) {
    // Cloud exists and local is empty: restore cloud to local
    finalCloudProgress = cloudProgress;
    try {
      await restoreCloudProgressToLocal(targetIdentity, cloudProgress);
      cloudSyncSuccess = true;
      await setLastSyncedSnapshot(targetIdentity, finalCloudProgress);
    } catch (err) {
      console.error(`[AccountCoordinator] Failed to restore cloud progress for ${uid}:`, err);
      coordinatorError = err;
      cloudSyncSuccess = false;
    }
  } else {
    // Both exist: reconcile local with cloud
    const unsynced = await getUnsyncedProgress(targetIdentity);
    const pendingOp = await getPendingSyncOp(targetIdentity);
    const { historicalPlayer, historicalCampaign } = extractHistoricalProgress(localPlayer, localCampaign, unsynced, pendingOp);

    const localSnapshot = buildBootstrapSnapshot(historicalPlayer, historicalCampaign, options);
    try {
      const res = await bootstrapCloudProgress(uid, localSnapshot);
      finalCloudProgress = res.snapshot || cloudProgress;
      cloudSyncSuccess = true;
      await setLastSyncedSnapshot(targetIdentity, finalCloudProgress);
      if (isUnsyncedEmpty(unsynced) && (!pendingOp || pendingOp.error)) {
        await restoreCloudProgressToLocal(targetIdentity, finalCloudProgress);
      }
    } catch (err) {
      console.error(`[AccountCoordinator] Failed to reconcile cloud progress for ${uid}:`, err);
      coordinatorError = err;
      cloudSyncSuccess = false;
    }
  }

  // Update cloudSyncReady state
  setCloudSyncReady(targetIdentity, cloudSyncSuccess);

  // 5. Update active identity pointer (always set so offline local gameplay proceeds)
  await setActiveIdentity(targetIdentity);

  return {
    identity: targetIdentity,
    status: cloudSyncSuccess ? 'authenticated_ready' : 'authenticated_offline',
    cloudSyncSuccess,
    cloudProgress: finalCloudProgress,
    error: coordinatorError || null
  };
}

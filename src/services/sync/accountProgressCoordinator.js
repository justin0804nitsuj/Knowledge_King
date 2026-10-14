import { normalizeIdentity, GUEST_IDENTITY, setActiveIdentity } from '../../storage/storageIdentity';
import {
  inspectLegacyStorage,
  getMigrationStatus,
  migrateLegacyStorageToIdentity
} from '../../storage/legacyStorageMigration';
import {
  getLegacyAdoptionRecord,
  recordLegacyAdoption
} from '../../storage/syncOutboxStorage';
import { canAdoptLegacySave } from '../../domain/sync/syncOperation';
import { buildBootstrapSnapshot } from '../../domain/sync/cloudBootstrap';
import { getCloudProgress, bootstrapCloudProgress } from './cloudProgressService';
import {
  loadScopedPlayerProgress,
  loadScopedCampaignProgress,
  restoreCloudProgressToLocal
} from './cloudRestoreAdapter';

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
 * Coordinates account bootstrap, migration, and restoration upon auth state resolution.
 *
 * @param {object|null} firebaseUser - Resolved Firebase user object, or null if signed out
 * @param {object} [options]
 * @returns {Promise<{ identity: string, status: string, cloudProgress?: object }>}
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

    await setActiveIdentity(targetIdentity);
    return {
      identity: targetIdentity,
      status: 'guest_ready'
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
  try {
    cloudProgress = await getCloudProgress(uid);
  } catch (err) {
    console.warn(`[AccountCoordinator] Failed to read cloud progress for ${uid}:`, err);
  }

  let finalCloudProgress = null;

  if (cloudProgress === null) {
    // Cloud is missing: bootstrap cloud from local snapshot
    const localSnapshot = buildBootstrapSnapshot(localPlayer, localCampaign, options);
    try {
      const res = await bootstrapCloudProgress(uid, localSnapshot);
      finalCloudProgress = res.snapshot || localSnapshot;
    } catch (err) {
      console.error(`[AccountCoordinator] Failed to bootstrap cloud progress for ${uid}:`, err);
      finalCloudProgress = localSnapshot;
    }
    await restoreCloudProgressToLocal(targetIdentity, finalCloudProgress);
  } else if (!hasLocalProgress) {
    // Cloud exists and local is empty: restore cloud to local
    finalCloudProgress = cloudProgress;
    await restoreCloudProgressToLocal(targetIdentity, cloudProgress);
  } else {
    // Both exist: reconcile local with cloud
    const localSnapshot = buildBootstrapSnapshot(localPlayer, localCampaign, options);
    try {
      const res = await bootstrapCloudProgress(uid, localSnapshot);
      finalCloudProgress = res.snapshot || cloudProgress;
    } catch (err) {
      console.error(`[AccountCoordinator] Failed to reconcile cloud progress for ${uid}:`, err);
      finalCloudProgress = cloudProgress;
    }
    await restoreCloudProgressToLocal(targetIdentity, finalCloudProgress);
  }

  // 5. Update active identity pointer
  await setActiveIdentity(targetIdentity);

  return {
    identity: targetIdentity,
    status: 'authenticated_ready',
    cloudProgress: finalCloudProgress
  };
}

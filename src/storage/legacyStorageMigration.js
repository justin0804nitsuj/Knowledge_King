import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeIdentity, getScopedKey } from './storageIdentity';

/**
 * CLOUD PROFILE SYNC V0.1 — NON-DESTRUCTIVE LEGACY MIGRATION ENGINE (PHASE 2)
 * 
 * CORE MIGRATION SAFETY INVARIANTS:
 * 
 * 1. Non-Destructive Copy:
 *    Legacy storage keys are strictly copied, NEVER moved, renamed, or deleted.
 *    Original legacy keys remain permanently untouched as the primary rollback source.
 * 
 * 2. Explicit Destination Identity:
 *    The migration engine does NOT guess or decide ownership.
 *    Destination identity ('guest' or 'uid:<firebaseUid>') MUST be supplied explicitly
 *    by the caller (e.g. Auth integration in future Phase 3/4).
 * 
 * 3. Immutable Backup Provenance:
 *    A dedicated backup key (@KnowledgeKing:migration:v1:backup:<category>) is created
 *    for each legacy item. Once written, backups are NEVER overwritten by retries.
 * 
 * 4. Collision Preservation:
 *    If target scoped data already exists, migration PRESERVES the target data.
 *    It does NOT blindly overwrite or perform destructive replacement.
 * 
 * 5. Idempotent & Crash-Safe:
 *    If migration is interrupted mid-execution, re-running it picks up safely.
 *    Already migrated categories are recognized as 'already_scoped'.
 * 
 * 6. Per-Identity Scoped Completion Marker:
 *    Completion marker (@KnowledgeKing:<identity>:legacyMigrationVersion) is scoped
 *    to the target identity and written ONLY after all categories succeed.
 * 
 * 7. Strict Personal vs Device-Wide Separation:
 *    Only personal data categories are migrated:
 *      - playerProgress
 *      - campaignProgress
 *      - mistakes
 *      - battleHistory
 *    Device-wide data (settings, pvpLoadout, deviceId, activeIdentity) is NEVER migrated.
 */

export const LEGACY_MIGRATION_VERSION = 1;

/**
 * Verified legacy storage keys from pre-sync architecture.
 */
export const LEGACY_STORAGE_KEYS = Object.freeze({
  playerProgress: '@KnowledgeKing:playerProgress',
  campaignProgress: '@KnowledgeKing:campaignProgress',
  mistakes: '@KnowledgeKing:mistakes',
  battleHistory: '@KnowledgeKing:battleHistory'
});

export const LEGACY_BACKUP_PREFIX = '@KnowledgeKing:migration:v1:backup:';

/**
 * Inspects legacy storage without modifying any keys or writing data.
 * 
 * @returns {Promise<{
 *   hasLegacyData: boolean,
 *   categories: Record<string, { exists: boolean, isValidJson: boolean, sizeBytes: number }>
 * }>}
 */
export async function inspectLegacyStorage() {
  const result = {
    hasLegacyData: false,
    categories: {}
  };

  for (const [category, legacyKey] of Object.entries(LEGACY_STORAGE_KEYS)) {
    try {
      const raw = await AsyncStorage.getItem(legacyKey);
      if (raw !== null) {
        let isValidJson = false;
        try {
          JSON.parse(raw);
          isValidJson = true;
        } catch (_) {
          isValidJson = false;
        }
        result.categories[category] = {
          exists: true,
          isValidJson,
          sizeBytes: raw.length
        };
        result.hasLegacyData = true;
      } else {
        result.categories[category] = {
          exists: false,
          isValidJson: false,
          sizeBytes: 0
        };
      }
    } catch (err) {
      console.warn(`[LegacyMigration] Failed to inspect legacy key ${legacyKey}:`, err);
      result.categories[category] = {
        exists: false,
        isValidJson: false,
        sizeBytes: 0,
        error: String(err)
      };
    }
  }

  return result;
}

/**
 * Checks migration completion status for the specified identity.
 * 
 * @param {string|object} identity - Target identity or object containing uid
 * @returns {Promise<{ isMigrated: boolean, version: number }>}
 */
export async function getMigrationStatus(identity) {
  const normalizedIdentity = normalizeIdentity(identity);
  const markerKey = getScopedKey('legacyMigrationVersion', normalizedIdentity);
  try {
    const raw = await AsyncStorage.getItem(markerKey);
    if (!raw) {
      return { isMigrated: false, version: 0 };
    }
    const version = parseInt(raw, 10);
    const isValid = Number.isFinite(version) && version >= 1;
    return {
      isMigrated: isValid,
      version: isValid ? version : 0
    };
  } catch (err) {
    console.warn(`[LegacyMigration] Failed to check status for ${normalizedIdentity}:`, err);
    return { isMigrated: false, version: 0 };
  }
}

/**
 * Retrieves the migration backup for a category, if created.
 * 
 * @param {string} category
 * @returns {Promise<string|null>}
 */
export async function getLegacyBackup(category) {
  if (!LEGACY_STORAGE_KEYS[category]) {
    throw new Error(`[LegacyMigration] Unknown category: ${category}`);
  }
  const backupKey = `${LEGACY_BACKUP_PREFIX}${category}`;
  try {
    return await AsyncStorage.getItem(backupKey);
  } catch (err) {
    console.warn(`[LegacyMigration] Failed to get backup for ${category}:`, err);
    return null;
  }
}

/**
 * Non-destructively copies legacy storage to an explicitly specified identity.
 * 
 * @param {string|object} targetIdentity - Explicit target identity ('guest' or 'uid:<firebaseUid>')
 * @returns {Promise<{
 *   identity: string,
 *   migrationVersion: number,
 *   status: 'completed' | 'already_migrated' | 'no_legacy_data' | 'failed',
 *   categories: Record<string, 'copied' | 'already_scoped' | 'missing' | 'invalid'>,
 *   backupCreated: boolean,
 *   completed: boolean
 * }>}
 */
export async function migrateLegacyStorageToIdentity(targetIdentity) {
  const normalizedIdentity = normalizeIdentity(targetIdentity);

  // Check if identity has already completed migration
  const currentStatus = await getMigrationStatus(normalizedIdentity);
  if (currentStatus.isMigrated && currentStatus.version >= LEGACY_MIGRATION_VERSION) {
    return {
      identity: normalizedIdentity,
      migrationVersion: currentStatus.version,
      status: 'already_migrated',
      categories: {},
      backupCreated: false,
      completed: true
    };
  }

  const categoryResults = {};
  let anyLegacyPresent = false;
  let anyInvalid = false;
  let backupCreated = false;

  for (const [category, legacyKey] of Object.entries(LEGACY_STORAGE_KEYS)) {
    try {
      const raw = await AsyncStorage.getItem(legacyKey);

      if (raw === null) {
        categoryResults[category] = 'missing';
        continue;
      }

      anyLegacyPresent = true;

      // Validate JSON structure
      try {
        JSON.parse(raw);
      } catch (err) {
        console.warn(`[LegacyMigration] Malformed JSON in legacy ${category}:`, err);
        categoryResults[category] = 'invalid';
        anyInvalid = true;
        continue;
      }

      // Rollback-safe backup: create backup only if not already backed up
      const backupKey = `${LEGACY_BACKUP_PREFIX}${category}`;
      const existingBackup = await AsyncStorage.getItem(backupKey);
      if (existingBackup === null) {
        await AsyncStorage.setItem(backupKey, raw);
        backupCreated = true;
      }

      // Target collision policy: check if scoped target already exists
      const targetKey = getScopedKey(category, normalizedIdentity);
      const existingTarget = await AsyncStorage.getItem(targetKey);

      if (existingTarget !== null) {
        // Target already exists: PRESERVE target, do not overwrite
        categoryResults[category] = 'already_scoped';
      } else {
        // Target is empty: safely copy legacy data to scoped target
        await AsyncStorage.setItem(targetKey, raw);
        categoryResults[category] = 'copied';
      }
    } catch (err) {
      console.error(`[LegacyMigration] Error processing category ${category}:`, err);
      categoryResults[category] = 'invalid';
      anyInvalid = true;
    }
  }

  // Determine overall status
  let overallStatus;
  let completed = false;

  if (anyInvalid) {
    overallStatus = 'failed';
    completed = false;
  } else if (!anyLegacyPresent) {
    overallStatus = 'no_legacy_data';
    completed = true;
  } else {
    overallStatus = 'completed';
    completed = true;
  }

  // If all categories succeeded, write per-identity migration marker
  if (completed) {
    const markerKey = getScopedKey('legacyMigrationVersion', normalizedIdentity);
    await AsyncStorage.setItem(markerKey, String(LEGACY_MIGRATION_VERSION));
  }

  return {
    identity: normalizedIdentity,
    migrationVersion: LEGACY_MIGRATION_VERSION,
    status: overallStatus,
    categories: categoryResults,
    backupCreated,
    completed
  };
}

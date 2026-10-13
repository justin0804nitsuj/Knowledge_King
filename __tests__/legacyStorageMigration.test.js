import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  LEGACY_MIGRATION_VERSION,
  LEGACY_STORAGE_KEYS,
  LEGACY_BACKUP_PREFIX,
  inspectLegacyStorage,
  getMigrationStatus,
  getLegacyBackup,
  migrateLegacyStorageToIdentity
} from '../src/storage/legacyStorageMigration';
import {
  getScopedKey,
  getDeviceId,
  _resetCachedDeviceIdForTests,
  DEVICE_ID_KEY,
  ACTIVE_IDENTITY_KEY
} from '../src/storage/storageIdentity';

// In-memory mock storage for AsyncStorage
let mockStore = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key) => mockStore[key] !== undefined ? mockStore[key] : null),
  setItem: jest.fn(async (key, value) => {
    mockStore[key] = String(value);
  }),
  removeItem: jest.fn(async (key) => {
    delete mockStore[key];
  }),
  clear: jest.fn(async () => {
    mockStore = {};
  })
}));

const SAMPLE_PLAYER_PROGRESS = JSON.stringify({
  schemaVersion: 1,
  progression: { totalXp: 1500, level: 4 },
  daily: { lastActiveDate: '2026-10-13' }
});

const SAMPLE_CAMPAIGN_PROGRESS = JSON.stringify({
  schemaVersion: 1,
  clearedStages: { 'L1-S1': true, 'L1-S2': true },
  stageStars: { 'L1-S1': 3, 'L1-S2': 2 }
});

const SAMPLE_MISTAKES = JSON.stringify({
  schemaVersion: 1,
  mistakes: { word_apple: { count: 2 } }
});

const SAMPLE_BATTLE_HISTORY = JSON.stringify({
  schemaVersion: 1,
  history: [{ id: 'B-1', score: 100 }]
});

describe('Legacy Storage Migration Engine (Phase 2)', () => {
  beforeEach(() => {
    mockStore = {};
    jest.clearAllMocks();
    _resetCachedDeviceIdForTests();
  });

  describe('1. inspectLegacyStorage', () => {
    test('reports hasLegacyData: false when storage is empty', async () => {
      const report = await inspectLegacyStorage();
      expect(report.hasLegacyData).toBe(false);
      expect(report.categories.playerProgress.exists).toBe(false);
      expect(report.categories.campaignProgress.exists).toBe(false);
    });

    test('reports existing legacy categories and validates JSON', async () => {
      mockStore[LEGACY_STORAGE_KEYS.playerProgress] = SAMPLE_PLAYER_PROGRESS;
      mockStore[LEGACY_STORAGE_KEYS.campaignProgress] = '{invalid-json';

      const report = await inspectLegacyStorage();
      expect(report.hasLegacyData).toBe(true);
      expect(report.categories.playerProgress.exists).toBe(true);
      expect(report.categories.playerProgress.isValidJson).toBe(true);
      expect(report.categories.campaignProgress.exists).toBe(true);
      expect(report.categories.campaignProgress.isValidJson).toBe(false);
      expect(report.categories.mistakes.exists).toBe(false);
    });
  });

  describe('2. Migration Scenarios', () => {
    test('scenario: no legacy data present returns no_legacy_data and marks completed', async () => {
      const result = await migrateLegacyStorageToIdentity('guest');
      expect(result.status).toBe('no_legacy_data');
      expect(result.completed).toBe(true);
      expect(result.categories.playerProgress).toBe('missing');
      expect(result.categories.campaignProgress).toBe('missing');

      // Marker written so repeated runs skip
      const status = await getMigrationStatus('guest');
      expect(status.isMigrated).toBe(true);
    });

    test('scenario: all 4 legacy categories present copied cleanly to guest', async () => {
      mockStore[LEGACY_STORAGE_KEYS.playerProgress] = SAMPLE_PLAYER_PROGRESS;
      mockStore[LEGACY_STORAGE_KEYS.campaignProgress] = SAMPLE_CAMPAIGN_PROGRESS;
      mockStore[LEGACY_STORAGE_KEYS.mistakes] = SAMPLE_MISTAKES;
      mockStore[LEGACY_STORAGE_KEYS.battleHistory] = SAMPLE_BATTLE_HISTORY;

      const result = await migrateLegacyStorageToIdentity('guest');
      expect(result.status).toBe('completed');
      expect(result.completed).toBe(true);
      expect(result.categories.playerProgress).toBe('copied');
      expect(result.categories.campaignProgress).toBe('copied');
      expect(result.categories.mistakes).toBe('copied');
      expect(result.categories.battleHistory).toBe('copied');
      expect(result.backupCreated).toBe(true);

      // Verify scoped keys populated
      expect(mockStore[getScopedKey('playerProgress', 'guest')]).toBe(SAMPLE_PLAYER_PROGRESS);
      expect(mockStore[getScopedKey('campaignProgress', 'guest')]).toBe(SAMPLE_CAMPAIGN_PROGRESS);
      expect(mockStore[getScopedKey('mistakes', 'guest')]).toBe(SAMPLE_MISTAKES);
      expect(mockStore[getScopedKey('battleHistory', 'guest')]).toBe(SAMPLE_BATTLE_HISTORY);

      // CRITICAL: Verify original legacy sources remain untouched
      expect(mockStore[LEGACY_STORAGE_KEYS.playerProgress]).toBe(SAMPLE_PLAYER_PROGRESS);
      expect(mockStore[LEGACY_STORAGE_KEYS.campaignProgress]).toBe(SAMPLE_CAMPAIGN_PROGRESS);
      expect(mockStore[LEGACY_STORAGE_KEYS.mistakes]).toBe(SAMPLE_MISTAKES);
      expect(mockStore[LEGACY_STORAGE_KEYS.battleHistory]).toBe(SAMPLE_BATTLE_HISTORY);

      // Verify backups created
      expect(await getLegacyBackup('playerProgress')).toBe(SAMPLE_PLAYER_PROGRESS);
      expect(await getLegacyBackup('campaignProgress')).toBe(SAMPLE_CAMPAIGN_PROGRESS);
    });

    test('scenario: only playerProgress present (partial data)', async () => {
      mockStore[LEGACY_STORAGE_KEYS.playerProgress] = SAMPLE_PLAYER_PROGRESS;

      const result = await migrateLegacyStorageToIdentity('guest');
      expect(result.status).toBe('completed');
      expect(result.completed).toBe(true);
      expect(result.categories.playerProgress).toBe('copied');
      expect(result.categories.campaignProgress).toBe('missing');
      expect(result.categories.mistakes).toBe('missing');
      expect(result.categories.battleHistory).toBe('missing');

      expect(mockStore[getScopedKey('playerProgress', 'guest')]).toBe(SAMPLE_PLAYER_PROGRESS);
      expect(mockStore[getScopedKey('campaignProgress', 'guest')]).toBeUndefined();
    });

    test('scenario: migrate to explicit uid:user_A', async () => {
      mockStore[LEGACY_STORAGE_KEYS.playerProgress] = SAMPLE_PLAYER_PROGRESS;

      const result = await migrateLegacyStorageToIdentity('uid:user_A');
      expect(result.identity).toBe('uid:user_A');
      expect(result.status).toBe('completed');
      expect(mockStore[getScopedKey('playerProgress', 'uid:user_A')]).toBe(SAMPLE_PLAYER_PROGRESS);

      // Guest scoped key is empty
      expect(mockStore[getScopedKey('playerProgress', 'guest')]).toBeUndefined();
    });

    test('scenario: uid:A and uid:B isolation', async () => {
      mockStore[LEGACY_STORAGE_KEYS.playerProgress] = SAMPLE_PLAYER_PROGRESS;

      await migrateLegacyStorageToIdentity('uid:user_A');

      const userAProgress = mockStore[getScopedKey('playerProgress', 'uid:user_A')];
      const userBProgress = mockStore[getScopedKey('playerProgress', 'uid:user_B')];

      expect(userAProgress).toBe(SAMPLE_PLAYER_PROGRESS);
      expect(userBProgress).toBeUndefined();
    });

    test('collision policy: target already exists -> preserved, never overwritten', async () => {
      mockStore[LEGACY_STORAGE_KEYS.playerProgress] = SAMPLE_PLAYER_PROGRESS; // Level 4
      const NEWER_SCOPED_PROGRESS = JSON.stringify({
        schemaVersion: 1,
        progression: { totalXp: 9999, level: 10 }
      });
      // Target already has newer data
      mockStore[getScopedKey('playerProgress', 'uid:user_A')] = NEWER_SCOPED_PROGRESS;

      const result = await migrateLegacyStorageToIdentity('uid:user_A');
      expect(result.status).toBe('completed');
      expect(result.categories.playerProgress).toBe('already_scoped');

      // Target must NOT have been overwritten by legacy data!
      expect(mockStore[getScopedKey('playerProgress', 'uid:user_A')]).toBe(NEWER_SCOPED_PROGRESS);
    });

    test('legacy source remains untouched and is NEVER deleted or mutated', async () => {
      mockStore[LEGACY_STORAGE_KEYS.playerProgress] = SAMPLE_PLAYER_PROGRESS;
      mockStore[LEGACY_STORAGE_KEYS.campaignProgress] = SAMPLE_CAMPAIGN_PROGRESS;

      await migrateLegacyStorageToIdentity('uid:user_A');

      expect(mockStore[LEGACY_STORAGE_KEYS.playerProgress]).toBe(SAMPLE_PLAYER_PROGRESS);
      expect(mockStore[LEGACY_STORAGE_KEYS.campaignProgress]).toBe(SAMPLE_CAMPAIGN_PROGRESS);
      expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    });
  });

  describe('3. Idempotency & Crash Recovery', () => {
    test('retry after partial failure picks up remaining categories without re-copying valid target', async () => {
      mockStore[LEGACY_STORAGE_KEYS.playerProgress] = SAMPLE_PLAYER_PROGRESS;
      mockStore[LEGACY_STORAGE_KEYS.campaignProgress] = SAMPLE_CAMPAIGN_PROGRESS;

      // Simulate first partial run where playerProgress was copied, but campaignProgress wasn't
      mockStore[getScopedKey('playerProgress', 'guest')] = SAMPLE_PLAYER_PROGRESS;
      // Do NOT set migration marker to simulate mid-process crash

      // Second run:
      const result = await migrateLegacyStorageToIdentity('guest');
      expect(result.status).toBe('completed');
      expect(result.completed).toBe(true);
      expect(result.categories.playerProgress).toBe('already_scoped'); // Preserved!
      expect(result.categories.campaignProgress).toBe('copied'); // Completed!
      expect(mockStore[getScopedKey('campaignProgress', 'guest')]).toBe(SAMPLE_CAMPAIGN_PROGRESS);
    });

    test('repeated migration is idempotent (returns already_migrated)', async () => {
      mockStore[LEGACY_STORAGE_KEYS.playerProgress] = SAMPLE_PLAYER_PROGRESS;

      const first = await migrateLegacyStorageToIdentity('uid:user_A');
      expect(first.status).toBe('completed');

      const second = await migrateLegacyStorageToIdentity('uid:user_A');
      expect(second.status).toBe('already_migrated');
      expect(second.completed).toBe(true);
    });

    test('does not overwrite existing backup on repeated attempts', async () => {
      mockStore[LEGACY_STORAGE_KEYS.playerProgress] = SAMPLE_PLAYER_PROGRESS;
      const backupKey = `${LEGACY_BACKUP_PREFIX}playerProgress`;
      const ORIGINAL_BACKUP = JSON.stringify({ original: true });
      mockStore[backupKey] = ORIGINAL_BACKUP;

      await migrateLegacyStorageToIdentity('guest');

      // The pre-existing backup must remain preserved
      expect(mockStore[backupKey]).toBe(ORIGINAL_BACKUP);
    });
  });

  describe('4. Malformed Data Handling', () => {
    test('malformed JSON does not crash, reports invalid, does not write corrupt data, and does not set marker', async () => {
      mockStore[LEGACY_STORAGE_KEYS.playerProgress] = '{corrupted-json-not-valid';

      const result = await migrateLegacyStorageToIdentity('guest');
      expect(result.status).toBe('failed');
      expect(result.completed).toBe(false);
      expect(result.categories.playerProgress).toBe('invalid');

      // Target must NOT be written with garbage
      expect(mockStore[getScopedKey('playerProgress', 'guest')]).toBeUndefined();

      // Marker must NOT be written
      const status = await getMigrationStatus('guest');
      expect(status.isMigrated).toBe(false);

      // Legacy source must NOT be deleted
      expect(mockStore[LEGACY_STORAGE_KEYS.playerProgress]).toBe('{corrupted-json-not-valid');
    });

    test('malformed category does not destroy other valid categories', async () => {
      mockStore[LEGACY_STORAGE_KEYS.playerProgress] = SAMPLE_PLAYER_PROGRESS; // Valid
      mockStore[LEGACY_STORAGE_KEYS.campaignProgress] = '{corrupted-json'; // Invalid

      const result = await migrateLegacyStorageToIdentity('guest');
      expect(result.status).toBe('failed');
      expect(result.completed).toBe(false);
      expect(result.categories.playerProgress).toBe('copied');
      expect(result.categories.campaignProgress).toBe('invalid');

      // Valid playerProgress was safely copied
      expect(mockStore[getScopedKey('playerProgress', 'guest')]).toBe(SAMPLE_PLAYER_PROGRESS);
      // Campaign progress was safely prevented from corrupting target
      expect(mockStore[getScopedKey('campaignProgress', 'guest')]).toBeUndefined();
    });
  });

  describe('5. Per-Identity Markers & Device-Wide Data Isolation', () => {
    test('migration marker is scoped per identity', async () => {
      mockStore[LEGACY_STORAGE_KEYS.playerProgress] = SAMPLE_PLAYER_PROGRESS;

      await migrateLegacyStorageToIdentity('uid:user_A');

      const statusA = await getMigrationStatus('uid:user_A');
      const statusB = await getMigrationStatus('uid:user_B');
      const statusGuest = await getMigrationStatus('guest');

      expect(statusA.isMigrated).toBe(true);
      expect(statusA.version).toBe(LEGACY_MIGRATION_VERSION);
      expect(statusB.isMigrated).toBe(false);
      expect(statusGuest.isMigrated).toBe(false);
    });

    test('deviceId remains untouched and unchanged by migration', async () => {
      const initialDeviceId = await getDeviceId();

      mockStore[LEGACY_STORAGE_KEYS.playerProgress] = SAMPLE_PLAYER_PROGRESS;
      await migrateLegacyStorageToIdentity('uid:user_A');

      const afterDeviceId = await getDeviceId();
      expect(afterDeviceId).toBe(initialDeviceId);
      expect(mockStore[DEVICE_ID_KEY]).toBe(initialDeviceId);
    });

    test('settings and PvP loadout remain untouched', async () => {
      mockStore['gsat_settings'] = JSON.stringify({ soundEffects: false, language: 'zh-TW' });
      mockStore['@knowledge_king:pvp_loadout'] = JSON.stringify({ HEAL: 2, SHIELD: 1, POWER: 1 });

      mockStore[LEGACY_STORAGE_KEYS.playerProgress] = SAMPLE_PLAYER_PROGRESS;
      await migrateLegacyStorageToIdentity('guest');

      expect(mockStore['gsat_settings']).toBe(JSON.stringify({ soundEffects: false, language: 'zh-TW' }));
      expect(mockStore['@knowledge_king:pvp_loadout']).toBe(JSON.stringify({ HEAL: 2, SHIELD: 1, POWER: 1 }));
    });
  });
});

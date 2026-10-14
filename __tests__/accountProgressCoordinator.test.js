import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  coordinateAccountProgress
} from '../src/services/sync/accountProgressCoordinator';
import {
  getActiveIdentity,
  getScopedKey
} from '../src/storage/storageIdentity';
import {
  LEGACY_STORAGE_KEYS
} from '../src/storage/legacyStorageMigration';
import {
  LEGACY_ADOPTION_KEY
} from '../src/storage/syncOutboxStorage';

let mockStore = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key) => mockStore[key] !== undefined ? mockStore[key] : null),
  setItem: jest.fn(async (key, value) => {
    mockStore[key] = String(value);
  }),
  multiSet: jest.fn(async (keyValuePairs) => {
    for (const [key, value] of keyValuePairs) {
      mockStore[key] = String(value);
    }
  }),
  removeItem: jest.fn(async (key) => {
    delete mockStore[key];
  }),
  clear: jest.fn(async () => {
    mockStore = {};
  })
}));

let mockCloudDb = {};

jest.mock('../src/services/sync/cloudProgressService', () => {
  const { reconcileLegacyWithCloud } = require('../src/domain/sync/cloudBootstrap');
  return {
    getCloudProgress: jest.fn(async (uid) => {
      return mockCloudDb[uid] ? JSON.parse(JSON.stringify(mockCloudDb[uid])) : null;
    }),
    bootstrapCloudProgress: jest.fn(async (uid, localSnapshot) => {
      const current = mockCloudDb[uid] || null;
      if (current === null) {
        mockCloudDb[uid] = {
          ...localSnapshot,
          schemaVersion: 1,
          revision: Math.max(1, localSnapshot?.revision || 1),
          updatedAt: Date.now()
        };
      } else {
        mockCloudDb[uid] = reconcileLegacyWithCloud(localSnapshot, current);
      }
      return {
        committed: true,
        snapshot: JSON.parse(JSON.stringify(mockCloudDb[uid]))
      };
    })
  };
});

describe('accountProgressCoordinator (Phase 5A)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockCloudDb = {};
    jest.clearAllMocks();
  });

  describe('Identity selection upon auth resolution', () => {
    test('signed-out resolved chooses guest', async () => {
      const result = await coordinateAccountProgress(null);
      expect(result.identity).toBe('guest');
      expect(result.status).toBe('guest_ready');

      const active = await getActiveIdentity();
      expect(active).toBe('guest');
    });

    test('Account A chooses uid:A', async () => {
      const result = await coordinateAccountProgress({ uid: 'AccountA' });
      expect(result.identity).toBe('uid:AccountA');
      expect(result.status).toBe('authenticated_ready');

      const active = await getActiveIdentity();
      expect(active).toBe('uid:AccountA');
    });
  });

  describe('Cloud bootstrap & reconciliation', () => {
    test('exact XP bootstrap & claim markers seeded without adding reward XP', async () => {
      // Seed local scoped progress for UserA
      const playerKey = getScopedKey('playerProgress', 'uid:UserA');
      const campaignKey = getScopedKey('campaignProgress', 'uid:UserA');

      await AsyncStorage.setItem(playerKey, JSON.stringify({
        schemaVersion: 1,
        totalXp: 750,
        stats: { bestCombo: 6 },
        daily: {
          lastActiveDate: '2026-10-14',
          missions: {
            m1: { progress: 20, claimed: true }
          }
        }
      }));

      await AsyncStorage.setItem(campaignKey, JSON.stringify({
        schemaVersion: 1,
        clearedStages: ['L1-S1'],
        stageStars: { 'L1-S1': 3 },
        stageScores: { 'L1-S1': 900 },
        bestCombo: 6
      }));

      const res = await coordinateAccountProgress({ uid: 'UserA' });

      expect(res.cloudProgress.progression.totalXp).toBe(750);
      expect(res.cloudProgress.uniqueClaims['firstClear:L1-S1']).toBeDefined();
      expect(res.cloudProgress.uniqueClaims['daily:2026-10-14:m1']).toBeDefined();
      expect(mockCloudDb['UserA'].progression.totalXp).toBe(750);
    });

    test('repeated bootstrap is idempotent', async () => {
      const playerKey = getScopedKey('playerProgress', 'uid:UserA');
      await AsyncStorage.setItem(playerKey, JSON.stringify({
        schemaVersion: 1,
        totalXp: 500
      }));

      const res1 = await coordinateAccountProgress({ uid: 'UserA' });
      const rev1 = res1.cloudProgress.revision;

      const res2 = await coordinateAccountProgress({ uid: 'UserA' });
      const rev2 = res2.cloudProgress.revision;

      expect(rev1).toBe(rev2);
      expect(res1.cloudProgress.progression.totalXp).toBe(500);
      expect(res2.cloudProgress.progression.totalXp).toBe(500);
    });

    test('existing cloud + empty local restores cloud to local', async () => {
      // Pre-seed cloud with 2500 XP
      mockCloudDb['UserA'] = {
        schemaVersion: 1,
        revision: 2,
        updatedAt: 1000,
        appliedOps: {},
        progression: { totalXp: 2500 },
        campaign: {
          clearedStages: { 'L1-S1': true, 'L1-S2': true },
          stageStars: { 'L1-S1': 3, 'L1-S2': 3 },
          stageScores: { 'L1-S1': 1000, 'L1-S2': 980 },
          bestCombo: 15
        },
        uniqueClaims: {
          'firstClear:L1-S1': { claimedAt: 1000, deviceId: 'dev' }
        }
      };

      // Empty local storage
      const res = await coordinateAccountProgress({ uid: 'UserA' });
      expect(res.cloudProgress.progression.totalXp).toBe(2500);

      // Verify local storage was restored with cloud data
      const playerKey = getScopedKey('playerProgress', 'uid:UserA');
      const localPlayer = JSON.parse(await AsyncStorage.getItem(playerKey));
      expect(localPlayer.totalXp).toBe(2500);

      const campaignKey = getScopedKey('campaignProgress', 'uid:UserA');
      const localCampaign = JSON.parse(await AsyncStorage.getItem(campaignKey));
      expect(localCampaign.clearedStages).toEqual(['L1-S1', 'L1-S2']);
    });

    test('existing cloud + legacy local uses max/union', async () => {
      mockCloudDb['UserA'] = {
        schemaVersion: 1,
        revision: 1,
        updatedAt: 1000,
        appliedOps: {},
        progression: { totalXp: 1000 },
        campaign: {
          clearedStages: { 'L1-S1': true },
          stageStars: { 'L1-S1': 2 },
          stageScores: { 'L1-S1': 500 },
          bestCombo: 5
        },
        uniqueClaims: {}
      };

      // Local has higher XP and additional clear
      const playerKey = getScopedKey('playerProgress', 'uid:UserA');
      const campaignKey = getScopedKey('campaignProgress', 'uid:UserA');

      await AsyncStorage.setItem(playerKey, JSON.stringify({
        schemaVersion: 1,
        totalXp: 1400,
        stats: { bestCombo: 8 }
      }));
      await AsyncStorage.setItem(campaignKey, JSON.stringify({
        schemaVersion: 1,
        clearedStages: ['L1-S1', 'L1-S2'],
        stageStars: { 'L1-S1': 3, 'L1-S2': 2 },
        stageScores: { 'L1-S1': 800, 'L1-S2': 600 },
        bestCombo: 8
      }));

      const res = await coordinateAccountProgress({ uid: 'UserA' });

      // totalXp = max(1000, 1400) = 1400 (NOT sum 2400)
      expect(res.cloudProgress.progression.totalXp).toBe(1400);
      expect(res.cloudProgress.campaign.clearedStages).toEqual({
        'L1-S1': true,
        'L1-S2': true
      });
      expect(res.cloudProgress.campaign.stageStars['L1-S1']).toBe(3);
    });
  });

  describe('Legacy adoption guardrail & account isolation', () => {
    test('A adopts legacy; B cannot adopt same legacy; A/B namespace isolation', async () => {
      // 1. Create legacy data in pre-sync storage keys
      await AsyncStorage.setItem(LEGACY_STORAGE_KEYS.playerProgress, JSON.stringify({
        schemaVersion: 1,
        totalXp: 999,
        stats: { battlesWon: 10 }
      }));
      await AsyncStorage.setItem(LEGACY_STORAGE_KEYS.campaignProgress, JSON.stringify({
        schemaVersion: 1,
        clearedStages: ['L1-S1'],
        stageStars: { 'L1-S1': 3 },
        stageScores: { 'L1-S1': 850 }
      }));

      // 2. Account A signs in
      await coordinateAccountProgress({ uid: 'AccountA' });

      // Account A adopted legacy
      const adoptionRecord = JSON.parse(await AsyncStorage.getItem(LEGACY_ADOPTION_KEY));
      expect(adoptionRecord.adoptedBy).toBe('uid:AccountA');

      // Account A scoped storage has legacy progress
      const aPlayerKey = getScopedKey('playerProgress', 'uid:AccountA');
      const aPlayer = JSON.parse(await AsyncStorage.getItem(aPlayerKey));
      expect(aPlayer.totalXp).toBe(999);

      // Legacy keys are NOT deleted
      expect(await AsyncStorage.getItem(LEGACY_STORAGE_KEYS.playerProgress)).not.toBeNull();

      // 3. Account A signs out -> guest
      await coordinateAccountProgress(null);
      expect(await getActiveIdentity()).toBe('guest');

      // 4. Account B signs in
      await coordinateAccountProgress({ uid: 'AccountB' });
      expect(await getActiveIdentity()).toBe('uid:AccountB');

      // Account B MUST NOT receive Account A's legacy progress
      const bPlayerKey = getScopedKey('playerProgress', 'uid:AccountB');
      const bPlayer = JSON.parse(await AsyncStorage.getItem(bPlayerKey));
      expect(bPlayer.totalXp).toBe(0); // virgin default, not 999!

      const bCampaignKey = getScopedKey('campaignProgress', 'uid:AccountB');
      const bCampaign = JSON.parse(await AsyncStorage.getItem(bCampaignKey));
      expect(bCampaign.clearedStages).toEqual([]);

      // 5. Account B signs out -> guest
      await coordinateAccountProgress(null);

      // 6. Account A signs in again -> restores Account A's data
      await coordinateAccountProgress({ uid: 'AccountA' });
      expect(await getActiveIdentity()).toBe('uid:AccountA');

      const aPlayerAgain = JSON.parse(await AsyncStorage.getItem(aPlayerKey));
      expect(aPlayerAgain.totalXp).toBe(999);
    });

    test('guest use does NOT permanently consume legacy adoption right', async () => {
      // 1. Create legacy data
      await AsyncStorage.setItem(LEGACY_STORAGE_KEYS.playerProgress, JSON.stringify({
        schemaVersion: 1,
        totalXp: 1200
      }));

      // 2. Guest signs in / initializes
      await coordinateAccountProgress(null);

      // Legacy adoption right was NOT consumed
      const record = await AsyncStorage.getItem(LEGACY_ADOPTION_KEY);
      expect(record).toBeNull();

      // 3. Account A signs in later -> is allowed to adopt legacy save
      await coordinateAccountProgress({ uid: 'AccountA' });

      const adoptedRecord = JSON.parse(await AsyncStorage.getItem(LEGACY_ADOPTION_KEY));
      expect(adoptedRecord.adoptedBy).toBe('uid:AccountA');

      const aPlayerKey = getScopedKey('playerProgress', 'uid:AccountA');
      const aPlayer = JSON.parse(await AsyncStorage.getItem(aPlayerKey));
      expect(aPlayer.totalXp).toBe(1200);
    });
  });

  describe('Non-cloud data preservation across restore', () => {
    test('restore does not overwrite mistakes, history, settings, or PvP loadout', async () => {
      const identity = 'uid:UserX';

      const mistakesKey = getScopedKey('mistakes', identity);
      const historyKey = getScopedKey('battleHistory', identity);
      const settingsKey = '@KnowledgeKing:settings';
      const pvpKey = '@KnowledgeKing:pvpLoadout';

      await AsyncStorage.setItem(mistakesKey, JSON.stringify([{ word: 'preservation', count: 1 }]));
      await AsyncStorage.setItem(historyKey, JSON.stringify([{ id: 'h1', won: true }]));
      await AsyncStorage.setItem(settingsKey, JSON.stringify({ sfx: false }));
      await AsyncStorage.setItem(pvpKey, JSON.stringify({ cards: [1, 2, 3, 4] }));

      // Pre-seed cloud
      mockCloudDb['UserX'] = {
        schemaVersion: 1,
        revision: 1,
        updatedAt: 1000,
        appliedOps: {},
        progression: { totalXp: 5500 },
        campaign: { clearedStages: {}, stageStars: {}, stageScores: {}, bestCombo: 0 },
        uniqueClaims: {}
      };

      await coordinateAccountProgress({ uid: 'UserX' });

      expect(JSON.parse(await AsyncStorage.getItem(mistakesKey))).toEqual([{ word: 'preservation', count: 1 }]);
      expect(JSON.parse(await AsyncStorage.getItem(historyKey))).toEqual([{ id: 'h1', won: true }]);
      expect(JSON.parse(await AsyncStorage.getItem(settingsKey))).toEqual({ sfx: false });
      expect(JSON.parse(await AsyncStorage.getItem(pvpKey))).toEqual({ cards: [1, 2, 3, 4] });
    });
  });
});

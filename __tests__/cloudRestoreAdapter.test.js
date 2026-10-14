import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  applyCloudToLocalProgress,
  restoreCloudProgressToLocal,
  loadScopedPlayerProgress,
  loadScopedCampaignProgress
} from '../src/services/sync/cloudRestoreAdapter';
import { getScopedKey } from '../src/storage/storageIdentity';

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

describe('cloudRestoreAdapter (Phase 5A)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  describe('applyCloudToLocalProgress (pure)', () => {
    test('restores cloud-owned fields into local structures', () => {
      const cloud = {
        progression: { totalXp: 3200 },
        campaign: {
          clearedStages: { 'L1-S1': true, 'L1-S2': true },
          stageStars: { 'L1-S1': 3, 'L1-S2': 2 },
          stageScores: { 'L1-S1': 950, 'L1-S2': 880 },
          bestCombo: 14
        }
      };

      const localPlayer = {
        totalXp: 500,
        stats: { bestCombo: 5, battlesWon: 12 },
        processedEvents: ['evt-1', 'evt-2'],
        daily: { lastActiveDate: '2026-10-14', streak: 4, missions: {} }
      };

      const localCampaign = {
        clearedStages: ['L1-S1'],
        stageStars: { 'L1-S1': 1 },
        stageScores: { 'L1-S1': 400 },
        bestCombo: 5
      };

      const { playerProgress, campaignProgress } = applyCloudToLocalProgress(cloud, localPlayer, localCampaign);

      // Cloud owned fields restored
      expect(playerProgress.totalXp).toBe(3200);
      expect(playerProgress.stats.bestCombo).toBe(14);
      expect(campaignProgress.clearedStages).toEqual(['L1-S1', 'L1-S2']);
      expect(campaignProgress.stageStars).toEqual({ 'L1-S1': 3, 'L1-S2': 2 });
      expect(campaignProgress.stageScores).toEqual({ 'L1-S1': 950, 'L1-S2': 880 });
      expect(campaignProgress.bestCombo).toBe(14);
    });

    test('does NOT store level separately in playerProgress', () => {
      const cloud = {
        progression: { totalXp: 5000 },
        campaign: {}
      };

      const localPlayer = {
        totalXp: 100,
        level: 5 // legacy field if present
      };

      const { playerProgress } = applyCloudToLocalProgress(cloud, localPlayer);
      expect(playerProgress.level).toBeUndefined();
    });

    test('preserves processedEvents, daily trackers, and local stats', () => {
      const cloud = {
        progression: { totalXp: 1000 },
        campaign: { bestCombo: 8 }
      };

      const localPlayer = {
        totalXp: 200,
        processedEvents: ['evt-abc', 'evt-xyz'],
        stats: {
          battlesPlayed: 25,
          battlesWon: 20,
          battlesLost: 5,
          bestCombo: 6
        },
        daily: {
          lastActiveDate: '2026-10-14',
          streak: 7,
          missions: {
            m1: { progress: 15, claimed: true }
          }
        }
      };

      const { playerProgress } = applyCloudToLocalProgress(cloud, localPlayer);

      expect(playerProgress.processedEvents).toEqual(['evt-abc', 'evt-xyz']);
      expect(playerProgress.stats.battlesPlayed).toBe(25);
      expect(playerProgress.stats.battlesWon).toBe(20);
      expect(playerProgress.stats.bestCombo).toBe(8); // high-water bestCombo
      expect(playerProgress.daily.streak).toBe(7);
      expect(playerProgress.daily.missions.m1.claimed).toBe(true);
    });
  });

  describe('restoreCloudProgressToLocal (storage persistence)', () => {
    test('does NOT overwrite mistakes, battleHistory, settings, or pvpLoadout', async () => {
      const identity = 'uid:player123';

      // Pre-seed unrelated local storage keys
      const mistakesKey = getScopedKey('mistakes', identity);
      const historyKey = getScopedKey('battleHistory', identity);
      const settingsKey = '@KnowledgeKing:settings';
      const pvpLoadoutKey = '@KnowledgeKing:pvpLoadout';

      await AsyncStorage.setItem(mistakesKey, JSON.stringify([{ word: 'test', errorCount: 2 }]));
      await AsyncStorage.setItem(historyKey, JSON.stringify([{ battleId: 'b1', outcome: 'win' }]));
      await AsyncStorage.setItem(settingsKey, JSON.stringify({ sound: false, music: false }));
      await AsyncStorage.setItem(pvpLoadoutKey, JSON.stringify({ deck: ['card1', 'card2'] }));

      const cloud = {
        schemaVersion: 1,
        revision: 1,
        progression: { totalXp: 4000 },
        campaign: {
          clearedStages: { 'L1-S1': true },
          stageStars: { 'L1-S1': 3 },
          stageScores: { 'L1-S1': 1000 },
          bestCombo: 12
        }
      };

      await restoreCloudProgressToLocal(identity, cloud);

      // Verify cloud progress restored to scoped storage
      const restoredPlayer = await loadScopedPlayerProgress(identity);
      expect(restoredPlayer.totalXp).toBe(4000);

      const restoredCampaign = await loadScopedCampaignProgress(identity);
      expect(restoredCampaign.clearedStages).toEqual(['L1-S1']);

      // Verify baseline lastSyncedSnapshot is persisted
      const snapshotKey = getScopedKey('lastSyncedSnapshot', identity);
      const savedSnapshot = JSON.parse(await AsyncStorage.getItem(snapshotKey));
      expect(savedSnapshot.progression.totalXp).toBe(4000);

      // Verify unrelated data remains completely intact and untouched
      expect(JSON.parse(await AsyncStorage.getItem(mistakesKey))).toEqual([{ word: 'test', errorCount: 2 }]);
      expect(JSON.parse(await AsyncStorage.getItem(historyKey))).toEqual([{ battleId: 'b1', outcome: 'win' }]);
      expect(JSON.parse(await AsyncStorage.getItem(settingsKey))).toEqual({ sound: false, music: false });
      expect(JSON.parse(await AsyncStorage.getItem(pvpLoadoutKey))).toEqual({ deck: ['card1', 'card2'] });
    });
  });
});

import {
  buildBootstrapSnapshot,
  reconcileLegacyWithCloud,
  normalizeClearedStagesMap
} from '../src/domain/sync/cloudBootstrap';

describe('cloudBootstrap domain (Phase 5A)', () => {
  describe('buildBootstrapSnapshot', () => {
    test('exact XP bootstrap: preserves local totalXp without recalculating or adding XP', () => {
      const localPlayer = {
        totalXp: 1250,
        stats: { bestCombo: 8 },
        daily: { lastActiveDate: '2026-10-14', missions: {} }
      };
      const localCampaign = {
        clearedStages: ['L1-S1', 'L1-S2'],
        stageStars: { 'L1-S1': 3, 'L1-S2': 2 },
        stageScores: { 'L1-S1': 950, 'L1-S2': 800 },
        bestCombo: 10
      };

      const snapshot = buildBootstrapSnapshot(localPlayer, localCampaign);

      expect(snapshot.progression.totalXp).toBe(1250);
      expect(snapshot.schemaVersion).toBe(1);
      expect(snapshot.campaign.clearedStages).toEqual({
        'L1-S1': true,
        'L1-S2': true
      });
      expect(snapshot.campaign.stageStars).toEqual({
        'L1-S1': 3,
        'L1-S2': 2
      });
      expect(snapshot.campaign.stageScores).toEqual({
        'L1-S1': 950,
        'L1-S2': 800
      });
      expect(snapshot.campaign.bestCombo).toBe(10);
    });

    test('first-clear claims seeded without adding XP', () => {
      const localPlayer = { totalXp: 300 };
      const localCampaign = {
        clearedStages: ['L1-S1', 'L1-S2'],
        stageStars: { 'L1-S1': 3, 'L1-S2': 1 }
      };

      const snapshot = buildBootstrapSnapshot(localPlayer, localCampaign, { deviceId: 'test-device' });

      // totalXp remains exactly local totalXp
      expect(snapshot.progression.totalXp).toBe(300);

      // first-clear claim markers are present
      expect(snapshot.uniqueClaims['firstClear:L1-S1']).toBeDefined();
      expect(snapshot.uniqueClaims['firstClear:L1-S1'].deviceId).toBe('test-device');
      expect(snapshot.uniqueClaims['firstClear:L1-S2']).toBeDefined();
      expect(snapshot.uniqueClaims['firstClear:L1-S2'].deviceId).toBe('test-device');
    });

    test('today\'s daily claims seeded without adding XP', () => {
      const localPlayer = {
        totalXp: 500,
        daily: {
          lastActiveDate: '2026-10-14',
          missions: {
            m1: { progress: 20, claimed: true },
            m2: { progress: 1, claimed: false },
            m3: { progress: 1, claimed: true }
          }
        }
      };
      const localCampaign = { clearedStages: [] };

      const snapshot = buildBootstrapSnapshot(localPlayer, localCampaign);

      expect(snapshot.progression.totalXp).toBe(500);
      expect(snapshot.uniqueClaims['daily:2026-10-14:m1']).toBeDefined();
      expect(snapshot.uniqueClaims['daily:2026-10-14:m2']).toBeUndefined();
      expect(snapshot.uniqueClaims['daily:2026-10-14:m3']).toBeDefined();
    });

    test('no historical daily claims fabricated', () => {
      const localPlayer = {
        totalXp: 800,
        daily: {
          lastActiveDate: '2026-10-14',
          streak: 5,
          missions: {
            m1: { progress: 20, claimed: true }
          }
        }
      };

      const snapshot = buildBootstrapSnapshot(localPlayer, {});

      const claimKeys = Object.keys(snapshot.uniqueClaims);
      // Only today's m1 should exist, NO historical dates like 2026-10-13, 2026-10-12
      expect(claimKeys).toEqual(['daily:2026-10-14:m1']);
    });

    test('handles clearedStages as map or array', () => {
      const mapCleared = normalizeClearedStagesMap({ 'L1-S1': true, 'L1-S2': false });
      expect(mapCleared).toEqual({ 'L1-S1': true });

      const arrCleared = normalizeClearedStagesMap(['L1-S1', 'L1-S3']);
      expect(arrCleared).toEqual({ 'L1-S1': true, 'L1-S3': true });
    });
  });

  describe('reconcileLegacyWithCloud', () => {
    test('existing cloud + empty local restores cloud', () => {
      const cloud = {
        schemaVersion: 1,
        revision: 3,
        updatedAt: 1000,
        appliedOps: { 'dev-1': 5 },
        progression: { totalXp: 2000 },
        campaign: {
          clearedStages: { 'L1-S1': true, 'L1-S2': true },
          stageStars: { 'L1-S1': 3, 'L1-S2': 2 },
          stageScores: { 'L1-S1': 1000, 'L1-S2': 850 },
          bestCombo: 12
        },
        uniqueClaims: {
          'firstClear:L1-S1': { claimedAt: 1000, deviceId: 'dev-1' },
          'firstClear:L1-S2': { claimedAt: 1000, deviceId: 'dev-1' }
        }
      };

      const emptyLocal = {
        totalXp: 0,
        clearedStages: [],
        stageStars: {},
        stageScores: {},
        bestCombo: 0
      };

      const reconciled = reconcileLegacyWithCloud(emptyLocal, cloud);

      // Should be completely identical to cloud
      expect(reconciled).toBe(cloud);
      expect(reconciled.progression.totalXp).toBe(2000);
      expect(reconciled.revision).toBe(3);
    });

    test('existing cloud + legacy local uses max/union', () => {
      const cloud = {
        schemaVersion: 1,
        revision: 2,
        updatedAt: 1000,
        appliedOps: { 'dev-cloud': 3 },
        progression: { totalXp: 1500 },
        campaign: {
          clearedStages: { 'L1-S1': true },
          stageStars: { 'L1-S1': 2 },
          stageScores: { 'L1-S1': 700 },
          bestCombo: 5
        },
        uniqueClaims: {
          'firstClear:L1-S1': { claimedAt: 1000, deviceId: 'dev-cloud' }
        }
      };

      const legacyLocal = {
        totalXp: 1800, // higher than cloud
        clearedStages: ['L1-S1', 'L1-S2'], // L1-S2 is new
        stageStars: { 'L1-S1': 3, 'L1-S2': 2 }, // L1-S1 stars higher
        stageScores: { 'L1-S1': 900, 'L1-S2': 600 },
        bestCombo: 9
      };

      const reconciled = reconcileLegacyWithCloud(legacyLocal, cloud);

      // totalXp = max(1500, 1800) = 1800 (NEVER sum: 1500 + 1800 = 3300 is forbidden)
      expect(reconciled.progression.totalXp).toBe(1800);

      // Cleared stages union
      expect(reconciled.campaign.clearedStages).toEqual({
        'L1-S1': true,
        'L1-S2': true
      });

      // Stars per-stage max
      expect(reconciled.campaign.stageStars).toEqual({
        'L1-S1': 3,
        'L1-S2': 2
      });

      // Scores per-stage max
      expect(reconciled.campaign.stageScores).toEqual({
        'L1-S1': 900,
        'L1-S2': 600
      });

      // Combo max
      expect(reconciled.campaign.bestCombo).toBe(9);

      // Unique claims union
      expect(reconciled.uniqueClaims['firstClear:L1-S1'].deviceId).toBe('dev-cloud'); // cloud metadata preserved
      expect(reconciled.uniqueClaims['firstClear:L1-S2']).toBeDefined();

      // Revision incremented because changes were merged
      expect(reconciled.revision).toBe(3);
    });

    test('repeated bootstrap/reconcile is idempotent', () => {
      const cloud = {
        schemaVersion: 1,
        revision: 4,
        updatedAt: 1500,
        appliedOps: { 'dev-1': 10 },
        progression: { totalXp: 2500 },
        campaign: {
          clearedStages: { 'L1-S1': true },
          stageStars: { 'L1-S1': 3 },
          stageScores: { 'L1-S1': 1000 },
          bestCombo: 15
        },
        uniqueClaims: {
          'firstClear:L1-S1': { claimedAt: 1000, deviceId: 'dev-1' }
        }
      };

      const sameLocal = {
        totalXp: 2500,
        clearedStages: ['L1-S1'],
        stageStars: { 'L1-S1': 3 },
        stageScores: { 'L1-S1': 1000 },
        bestCombo: 15
      };

      const r1 = reconcileLegacyWithCloud(sameLocal, cloud);
      expect(r1).toBe(cloud);

      const r2 = reconcileLegacyWithCloud(sameLocal, r1);
      expect(r2).toBe(cloud);
      expect(r2.revision).toBe(4);
    });
  });
});

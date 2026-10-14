import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  buildFirstClearClaimId,
  buildDailyMissionClaimId,
  parseClaimId,
  resolveCanonicalClaimReward,
  validateUniqueClaim
} from '../src/domain/sync/uniqueRewards';
import {
  createSyncOperation,
  validateSyncOperation,
  reconcileProgressOnOpAck,
  canAdoptLegacySave
} from '../src/domain/sync/syncOperation';
import {
  getPendingSyncOp,
  hasPendingSyncOp,
  createAndPersistSyncOp,
  clearPendingSyncOp,
  getLegacyAdoptionRecord,
  recordLegacyAdoption,
  LEGACY_ADOPTION_KEY
} from '../src/storage/syncOutboxStorage';
import {
  getLocalSyncSeq,
  setLocalSyncSeq,
  getScopedKey
} from '../src/storage/storageIdentity';

// In-memory mock storage for AsyncStorage
let mockStore = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key) => (mockStore[key] !== undefined ? mockStore[key] : null)),
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

const DEVICE_A = 'dev-uuid-aaa-111';
const DEVICE_B = 'dev-uuid-bbb-222';

describe('Sync Operation & Outbox Foundation (Phase 3)', () => {
  beforeEach(() => {
    mockStore = {};
    jest.clearAllMocks();
  });

  describe('1. Canonical Unique Reward Definitions & Validation', () => {
    test('builds and parses deterministic firstClear claim ID', () => {
      const claimId = buildFirstClearClaimId('L1-S3');
      expect(claimId).toBe('firstClear:L1-S3');

      const parsed = parseClaimId(claimId);
      expect(parsed.family).toBe('firstClear');
      expect(parsed.stageId).toBe('L1-S3');
      expect(parsed.stage.type).toBe('NORMAL');
    });

    test('resolves canonical first-clear rewards for NORMAL, ELITE, and BOSS stages', () => {
      // NORMAL: L1-S1 -> 20 XP
      expect(resolveCanonicalClaimReward('firstClear:L1-S1')).toBe(20);
      // ELITE: L1-E1 -> 30 XP
      expect(resolveCanonicalClaimReward('firstClear:L1-E1')).toBe(30);
      // BOSS: L1-BOSS -> 50 XP
      expect(resolveCanonicalClaimReward('firstClear:L1-BOSS')).toBe(50);
    });

    test('builds and parses deterministic daily mission claim ID', () => {
      const claimId = buildDailyMissionClaimId('2026-10-13', 'm1');
      expect(claimId).toBe('daily:2026-10-13:m1');

      const parsed = parseClaimId(claimId);
      expect(parsed.family).toBe('daily');
      expect(parsed.dateKey).toBe('2026-10-13');
      expect(parsed.missionId).toBe('m1');
    });

    test('resolves canonical daily mission rewards (m1=30, m2=40, m3=50)', () => {
      expect(resolveCanonicalClaimReward('daily:2026-10-13:m1')).toBe(30);
      expect(resolveCanonicalClaimReward('daily:2026-10-13:m2')).toBe(40);
      expect(resolveCanonicalClaimReward('daily:2026-10-13:m3')).toBe(50);
    });

    test('rejects malformed or unknown claim IDs', () => {
      expect(() => parseClaimId('unknown:xyz')).toThrow();
      expect(() => parseClaimId('firstClear:INVALID_STAGE_ID')).toThrow();
      expect(() => parseClaimId('daily:not-a-date:m1')).toThrow();
      expect(() => parseClaimId('daily:2026-10-13:unknown_m')).toThrow();
      expect(() => parseClaimId('')).toThrow();
    });

    test('validateUniqueClaim accepts matching reward and auto-populates omitted reward', () => {
      // Auto-populates canonical 20 XP
      const c1 = validateUniqueClaim({ claimId: 'firstClear:L1-S1' });
      expect(c1.xpReward).toBe(20);

      // Accepts exact matching canonical reward
      const c2 = validateUniqueClaim({ claimId: 'firstClear:L1-S1', xpReward: 20 });
      expect(c2.xpReward).toBe(20);
    });

    test('validateUniqueClaim rejects arbitrary UI-provided XP reward values', () => {
      expect(() =>
        validateUniqueClaim({ claimId: 'firstClear:L1-S1', xpReward: 9999 })
      ).toThrow(/mismatch/);

      expect(() =>
        validateUniqueClaim({ claimId: 'daily:2026-10-13:m1', xpReward: 100 })
      ).toThrow(/mismatch/);
    });
  });

  describe('2. SyncOperation Contract & Validation', () => {
    test('creates valid, deterministic SyncOp with matching opId', () => {
      const op = createSyncOperation({
        deviceId: DEVICE_A,
        seq: 5,
        repeatableXpDelta: 120,
        uniqueClaims: [{ claimId: 'firstClear:L1-S1' }],
        campaignProgress: {
          clearedStages: ['L1-S1'],
          stageStars: { 'L1-S1': 3 },
          stageScores: { 'L1-S1': 500 },
          bestCombo: 10
        }
      });

      expect(op.opId).toBe(`${DEVICE_A}:5`);
      expect(op.deviceId).toBe(DEVICE_A);
      expect(op.seq).toBe(5);
      expect(op.repeatableXpDelta).toBe(120);
      expect(op.uniqueClaims[0].claimId).toBe('firstClear:L1-S1');
      expect(op.uniqueClaims[0].xpReward).toBe(20);
    });

    test('constructed SyncOp is immutable (Object.freeze)', () => {
      const op = createSyncOperation({
        deviceId: DEVICE_A,
        seq: 1
      });

      expect(Object.isFrozen(op)).toBe(true);
      expect(Object.isFrozen(op.uniqueClaims)).toBe(true);
      expect(Object.isFrozen(op.campaignProgress)).toBe(true);
    });

    test('rejects seq <= 0, non-integer, or empty deviceId', () => {
      expect(() => createSyncOperation({ deviceId: '', seq: 1 })).toThrow();
      expect(() => createSyncOperation({ deviceId: DEVICE_A, seq: 0 })).toThrow();
      expect(() => createSyncOperation({ deviceId: DEVICE_A, seq: -5 })).toThrow();
      expect(() => createSyncOperation({ deviceId: DEVICE_A, seq: 2.5 })).toThrow();
    });

    test('rejects negative repeatableXpDelta or non-integer', () => {
      expect(() =>
        createSyncOperation({ deviceId: DEVICE_A, seq: 1, repeatableXpDelta: -10 })
      ).toThrow();
      expect(() =>
        createSyncOperation({ deviceId: DEVICE_A, seq: 1, repeatableXpDelta: NaN })
      ).toThrow();
    });

    test('rejects duplicate claim IDs within a single operation', () => {
      expect(() =>
        createSyncOperation({
          deviceId: DEVICE_A,
          seq: 1,
          uniqueClaims: [
            { claimId: 'firstClear:L1-S1' },
            { claimId: 'firstClear:L1-S1' }
          ]
        })
      ).toThrow(/Duplicate claimId/);
    });

    test('rejects invalid stage stars (< 1 or > 3)', () => {
      expect(() =>
        createSyncOperation({
          deviceId: DEVICE_A,
          seq: 1,
          campaignProgress: { stageStars: { 'L1-S1': 4 } }
        })
      ).toThrow();

      expect(() =>
        createSyncOperation({
          deviceId: DEVICE_A,
          seq: 1,
          campaignProgress: { stageStars: { 'L1-S1': 0 } }
        })
      ).toThrow();
    });
  });

  describe('3. SyncOutbox Persistence & Sequence Reservation', () => {
    test('creates and persists pending SyncOp to scoped AsyncStorage key', async () => {
      const op = await createAndPersistSyncOp({
        identity: 'uid:user_alpha',
        deviceId: DEVICE_A,
        repeatableXpDelta: 50
      });

      expect(op.opId).toBe(`${DEVICE_A}:1`);
      expect(op.seq).toBe(1);

      const stored = await getPendingSyncOp('uid:user_alpha');
      expect(stored).not.toBeNull();
      expect(stored.opId).toBe(`${DEVICE_A}:1`);
      expect(stored.repeatableXpDelta).toBe(50);
    });

    test('enforces queue depth = 1: cannot overwrite unresolved pending op', async () => {
      await createAndPersistSyncOp({
        identity: 'uid:user_alpha',
        deviceId: DEVICE_A,
        repeatableXpDelta: 50
      });

      // Attempt to create second op while first is unresolved
      await expect(
        createAndPersistSyncOp({
          identity: 'uid:user_alpha',
          deviceId: DEVICE_A,
          repeatableXpDelta: 80
        })
      ).rejects.toThrow(/pending operation.*already exists/);
    });

    test('same pending op survives reload and returns identical payload for retries', async () => {
      const op = await createAndPersistSyncOp({
        identity: 'uid:user_alpha',
        deviceId: DEVICE_A,
        repeatableXpDelta: 75,
        uniqueClaims: [{ claimId: 'firstClear:L1-S1' }]
      });

      const opRead1 = await getPendingSyncOp('uid:user_alpha');
      const opRead2 = await getPendingSyncOp('uid:user_alpha');

      expect(opRead1.opId).toBe(op.opId);
      expect(opRead2.opId).toBe(op.opId);
      expect(opRead1.uniqueClaims).toEqual(opRead2.uniqueClaims);
    });

    test('clears pending op only through explicit confirmation with matching opId', async () => {
      const op = await createAndPersistSyncOp({
        identity: 'uid:user_alpha',
        deviceId: DEVICE_A,
        repeatableXpDelta: 50
      });

      // Mismatched opId throws
      await expect(clearPendingSyncOp('uid:user_alpha', 'mismatched:999')).rejects.toThrow(
        /Mismatched opId/
      );

      // Correct opId clears cleanly
      const cleared = await clearPendingSyncOp('uid:user_alpha', op.opId);
      expect(cleared).toBe(true);

      expect(await getPendingSyncOp('uid:user_alpha')).toBeNull();
      expect(await hasPendingSyncOp('uid:user_alpha')).toBe(false);
    });

    test('sequence increments safely after op resolution and never rolls backward', async () => {
      // Op 1 (seq = 1)
      const op1 = await createAndPersistSyncOp({
        identity: 'uid:user_alpha',
        deviceId: DEVICE_A
      });
      expect(op1.seq).toBe(1);
      await clearPendingSyncOp('uid:user_alpha', op1.opId);

      // Op 2 (seq = 2)
      const op2 = await createAndPersistSyncOp({
        identity: 'uid:user_alpha',
        deviceId: DEVICE_A
      });
      expect(op2.seq).toBe(2);
      await clearPendingSyncOp('uid:user_alpha', op2.opId);

      // Sequence never rolls backward
      const storedSeq = await getLocalSyncSeq('uid:user_alpha');
      expect(storedSeq).toBe(2);
    });

    test('crash-safe sequence ordering: sequence is reserved in storage first', async () => {
      // Simulate base sequence at 10
      await setLocalSyncSeq('uid:user_alpha', 10);

      // Next op creation reserves 11
      const op = await createAndPersistSyncOp({
        identity: 'uid:user_alpha',
        deviceId: DEVICE_A
      });
      expect(op.seq).toBe(11);
      expect(await getLocalSyncSeq('uid:user_alpha')).toBe(11);
    });

    test('detects malformed persisted pending op safely without crashing', async () => {
      const key = getScopedKey('pendingSyncOp', 'uid:user_alpha');
      mockStore[key] = '{corrupted-json';

      const read = await getPendingSyncOp('uid:user_alpha');
      expect(read.error).toBe('MALFORMED_JSON');
      expect(await hasPendingSyncOp('uid:user_alpha')).toBe(false);
    });
  });

  describe('4. Post-Op Gameplay Safety (Reconciliation Contract)', () => {
    test('gameplay progress earned locally AFTER pending op creation is strictly preserved on op ack', () => {
      // 1. Initial local state at op creation: 1000 total XP
      const baselineTotalXp = 1000;
      // Op was built with repeatable delta +50 and first-clear +20 (op total = 70 XP)

      // 2. While op is pending in outbox, player plays locally and earns +140 XP
      const localCurrentTotalXp = baselineTotalXp + 140; // 1140 XP

      // 3. Cloud acknowledges op, authoritatively updating cloud total to 1070 XP
      const cloudSnapshotTotalXp = 1070;

      // 4. Pure reconciler executes upon acknowledgement:
      const reconciled = reconcileProgressOnOpAck({
        localCurrentTotalXp,
        localBaselineTotalXpAtOpCreation: baselineTotalXp,
        cloudSnapshotTotalXp,
        localCurrentCampaign: {
          clearedStages: ['L1-S1', 'L1-S2'],
          stageStars: { 'L1-S1': 3, 'L1-S2': 2 },
          stageScores: { 'L1-S1': 1000, 'L1-S2': 800 },
          bestCombo: 12
        },
        cloudSnapshotCampaign: {
          clearedStages: ['L1-S1'],
          stageStars: { 'L1-S1': 3 },
          stageScores: { 'L1-S1': 1000 },
          bestCombo: 8
        }
      });

      // Expected: cloudSnapshotTotalXp (1070) + postOpEarnedXp (140) = 1210 XP!
      expect(reconciled.progression.postOpEarnedXp).toBe(140);
      expect(reconciled.progression.totalXp).toBe(1210);

      // Campaign progress is unioned with high-water marks preserved
      expect(reconciled.campaign.clearedStages).toEqual(expect.arrayContaining(['L1-S1', 'L1-S2']));
      expect(reconciled.campaign.stageStars['L1-S2']).toBe(2);
      expect(reconciled.campaign.stageScores['L1-S2']).toBe(800);
      expect(reconciled.campaign.bestCombo).toBe(12);
    });
  });

  describe('5. Account Isolation & Legacy Adoption Guardrail', () => {
    test('pending op isolation between Account A and Account B', async () => {
      const opA = await createAndPersistSyncOp({
        identity: 'uid:user_A',
        deviceId: DEVICE_A,
        repeatableXpDelta: 100
      });

      const opB = await createAndPersistSyncOp({
        identity: 'uid:user_B',
        deviceId: DEVICE_B,
        repeatableXpDelta: 200
      });

      const readA = await getPendingSyncOp('uid:user_A');
      const readB = await getPendingSyncOp('uid:user_B');

      expect(readA.opId).toBe(opA.opId);
      expect(readB.opId).toBe(opB.opId);
      expect(readA.repeatableXpDelta).toBe(100);
      expect(readB.repeatableXpDelta).toBe(200);
    });

    test('guest pending op isolated from signed-in users', async () => {
      const opGuest = await createAndPersistSyncOp({
        identity: 'guest',
        deviceId: DEVICE_A,
        repeatableXpDelta: 30
      });

      const readUser = await getPendingSyncOp('uid:user_A');
      expect(readUser).toBeNull();

      const readGuest = await getPendingSyncOp('guest');
      expect(readGuest.opId).toBe(opGuest.opId);
    });

    test('legacy adoption guardrail: allows first identity, rejects subsequent different identities', async () => {
      // 1. Initial state: not adopted
      expect(await getLegacyAdoptionRecord()).toBeNull();

      // 2. Account A adopts legacy data
      const recordA = await recordLegacyAdoption('uid:user_A');
      expect(recordA.adoptedBy).toBe('uid:user_A');

      // 3. Account A adopting again is idempotent (allowed)
      const recordAA = await recordLegacyAdoption('uid:user_A');
      expect(recordAA.adoptedBy).toBe('uid:user_A');

      // 4. Account B attempting to adopt the same legacy save is REJECTED
      await expect(recordLegacyAdoption('uid:user_B')).rejects.toThrow(
        /Legacy save is already adopted by "uid:user_A"/
      );

      // 5. Guest attempting to adopt is also REJECTED
      await expect(recordLegacyAdoption('guest')).rejects.toThrow(
        /Legacy save is already adopted by "uid:user_A"/
      );
    });
  });
});

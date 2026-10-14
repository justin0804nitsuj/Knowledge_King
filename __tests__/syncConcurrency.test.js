import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  addStagedRepeatableXp,
  addStagedUniqueClaim,
  getUnsyncedProgress
} from '../src/storage/unsyncedProgressStorage';
import {
  createPendingSyncOpFromStaged,
  getPendingSyncOp,
  hasPendingSyncOp
} from '../src/storage/syncOutboxStorage';
import {
  withSyncMutationLock,
  isIdentityLocked,
  _resetSyncLocksForTesting
} from '../src/storage/syncLock';
import { getScopedKey } from '../src/storage/storageIdentity';
import { createSyncOperation } from '../src/domain/sync/syncOperation';

let mockStore = {};
let mockAsyncStorageDelayMs = 0;

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key) => {
    if (mockAsyncStorageDelayMs > 0) {
      await new Promise((res) => setTimeout(res, mockAsyncStorageDelayMs));
    }
    return mockStore[key] !== undefined ? mockStore[key] : null;
  }),
  setItem: jest.fn(async (key, value) => {
    if (mockAsyncStorageDelayMs > 0) {
      await new Promise((res) => setTimeout(res, mockAsyncStorageDelayMs));
    }
    mockStore[key] = String(value);
  }),
  removeItem: jest.fn(async (key) => {
    if (mockAsyncStorageDelayMs > 0) {
      await new Promise((res) => setTimeout(res, mockAsyncStorageDelayMs));
    }
    delete mockStore[key];
  }),
  clear: jest.fn(async () => {
    mockStore = {};
  })
}));

const DEVICE_A = 'dev-uuid-aaa-111';
const DEVICE_B = 'dev-uuid-bbb-222';

describe('Local Cloud Sync Concurrency Safety & Mutation Serialization (Phase 3.6)', () => {
  beforeEach(() => {
    mockStore = {};
    mockAsyncStorageDelayMs = 0;
    _resetSyncLocksForTesting();
    jest.clearAllMocks();
  });

  describe('1. Critical Race Prevention: Concurrent Gameplay During Pending Op Creation', () => {
    test('Scenario A: Gameplay +30 occurring concurrently during pending op creation is strictly preserved', async () => {
      const identity = 'uid:player_concurrency_A';

      // Setup initial unsynced repeatable XP = 100
      await addStagedRepeatableXp(identity, 100);

      // Introduce an artificial AsyncStorage delay (10ms) so that multiple async ticks occur inside storage
      mockAsyncStorageDelayMs = 10;

      // Launch pending op creation (takes ~40ms to read unsynced, reserve seq, write pending op, drain unsynced)
      const pendingCreationPromise = createPendingSyncOpFromStaged({
        identity,
        deviceId: DEVICE_A
      });

      // Concurrently launch gameplay task that stages +30 XP
      const gameplayTaskPromise = addStagedRepeatableXp(identity, 30);

      // Await both operations
      const [op, gameplayUnsynced] = await Promise.all([
        pendingCreationPromise,
        gameplayTaskPromise
      ]);

      expect(op).not.toBeNull();
      expect(op.repeatableXpDelta).toBe(100);

      // Critical Assert: The final unsynced state MUST contain +30! It must NEVER become 0!
      const finalUnsynced = await getUnsyncedProgress(identity);
      expect(finalUnsynced.repeatableXpDelta).toBe(30);
    });
  });

  describe('2. Concurrent Staging Mutation Serialization', () => {
    test('Scenario B: Two concurrent stageRepeatableXp calls preserve both increments', async () => {
      const identity = 'uid:player_concurrent_xp';
      mockAsyncStorageDelayMs = 5;

      // Fire two concurrent increments (50 and 30) simultaneously
      await Promise.all([
        addStagedRepeatableXp(identity, 50),
        addStagedRepeatableXp(identity, 30)
      ]);

      const finalUnsynced = await getUnsyncedProgress(identity);
      // Both increments must be strictly preserved without one overwriting the other
      expect(finalUnsynced.repeatableXpDelta).toBe(80);
    });

    test('Scenario C: Two concurrent stageUniqueClaim calls with DIFFERENT claimIds preserve both', async () => {
      const identity = 'uid:player_concurrent_claims';
      mockAsyncStorageDelayMs = 5;

      await Promise.all([
        addStagedUniqueClaim(identity, { claimId: 'firstClear:L1-S1' }),
        addStagedUniqueClaim(identity, { claimId: 'firstClear:L1-S2' })
      ]);

      const finalUnsynced = await getUnsyncedProgress(identity);
      expect(finalUnsynced.uniqueClaims['firstClear:L1-S1']).toBeDefined();
      expect(finalUnsynced.uniqueClaims['firstClear:L1-S2']).toBeDefined();
      expect(Object.keys(finalUnsynced.uniqueClaims)).toHaveLength(2);
    });

    test('Scenario D: Two concurrent stageUniqueClaim calls with SAME claimId: exactly one succeeds and one rejects', async () => {
      const identity = 'uid:player_dup_claim';
      mockAsyncStorageDelayMs = 5;

      const results = await Promise.allSettled([
        addStagedUniqueClaim(identity, { claimId: 'firstClear:L1-S1' }),
        addStagedUniqueClaim(identity, { claimId: 'firstClear:L1-S1' })
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason.message).toMatch(/Duplicate staged unique claim/);

      const finalUnsynced = await getUnsyncedProgress(identity);
      expect(finalUnsynced.uniqueClaims['firstClear:L1-S1']).toBeDefined();
      expect(Object.keys(finalUnsynced.uniqueClaims)).toHaveLength(1);
    });
  });

  describe('3. Concurrent Pending Op Creation Prevention', () => {
    test('Scenario E: Two concurrent createPendingSyncOpFromStaged calls result in exactly one op', async () => {
      const identity = 'uid:player_concurrent_ops';
      await addStagedRepeatableXp(identity, 100);

      mockAsyncStorageDelayMs = 10;

      // Fire two concurrent op creations simultaneously
      const results = await Promise.allSettled([
        createPendingSyncOpFromStaged({ identity, deviceId: DEVICE_A }),
        createPendingSyncOpFromStaged({ identity, deviceId: DEVICE_A })
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly one must succeed, the other must observe that an op already exists
      expect(fulfilled).toHaveLength(1);
      expect(fulfilled[0].value).not.toBeNull();
      expect(fulfilled[0].value.opId).toBe(`${DEVICE_A}:1`);

      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason.message).toMatch(/pending operation .* already exists/);

      // Invariant: At most ONE pending SyncOp exists
      const pending = await getPendingSyncOp(identity);
      expect(pending.opId).toBe(`${DEVICE_A}:1`);
    });
  });

  describe('4. Multi-Account Isolation & Non-Blocking Concurrency', () => {
    test('Scenario F: Account A mutations do NOT block Account B or Guest', async () => {
      const idA = 'uid:player_alpha';
      const idB = 'uid:player_beta';
      const idGuest = 'guest';

      mockAsyncStorageDelayMs = 5;

      // Interleave operations across Account A, Account B, and Guest concurrently
      await Promise.all([
        addStagedRepeatableXp(idA, 100),
        addStagedRepeatableXp(idB, 200),
        addStagedRepeatableXp(idGuest, 50),
        addStagedUniqueClaim(idA, { claimId: 'firstClear:L1-S1' }),
        addStagedUniqueClaim(idB, { claimId: 'firstClear:L1-S2' })
      ]);

      const unsyncedA = await getUnsyncedProgress(idA);
      const unsyncedB = await getUnsyncedProgress(idB);
      const unsyncedGuest = await getUnsyncedProgress(idGuest);

      expect(unsyncedA.repeatableXpDelta).toBe(100);
      expect(unsyncedA.uniqueClaims['firstClear:L1-S1']).toBeDefined();
      expect(unsyncedA.uniqueClaims['firstClear:L1-S2']).toBeUndefined();

      expect(unsyncedB.repeatableXpDelta).toBe(200);
      expect(unsyncedB.uniqueClaims['firstClear:L1-S2']).toBeDefined();
      expect(unsyncedB.uniqueClaims['firstClear:L1-S1']).toBeUndefined();

      expect(unsyncedGuest.repeatableXpDelta).toBe(50);
      expect(Object.keys(unsyncedGuest.uniqueClaims)).toHaveLength(0);
    });
  });

  describe('5. Lock Release Safety on Exception', () => {
    test('Scenario G: Mutex lock releases cleanly after an unhandled error inside mutation', async () => {
      const identity = 'uid:player_error_recovery';

      // 1. Run a mutation that fails
      await expect(
        withSyncMutationLock(identity, async () => {
          throw new Error('Simulated network/disk crash inside lock');
        })
      ).rejects.toThrow('Simulated network/disk crash inside lock');

      // 2. Subsequent mutation must NOT be deadlocked and must execute normally
      const result = await addStagedRepeatableXp(identity, 45);
      expect(result.repeatableXpDelta).toBe(45);

      const finalUnsynced = await getUnsyncedProgress(identity);
      expect(finalUnsynced.repeatableXpDelta).toBe(45);
    });
  });

  describe('6. Crash Safety Under Serialization', () => {
    test('Scenario H: Process-crash recovery remains 100% active and idempotent with serialization enabled', async () => {
      const identity = 'uid:player_crash_test';

      // Simulate state where pendingSyncOp was saved, but app was killed before drain
      const op = createSyncOperation({
        deviceId: DEVICE_A,
        seq: 1,
        repeatableXpDelta: 75,
        uniqueClaims: [{ claimId: 'firstClear:L1-S1' }]
      });

      const pendingKey = getScopedKey('pendingSyncOp', identity);
      const unsyncedKey = getScopedKey('unsyncedProgress', identity);

      await AsyncStorage.setItem(pendingKey, JSON.stringify(op));

      // Unsynced accumulator still has the old 75 XP and firstClear claim
      const unDrained = {
        repeatableXpDelta: 75,
        uniqueClaims: {
          'firstClear:L1-S1': { claimId: 'firstClear:L1-S1', xpReward: 20 }
        },
        campaignProgress: { clearedStages: {}, stageStars: {}, stageScores: {}, bestCombo: 0 },
        lastEnqueuedOpId: null // Not updated due to crash
      };
      await AsyncStorage.setItem(unsyncedKey, JSON.stringify(unDrained));

      // Reading unsyncedProgress through the serialized API triggers crash recovery
      const recovered = await getUnsyncedProgress(identity);

      expect(recovered.repeatableXpDelta).toBe(0);
      expect(recovered.uniqueClaims['firstClear:L1-S1']).toBeUndefined();
      expect(recovered.lastEnqueuedOpId).toBe(op.opId);

      // Subsequent staged gameplay accumulates cleanly on top of recovered state
      await addStagedRepeatableXp(identity, 25);
      const afterGameplay = await getUnsyncedProgress(identity);
      expect(afterGameplay.repeatableXpDelta).toBe(25);
    });
  });
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createNewRun,
  loadActiveRun,
  saveRun,
  advanceToNode,
  abandonRun,
  getActiveSelectableNodes,
} from '../src/services/rogue/rogueRunService';
import {
  loadActiveRogueRun,
  saveActiveRogueRun,
  clearActiveRogueRun,
  ROGUE_RUN_STORAGE_CATEGORY,
} from '../src/storage/rogueRunStorage';
import {
  setActiveIdentity,
  getActiveIdentity,
  getScopedKey,
  _resetCachedDeviceIdForTests,
} from '../src/storage/storageIdentity';
import { ROGUE_RUN_STATUS } from '../src/domain/rogue/rogueRun';

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
  }),
}));

describe('Rogue Expedition V0.1 — Service & Account-Scoped Storage Isolation', () => {
  beforeEach(async () => {
    mockStore = {};
    jest.clearAllMocks();
    _resetCachedDeviceIdForTests();
    await setActiveIdentity('guest');
  });

  describe('1. Run Lifecycle & Persistence', () => {
    test('createNewRun persists active run under account-scoped storage key', async () => {
      const run = await createNewRun({ seed: 7788 });

      expect(run).toBeDefined();
      expect(run.seed).toBe(7788);
      expect(run.status).toBe(ROGUE_RUN_STATUS.ACTIVE);

      const scopedKey = getScopedKey(ROGUE_RUN_STORAGE_CATEGORY, 'guest');
      expect(mockStore[scopedKey]).toBeDefined();

      const loaded = await loadActiveRun();
      expect(loaded).toEqual(run);
    });

    test('run persists accurately after reload', async () => {
      const created = await createNewRun({ seed: 1234 });
      const nextNodes = await getActiveSelectableNodes();
      expect(nextNodes.length).toBeGreaterThan(0);

      const advanced = await advanceToNode(nextNodes[0]);
      expect(advanced.currentNodeId).toBe(nextNodes[0]);

      // Simulate app restart by calling loadActiveRun cleanly
      const reloaded = await loadActiveRun();
      expect(reloaded).toEqual(advanced);
      expect(reloaded.currentNodeId).toBe(nextNodes[0]);
      expect(reloaded.runStats.nodesVisited).toBe(2);
    });

    test('restarting a new run intentionally replaces prior finished/abandoned run', async () => {
      const firstRun = await createNewRun({ seed: 100 });
      const abandoned = await abandonRun();
      expect(abandoned.status).toBe(ROGUE_RUN_STATUS.ABANDONED);

      const reloadedAbandoned = await loadActiveRun();
      expect(reloadedAbandoned.status).toBe(ROGUE_RUN_STATUS.ABANDONED);

      // Start new run with different seed
      const secondRun = await createNewRun({ seed: 200 });
      expect(secondRun.seed).toBe(200);
      expect(secondRun.status).toBe(ROGUE_RUN_STATUS.ACTIVE);

      const loadedSecond = await loadActiveRun();
      expect(loadedSecond.seed).toBe(200);
      expect(loadedSecond.status).toBe(ROGUE_RUN_STATUS.ACTIVE);
      expect(loadedSecond.runId).not.toBe(firstRun.runId);
    });

    test('advanceToNode validates connectivity and throws on illegal jumps', async () => {
      const run = await createNewRun({ seed: 555 });

      await expect(advanceToNode('illegal-jump-node')).rejects.toThrow(/Invalid move/);

      // Verify that the run in storage remains unchanged
      const current = await loadActiveRun();
      expect(current.currentNodeId).toBe(run.currentNodeId);
      expect(current.runStats.nodesVisited).toBe(1);
    });
  });

  describe('2. Account-Scoped Physical Storage Isolation', () => {
    test('Account A run is completely isolated from Account B run', async () => {
      // Player A logs in and starts an expedition
      await setActiveIdentity('uid:account_alpha');
      const runA = await createNewRun({ seed: 1111 });
      const selectableA = await getActiveSelectableNodes();
      await advanceToNode(selectableA[0]);

      const keyA = getScopedKey(ROGUE_RUN_STORAGE_CATEGORY, 'uid:account_alpha');
      expect(mockStore[keyA]).toBeDefined();

      // Switch to Player B
      await setActiveIdentity('uid:account_beta');
      const runBOnStart = await loadActiveRun();
      expect(runBOnStart).toBeNull(); // No run for Player B yet

      // Player B creates their own run
      const runB = await createNewRun({ seed: 9999 });
      const keyB = getScopedKey(ROGUE_RUN_STORAGE_CATEGORY, 'uid:account_beta');
      expect(mockStore[keyB]).toBeDefined();
      expect(keyA).not.toBe(keyB);

      // Player B state is independent
      const loadedB = await loadActiveRun();
      expect(loadedB.seed).toBe(9999);
      expect(loadedB.currentNodeId).toBe(runB.route.startNodeId);

      // Switch back to Player A
      await setActiveIdentity('uid:account_alpha');
      const loadedA = await loadActiveRun();
      expect(loadedA.seed).toBe(1111);
      expect(loadedA.currentNodeId).toBe(selectableA[0]);
      expect(loadedA.runStats.nodesVisited).toBe(2);
    });

    test('Guest run is completely isolated from Account A', async () => {
      // Guest creates run
      await setActiveIdentity('guest');
      const guestRun = await createNewRun({ seed: 3333 });

      const guestKey = getScopedKey(ROGUE_RUN_STORAGE_CATEGORY, 'guest');
      expect(mockStore[guestKey]).toBeDefined();

      // Log in as Account A
      await setActiveIdentity('uid:account_alpha');
      const accountARun = await loadActiveRun();
      expect(accountARun).toBeNull();

      // Account A creates run
      await createNewRun({ seed: 4444 });
      const loadedAccountA = await loadActiveRun();
      expect(loadedAccountA.seed).toBe(4444);

      // Switch back to Guest
      await setActiveIdentity('guest');
      const loadedGuest = await loadActiveRun();
      expect(loadedGuest.seed).toBe(3333);
    });

    test('clearActiveRogueRun removes only the target identity run', async () => {
      await setActiveIdentity('uid:user_1');
      await createNewRun({ seed: 101 });

      await setActiveIdentity('uid:user_2');
      await createNewRun({ seed: 202 });

      // Clear user_1's run
      await clearActiveRogueRun('uid:user_1');

      const user1Run = await loadActiveRogueRun('uid:user_1');
      expect(user1Run).toBeNull();

      const user2Run = await loadActiveRogueRun('uid:user_2');
      expect(user2Run).not.toBeNull();
      expect(user2Run.seed).toBe(202);
    });
  });
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createNewRun,
  loadActiveRun,
  advanceToNode,
  submitCombatAnswer,
  getActiveSelectableNodes,
  getActiveEncounter,
} from '../src/services/rogue/rogueRunService';
import {
  setActiveIdentity,
  getScopedKey,
  _resetCachedDeviceIdForTests,
} from '../src/storage/storageIdentity';
import { ROGUE_RUN_STORAGE_CATEGORY } from '../src/storage/rogueRunStorage';
import { ROGUE_RUN_STATUS } from '../src/domain/rogue/rogueRun';
import { ENCOUNTER_STATUS } from '../src/domain/rogue/combat/rogueCombat';

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

describe('Rogue Expedition V0.1 — Combat Lifecycle & Persistence Gating (Phase R2)', () => {
  beforeEach(async () => {
    mockStore = {};
    jest.clearAllMocks();
    _resetCachedDeviceIdForTests();
    await setActiveIdentity('guest');
  });

  describe('1. Node Gating & Combat Victory Unlocking', () => {
    test('entering combat node marks it unresolved and locks next map nodes until victory', async () => {
      const run = await createNewRun({ seed: 777 });
      const nextNodes = await getActiveSelectableNodes();
      const battleNodeId = nextNodes[0];

      // Enter combat node
      const activeRun = await advanceToNode(battleNodeId);
      expect(activeRun.currentNodeId).toBe(battleNodeId);
      expect(activeRun.currentNodeResolved).toBe(false);
      expect(activeRun.encounter).toBeDefined();
      expect(activeRun.encounter.status).toBe(ENCOUNTER_STATUS.ACTIVE);

      // Invariant: Unresolved node locks all next nodes
      const lockedNodes = await getActiveSelectableNodes();
      expect(lockedNodes).toEqual([]);

      // Attempting to advance while unresolved throws error
      await expect(advanceToNode('node-2-0')).rejects.toThrow(/unresolved/);

      // Fight combat until victory
      let currentEncounter = activeRun.encounter;
      while (currentEncounter.status === ENCOUNTER_STATUS.ACTIVE) {
        const correctChoiceId = currentEncounter.question.correctChoiceId;
        const result = await submitCombatAnswer({
          choiceId: correctChoiceId,
          token: currentEncounter.question.token,
        });
        currentEncounter = result.encounter;
      }

      expect(currentEncounter.status).toBe(ENCOUNTER_STATUS.VICTORY);

      // Invariant: After victory, node is resolved and next nodes are unlocked!
      const resolvedRun = await loadActiveRun();
      expect(resolvedRun.currentNodeResolved).toBe(true);
      expect(resolvedRun.runStats.battlesWon).toBe(1);

      const unlockedNextNodes = await getActiveSelectableNodes();
      expect(unlockedNextNodes.length).toBeGreaterThanOrEqual(1);

      // Invariant: Player can now legally advance to the unlocked next node
      const nextHop = unlockedNextNodes[0];
      const nextRunState = await advanceToNode(nextHop);
      expect(nextRunState.currentNodeId).toBe(nextHop);
    });

    test('player defeat terminates the run and stops all map progression', async () => {
      const run = await createNewRun({ seed: 888, initialHp: 6 }); // Low HP for quick defeat test
      const firstBattleId = (await getActiveSelectableNodes())[0];
      const battleRun = await advanceToNode(firstBattleId);

      // Player answers incorrectly twice, enemy deals 4 damage each time
      let enc = battleRun.encounter;
      const wrongChoiceId = 'wrong_choice_id';

      // Turn 1 wrong answer (6 - 4 = 2 HP)
      const res1 = await submitCombatAnswer({
        choiceId: wrongChoiceId,
        token: enc.question.token,
      });
      expect(res1.encounter.player.hp).toBe(2);
      expect(res1.encounter.status).toBe(ENCOUNTER_STATUS.ACTIVE);

      // Turn 2 wrong answer (2 - 4 = 0 HP -> DEFEAT)
      const res2 = await submitCombatAnswer({
        choiceId: wrongChoiceId,
        token: res1.encounter.question.token,
      });
      expect(res2.encounter.player.hp).toBe(0);
      expect(res2.encounter.status).toBe(ENCOUNTER_STATUS.DEFEAT);

      const loadedRun = await loadActiveRun();
      expect(loadedRun.status).toBe(ROGUE_RUN_STATUS.DEFEAT);
      expect(loadedRun.player.hp).toBe(0);

      // Invariant: Defeated run has no available next nodes and cannot advance
      const nextNodes = await getActiveSelectableNodes();
      expect(nextNodes).toEqual([]);
      await expect(advanceToNode('node-2-0')).rejects.toThrow(/Cannot advance/);
    });
  });

  describe('2. Mid-Battle Persistence & Restart Safety', () => {
    test('mid-battle state persists to storage and reloads identical encounter after simulated app restart', async () => {
      const run = await createNewRun({ seed: 4321 });
      const battleNodeId = (await getActiveSelectableNodes())[0];
      await advanceToNode(battleNodeId);

      const initialEncounter = await getActiveEncounter();
      expect(initialEncounter.turn).toBe(1);
      expect(initialEncounter.enemy.hp).toBe(40);

      // Player answers 1 question correctly (deals 10 damage, takes 4 damage)
      const submitRes = await submitCombatAnswer({
        choiceId: initialEncounter.question.correctChoiceId,
        token: initialEncounter.question.token,
      });
      expect(submitRes.encounter.enemy.hp).toBe(30);
      expect(submitRes.encounter.player.hp).toBe(96);
      expect(submitRes.encounter.turn).toBe(2);

      const midBattleQuestionToken = submitRes.encounter.question.token;

      // Simulate App Restart: re-read active run from storage
      const reloadedRun = await loadActiveRun();
      expect(reloadedRun.encounter).toBeDefined();
      expect(reloadedRun.encounter.turn).toBe(2);
      expect(reloadedRun.encounter.enemy.hp).toBe(30); // Enemy did NOT regenerate to 40!
      expect(reloadedRun.encounter.player.hp).toBe(96); // Player was NOT healed!
      expect(reloadedRun.encounter.question.token).toBe(midBattleQuestionToken); // Same question preserved!
    });

    test('remaining player HP persists into the run after battle victory', async () => {
      const run = await createNewRun({ seed: 5555, initialHp: 100 });
      const battleId = (await getActiveSelectableNodes())[0];
      await advanceToNode(battleId);

      // Answer once incorrectly (takes 4 damage -> 96 HP)
      let enc = (await loadActiveRun()).encounter;
      const res1 = await submitCombatAnswer({
        choiceId: 'wrong_c',
        token: enc.question.token,
      });
      expect(res1.encounter.player.hp).toBe(96);

      // Now defeat enemy with correct answers
      enc = res1.encounter;
      while (enc.status === ENCOUNTER_STATUS.ACTIVE) {
        const killRes = await submitCombatAnswer({
          choiceId: enc.question.correctChoiceId,
          token: enc.question.token,
        });
        enc = killRes.encounter;
      }

      expect(enc.status).toBe(ENCOUNTER_STATUS.VICTORY);

      const postBattleRun = await loadActiveRun();
      expect(postBattleRun.player.hp).toBeLessThan(100); // Did NOT automatically heal!
    });
  });

  describe('3. Account-Scoped Storage Isolation for Combat', () => {
    test('Account A mid-battle state is isolated from Account B', async () => {
      // Account A enters battle and damages enemy to 20 HP
      await setActiveIdentity('uid:account_alpha');
      await createNewRun({ seed: 123 });
      const runA = await loadActiveRun();
      const nodeA = (await getActiveSelectableNodes()).find(
        (id) => runA.route.nodes[id].type === 'BATTLE'
      );
      await advanceToNode(nodeA);

      let encA = (await loadActiveRun()).encounter;
      await submitCombatAnswer({
        choiceId: encA.question.correctChoiceId,
        token: encA.question.token,
      });
      encA = (await loadActiveRun()).encounter;
      expect(encA.enemy.hp).toBe(30);

      // Account B starts expedition
      await setActiveIdentity('uid:account_beta');
      expect(await loadActiveRun()).toBeNull(); // Clean slate

      await createNewRun({ seed: 999 });
      const runB = await loadActiveRun();
      const nodeB = (await getActiveSelectableNodes()).find(
        (id) => runB.route.nodes[id].type === 'BATTLE'
      );
      await advanceToNode(nodeB);

      const encB = (await loadActiveRun()).encounter;
      expect(encB.enemy.hp).toBe(encB.enemy.maxHp); // Account B has their own fresh enemy

      // Switch back to Account A
      await setActiveIdentity('uid:account_alpha');
      const reloadedA = (await loadActiveRun()).encounter;
      expect(reloadedA.enemy.hp).toBe(30); // Account A's damaged enemy remains intact
    });

    test('Guest mid-battle state is isolated from logged-in Account A', async () => {
      await setActiveIdentity('guest');
      await createNewRun({ seed: 111 });
      const guestRun = await loadActiveRun();
      const guestNode = (await getActiveSelectableNodes()).find(
        (id) => guestRun.route.nodes[id].type === 'BATTLE'
      );
      await advanceToNode(guestNode);

      const guestEnc = (await loadActiveRun()).encounter;
      expect(guestEnc.enemy.hp).toBe(guestEnc.enemy.maxHp);

      // Switch to Account A
      await setActiveIdentity('uid:player_1');
      expect(await loadActiveRun()).toBeNull();
    });
  });
});

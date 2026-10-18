import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createNewRun,
  loadActiveRun,
  advanceToNode,
  selectCombatAction,
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
import { ENCOUNTER_STATUS, PLAYER_ACTION_IDS } from '../src/domain/rogue/combat/rogueCombat';

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

      // Fight combat until victory with bounded loop safeguard
      let currentEncounter = activeRun.encounter;
      let turns = 0;
      const MAX_TURNS = 30;

      while (currentEncounter.status === ENCOUNTER_STATUS.ACTIVE && turns++ < MAX_TURNS) {
        await selectCombatAction({ actionId: PLAYER_ACTION_IDS.ATTACK });
        const correctChoiceId = currentEncounter.question.correctChoiceId;
        const result = await submitCombatAnswer({
          choiceId: correctChoiceId,
          token: currentEncounter.question.token,
        });
        currentEncounter = result.encounter;
      }

      if (currentEncounter.status === ENCOUNTER_STATUS.ACTIVE) {
        throw new Error(`Combat failed to resolve within ${MAX_TURNS} turns`);
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
      const run = await createNewRun({ seed: 888, initialHp: 10 }); // Low HP for quick defeat test (enemy deals 8 damage)
      const firstBattleId = (await getActiveSelectableNodes())[0];
      const battleRun = await advanceToNode(firstBattleId);

      // Player answers incorrectly twice with ATTACK, enemy deals 8 damage each time
      let enc = battleRun.encounter;
      const wrongChoiceId = 'wrong_choice_id';

      // Turn 1 wrong answer (10 - 8 = 2 HP)
      await selectCombatAction({ actionId: PLAYER_ACTION_IDS.ATTACK });
      const res1 = await submitCombatAnswer({
        choiceId: wrongChoiceId,
        token: enc.question.token,
      });
      expect(res1.encounter.player.hp).toBe(2);
      expect(res1.encounter.status).toBe(ENCOUNTER_STATUS.ACTIVE);

      // Turn 2 wrong answer (2 - 8 = 0 HP -> DEFEAT)
      await selectCombatAction({ actionId: PLAYER_ACTION_IDS.ATTACK });
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
      expect(initialEncounter.enemy.hp).toBe(100);

      // Player selects ATTACK and answers 1 question correctly (deals 25 damage, takes 8 damage)
      await selectCombatAction({ actionId: PLAYER_ACTION_IDS.ATTACK });
      const submitRes = await submitCombatAnswer({
        choiceId: initialEncounter.question.correctChoiceId,
        token: initialEncounter.question.token,
      });
      expect(submitRes.encounter.enemy.hp).toBe(75);
      expect(submitRes.encounter.player.hp).toBe(92);
      expect(submitRes.encounter.turn).toBe(2);

      const midBattleQuestionToken = submitRes.encounter.question.token;

      // Simulate App Restart: re-read active run from storage
      const reloadedRun = await loadActiveRun();
      expect(reloadedRun.encounter).toBeDefined();
      expect(reloadedRun.encounter.turn).toBe(2);
      expect(reloadedRun.encounter.enemy.hp).toBe(75); // Enemy did NOT regenerate!
      expect(reloadedRun.encounter.player.hp).toBe(92); // Player was NOT healed!
      expect(reloadedRun.encounter.question.token).toBe(midBattleQuestionToken); // Same question preserved!
    });

    test('remaining player HP persists into the run after battle victory', async () => {
      const run = await createNewRun({ seed: 5555, initialHp: 100 });
      const battleId = (await getActiveSelectableNodes())[0];
      await advanceToNode(battleId);

      // Answer once incorrectly with ATTACK (takes 8 damage -> 92 HP)
      let enc = (await loadActiveRun()).encounter;
      await selectCombatAction({ actionId: PLAYER_ACTION_IDS.ATTACK });
      const res1 = await submitCombatAnswer({
        choiceId: 'wrong_c',
        token: enc.question.token,
      });
      expect(res1.encounter.player.hp).toBe(92);

      // Now defeat enemy with correct ATTACK answers with bounded loop safeguard
      enc = res1.encounter;
      let turns = 0;
      const MAX_TURNS = 30;

      while (enc.status === ENCOUNTER_STATUS.ACTIVE && turns++ < MAX_TURNS) {
        await selectCombatAction({ actionId: PLAYER_ACTION_IDS.ATTACK });
        const killRes = await submitCombatAnswer({
          choiceId: enc.question.correctChoiceId,
          token: enc.question.token,
        });
        enc = killRes.encounter;
      }

      if (enc.status === ENCOUNTER_STATUS.ACTIVE) {
        throw new Error(`Combat failed to resolve within ${MAX_TURNS} turns`);
      }

      expect(enc.status).toBe(ENCOUNTER_STATUS.VICTORY);

      const postBattleRun = await loadActiveRun();
      expect(postBattleRun.player.hp).toBeLessThan(100); // Did NOT automatically heal!
    });
  });

  describe('3. Account-Scoped Storage Isolation for Combat', () => {
    test('Account A mid-battle state is isolated from Account B', async () => {
      // Account A enters battle and damages enemy to 75 HP
      await setActiveIdentity('uid:account_alpha');
      await createNewRun({ seed: 123 });
      const runA = await loadActiveRun();
      const nodeA = (await getActiveSelectableNodes()).find(
        (id) => runA.route.nodes[id].type === 'BATTLE'
      );
      await advanceToNode(nodeA);

      let encA = (await loadActiveRun()).encounter;
      await selectCombatAction({ actionId: PLAYER_ACTION_IDS.ATTACK });
      await submitCombatAnswer({
        choiceId: encA.question.correctChoiceId,
        token: encA.question.token,
      });
      encA = (await loadActiveRun()).encounter;
      expect(encA.enemy.hp).toBe(75);

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
      expect(reloadedA.enemy.hp).toBe(75); // Account A's damaged enemy remains intact
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

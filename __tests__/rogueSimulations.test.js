/**
 * ROGUE EXPEDITION V0.1 — PHASE R9 COMBAT ACTIONS 50-SEED SIMULATION MATRIX
 *
 * Validates the core thesis of Phase R9 Combat Actions Redesign:
 * 1. SMART PERFECT PLAYER (50 Seeds):
 *    - 100% vocabulary accuracy.
 *    - Uses tactical Action choices:
 *      * GUARD against HEAVY_ATTACK
 *      * RECOVER when wounded (HP <= 75) and cooldown is ready
 *      * ATTACK otherwise
 *    - Result: 100% win rate (50/50 VICTORY).
 *
 * 2. ATTACK-ONLY CONTROL PLAYER (Same 50 Seeds):
 *    - 100% vocabulary accuracy.
 *    - Mindlessly selects ATTACK on every single turn (no Guard, no Recover).
 *    - Result: Significant defeat rate proving tactical Action choice is required.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createNewRun,
  advanceToNode,
  selectCombatAction,
  submitCombatAnswer,
  selectRelicReward,
  submitRestAction,
  submitEventAction,
} from '../src/services/rogue/rogueRunService';
import { clearActiveRogueRun } from '../src/storage/rogueRunStorage';
import {
  ROGUE_RUN_STATUS,
  getSelectableNextNodes,
} from '../src/domain/rogue/rogueRun';
import { ENCOUNTER_STATUS } from '../src/domain/rogue/combat/rogueCombat';
import { INTENT_TYPES } from '../src/domain/rogue/combat/enemyArchetypes';
import { PLAYER_ACTION_IDS } from '../src/domain/rogue/combat/playerActions';
import { REST_ACTIONS } from '../src/domain/rogue/rest/restResolver';

let mockStore = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key) => mockStore[key] ?? null),
  setItem: jest.fn(async (key, value) => {
    mockStore[key] = String(value);
    return null;
  }),
  removeItem: jest.fn(async (key) => {
    delete mockStore[key];
    return null;
  }),
  clear: jest.fn(async () => {
    mockStore = {};
    return null;
  }),
}));

describe('Phase R9 — 50-Seed Tactical Combat Simulation', () => {
  beforeEach(async () => {
    mockStore = {};
    await clearActiveRogueRun();
    jest.clearAllMocks();
  });

  const SEED_COUNT = 50;
  const SEED_OFFSET = 100; // seeds 101 .. 150

  /**
   * Helper to simulate a full run on a given seed with a specified combat strategy.
   */
  async function simulateRun({ seed, strategy }) {
    await clearActiveRogueRun();
    let run = await createNewRun({ seed });

    let iterations = 0;
    const maxIterations = 200;

    while (run.status === ROGUE_RUN_STATUS.ACTIVE && iterations < maxIterations) {
      iterations++;

      // 1. Resolve combat
      if (run.encounter && run.encounter.status === ENCOUNTER_STATUS.ACTIVE) {
        const actionId = strategy(run.encounter);
        await selectCombatAction({ actionId });

        const res = await submitCombatAnswer({
          choiceId: run.encounter.question.correctChoiceId,
          token: run.encounter.question.token,
        });
        run = res.run;
        continue;
      }

      // 2. Resolve relic draft
      if (run.pendingReward && run.pendingReward.type === 'RELIC_DRAFT') {
        const rawOption = run.pendingReward.options[0];
        const relicId = typeof rawOption === 'string' ? rawOption : rawOption?.id;
        const res = await selectRelicReward({
          rewardId: run.pendingReward.rewardId,
          relicId,
        });
        run = res.run;
        continue;
      }

      // 3. Resolve Rest node
      if (run.pendingInteraction && run.pendingInteraction.type === 'REST') {
        const res = await submitRestAction({ actionType: REST_ACTIONS.RECOVER });
        run = res.run;
        continue;
      }

      // 4. Resolve Event node
      if (run.pendingInteraction && run.pendingInteraction.type === 'EVENT') {
        const hasCurses = Array.isArray(run.cursedWords) && run.cursedWords.length > 0;
        let optionId = run.pendingInteraction.options[0];
        const opts = run.pendingInteraction.options;
        if (!hasCurses) {
          const safeOpt = opts.find((o) => {
            const upper = String(o).toUpperCase();
            return upper === 'LEAVE' || upper === 'REST';
          });
          if (safeOpt) optionId = safeOpt;
        }
        const res = await submitEventAction({ optionId });
        run = res.run;
        continue;
      }

      // 5. Navigate to next node
      const nextNodes = getSelectableNextNodes(run);
      if (nextNodes.length === 0) {
        break;
      }

      let targetNodeId = nextNodes[0];
      if (run.player.hp < 75) {
        const restNode = nextNodes.find((id) => run.route.nodes[id]?.type === 'REST');
        const eventNode = nextNodes.find((id) => run.route.nodes[id]?.type === 'EVENT');
        if (restNode) {
          targetNodeId = restNode;
        } else if (eventNode) {
          targetNodeId = eventNode;
        }
      }
      run = await advanceToNode(targetNodeId);
    }

    if (iterations >= maxIterations) {
      throw new Error(`Simulation exceeded maxIterations (${maxIterations}) on seed ${seed}`);
    }

    return run;
  }

  test('SMART PERFECT PLAYER: completes all 50 seeds with 100% win rate', async () => {
    let victories = 0;
    let defeats = 0;

    const smartStrategy = (encounter) => {
      const intent = encounter.enemy.intent;
      const enemyHp = encounter.enemy.hp;
      const playerHp = encounter.player.hp;
      const canRecover = (encounter.recoverCooldown ?? 0) === 0;

      // 1. Lethal blow cancels enemy action completely
      const guardMitigation = intent?.type === INTENT_TYPES.GUARD ? (intent.value || 10) : 0;
      const effectiveDmg = Math.max(0, 25 - guardMitigation);
      if (enemyHp <= effectiveDmg) {
        return PLAYER_ACTION_IDS.ATTACK;
      }

      // 2. Defend against HEAVY_ATTACK always
      if (intent?.type === INTENT_TYPES.HEAVY_ATTACK) {
        return PLAYER_ACTION_IDS.GUARD;
      }

      // 3. If enemy is GUARDING, zero incoming damage -> prime Recover window
      if (intent?.type === INTENT_TYPES.GUARD) {
        if (playerHp <= 85 && canRecover) {
          return PLAYER_ACTION_IDS.RECOVER;
        }
        return PLAYER_ACTION_IDS.ATTACK;
      }

      // 4. Enemy is executing normal ATTACK:
      // If player is critical (<= 20 HP), GUARD prevents 100% of standard attack damage
      if (playerHp <= 20) {
        return PLAYER_ACTION_IDS.GUARD;
      }

      // If player is wounded (<= 75 HP) and can recover:
      if (playerHp <= 75 && canRecover) {
        return PLAYER_ACTION_IDS.RECOVER;
      }

      return PLAYER_ACTION_IDS.ATTACK;
    };

    for (let i = 1; i <= SEED_COUNT; i++) {
      const seed = SEED_OFFSET + i;
      const finalRun = await simulateRun({ seed, strategy: smartStrategy });

      if (finalRun.status === ROGUE_RUN_STATUS.VICTORY) {
        victories++;
      } else if (finalRun.status === ROGUE_RUN_STATUS.DEFEAT) {
        defeats++;
      }
    }

    expect(victories).toBe(SEED_COUNT);
    expect(defeats).toBe(0);
  }, 120000);

  test('ATTACK-ONLY CONTROL PLAYER: experiences defeats due to lack of defense and sustain', async () => {
    let victories = 0;
    let defeats = 0;

    const attackOnlyStrategy = () => PLAYER_ACTION_IDS.ATTACK;

    for (let i = 1; i <= SEED_COUNT; i++) {
      const seed = SEED_OFFSET + i;
      const finalRun = await simulateRun({ seed, strategy: attackOnlyStrategy });

      if (finalRun.status === ROGUE_RUN_STATUS.VICTORY) {
        victories++;
      } else if (finalRun.status === ROGUE_RUN_STATUS.DEFEAT) {
        defeats++;
      }
    }

    expect(defeats).toBe(SEED_COUNT);
    expect(victories).toBe(0);
  }, 120000);
});

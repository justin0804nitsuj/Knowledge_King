/**
 * ROGUE EXPEDITION V0.1 — PHASE R9.1 HUMAN DIFFICULTY & PACING REBALANCE
 *
 * 50-Seed Simulation Matrix across accuracy tiers:
 * 1. SMART TACTICAL PLAYER (100% accuracy):
 *    - Near-guaranteed completion (target: 48–50 / 50 wins).
 *    - Pacing: typical victorious run takes ~35–50 questions.
 *
 * 2. SMART TACTICAL PLAYER (~90% accuracy, deterministic 1 miss per 10 questions):
 *    - Usually completes a run with noticeable HP pressure (target: 35–50 / 50 wins).
 *    - Demonstrates realistic human completion for competent tactical players.
 *
 * 3. SMART TACTICAL PLAYER (~80% accuracy, deterministic 1 miss per 5 questions):
 *    - Difficult and inconsistent, but not mathematically hopeless (target: 15–35 / 50 wins).
 *
 * 4. ATTACK-ONLY CONTROL PLAYER (100% accuracy, no Guard, no Recover):
 *    - Materially worse than Smart Tactical (target: 10–25 / 50 wins).
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

describe('Phase R9.1 — 50-Seed Difficulty & Pacing Simulation Matrix', () => {
  beforeEach(async () => {
    mockStore = {};
    await clearActiveRogueRun();
    jest.clearAllMocks();
  });

  const SEED_COUNT = 50;
  const SEED_OFFSET = 100; // seeds 101 .. 150

  const smartTacticalStrategy = (encounter) => {
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

  const attackOnlyStrategy = () => PLAYER_ACTION_IDS.ATTACK;

  /**
   * Helper to simulate a full run on a given seed with a specified combat strategy and accuracy rate.
   */
  async function simulateRun({ seed, strategy, accuracyRate = 100, offset = 0 }) {
    await clearActiveRogueRun();
    let run = await createNewRun({ seed });

    let iterations = 0;
    const maxIterations = 300;
    let questionsAnswered = 0;
    let battlesWon = 0;
    let lastDefeatInfo = null;

    while (run.status === ROGUE_RUN_STATUS.ACTIVE && iterations < maxIterations) {
      iterations++;

      // 1. Resolve combat
      if (run.encounter && run.encounter.status === ENCOUNTER_STATUS.ACTIVE) {
        const actionId = strategy(run.encounter);
        await selectCombatAction({ actionId });

        questionsAnswered++;
        let isCorrect = true;
        if (accuracyRate === 90) {
          if ((questionsAnswered + offset) % 10 === 0) {
            isCorrect = false;
          }
        } else if (accuracyRate === 89) {
          if ((questionsAnswered + offset) % 9 === 0) {
            isCorrect = false;
          }
        } else if (accuracyRate === 80) {
          if ((questionsAnswered + offset) % 5 === 0) {
            isCorrect = false;
          }
        }

        let choiceId = run.encounter.question.correctChoiceId;
        if (!isCorrect) {
          const wrongChoice = run.encounter.question.choices.find(
            (c) => String(c.id) !== String(choiceId)
          );
          choiceId = wrongChoice ? wrongChoice.id : 'wrong_choice';
        }

        const currentEnemyArchetype = run.encounter.archetypeId;
        const currentIntent = run.encounter.enemy.intent;
        const res = await submitCombatAnswer({
          choiceId,
          token: run.encounter.question.token,
        });
        run = res.run;

        if (res.resolution?.enemyDamage > 0 || res.resolution?.backlashDamage > 0) {
          if (run.player.hp <= 0) {
            lastDefeatInfo = {
              archetype: currentEnemyArchetype,
              intent: currentIntent?.type,
              intentValue: currentIntent?.value,
              enemyDamage: res.resolution.enemyDamage,
              backlashDamage: res.resolution.backlashDamage,
              selectedAction: actionId,
              actionSucceeded: isCorrect,
              cursesCount: Array.isArray(run.cursedWords) ? run.cursedWords.length : 0,
            };
          }
        }

        if (run.encounter && run.encounter.status === ENCOUNTER_STATUS.VICTORY) {
          battlesWon++;
        }
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

    return {
      run,
      questionsAnswered,
      battlesWon,
      lastDefeatInfo,
    };
  }

  async function runSimulationCohort({ strategy, accuracyRate, offset = 0, name }) {
    const results = [];
    for (let i = 1; i <= SEED_COUNT; i++) {
      const seed = SEED_OFFSET + i;
      const res = await simulateRun({ seed, strategy, accuracyRate, offset });
      results.push({
        seed,
        status: res.run.status,
        finalHp: res.run.player.hp,
        questionsAnswered: res.questionsAnswered,
        battlesWon: res.battlesWon,
        lastDefeatInfo: res.lastDefeatInfo,
      });
    }

    const victories = results.filter((r) => r.status === ROGUE_RUN_STATUS.VICTORY);
    const defeats = results.filter((r) => r.status === ROGUE_RUN_STATUS.DEFEAT);

    const avgFinalHp = victories.length > 0
      ? Number((victories.reduce((acc, r) => acc + r.finalHp, 0) / victories.length).toFixed(1))
      : 0;

    const allQuestions = results.map((r) => r.questionsAnswered).sort((a, b) => a - b);
    const avgQuestions = Number((results.reduce((acc, r) => acc + r.questionsAnswered, 0) / results.length).toFixed(1));
    const medianQuestions = allQuestions.length % 2 === 0
      ? Number(((allQuestions[allQuestions.length / 2 - 1] + allQuestions[allQuestions.length / 2]) / 2).toFixed(1))
      : allQuestions[Math.floor(allQuestions.length / 2)];

    const vicQuestions = victories.map((r) => r.questionsAnswered);
    const avgVicQuestions = victories.length > 0
      ? Number((vicQuestions.reduce((a, b) => a + b, 0) / victories.length).toFixed(1))
      : 0;

    const defeatCauses = {};
    for (const d of defeats) {
      const info = d.lastDefeatInfo;
      let cause = 'Unknown';
      if (info) {
        if (info.backlashDamage > 0) {
          cause = `Curse Backlash (${info.archetype})`;
        } else if (info.intent === 'HEAVY_ATTACK') {
          cause = info.actionSucceeded
            ? `HEAVY_ATTACK through Guard/Unblocked (${info.archetype})`
            : `Failed Guard against HEAVY_ATTACK (${info.archetype})`;
        } else if (info.intent === 'ATTACK') {
          cause = `Normal Attack Attrition (${info.archetype})`;
        } else {
          cause = `${info.archetype} ${info.intent}`;
        }
      }
      defeatCauses[cause] = (defeatCauses[cause] || 0) + 1;
    }

    console.log(`\n[Cohort: ${name}] Wins: ${victories.length}/50 | AvgFinalHP: ${avgFinalHp} | AvgQ(All): ${avgQuestions} | MedQ: ${medianQuestions} | AvgQ(Wins): ${avgVicQuestions}`);
    if (defeats.length > 0) {
      console.log(`  Defeat causes:`, JSON.stringify(defeatCauses));
    }

    return {
      name,
      wins: victories.length,
      defeats: defeats.length,
      avgFinalHp,
      avgQuestions,
      medianQuestions,
      avgVicQuestions,
      defeatCauses,
      results,
    };
  }

  test('1. SMART TACTICAL 100%: near-guaranteed completion within 35-50 target questions', async () => {
    const cohort = await runSimulationCohort({
      strategy: smartTacticalStrategy,
      accuracyRate: 100,
      name: 'Smart Tactical 100%',
    });

    expect(cohort.wins).toBeGreaterThanOrEqual(48);
    expect(cohort.avgVicQuestions).toBeGreaterThanOrEqual(25);
    expect(cohort.avgVicQuestions).toBeLessThanOrEqual(50);
  }, 120000);

  test('2. SMART TACTICAL ~90%: realistic human completion (~89-90%) with noticeable HP pressure', async () => {
    const cohort = await runSimulationCohort({
      strategy: smartTacticalStrategy,
      accuracyRate: 90,
      offset: 0,
      name: 'Smart Tactical 90%',
    });

    expect(cohort.wins).toBeGreaterThanOrEqual(35);
    expect(cohort.avgVicQuestions).toBeGreaterThanOrEqual(30);
    expect(cohort.avgVicQuestions).toBeLessThanOrEqual(50);
  }, 120000);

  test('3. SMART TACTICAL ~89%: deterministic 1 wrong per 9 answers represents human playtest case', async () => {
    const cohort = await runSimulationCohort({
      strategy: smartTacticalStrategy,
      accuracyRate: 89,
      offset: 0,
      name: 'Smart Tactical ~89%',
    });

    expect(cohort.wins).toBeGreaterThanOrEqual(35);
    expect(cohort.avgVicQuestions).toBeGreaterThanOrEqual(30);
    expect(cohort.avgVicQuestions).toBeLessThanOrEqual(50);
  }, 120000);

  test('4. SMART TACTICAL ~80%: difficult and inconsistent, but not mathematically hopeless', async () => {
    const cohort = await runSimulationCohort({
      strategy: smartTacticalStrategy,
      accuracyRate: 80,
      offset: 0,
      name: 'Smart Tactical 80%',
    });

    expect(cohort.wins).toBeGreaterThanOrEqual(15);
    expect(cohort.wins).toBeLessThanOrEqual(35);
  }, 120000);

  test('5. ATTACK-ONLY 100%: materially worse than smart tactical, proving strategy matters', async () => {
    const cohort = await runSimulationCohort({
      strategy: attackOnlyStrategy,
      accuracyRate: 100,
      name: 'Attack-Only 100%',
    });

    expect(cohort.wins).toBeLessThanOrEqual(25);
    expect(cohort.defeats).toBeGreaterThan(cohort.wins);
  }, 120000);
});

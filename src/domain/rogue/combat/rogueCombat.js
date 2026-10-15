/**
 * ROGUE EXPEDITION V0.1 — PURE COMBAT STATE & TURN RESOLUTION
 *
 * Implements the Answer -> Action core loop:
 * 1. Player answers vocabulary question
 * 2. Correct answer deals player damage; wrong answer deals 0 normal damage
 * 3. Enemy responds with intent attack unless defeated by that answer
 * 4. Advances to next question if encounter remains ACTIVE
 * 5. Strict turn idempotency via unique question tokens
 */

import {
  ROGUE_COMBAT_CONSTANTS,
  getEnemyConfigForNodeType,
  getRogueQuestionDifficulty,
} from './rogueCombatConfig';
import { getRogueQuestion } from './rogueQuestionProvider';

export const CURRENT_ENCOUNTER_SCHEMA_VERSION = 1;

export const ENCOUNTER_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  VICTORY: 'VICTORY',
  DEFEAT: 'DEFEAT',
});

/**
 * Creates a brand new combat encounter for a map node.
 *
 * @param {object} params
 * @param {string} params.nodeId
 * @param {string} [params.nodeType='BATTLE']
 * @param {number} [params.playerHp=100]
 * @param {number} [params.playerMaxHp=100]
 * @param {number|string} [params.seed]
 * @param {object} [params.customQuestion] - Optional mock question for testing
 * @param {object} [params.run]
 * @returns {object} Pure encounter state
 */
export function createEncounter({
  nodeId,
  nodeType = 'BATTLE',
  playerHp = ROGUE_COMBAT_CONSTANTS.PLAYER_MAX_HP,
  playerMaxHp = ROGUE_COMBAT_CONSTANTS.PLAYER_MAX_HP,
  seed,
  customQuestion,
  run,
} = {}) {
  const encounterId = `enc_${nodeId}_${Date.now()}`;
  const enemyConfig = getEnemyConfigForNodeType(nodeType);

  const initialHp = Math.max(1, Math.min(playerHp, playerMaxHp));
  const difficultyLevel = getRogueQuestionDifficulty({ nodeId, type: nodeType }, run);

  const firstQuestion = getRogueQuestion({
    level: difficultyLevel,
    encounterId,
    turn: 1,
    seed,
    customQuestion,
  });

  return {
    schemaVersion: CURRENT_ENCOUNTER_SCHEMA_VERSION,
    encounterId,
    nodeId,
    nodeType,
    status: ENCOUNTER_STATUS.ACTIVE,
    turn: 1,
    player: {
      hp: initialHp,
      maxHp: playerMaxHp,
    },
    enemy: {
      enemyId: enemyConfig.enemyId,
      name: enemyConfig.name,
      hp: enemyConfig.hp,
      maxHp: enemyConfig.maxHp,
      baseDamage: enemyConfig.baseDamage,
      intent: {
        type: 'ATTACK',
        value: enemyConfig.baseDamage,
      },
    },
    question: firstQuestion,
    resolvedQuestionTokens: [],
    lastResolution: null,
    stats: {
      correctAnswers: 0,
      wrongAnswers: 0,
      totalDamageDealt: 0,
      totalDamageTaken: 0,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Resolves an encounter turn given a selected choice ID and question token.
 *
 * Idempotency Invariant:
 * Submitting the same question token twice is a strict NO-OP.
 *
 * @param {object} encounter - Current encounter state
 * @param {object} action
 * @param {string} action.choiceId - The choice ID picked by the player
 * @param {string} action.token - Question token being answered
 * @param {object} [options]
 * @param {number|string} [options.seed] - Seed for next question generation
 * @param {object} [options.nextQuestion] - Injected next question for testing
 * @returns {{ encounter: object, resolved: boolean, reason?: string }}
 */
export function resolveEncounterTurn(encounter, action, options = {}) {
  if (!encounter || typeof encounter !== 'object') {
    throw new Error('[RogueCombat] Invalid encounter state');
  }

  // Gating: finished encounters cannot resolve further turns
  if (encounter.status !== ENCOUNTER_STATUS.ACTIVE) {
    return { encounter, resolved: false, reason: 'ENCOUNTER_NOT_ACTIVE' };
  }

  const { choiceId, token } = action || {};
  if (!choiceId || !token) {
    return { encounter, resolved: false, reason: 'INVALID_ACTION_PAYLOAD' };
  }

  // Idempotency: token must match current question and not be previously resolved
  if (token !== encounter.question?.token) {
    return { encounter, resolved: false, reason: 'TOKEN_MISMATCH' };
  }

  if (encounter.resolvedQuestionTokens.includes(token)) {
    return { encounter, resolved: false, reason: 'TOKEN_ALREADY_RESOLVED' };
  }

  // 1. Evaluate Player Answer
  const isCorrect = String(choiceId) === String(encounter.question.correctChoiceId);
  const playerDamage = isCorrect
    ? ROGUE_COMBAT_CONSTANTS.PLAYER_ATTACK_DAMAGE
    : ROGUE_COMBAT_CONSTANTS.PLAYER_WRONG_DAMAGE;

  const newEnemyHp = Math.max(0, encounter.enemy.hp - playerDamage);
  const enemyDefeated = newEnemyHp <= 0;

  // 2. Enemy Response (only if enemy was NOT defeated by this lethal answer)
  let enemyDamage = 0;
  if (!enemyDefeated) {
    enemyDamage = encounter.enemy.intent?.value || encounter.enemy.baseDamage || 10;
  }

  const newPlayerHp = Math.max(0, Math.min(encounter.player.hp - enemyDamage, encounter.player.maxHp));
  const playerDefeated = newPlayerHp <= 0;

  // 3. Status Transition
  let nextStatus = ENCOUNTER_STATUS.ACTIVE;
  if (enemyDefeated) {
    nextStatus = ENCOUNTER_STATUS.VICTORY;
  } else if (playerDefeated) {
    nextStatus = ENCOUNTER_STATUS.DEFEAT;
  }

  // 4. Update Stats
  const nextStats = {
    correctAnswers: encounter.stats.correctAnswers + (isCorrect ? 1 : 0),
    wrongAnswers: encounter.stats.wrongAnswers + (isCorrect ? 0 : 1),
    totalDamageDealt: encounter.stats.totalDamageDealt + playerDamage,
    totalDamageTaken: encounter.stats.totalDamageTaken + enemyDamage,
  };

  const nextResolvedTokens = [...encounter.resolvedQuestionTokens, token];

  const resolution = {
    token,
    chosenChoiceId: String(choiceId),
    correct: isCorrect,
    playerDamage,
    enemyDamage,
  };

  // 5. Generate Next Question if battle continues
  let nextQuestion = encounter.question;
  const nextTurn = encounter.turn + 1;

  if (nextStatus === ENCOUNTER_STATUS.ACTIVE) {
    if (options.nextQuestion) {
      nextQuestion = options.nextQuestion;
    } else {
      const difficultyLevel = getRogueQuestionDifficulty({
        nodeId: encounter.nodeId,
        type: encounter.nodeType,
      });
      nextQuestion = getRogueQuestion({
        level: difficultyLevel,
        encounterId: encounter.encounterId,
        turn: nextTurn,
        seed: options.seed,
      });
    }
  }

  const updatedEncounter = {
    ...encounter,
    status: nextStatus,
    turn: nextStatus === ENCOUNTER_STATUS.ACTIVE ? nextTurn : encounter.turn,
    player: {
      ...encounter.player,
      hp: newPlayerHp,
    },
    enemy: {
      ...encounter.enemy,
      hp: newEnemyHp,
      intent: {
        type: 'ATTACK',
        value: encounter.enemy.baseDamage,
      },
    },
    question: nextQuestion,
    resolvedQuestionTokens: nextResolvedTokens,
    lastResolution: resolution,
    stats: nextStats,
    updatedAt: Date.now(),
  };

  return {
    encounter: updatedEncounter,
    resolved: true,
    resolution,
  };
}

/**
 * ROGUE EXPEDITION V0.1 — PURE COMBAT STATE & TURN RESOLUTION
 *
 * Implements the Answer -> Action core loop with Enemy Intents & Archetypes:
 * 1. Current enemy intent is visible before answer.
 * 2. Player answers vocabulary question.
 * 3. Player action resolved (mitigated if enemy intent is GUARD).
 * 4. Lethal player hit cancels enemy response immediately.
 * 5. If enemy survives, enemy executes its intent (ATTACK, HEAVY_ATTACK, or GUARD).
 * 6. Turn advances: next intent and next question prepared for next turn.
 * 7. Strict turn idempotency via unique question tokens.
 */

import {
  ROGUE_COMBAT_CONSTANTS,
  getRogueQuestionDifficulty,
} from './rogueCombatConfig';
import {
  INTENT_TYPES,
  ARCHETYPE_IDS,
  ENEMY_ARCHETYPES,
  selectArchetypeForNode,
  getArchetype,
  getIntentForTurn,
  validateEncounterIntegrity,
} from './enemyArchetypes';
import { getRogueQuestion } from './rogueQuestionProvider';

export const CURRENT_ENCOUNTER_SCHEMA_VERSION = 1;

export const ENCOUNTER_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  VICTORY: 'VICTORY',
  DEFEAT: 'DEFEAT',
});

/**
 * Creates a brand new combat encounter for a map node with assigned archetype.
 *
 * @param {object} params
 * @param {string} params.nodeId
 * @param {string} [params.nodeType='BATTLE']
 * @param {number} [params.playerHp=100]
 * @param {number} [params.playerMaxHp=100]
 * @param {number|string} [params.seed]
 * @param {string} [params.archetypeId] - Optional explicit archetype override for testing
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
  archetypeId,
  customQuestion,
  run,
} = {}) {
  const encounterId = `enc_${nodeId}_${Date.now()}`;
  const resolvedSeed = seed !== undefined ? seed : run?.seed;

  // Resolve archetype deterministically
  const assignedArchetypeId =
    archetypeId || selectArchetypeForNode(nodeType, resolvedSeed, nodeId);
  const archetype = getArchetype(assignedArchetypeId) || ENEMY_ARCHETYPES[ARCHETYPE_IDS.SCOUT];

  const initialHp = Math.max(1, Math.min(playerHp, playerMaxHp));
  const difficultyLevel = getRogueQuestionDifficulty({ nodeId, type: nodeType }, run);

  const initialIntent = getIntentForTurn(archetype, 1);

  const firstQuestion = getRogueQuestion({
    level: difficultyLevel,
    encounterId,
    turn: 1,
    seed: resolvedSeed,
    customQuestion,
  });

  return {
    schemaVersion: CURRENT_ENCOUNTER_SCHEMA_VERSION,
    encounterId,
    nodeId,
    nodeType,
    archetypeId: archetype.id,
    status: ENCOUNTER_STATUS.ACTIVE,
    turn: 1,
    player: {
      hp: initialHp,
      maxHp: playerMaxHp,
    },
    enemy: {
      enemyId: `enemy_${archetype.id.toLowerCase()}`,
      archetypeId: archetype.id,
      nameKey: archetype.nameKey,
      name: archetype.defaultName,
      hp: archetype.hp,
      maxHp: archetype.maxHp,
      baseDamage: archetype.baseDamage,
      intent: initialIntent,
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
 * Enforces canonical turn resolution order:
 * 1. Current intent already exists and is visible before answering.
 * 2. Player answers question.
 * 3. Player action resolved (reduced if current intent is GUARD).
 * 4. If enemy HP <= 0 -> VICTORY (enemy action is skipped).
 * 5. Otherwise enemy executes intent (ATTACK, HEAVY_ATTACK, or GUARD).
 * 6. If player HP <= 0 -> DEFEAT.
 * 7. Next turn derived deterministically (next intent + next question).
 *
 * @param {object} encounter - Current encounter state
 * @param {object} action
 * @param {string} action.choiceId - The choice ID picked by the player
 * @param {string} action.token - Question token being answered
 * @param {object} [options]
 * @param {number|string} [options.seed] - Seed for next question generation
 * @param {object} [options.nextQuestion] - Injected next question for testing
 * @returns {{ encounter: object, resolved: boolean, reason?: string, resolution?: object }}
 */
export function resolveEncounterTurn(encounter, action, options = {}) {
  if (!encounter || typeof encounter !== 'object') {
    throw new Error('[RogueCombat] Invalid encounter state');
  }

  // Integrity validation
  const validation = validateEncounterIntegrity(encounter);
  if (!validation.valid) {
    throw new Error(`[RogueCombat] Corrupted encounter state: ${validation.errors.join('; ')}`);
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

  const currentIntent = encounter.enemy.intent;
  const archetype = getArchetype(encounter.archetypeId) || ENEMY_ARCHETYPES[ARCHETYPE_IDS.SCOUT];

  // 1. Evaluate Player Answer
  const isCorrect = String(choiceId) === String(encounter.question.correctChoiceId);
  const basePlayerDamage = isCorrect
    ? ROGUE_COMBAT_CONSTANTS.PLAYER_ATTACK_DAMAGE
    : ROGUE_COMBAT_CONSTANTS.PLAYER_WRONG_DAMAGE;

  // 2. Apply Current Intent Defensive Modifiers (GUARD)
  let effectivePlayerDamage = basePlayerDamage;
  let guardMitigated = 0;

  if (currentIntent.type === INTENT_TYPES.GUARD && isCorrect) {
    const mitigation = currentIntent.value || archetype.guardMitigation || 10;
    effectivePlayerDamage = Math.max(0, basePlayerDamage - mitigation);
    guardMitigated = Math.min(basePlayerDamage, mitigation);
  }

  const newEnemyHp = Math.max(0, encounter.enemy.hp - effectivePlayerDamage);
  const enemyDefeated = newEnemyHp <= 0;

  // 3. Enemy Action Resolution
  let enemyDamage = 0;
  if (!enemyDefeated) {
    if (currentIntent.type === INTENT_TYPES.ATTACK || currentIntent.type === INTENT_TYPES.HEAVY_ATTACK) {
      enemyDamage = currentIntent.value;
    } else if (currentIntent.type === INTENT_TYPES.GUARD) {
      // Guard turn: enemy deals no attack damage
      enemyDamage = 0;
    }
  }

  const newPlayerHp = Math.max(0, Math.min(encounter.player.hp - enemyDamage, encounter.player.maxHp));
  const playerDefeated = newPlayerHp <= 0;

  // 4. Status Transition
  let nextStatus = ENCOUNTER_STATUS.ACTIVE;
  if (enemyDefeated) {
    nextStatus = ENCOUNTER_STATUS.VICTORY;
  } else if (playerDefeated) {
    nextStatus = ENCOUNTER_STATUS.DEFEAT;
  }

  // 5. Update Stats
  const nextStats = {
    correctAnswers: encounter.stats.correctAnswers + (isCorrect ? 1 : 0),
    wrongAnswers: encounter.stats.wrongAnswers + (isCorrect ? 0 : 1),
    totalDamageDealt: encounter.stats.totalDamageDealt + effectivePlayerDamage,
    totalDamageTaken: encounter.stats.totalDamageTaken + enemyDamage,
  };

  const nextResolvedTokens = [...encounter.resolvedQuestionTokens, token];

  const resolution = {
    token,
    chosenChoiceId: String(choiceId),
    correct: isCorrect,
    playerDamage: effectivePlayerDamage,
    guardMitigated,
    enemyDamage,
    executedIntent: { ...currentIntent },
  };

  // 6. Next Turn Generation (Intent + Question for turn + 1)
  let nextQuestion = encounter.question;
  const nextTurn = encounter.turn + 1;
  let nextIntent = currentIntent;

  if (nextStatus === ENCOUNTER_STATUS.ACTIVE) {
    // Derive next intent deterministically from (archetype, nextTurn)
    nextIntent = getIntentForTurn(archetype, nextTurn);

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
      intent: nextIntent,
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

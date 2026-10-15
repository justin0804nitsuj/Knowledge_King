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
import {
  applyCurseWrongAnswer,
  applyCurseCorrectAnswer,
} from '../curse/cursedWordModel';
import { getRogueQuestion } from './rogueQuestionProvider';
import { RELIC_IDS } from '../relic/relicRegistry';
import {
  modifyPlayerAttackDamage,
  modifyGuardMitigation,
  getCursePurificationAmount,
  modifyCurseBacklashDamage,
  shouldPreventNewCurse,
  onCursePurified,
  applyLethalProtection,
} from '../relic/relicEffects';

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
 * @param {Array<object>} [params.cursedWords]
 * @param {Array<string>} [params.relics]
 * @param {object} [params.relicState]
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
  cursedWords,
  relics,
  relicState,
  run,
} = {}) {
  const encounterId = `enc_${nodeId}_${Date.now()}`;
  const resolvedSeed = seed !== undefined ? seed : run?.seed;
  const initialCursedWords = Array.isArray(cursedWords)
    ? [...cursedWords]
    : Array.isArray(run?.cursedWords)
    ? [...run.cursedWords]
    : [];

  const initialRelics = Array.isArray(relics)
    ? [...relics]
    : Array.isArray(run?.relics)
    ? [...run.relics]
    : [];

  const initialRunRelicState = relicState
    ? { ...relicState }
    : run?.relicState
    ? { ...run.relicState }
    : {};

  const initialEncounterRelicState = {
    [RELIC_IDS.MNEMONIC_CHARM]: {
      usedThisEncounter: false,
    },
  };

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
    cursedWords: initialCursedWords,
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
    cursedWords: initialCursedWords,
    relics: initialRelics,
    runRelicState: initialRunRelicState,
    encounterRelicState: initialEncounterRelicState,
    resolvedQuestionTokens: [],
    lastResolution: null,
    stats: {
      correctAnswers: 0,
      wrongAnswers: 0,
      totalDamageDealt: 0,
      totalDamageTaken: 0,
      curseBacklashTaken: 0,
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

  const currentCursedWords = Array.isArray(encounter.cursedWords)
    ? encounter.cursedWords
    : [];

  const activeRelics = Array.isArray(options.relics)
    ? options.relics
    : Array.isArray(encounter.relics)
    ? encounter.relics
    : [];

  let currentRunRelicState = { ...(options.runRelicState || encounter.runRelicState || {}) };
  let currentEncounterRelicState = { ...(encounter.encounterRelicState || {}) };
  const relicTriggers = [];

  const questionWordId =
    encounter.question?.wordId ||
    encounter.question?.targetId ||
    encounter.question?.word ||
    'unknown';
  const questionWord = encounter.question?.word || questionWordId;
  const questionLevel = encounter.question?.level || 1;
  const isCursedReview = Boolean(encounter.question?.isCursed);

  // 1. Evaluate Player Answer
  const isCorrect = String(choiceId) === String(encounter.question.correctChoiceId);
  const rawBaseDamage = isCorrect
    ? ROGUE_COMBAT_CONSTANTS.PLAYER_ATTACK_DAMAGE
    : ROGUE_COMBAT_CONSTANTS.PLAYER_WRONG_DAMAGE;

  // 2. Apply player-damage relic modifiers (Glass Quill: +10 on correct attack)
  const { playerDamage: basePlayerDamage, glassQuillBonus } = modifyPlayerAttackDamage({
    baseDamage: rawBaseDamage,
    relics: activeRelics,
  });
  if (glassQuillBonus > 0) {
    relicTriggers.push({
      relicId: RELIC_IDS.GLASS_QUILL,
      type: 'DAMAGE_BONUS',
      value: glassQuillBonus,
    });
  }

  // 3. Apply Current Intent Defensive Modifiers (GUARD) & Piercing Nib
  let effectivePlayerDamage = basePlayerDamage;
  let guardMitigated = 0;
  let guardPierced = 0;

  if (currentIntent.type === INTENT_TYPES.GUARD && isCorrect) {
    const rawMitigation = currentIntent.value || archetype.guardMitigation || 10;
    const { effectiveMitigation, guardPierced: pierced } = modifyGuardMitigation({
      mitigation: rawMitigation,
      relics: activeRelics,
    });
    effectivePlayerDamage = Math.max(0, basePlayerDamage - effectiveMitigation);
    guardMitigated = Math.min(basePlayerDamage, effectiveMitigation);
    guardPierced = pierced;
    if (guardPierced > 0) {
      relicTriggers.push({
        relicId: RELIC_IDS.PIERCING_NIB,
        type: 'GUARD_PIERCED',
        value: guardPierced,
      });
    }
  }

  const newEnemyHp = Math.max(0, encounter.enemy.hp - effectivePlayerDamage);
  const enemyDefeated = newEnemyHp <= 0;

  // 4. Resolve Cursed Word State Transition & Relic Modifiers
  let nextCursedWords = currentCursedWords;
  let curseResult = null;
  let currentPlayerHp = encounter.player.hp;
  let inkHeal = 0;

  if (isCorrect) {
    if (isCursedReview) {
      const purificationAmount = getCursePurificationAmount({ relics: activeRelics });
      if (purificationAmount > 1) {
        relicTriggers.push({
          relicId: RELIC_IDS.SCHOLARS_LENS,
          type: 'PURIFICATION_BONUS',
          value: purificationAmount,
        });
      }

      const res = applyCurseCorrectAnswer(currentCursedWords, {
        wordId: questionWordId,
        word: questionWord,
        turn: encounter.turn,
        purificationAmount,
      });
      nextCursedWords = res.cursedWords;
      curseResult = res.curseResult;

      // Purifying Ink: Heals 10 HP upon full purification
      if (curseResult?.type === 'CURSE_PURIFIED') {
        const { healedHp, actualHeal } = onCursePurified({
          playerHp: currentPlayerHp,
          playerMaxHp: encounter.player.maxHp,
          relics: activeRelics,
        });
        currentPlayerHp = healedHp;
        inkHeal = actualHeal;
        if (actualHeal > 0) {
          relicTriggers.push({
            relicId: RELIC_IDS.PURIFYING_INK,
            type: 'HEAL',
            value: actualHeal,
          });
        }
      }
    }
  } else {
    // Wrong answer
    if (!isCursedReview) {
      // Normal word mistake: Check Mnemonic Charm
      const preventCurse = shouldPreventNewCurse({
        isNormalMistake: true,
        relics: activeRelics,
        encounterRelicState: currentEncounterRelicState,
      });

      if (preventCurse) {
        currentEncounterRelicState = {
          ...currentEncounterRelicState,
          [RELIC_IDS.MNEMONIC_CHARM]: { usedThisEncounter: true },
        };
        relicTriggers.push({
          relicId: RELIC_IDS.MNEMONIC_CHARM,
          type: 'CURSE_PREVENTED',
        });
        curseResult = {
          type: 'CURSE_PREVENTED',
          wordId: questionWordId,
          word: questionWord,
          previousStacks: 0,
          stacks: 0,
          backlash: 0,
        };
      } else {
        const res = applyCurseWrongAnswer(currentCursedWords, {
          wordId: questionWordId,
          word: questionWord,
          level: questionLevel,
          turn: encounter.turn,
          isCursedReview: false,
          firstCursedAt: encounter.stats.wrongAnswers + 1,
          firstCursedOrder: encounter.stats.wrongAnswers + 1,
        });
        nextCursedWords = res.cursedWords;
        curseResult = res.curseResult;
      }
    } else {
      // Cursed review failed: normal stack increment & backlash
      const res = applyCurseWrongAnswer(currentCursedWords, {
        wordId: questionWordId,
        word: questionWord,
        level: questionLevel,
        turn: encounter.turn,
        isCursedReview: true,
        firstCursedAt: encounter.stats.wrongAnswers + 1,
        firstCursedOrder: encounter.stats.wrongAnswers + 1,
      });
      nextCursedWords = res.cursedWords;
      curseResult = res.curseResult;
    }
  }

  // 5. Calculate Curse Backlash & Glass Quill tradeoff
  const rawBacklash = curseResult?.backlash || 0;
  let effectiveBacklash = rawBacklash;
  let glassQuillBacklashBonus = 0;

  if (rawBacklash > 0 && isCursedReview) {
    const backlashRes = modifyCurseBacklashDamage({
      backlash: rawBacklash,
      isCursedReview: true,
      relics: activeRelics,
    });
    effectiveBacklash = backlashRes.effectiveBacklash;
    glassQuillBacklashBonus = backlashRes.glassQuillBacklashBonus;
    if (glassQuillBacklashBonus > 0) {
      relicTriggers.push({
        relicId: RELIC_IDS.GLASS_QUILL,
        type: 'BACKLASH_BONUS',
        value: glassQuillBacklashBonus,
      });
    }
  }

  // 6. Combat Status Transition & Canonical Damage Resolution
  let nextStatus = ENCOUNTER_STATUS.ACTIVE;
  let enemyDamage = 0;
  let secondChanceTriggered = false;

  if (enemyDefeated) {
    // Lethal player hit: victory immediately; enemy action skipped; curse updates & healing persist!
    nextStatus = ENCOUNTER_STATUS.VICTORY;
  } else {
    // Enemy survived: apply Curse Backlash if applicable
    if (effectiveBacklash > 0) {
      const lethalRes = applyLethalProtection({
        currentHp: currentPlayerHp,
        incomingDamage: effectiveBacklash,
        relics: activeRelics,
        runRelicState: currentRunRelicState,
      });
      currentPlayerHp = lethalRes.newHp;
      if (lethalRes.protected) {
        secondChanceTriggered = true;
        currentRunRelicState = {
          ...currentRunRelicState,
          [RELIC_IDS.SECOND_CHANCE]: { consumed: true },
        };
        relicTriggers.push({
          relicId: RELIC_IDS.SECOND_CHANCE,
          type: 'LETHAL_PROTECTION',
          source: 'BACKLASH',
        });
      }
    }

    if (currentPlayerHp <= 0) {
      // Player defeated by Curse Backlash; enemy action skipped
      nextStatus = ENCOUNTER_STATUS.DEFEAT;
    } else {
      // Player survived backlash: enemy executes intent
      if (currentIntent.type === INTENT_TYPES.ATTACK || currentIntent.type === INTENT_TYPES.HEAVY_ATTACK) {
        enemyDamage = currentIntent.value;
      } else if (currentIntent.type === INTENT_TYPES.GUARD) {
        enemyDamage = 0;
      }

      if (enemyDamage > 0) {
        const lethalRes = applyLethalProtection({
          currentHp: currentPlayerHp,
          incomingDamage: enemyDamage,
          relics: activeRelics,
          runRelicState: currentRunRelicState,
        });
        currentPlayerHp = lethalRes.newHp;
        if (lethalRes.protected) {
          secondChanceTriggered = true;
          currentRunRelicState = {
            ...currentRunRelicState,
            [RELIC_IDS.SECOND_CHANCE]: { consumed: true },
          };
          relicTriggers.push({
            relicId: RELIC_IDS.SECOND_CHANCE,
            type: 'LETHAL_PROTECTION',
            source: 'ENEMY_ATTACK',
          });
        }
      }

      if (currentPlayerHp <= 0) {
        nextStatus = ENCOUNTER_STATUS.DEFEAT;
      }
    }
  }

  // 7. Update Stats
  const nextStats = {
    correctAnswers: encounter.stats.correctAnswers + (isCorrect ? 1 : 0),
    wrongAnswers: encounter.stats.wrongAnswers + (isCorrect ? 0 : 1),
    totalDamageDealt: encounter.stats.totalDamageDealt + effectivePlayerDamage,
    totalDamageTaken: encounter.stats.totalDamageTaken + enemyDamage + effectiveBacklash,
    curseBacklashTaken: (encounter.stats.curseBacklashTaken || 0) + effectiveBacklash,
  };

  const nextResolvedTokens = [...encounter.resolvedQuestionTokens, token];

  const resolution = {
    token,
    chosenChoiceId: String(choiceId),
    correct: isCorrect,
    playerDamage: effectivePlayerDamage,
    guardMitigated,
    guardPierced,
    enemyDamage,
    backlashDamage: effectiveBacklash,
    curseResult,
    executedIntent: { ...currentIntent },
    relicTriggers,
    inkHeal,
    glassQuillBonus,
    secondChanceTriggered,
  };

  // 8. Next Turn Generation (Intent + Question for turn + 1)
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
        cursedWords: nextCursedWords,
      });
    }
  }

  const updatedEncounter = {
    ...encounter,
    status: nextStatus,
    turn: nextStatus === ENCOUNTER_STATUS.ACTIVE ? nextTurn : encounter.turn,
    player: {
      ...encounter.player,
      hp: currentPlayerHp,
    },
    enemy: {
      ...encounter.enemy,
      hp: newEnemyHp,
      intent: nextIntent,
    },
    question: nextQuestion,
    cursedWords: nextCursedWords,
    relics: activeRelics,
    runRelicState: currentRunRelicState,
    encounterRelicState: currentEncounterRelicState,
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

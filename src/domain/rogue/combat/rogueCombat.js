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
  PLAYER_ACTION_IDS,
  PLAYER_ACTIONS,
  PLAYER_ACTION_CONSTANTS,
  isValidActionId,
  isActionAvailable,
} from './playerActions';
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

export {
  PLAYER_ACTION_IDS,
  PLAYER_ACTIONS,
  PLAYER_ACTION_CONSTANTS,
  isValidActionId,
  isActionAvailable,
};

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

  const isBoss =
    assignedArchetypeId === ARCHETYPE_IDS.OVERLORD || nodeType === 'BOSS';
  const initialBossPhase = isBoss ? 1 : undefined;
  const initialPhase2StartTurn = isBoss ? null : undefined;

  return {
    schemaVersion: CURRENT_ENCOUNTER_SCHEMA_VERSION,
    encounterId,
    nodeId,
    nodeType,
    archetypeId: archetype.id,
    ...(isBoss
      ? {
          bossPhase: initialBossPhase,
          phase2StartTurn: initialPhase2StartTurn,
        }
      : {}),
    status: ENCOUNTER_STATUS.ACTIVE,
    turn: 1,
    selectedAction: null,
    recoverCooldown: 0,
    temporaryBlock: 0,
    player: {
      hp: initialHp,
      maxHp: playerMaxHp,
      selectedAction: null,
      recoverCooldown: 0,
      temporaryBlock: 0,
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
 * Updates the selected action for an active encounter.
 *
 * @param {object} encounter
 * @param {string} actionId - 'ATTACK' | 'GUARD' | 'RECOVER'
 * @returns {object} New encounter state with selectedAction set
 */
export function selectActionInEncounter(encounter, actionId) {
  if (!encounter || encounter.status !== ENCOUNTER_STATUS.ACTIVE) {
    throw new Error('[RogueCombat] Cannot select action for inactive encounter');
  }
  if (!isValidActionId(actionId)) {
    throw new Error(`[RogueCombat] Invalid action ID: "${actionId}"`);
  }
  const currentCd = encounter.recoverCooldown ?? encounter.player?.recoverCooldown ?? 0;
  if (actionId === PLAYER_ACTION_IDS.RECOVER && currentCd > 0) {
    throw new Error(`[RogueCombat] Recover is on cooldown (${currentCd} turns remaining)`);
  }
  return {
    ...encounter,
    selectedAction: actionId,
    player: {
      ...encounter.player,
      selectedAction: actionId,
    },
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
    return { encounter, resolved: true, reason: 'TOKEN_ALREADY_RESOLVED', resolution: encounter.lastResolution };
  }

  // Action Selection validation
  const selectedAction =
    action?.actionId ||
    encounter.selectedAction ||
    encounter.player?.selectedAction;

  if (!selectedAction || !isValidActionId(selectedAction)) {
    return { encounter, resolved: false, reason: 'ACTION_REQUIRED' };
  }

  const currentRecoverCooldown =
    encounter.recoverCooldown ?? encounter.player?.recoverCooldown ?? 0;

  if (selectedAction === PLAYER_ACTION_IDS.RECOVER && currentRecoverCooldown > 0) {
    return { encounter, resolved: false, reason: 'RECOVER_ON_COOLDOWN' };
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

  // 1. Evaluate Player Answer & Action Execution
  const isCorrect = String(choiceId) === String(encounter.question.correctChoiceId);

  let rawBaseDamage = 0;
  let effectivePlayerDamage = 0;
  let guardMitigated = 0;
  let guardPierced = 0;
  let temporaryBlock = 0;
  let appliedTemporaryBlock = 0;
  let recoveredHp = 0;
  let recoverCooldownStarted = false;
  let currentPlayerHp = encounter.player.hp;
  let glassQuillBonus = 0;

  if (isCorrect) {
    if (selectedAction === PLAYER_ACTION_IDS.ATTACK) {
      rawBaseDamage = PLAYER_ACTION_CONSTANTS.ATTACK_DAMAGE; // 25
      const modResult = modifyPlayerAttackDamage({
        baseDamage: rawBaseDamage,
        relics: activeRelics,
      });
      effectivePlayerDamage = modResult.playerDamage;
      glassQuillBonus = modResult.glassQuillBonus;
      if (glassQuillBonus > 0) {
        relicTriggers.push({
          relicId: RELIC_IDS.GLASS_QUILL,
          type: 'DAMAGE_BONUS',
          value: glassQuillBonus,
        });
      }

      // Check enemy GUARD intent mitigation
      if (currentIntent.type === INTENT_TYPES.GUARD) {
        const rawMitigation = currentIntent.value || archetype.guardMitigation || 10;
        const { effectiveMitigation, guardPierced: pierced } = modifyGuardMitigation({
          mitigation: rawMitigation,
          relics: activeRelics,
        });
        guardMitigated = Math.min(effectivePlayerDamage, effectiveMitigation);
        effectivePlayerDamage = Math.max(0, effectivePlayerDamage - effectiveMitigation);
        guardPierced = pierced;
        if (guardPierced > 0) {
          relicTriggers.push({
            relicId: RELIC_IDS.PIERCING_NIB,
            type: 'GUARD_PIERCED',
            value: guardPierced,
          });
        }
      }
    } else if (selectedAction === PLAYER_ACTION_IDS.GUARD) {
      temporaryBlock = PLAYER_ACTION_CONSTANTS.GUARD_BLOCK; // 20
      appliedTemporaryBlock = temporaryBlock;
    } else if (selectedAction === PLAYER_ACTION_IDS.RECOVER) {
      recoverCooldownStarted = true;
      const targetHp = Math.min(
        encounter.player.maxHp,
        currentPlayerHp + PLAYER_ACTION_CONSTANTS.RECOVER_HEAL
      );
      recoveredHp = targetHp - currentPlayerHp;
      currentPlayerHp = targetHp;
    }
  } else {
    // Wrong answer: chosen Action fails completely
    if (selectedAction === PLAYER_ACTION_IDS.RECOVER) {
      // Failed recover still starts cooldown
      recoverCooldownStarted = true;
    }
  }

  const newEnemyHp = Math.max(0, encounter.enemy.hp - effectivePlayerDamage);
  const enemyDefeated = newEnemyHp <= 0;

  // 4. Resolve Cursed Word State Transition & Relic Modifiers
  let nextCursedWords = currentCursedWords;
  let curseResult = null;
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
  let rawEnemyDamage = 0;
  let blockedDamage = 0;
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
        rawEnemyDamage = currentIntent.value || 0;
      } else if (currentIntent.type === INTENT_TYPES.GUARD) {
        rawEnemyDamage = 0;
      }

      // Guard blocks incoming enemy damage this turn
      blockedDamage = Math.min(rawEnemyDamage, temporaryBlock);
      enemyDamage = Math.max(0, rawEnemyDamage - temporaryBlock);

      // Temporary block expires after current enemy intent resolves
      temporaryBlock = 0;

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

  // Cooldown progression: if Recover was selected, set to RECOVER_COOLDOWN_TURNS (3).
  // Otherwise decrement active cooldown by 1 (minimum 0).
  const nextRecoverCooldown = recoverCooldownStarted
    ? PLAYER_ACTION_CONSTANTS.RECOVER_COOLDOWN_TURNS
    : Math.max(0, currentRecoverCooldown - 1);

  // 7. Update Stats
  const nextStats = {
    correctAnswers: encounter.stats.correctAnswers + (isCorrect ? 1 : 0),
    wrongAnswers: encounter.stats.wrongAnswers + (isCorrect ? 0 : 1),
    totalDamageDealt: encounter.stats.totalDamageDealt + effectivePlayerDamage,
    totalDamageTaken: encounter.stats.totalDamageTaken + enemyDamage + effectiveBacklash,
    curseBacklashTaken: (encounter.stats.curseBacklashTaken || 0) + effectiveBacklash,
  };

  const nextResolvedTokens = [...encounter.resolvedQuestionTokens, token];
  const nextTurn = encounter.turn + 1;

  // 8. Boss Phase Progression
  const isBoss =
    encounter.archetypeId === ARCHETYPE_IDS.OVERLORD ||
    encounter.nodeType === 'BOSS';
  const bossPhaseThreshold = archetype.phaseThreshold || 100;
  let nextBossPhase = encounter.bossPhase !== undefined ? encounter.bossPhase : (isBoss ? (encounter.enemy?.hp <= bossPhaseThreshold ? 2 : 1) : null);
  let nextPhase2StartTurn = encounter.phase2StartTurn || null;
  let bossPhaseTransition = false;

  if (isBoss && nextStatus === ENCOUNTER_STATUS.ACTIVE) {
    if (nextBossPhase === 1 && newEnemyHp <= bossPhaseThreshold) {
      nextBossPhase = 2;
      nextPhase2StartTurn = nextTurn;
      bossPhaseTransition = true;
    }
  }

  const resolution = {
    token,
    chosenChoiceId: String(choiceId),
    correct: isCorrect,
    actionId: selectedAction,
    selectedAction,
    actionSucceeded: isCorrect,
    playerDamage: effectivePlayerDamage,
    guardMitigated,
    guardPierced,
    temporaryBlock: appliedTemporaryBlock,
    blockedDamage,
    damageBlocked: blockedDamage,
    recoveredHp,
    rawEnemyDamage,
    enemyDamage,
    recoverCooldown: nextRecoverCooldown,
    backlashDamage: effectiveBacklash,
    curseResult,
    executedIntent: { ...currentIntent },
    relicTriggers,
    inkHeal,
    glassQuillBonus,
    secondChanceTriggered,
    ...(isBoss
      ? {
          bossPhase: nextBossPhase,
          bossPhaseTransition,
        }
      : {}),
  };

  // 9. Next Turn Generation (Intent + Question for turn + 1)
  let nextQuestion = encounter.question;
  let nextIntent = currentIntent;

  if (nextStatus === ENCOUNTER_STATUS.ACTIVE) {
    // Derive next intent deterministically from (archetype, nextTurn, { bossPhase, phase2StartTurn })
    nextIntent = getIntentForTurn(archetype, nextTurn, {
      bossPhase: nextBossPhase,
      phase2StartTurn: nextPhase2StartTurn,
    });

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
    selectedAction: null,
    recoverCooldown: nextRecoverCooldown,
    temporaryBlock: 0,
    ...(isBoss
      ? {
          bossPhase: nextBossPhase,
          phase2StartTurn: nextPhase2StartTurn,
        }
      : {}),
    player: {
      ...encounter.player,
      hp: currentPlayerHp,
      selectedAction: null,
      recoverCooldown: nextRecoverCooldown,
      temporaryBlock: 0,
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

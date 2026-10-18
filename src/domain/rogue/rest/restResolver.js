/**
 * ROGUE EXPEDITION V0.1 — REST NODE RESOLVER
 *
 * Implements pure strategic REST choices:
 * - RECOVER: Restore 30 HP (clamped to maxHp). Valid even at full HP.
 * - CLEANSE: Reduce 1 stack from the deterministic highest-priority Curse.
 *            Triggers Purifying Ink (+10 HP) upon full purification.
 *            Scholar's Lens does NOT apply (not a vocabulary answer).
 * - Enforces idempotency via interactionId.
 * - Resolves the node and unlocks forward navigation.
 */

import { selectCursedWordForReview } from '../curse/cursedWordModel';
import { onCursePurified } from '../relic/relicEffects';
import { ROGUE_RUN_STATUS } from '../rogueRun';

export const REST_ACTIONS = Object.freeze({
  RECOVER: 'RECOVER',
  CLEANSE: 'CLEANSE',
});

export const REST_HEAL_AMOUNT = 40;

/**
 * Pure helper to cleanse the highest-priority curse outside of combat answers.
 *
 * @param {object} params
 * @param {Array<object>} params.cursedWords
 * @param {number} params.playerHp
 * @param {number} params.playerMaxHp
 * @param {Array<string>} [params.relics=[]]
 * @returns {{ success: boolean, reason?: string, nextCursedWords: Array<object>, nextHp: number, inkHeal: number, purified: boolean, targetWord?: string }}
 */
export function cleanseHighestPriorityCurse({
  cursedWords = [],
  playerHp,
  playerMaxHp,
  relics = [],
}) {
  const currentList = Array.isArray(cursedWords) ? cursedWords : [];
  const target = selectCursedWordForReview(currentList);

  if (!target) {
    return {
      success: false,
      reason: 'NO_CURSES_TO_CLEANSE',
      nextCursedWords: currentList,
      nextHp: playerHp,
      inkHeal: 0,
      purified: false,
    };
  }

  const targetId = String(target.wordId || target.word);
  const targetIndex = currentList.findIndex(
    (c) => c && String(c.wordId || c.word) === targetId
  );

  const previousStacks = target.stacks || 1;
  const newStacks = previousStacks - 1;

  if (newStacks <= 0) {
    // Fully purified & removed
    const nextList = currentList.filter((_, idx) => idx !== targetIndex);
    const { healedHp, actualHeal } = onCursePurified({
      playerHp,
      playerMaxHp,
      relics,
    });

    return {
      success: true,
      purified: true,
      targetWord: target.word || targetId,
      nextCursedWords: nextList,
      nextHp: healedHp,
      inkHeal: actualHeal,
    };
  }

  // Weakened by 1 stack
  const nextList = [...currentList];
  nextList[targetIndex] = {
    ...target,
    stacks: newStacks,
  };

  return {
    success: true,
    purified: false,
    targetWord: target.word || targetId,
    nextCursedWords: nextList,
    nextHp: playerHp,
    inkHeal: 0,
  };
}

/**
 * Pure transition: resolves a REST node interaction.
 *
 * @param {object} run - Active Rogue Run state
 * @param {object} params
 * @param {string} params.interactionId - Stable interaction identifier
 * @param {string} params.actionType - 'RECOVER' or 'CLEANSE'
 * @returns {{ run: object, success: boolean, reason?: string, alreadyResolved?: boolean, outcome?: object }}
 */
export function resolveRestInteraction(run, { interactionId, actionType }) {
  if (!run || typeof run !== 'object') {
    return { run, success: false, reason: 'INVALID_RUN' };
  }

  if (run.status !== ROGUE_RUN_STATUS.ACTIVE) {
    return { run, success: false, reason: 'RUN_NOT_ACTIVE' };
  }

  // Idempotency: check if interaction already resolved
  if (!run.pendingInteraction) {
    if (run.currentNodeResolved) {
      return { run, success: true, alreadyResolved: true };
    }
    return { run, success: false, reason: 'NO_PENDING_INTERACTION' };
  }

  if (run.pendingInteraction.interactionId !== interactionId) {
    return { run, success: false, reason: 'INTERACTION_ID_MISMATCH' };
  }

  if (run.pendingInteraction.type !== 'REST') {
    return { run, success: false, reason: 'INTERACTION_TYPE_MISMATCH' };
  }

  const currentHp = run.player?.hp ?? 100;
  const maxHp = run.player?.maxHp ?? 100;
  const relics = run.relics || [];

  let nextHp = currentHp;
  let nextCursedWords = run.cursedWords || [];
  let outcome = {};

  if (actionType === REST_ACTIONS.RECOVER) {
    nextHp = Math.min(maxHp, currentHp + REST_HEAL_AMOUNT);
    outcome = {
      action: REST_ACTIONS.RECOVER,
      healed: nextHp - currentHp,
      newHp: nextHp,
    };
  } else if (actionType === REST_ACTIONS.CLEANSE) {
    const cleanseResult = cleanseHighestPriorityCurse({
      cursedWords: nextCursedWords,
      playerHp: currentHp,
      playerMaxHp: maxHp,
      relics,
    });

    if (!cleanseResult.success) {
      return { run, success: false, reason: cleanseResult.reason };
    }

    nextCursedWords = cleanseResult.nextCursedWords;
    nextHp = cleanseResult.nextHp;
    outcome = {
      action: REST_ACTIONS.CLEANSE,
      targetWord: cleanseResult.targetWord,
      purified: cleanseResult.purified,
      inkHeal: cleanseResult.inkHeal,
      newHp: nextHp,
    };
  } else {
    return { run, success: false, reason: 'INVALID_REST_ACTION' };
  }

  const updatedRun = {
    ...run,
    player: {
      ...run.player,
      hp: nextHp,
    },
    cursedWords: nextCursedWords,
    pendingInteraction: null,
    currentNodeResolved: true,
    updatedAt: Date.now(),
  };

  return {
    run: updatedRun,
    success: true,
    outcome,
  };
}

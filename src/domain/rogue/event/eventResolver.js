/**
 * ROGUE EXPEDITION V0.1 — EVENT NODE RESOLVER
 *
 * Implements pure event choice resolution:
 * - Validates affordability before applying any effect (HP_COST requires currentHp > cost)
 * - Canonical order: validate -> pay HP cost -> apply effects -> apply triggered relic effects (Purifying Ink)
 * - HP_COST is a voluntary resource cost, never incoming combat damage (never triggers Second Chance)
 * - Scholar's Lens does not modify event curse cleansing
 * - Enforces idempotency via interactionId
 * - Resolves the node upon completion
 */

import { getEvent, EVENT_EFFECT_TYPES } from './eventRegistry';
import { cleanseHighestPriorityCurse } from '../rest/restResolver';
import { ROGUE_RUN_STATUS } from '../rogueRun';

/**
 * Pure transition: resolves an EVENT node interaction.
 *
 * @param {object} run - Active Rogue Run state
 * @param {object} params
 * @param {string} params.interactionId - Stable interaction identifier
 * @param {string} params.optionId - Chosen option ID
 * @returns {{ run: object, success: boolean, reason?: string, alreadyResolved?: boolean, outcome?: object }}
 */
export function resolveEventInteraction(run, { interactionId, optionId }) {
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

  if (run.pendingInteraction.type !== 'EVENT') {
    return { run, success: false, reason: 'INTERACTION_TYPE_MISMATCH' };
  }

  const eventDef = getEvent(run.pendingInteraction.eventId);
  if (!eventDef) {
    return { run, success: false, reason: 'UNKNOWN_EVENT' };
  }

  const option = eventDef.options.find((opt) => opt.id === optionId);
  if (!option) {
    return { run, success: false, reason: 'INVALID_EVENT_OPTION' };
  }

  const currentHp = run.player?.hp ?? 100;
  const maxHp = run.player?.maxHp ?? 100;
  const relics = run.relics || [];
  const cursedWords = run.cursedWords || [];

  // Precondition 1: Requires curse
  if (option.requiresCurse && cursedWords.length === 0) {
    return { run, success: false, reason: 'REQUIRES_CURSE' };
  }

  // Precondition 2: Affordability check for HP_COST
  const hpCostEffect = option.effects.find((e) => e.type === EVENT_EFFECT_TYPES.HP_COST);
  if (hpCostEffect) {
    const cost = Math.max(0, hpCostEffect.value || 0);
    // Player cannot voluntarily pay HP to 0
    if (currentHp <= cost) {
      return { run, success: false, reason: 'CANNOT_AFFORD_HP_COST' };
    }
  }

  // Step 1: Pay HP cost if any
  let nextHp = currentHp;
  let paidCost = 0;
  if (hpCostEffect) {
    paidCost = Math.max(0, hpCostEffect.value || 0);
    nextHp -= paidCost;
  }

  // Step 2: Apply remaining effects
  let nextCursedWords = cursedWords;
  let healedAmount = 0;
  let inkHeal = 0;
  let purifiedWord = null;

  for (const effect of option.effects) {
    if (effect.type === EVENT_EFFECT_TYPES.HEAL) {
      const healValue = Math.max(0, effect.value || 0);
      const afterHeal = Math.min(maxHp, nextHp + healValue);
      healedAmount += afterHeal - nextHp;
      nextHp = afterHeal;
    } else if (effect.type === EVENT_EFFECT_TYPES.PURIFY_HIGHEST_CURSE) {
      const cleanseResult = cleanseHighestPriorityCurse({
        cursedWords: nextCursedWords,
        playerHp: nextHp,
        playerMaxHp: maxHp,
        relics,
      });

      if (cleanseResult.success) {
        nextCursedWords = cleanseResult.nextCursedWords;
        nextHp = cleanseResult.nextHp;
        inkHeal += cleanseResult.inkHeal;
        purifiedWord = cleanseResult.targetWord;
      }
    } else if (effect.type === EVENT_EFFECT_TYPES.NONE) {
      // Intentionally no effect
    }
  }

  const outcome = {
    eventId: eventDef.id,
    optionId: option.id,
    paidCost,
    healedAmount,
    inkHeal,
    purifiedWord,
    finalHp: nextHp,
  };

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

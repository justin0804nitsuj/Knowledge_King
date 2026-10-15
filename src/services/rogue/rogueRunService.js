/**
 * ROGUE EXPEDITION V0.1 — RUN LIFECYCLE SERVICE
 *
 * Coordinates Rogue Expedition lifecycle operations:
 * - createNewRun
 * - loadActiveRun
 * - saveRun
 * - advanceToNode
 * - submitCombatAnswer
 * - abandonRun
 *
 * Enforces valid forward moves, rejects illegal map jumps,
 * guarantees mid-battle persistence, and provides clean account-scoped isolation.
 */

import {
  createRogueRun,
  advanceRunNode,
  resolveCombatVictory,
  resolveCombatDefeat,
  abandonRogueRun,
  canAdvanceToNode,
  getSelectableNextNodes,
  isRunActive,
} from '../../domain/rogue/rogueRun';
import {
  resolveEncounterTurn,
  ENCOUNTER_STATUS,
} from '../../domain/rogue/combat/rogueCombat';
import { claimRelicReward } from '../../domain/rogue/relic/relicDraft';
import {
  loadActiveRogueRun,
  saveActiveRogueRun,
  clearActiveRogueRun,
} from '../../storage/rogueRunStorage';

/**
 * Creates and persists a brand new Rogue Expedition run.
 * Intentionally replaces any prior finished or abandoned run.
 *
 * @param {object} [params]
 * @param {number|string} [params.seed]
 * @param {string|object} [params.explicitIdentity]
 * @param {number} [params.initialHp]
 * @param {number} [params.maxHp]
 * @returns {Promise<object>} The newly created run
 */
export async function createNewRun(params = {}) {
  const { seed, explicitIdentity, initialHp, maxHp } = params;
  const newRun = createRogueRun({ seed, initialHp, maxHp });
  await saveActiveRogueRun(newRun, explicitIdentity);
  return newRun;
}

/**
 * Loads the active rogue run for the current or specified identity.
 *
 * @param {string|object} [explicitIdentity]
 * @returns {Promise<object|null>}
 */
export async function loadActiveRun(explicitIdentity) {
  return await loadActiveRogueRun(explicitIdentity);
}

/**
 * Persists an existing rogue run state.
 *
 * @param {object} run
 * @param {string|object} [explicitIdentity]
 * @returns {Promise<object>}
 */
export async function saveRun(run, explicitIdentity) {
  return await saveActiveRogueRun(run, explicitIdentity);
}

/**
 * Advances the active run to a valid connected next node.
 * Rejects invalid jumps or attempts to advance finished/defeated runs.
 *
 * @param {string} targetNodeId
 * @param {string|object} [explicitIdentity]
 * @param {object} [options]
 * @returns {Promise<object>} Updated run
 */
export async function advanceToNode(targetNodeId, explicitIdentity, options = {}) {
  let resolvedIdentity = explicitIdentity;
  let resolvedOptions = options;

  if (
    explicitIdentity &&
    typeof explicitIdentity === 'object' &&
    !explicitIdentity.uid &&
    (explicitIdentity.customQuestion !== undefined ||
      explicitIdentity.seed !== undefined ||
      Object.keys(options).length === 0)
  ) {
    resolvedOptions = explicitIdentity;
    resolvedIdentity = undefined;
  }

  const currentRun = await loadActiveRogueRun(resolvedIdentity);
  if (!currentRun) {
    throw new Error('[RogueRunService] No active run found to advance');
  }

  const updatedRun = advanceRunNode(currentRun, targetNodeId, resolvedOptions);
  await saveActiveRogueRun(updatedRun, resolvedIdentity);
  return updatedRun;
}

/**
 * Submits an answer choice for the active combat encounter.
 *
 * Invariants enforced:
 * - Answer -> Action resolution
 * - Question turn idempotency (second submission is strict NO-OP)
 * - Persists mid-battle state immediately to account-scoped local storage
 * - If encounter finishes, applies victory/defeat transitions to the run
 *
 * @param {object} params
 * @param {string} params.choiceId - Chosen answer choice ID
 * @param {string} params.token - Question token being answered
 * @param {string|object} [params.explicitIdentity]
 * @param {object} [params.options] - Optional nextQuestion / seed injection
 * @returns {Promise<{ run: object, encounter: object, resolution?: object, resolved: boolean, reason?: string }>}
 */
export async function submitCombatAnswer({
  choiceId,
  token,
  explicitIdentity,
  options = {},
} = {}) {
  const currentRun = await loadActiveRogueRun(explicitIdentity);
  if (!currentRun) {
    throw new Error('[RogueRunService] No active run found');
  }

  const encounter = currentRun.encounter;
  if (!encounter || encounter.status !== ENCOUNTER_STATUS.ACTIVE) {
    return {
      run: currentRun,
      encounter,
      resolved: false,
      reason: 'NO_ACTIVE_ENCOUNTER',
    };
  }

  const turnOptions = {
    ...options,
    relics: options.relics || currentRun.relics || [],
    runRelicState: options.runRelicState || currentRun.relicState || {},
  };

  const { encounter: updatedEncounter, resolved, resolution, reason } = resolveEncounterTurn(
    encounter,
    { choiceId, token },
    turnOptions
  );

  if (!resolved) {
    // Idempotent duplicate or invalid payload: return existing state unchanged
    return {
      run: currentRun,
      encounter,
      resolved: false,
      reason,
    };
  }

  let finalRun = {
    ...currentRun,
    relics: updatedEncounter.relics || currentRun.relics || [],
    relicState: updatedEncounter.runRelicState || currentRun.relicState || {},
    cursedWords: updatedEncounter.cursedWords || currentRun.cursedWords || [],
    encounter: updatedEncounter,
    player: {
      ...currentRun.player,
      hp: updatedEncounter.player.hp,
    },
    updatedAt: Date.now(),
  };

  if (updatedEncounter.status === ENCOUNTER_STATUS.VICTORY) {
    finalRun = resolveCombatVictory(finalRun, updatedEncounter);
  } else if (updatedEncounter.status === ENCOUNTER_STATUS.DEFEAT) {
    finalRun = resolveCombatDefeat(finalRun, updatedEncounter);
  }

  await saveActiveRogueRun(finalRun, explicitIdentity);

  return {
    run: finalRun,
    encounter: updatedEncounter,
    resolution,
    resolved: true,
  };
}

/**
 * Returns the currently active encounter if one exists.
 *
 * @param {string|object} [explicitIdentity]
 * @returns {Promise<object|null>}
 */
export async function getActiveEncounter(explicitIdentity) {
  const currentRun = await loadActiveRogueRun(explicitIdentity);
  return currentRun?.encounter || null;
}

/**
 * Abandons the current active run.
 *
 * @param {string|object} [explicitIdentity]
 * @returns {Promise<object|null>} Updated abandoned run
 */
export async function abandonRun(explicitIdentity) {
  const currentRun = await loadActiveRogueRun(explicitIdentity);
  if (!currentRun) {
    return null;
  }

  const updatedRun = abandonRogueRun(currentRun);
  await saveActiveRogueRun(updatedRun, explicitIdentity);
  return updatedRun;
}

/**
 * Helper to get available next nodes for the active run.
 *
 * @param {string|object} [explicitIdentity]
 * @returns {Promise<string[]>}
 */
export async function getActiveSelectableNodes(explicitIdentity) {
  const currentRun = await loadActiveRogueRun(explicitIdentity);
  return getSelectableNextNodes(currentRun);
}

/**
 * Selects a relic from the pending reward draft.
 * Idempotent: repeated selections with the same token do not duplicate relics or node resolutions.
 *
 * @param {object} params
 * @param {string} params.rewardId
 * @param {string|null} params.relicId
 * @param {string|object} [params.explicitIdentity]
 * @returns {Promise<{ run: object, success: boolean, reason?: string, alreadyClaimed?: boolean }>}
 */
export async function selectRelicReward({
  rewardId,
  relicId,
  explicitIdentity,
} = {}) {
  const currentRun = await loadActiveRogueRun(explicitIdentity);
  if (!currentRun) {
    throw new Error('[RogueRunService] No active run found');
  }

  const { run: updatedRun, success, reason, alreadyClaimed } = claimRelicReward(
    currentRun,
    { rewardId, relicId }
  );

  if (!success) {
    return {
      run: currentRun,
      success: false,
      reason,
    };
  }

  await saveActiveRogueRun(updatedRun, explicitIdentity);

  return {
    run: updatedRun,
    success: true,
    alreadyClaimed: Boolean(alreadyClaimed),
  };
}

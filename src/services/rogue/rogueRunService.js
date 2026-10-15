/**
 * ROGUE EXPEDITION V0.1 — RUN LIFECYCLE SERVICE
 *
 * Coordinates Rogue Expedition lifecycle operations:
 * - createNewRun
 * - loadActiveRun
 * - saveRun
 * - advanceToNode
 * - abandonRun
 *
 * Enforces valid forward moves, rejects illegal map jumps,
 * guarantees state persistence, and provides clean account-scoped isolation.
 */

import {
  createRogueRun,
  advanceRunNode,
  abandonRogueRun,
  canAdvanceToNode,
  getSelectableNextNodes,
  isRunActive,
} from '../../domain/rogue/rogueRun';
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
 * @returns {Promise<object>} Updated run
 */
export async function advanceToNode(targetNodeId, explicitIdentity) {
  const currentRun = await loadActiveRogueRun(explicitIdentity);
  if (!currentRun) {
    throw new Error('[RogueRunService] No active run found to advance');
  }

  const updatedRun = advanceRunNode(currentRun, targetNodeId);
  await saveActiveRogueRun(updatedRun, explicitIdentity);
  return updatedRun;
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

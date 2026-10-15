/**
 * ROGUE EXPEDITION V0.1 — DETERMINISTIC RELIC REWARD DRAFT
 *
 * Deterministic generation and idempotent acquisition of relic rewards:
 * - Uses PRNG seeded by (runSeed + nodeId + 'relic_draft')
 * - Offers up to 3 distinct unowned relics
 * - Draft choices are persisted in run state
 * - Selection resolves the ELITE reward gate and unlocks subsequent map nodes
 */

import { getAllRelics, getRelic } from './relicRegistry';
import { createPrng } from '../prng';

export const REWARD_TYPES = Object.freeze({
  RELIC_DRAFT: 'RELIC_DRAFT',
});

/**
 * Deterministically generates a relic draft reward for a node.
 *
 * @param {object} params
 * @param {string|number} params.seed - Run seed
 * @param {string} params.nodeId - Map node ID (e.g. ELITE node)
 * @param {Array<string>} [params.ownedRelics=[]] - Relic IDs already owned in the run
 * @returns {object} Pending reward descriptor
 */
export function generateRelicDraft({ seed, nodeId, ownedRelics = [] }) {
  const safeSeed = seed !== undefined && seed !== null ? seed : 'default_seed';
  const safeNodeId = String(nodeId || 'node');
  const safeOwned = Array.isArray(ownedRelics) ? ownedRelics : [];

  // 1. Get all canonical relics, excluding already owned
  const allRelics = getAllRelics();
  const available = allRelics.filter((r) => r && !safeOwned.includes(r.id));

  const draftSeed = `${safeSeed}_relic_draft_${safeNodeId}`;
  const rewardId = `relic_reward_${safeNodeId}_${draftSeed}`;

  if (available.length === 0) {
    return {
      type: REWARD_TYPES.RELIC_DRAFT,
      rewardId,
      nodeId: safeNodeId,
      options: [],
    };
  }

  // 2. Deterministic Fisher-Yates shuffle
  const prng = createPrng(draftSeed);
  const pool = available.map((r) => r.id);

  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(prng.next() * (i + 1));
    const temp = pool[i];
    pool[i] = pool[j];
    pool[j] = temp;
  }

  // 3. Take up to 3 options
  const options = pool.slice(0, 3);

  return {
    type: REWARD_TYPES.RELIC_DRAFT,
    rewardId,
    nodeId: safeNodeId,
    options,
  };
}

/**
 * Pure transition: selects a relic from the run's pending reward draft.
 *
 * Enforces:
 * - Matching rewardId
 * - Option exists in pending options (or option is null when no options available)
 * - No duplicate relic acquisition
 * - Node resolution upon reward claim
 * - Idempotency (repeated calls with same rewardId are safe NO-OPs)
 *
 * @param {object} run - Active Rogue Run state
 * @param {object} params
 * @param {string} params.rewardId - Token/ID of the pending reward
 * @param {string|null} params.relicId - Chosen relic ID (null if skipping empty draft)
 * @returns {{ run: object, success: boolean, reason?: string, alreadyClaimed?: boolean }}
 */
export function claimRelicReward(run, { rewardId, relicId }) {
  if (!run || typeof run !== 'object') {
    return { run, success: false, reason: 'INVALID_RUN' };
  }

  // Check if already claimed / resolved (Idempotency)
  if (!run.pendingReward) {
    if (relicId && run.relics?.includes(relicId)) {
      return { run, success: true, alreadyClaimed: true };
    }
    return { run, success: false, reason: 'NO_PENDING_REWARD' };
  }

  if (run.pendingReward.type !== REWARD_TYPES.RELIC_DRAFT) {
    return { run, success: false, reason: 'UNSUPPORTED_REWARD_TYPE' };
  }

  if (run.pendingReward.rewardId !== rewardId) {
    return { run, success: false, reason: 'REWARD_ID_MISMATCH' };
  }

  const { options = [] } = run.pendingReward;

  // Case 1: Empty draft (all relics owned)
  if (options.length === 0) {
    const nextRun = {
      ...run,
      pendingReward: null,
      currentNodeResolved: true,
      updatedAt: Date.now(),
    };
    return { run: nextRun, success: true };
  }

  // Case 2: Selected relic must be in options
  if (!relicId || !options.includes(relicId)) {
    return { run, success: false, reason: 'INVALID_REWARD_OPTION' };
  }

  // Case 3: Check duplicate acquisition
  const existingRelics = Array.isArray(run.relics) ? run.relics : [];
  if (existingRelics.includes(relicId)) {
    return { run, success: false, reason: 'DUPLICATE_RELIC' };
  }

  // Validate relic registry entry
  const relicDef = getRelic(relicId);
  if (!relicDef) {
    return { run, success: false, reason: 'UNKNOWN_RELIC' };
  }

  const nextRelics = [...existingRelics, relicId];

  // Initialize relicState if this relic is stateful (e.g. SECOND_CHANCE)
  const existingRelicState = run.relicState || {};
  let nextRelicState = { ...existingRelicState };

  if (relicId === 'SECOND_CHANCE' && !nextRelicState.SECOND_CHANCE) {
    nextRelicState.SECOND_CHANCE = { consumed: false };
  }

  const nextRun = {
    ...run,
    relics: nextRelics,
    relicState: nextRelicState,
    pendingReward: null,
    currentNodeResolved: true,
    updatedAt: Date.now(),
  };

  return { run: nextRun, success: true };
}

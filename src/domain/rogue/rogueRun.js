/**
 * ROGUE EXPEDITION V0.1 — RUN DOMAIN MODEL & STATE TRANSITIONS
 *
 * Pure domain logic for Rogue Expedition runs:
 * - Deterministic immutable state transitions
 * - Route navigation & choice validation
 * - Isolated from account XP / campaign progress
 */

import { generateRogueMap, ROGUE_NODE_TYPES } from './mapGenerator';

export const CURRENT_ROGUE_SCHEMA_VERSION = 1;

export const ROGUE_RUN_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  VICTORY: 'VICTORY',
  DEFEAT: 'DEFEAT',
  ABANDONED: 'ABANDONED',
});

/**
 * Creates a brand new Rogue Expedition run.
 *
 * @param {object} [params]
 * @param {number|string} [params.seed] - Seed for procedural map generation
 * @param {string} [params.runId] - Unique run identifier
 * @param {number} [params.initialHp=100]
 * @param {number} [params.maxHp=100]
 * @param {object} [params.map] - Optional pre-generated map
 * @returns {object} Pure Rogue Run state
 */
export function createRogueRun({
  seed,
  runId,
  initialHp = 100,
  maxHp = 100,
  map,
} = {}) {
  const resolvedSeed = seed !== undefined && seed !== null ? seed : Date.now();
  const resolvedRunId = runId || `rogue-run-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const routeMap = map || generateRogueMap(resolvedSeed);

  const startId = routeMap.startNodeId;

  return {
    schemaVersion: CURRENT_ROGUE_SCHEMA_VERSION,
    runId: resolvedRunId,
    seed: resolvedSeed,
    status: ROGUE_RUN_STATUS.ACTIVE,
    currentNodeId: startId,
    player: {
      hp: initialHp,
      maxHp: maxHp,
    },
    route: {
      seed: resolvedSeed,
      rowCount: routeMap.rowCount,
      startNodeId: startId,
      bossNodeId: routeMap.bossNodeId,
      nodes: routeMap.nodes,
      visitedNodeIds: [startId],
    },
    relics: [],
    cursedWords: [],
    runStats: {
      battlesWon: 0,
      correctAnswers: 0,
      wrongAnswers: 0,
      nodesVisited: 1,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Derives selectable connected next nodes from the current run state.
 *
 * @param {object} run
 * @returns {string[]} Array of node IDs available to visit next
 */
export function getSelectableNextNodes(run) {
  if (!run || typeof run !== 'object') return [];
  if (run.status !== ROGUE_RUN_STATUS.ACTIVE) return [];

  const { currentNodeId, route } = run;
  if (!route || !route.nodes) return [];

  if (!currentNodeId) {
    return route.startNodeId ? [route.startNodeId] : [];
  }

  const currentNode = route.nodes[currentNodeId];
  if (!currentNode || !Array.isArray(currentNode.nextNodes)) {
    return [];
  }

  return [...currentNode.nextNodes];
}

/**
 * Checks if a specific node can be legally visited next.
 *
 * @param {object} run
 * @param {string} targetNodeId
 * @returns {boolean}
 */
export function canAdvanceToNode(run, targetNodeId) {
  if (!targetNodeId || typeof targetNodeId !== 'string') return false;
  const available = getSelectableNextNodes(run);
  return available.includes(targetNodeId);
}

/**
 * Pure transition: advances the run to the selected target node.
 * Throws if the jump is invalid or the run is not ACTIVE.
 *
 * @param {object} run
 * @param {string} targetNodeId
 * @returns {object} Updated run state
 */
export function advanceRunNode(run, targetNodeId) {
  if (!run || typeof run !== 'object') {
    throw new Error('[RogueRun] Invalid run state');
  }

  if (run.status !== ROGUE_RUN_STATUS.ACTIVE) {
    throw new Error(`[RogueRun] Cannot advance a run with status "${run.status}"`);
  }

  if (!canAdvanceToNode(run, targetNodeId)) {
    throw new Error(
      `[RogueRun] Invalid move: node "${targetNodeId}" is not a connected next step from "${run.currentNodeId}"`
    );
  }

  const targetNode = run.route.nodes[targetNodeId];
  if (!targetNode) {
    throw new Error(`[RogueRun] Target node "${targetNodeId}" does not exist in map`);
  }

  const isBossNode =
    targetNode.type === ROGUE_NODE_TYPES.BOSS || targetNodeId === run.route.bossNodeId;

  const nextVisited = Array.from(new Set([...(run.route.visitedNodeIds || []), targetNodeId]));

  return {
    ...run,
    status: isBossNode ? ROGUE_RUN_STATUS.VICTORY : ROGUE_RUN_STATUS.ACTIVE,
    currentNodeId: targetNodeId,
    route: {
      ...run.route,
      visitedNodeIds: nextVisited,
    },
    runStats: {
      ...run.runStats,
      nodesVisited: (run.runStats?.nodesVisited || 0) + 1,
    },
    updatedAt: Date.now(),
  };
}

/**
 * Abandons an active run.
 *
 * @param {object} run
 * @returns {object} Updated run state
 */
export function abandonRogueRun(run) {
  if (!run || typeof run !== 'object') {
    throw new Error('[RogueRun] Invalid run state');
  }
  return {
    ...run,
    status: ROGUE_RUN_STATUS.ABANDONED,
    updatedAt: Date.now(),
  };
}

/**
 * Marks a run as defeated.
 *
 * @param {object} run
 * @returns {object} Updated run state
 */
export function defeatRogueRun(run) {
  if (!run || typeof run !== 'object') {
    throw new Error('[RogueRun] Invalid run state');
  }
  return {
    ...run,
    status: ROGUE_RUN_STATUS.DEFEAT,
    updatedAt: Date.now(),
  };
}

/**
 * Marks a run as victorious.
 *
 * @param {object} run
 * @returns {object} Updated run state
 */
export function completeRogueRun(run) {
  if (!run || typeof run !== 'object') {
    throw new Error('[RogueRun] Invalid run state');
  }
  return {
    ...run,
    status: ROGUE_RUN_STATUS.VICTORY,
    updatedAt: Date.now(),
  };
}

/**
 * Checks if a run is currently ongoing.
 *
 * @param {object} run
 * @returns {boolean}
 */
export function isRunActive(run) {
  return Boolean(run && run.status === ROGUE_RUN_STATUS.ACTIVE);
}

/**
 * Checks if a run is ended (VICTORY, DEFEAT, or ABANDONED).
 *
 * @param {object} run
 * @returns {boolean}
 */
export function isRunOver(run) {
  return Boolean(run && run.status !== ROGUE_RUN_STATUS.ACTIVE);
}

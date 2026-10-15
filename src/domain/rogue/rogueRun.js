/**
 * ROGUE EXPEDITION V0.1 — RUN DOMAIN MODEL & STATE TRANSITIONS
 *
 * Pure domain logic for Rogue Expedition runs:
 * - Deterministic immutable state transitions
 * - Route navigation & node resolution gating
 * - Encounter attachment and combat resolution
 * - Isolated from account XP / campaign progress
 */

import { generateRogueMap, ROGUE_NODE_TYPES } from './mapGenerator';
import { createEncounter, ENCOUNTER_STATUS } from './combat/rogueCombat';
import { generateRelicDraft, claimRelicReward } from './relic/relicDraft';
import { selectEventForNode } from './event/eventRegistry';

export const CURRENT_ROGUE_SCHEMA_VERSION = 1;

export const ROGUE_RUN_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  VICTORY: 'VICTORY',
  DEFEAT: 'DEFEAT',
  ABANDONED: 'ABANDONED',
});

/**
 * Creates a brand new Rogue Expedition run.
 * START node begins resolved.
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
    currentNodeResolved: true, // START begins resolved
    encounter: null,
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
    relicState: {},
    pendingReward: null,
    pendingInteraction: null,
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
 * Checks whether the current node is resolved.
 *
 * @param {object} run
 * @returns {boolean}
 */
export function isCurrentNodeResolved(run) {
  if (!run || typeof run !== 'object') return false;
  if (run.pendingReward) return false;
  if (run.pendingInteraction && !run.pendingInteraction.resolved) return false;
  return run.currentNodeResolved !== false;
}

/**
 * Derives selectable connected next nodes from the current run state.
 *
 * GATING INVARIANT:
 * If the current node is unresolved (e.g. active combat), NO next nodes can be selected.
 *
 * @param {object} run
 * @returns {string[]} Array of node IDs available to visit next
 */
export function getSelectableNextNodes(run) {
  if (!run || typeof run !== 'object') return [];
  if (run.status !== ROGUE_RUN_STATUS.ACTIVE) return [];

  // Gating rule: unresolved nodes lock all forward progression
  if (!isCurrentNodeResolved(run)) return [];

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
 * Throws if the jump is invalid, the run is not ACTIVE, or current node is unresolved.
 *
 * Combat nodes become unresolved on entry and spawn an encounter.
 *
 * @param {object} run
 * @param {string} targetNodeId
 * @param {object} [options] - Optional seed/customQuestion injection for tests
 * @returns {object} Updated run state
 */
export function advanceRunNode(run, targetNodeId, options = {}) {
  if (!run || typeof run !== 'object') {
    throw new Error('[RogueRun] Invalid run state');
  }

  if (run.status !== ROGUE_RUN_STATUS.ACTIVE) {
    throw new Error(`[RogueRun] Cannot advance a run with status "${run.status}"`);
  }

  if (!isCurrentNodeResolved(run)) {
    throw new Error(
      `[RogueRun] Cannot advance: current node "${run.currentNodeId}" is unresolved. Resolve encounter before advancing.`
    );
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

  const isCombatNode =
    targetNode.type === ROGUE_NODE_TYPES.BATTLE ||
    targetNode.type === ROGUE_NODE_TYPES.ELITE ||
    targetNode.type === ROGUE_NODE_TYPES.BOSS;

  const nextVisited = Array.from(new Set([...(run.route.visitedNodeIds || []), targetNodeId]));

  let encounter = null;
  let pendingInteraction = null;
  let isResolved = true;

  if (isCombatNode) {
    isResolved = false;
    encounter = createEncounter({
      nodeId: targetNodeId,
      nodeType: targetNode.type,
      playerHp: run.player.hp,
      playerMaxHp: run.player.maxHp,
      seed: options.seed || run.seed,
      customQuestion: options.customQuestion,
      relics: run.relics,
      relicState: run.relicState,
      run,
    });
  } else if (targetNode.type === ROGUE_NODE_TYPES.REST) {
    isResolved = false;
    pendingInteraction = {
      interactionId: `rest_${targetNodeId}_${run.seed}`,
      nodeId: targetNodeId,
      type: 'REST',
      options: ['RECOVER', 'CLEANSE'],
      resolved: false,
    };
  } else if (targetNode.type === ROGUE_NODE_TYPES.EVENT) {
    isResolved = false;
    const selectedEvent = selectEventForNode({
      seed: run.seed,
      nodeId: targetNodeId,
    });
    pendingInteraction = {
      interactionId: `event_${targetNodeId}_${run.seed}_${selectedEvent.id}`,
      nodeId: targetNodeId,
      type: 'EVENT',
      eventId: selectedEvent.id,
      options: selectedEvent.options.map((o) => o.id),
      resolved: false,
    };
  }

  return {
    ...run,
    currentNodeId: targetNodeId,
    currentNodeResolved: isResolved,
    encounter,
    pendingInteraction,
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
 * Resolves combat victory on the current node.
 * Persists remaining player HP, unlocks next nodes, and handles Boss run victory.
 *
 * @param {object} run
 * @param {object} finalEncounter
 * @returns {object} Updated run state
 */
export function resolveCombatVictory(run, finalEncounter) {
  if (!run || typeof run !== 'object') {
    throw new Error('[RogueRun] Invalid run state');
  }

  const remainingHp = finalEncounter?.player?.hp ?? run.player.hp;
  const currentNode = run.route.nodes[run.currentNodeId];
  const isBossNode =
    run.currentNodeId === run.route.bossNodeId ||
    currentNode?.type === ROGUE_NODE_TYPES.BOSS;

  const isEliteNode = currentNode?.type === ROGUE_NODE_TYPES.ELITE;

  let pendingReward = run.pendingReward || null;
  let isNodeResolved = true;

  if (isEliteNode && !pendingReward) {
    const draft = generateRelicDraft({
      seed: run.seed,
      nodeId: run.currentNodeId,
      ownedRelics: run.relics || [],
    });

    if (draft.options.length > 0) {
      pendingReward = draft;
      isNodeResolved = false;
    } else {
      // All relics owned: resolve reward without adding another relic
      pendingReward = null;
      isNodeResolved = true;
    }
  }

  const updatedRelics = finalEncounter?.relics || run.relics || [];
  const updatedRelicState = finalEncounter?.runRelicState || run.relicState || {};

  return {
    ...run,
    status: isBossNode ? ROGUE_RUN_STATUS.VICTORY : ROGUE_RUN_STATUS.ACTIVE,
    currentNodeResolved: isNodeResolved,
    pendingReward,
    encounter: finalEncounter || run.encounter,
    cursedWords: finalEncounter?.cursedWords || run.cursedWords || [],
    relics: updatedRelics,
    relicState: updatedRelicState,
    player: {
      ...run.player,
      hp: Math.max(1, Math.min(remainingHp, run.player.maxHp)),
    },
    runStats: {
      ...run.runStats,
      battlesWon: (run.runStats?.battlesWon || 0) + 1,
      correctAnswers:
        (run.runStats?.correctAnswers || 0) + (finalEncounter?.stats?.correctAnswers || 0),
      wrongAnswers:
        (run.runStats?.wrongAnswers || 0) + (finalEncounter?.stats?.wrongAnswers || 0),
    },
    updatedAt: Date.now(),
  };
}

/**
 * Resolves combat defeat on the current node.
 * Terminates run with DEFEAT.
 *
 * @param {object} run
 * @param {object} finalEncounter
 * @returns {object} Updated run state
 */
export function resolveCombatDefeat(run, finalEncounter) {
  if (!run || typeof run !== 'object') {
    throw new Error('[RogueRun] Invalid run state');
  }

  return {
    ...run,
    status: ROGUE_RUN_STATUS.DEFEAT,
    currentNodeResolved: false,
    encounter: finalEncounter || run.encounter,
    cursedWords: finalEncounter?.cursedWords || run.cursedWords || [],
    player: {
      ...run.player,
      hp: 0,
    },
    runStats: {
      ...run.runStats,
      correctAnswers:
        (run.runStats?.correctAnswers || 0) + (finalEncounter?.stats?.correctAnswers || 0),
      wrongAnswers:
        (run.runStats?.wrongAnswers || 0) + (finalEncounter?.stats?.wrongAnswers || 0),
    },
    updatedAt: Date.now(),
  };
}

/**
 * Manually resolves the current node (e.g. non-combat or direct victory resolution helper).
 *
 * @param {object} run
 * @returns {object} Updated run state
 */
export function resolveCurrentNode(run) {
  if (!run || typeof run !== 'object') {
    throw new Error('[RogueRun] Invalid run state');
  }
  const isBossNode =
    run.currentNodeId === run.route.bossNodeId ||
    run.route.nodes[run.currentNodeId]?.type === ROGUE_NODE_TYPES.BOSS;

  return {
    ...run,
    status: isBossNode ? ROGUE_RUN_STATUS.VICTORY : ROGUE_RUN_STATUS.ACTIVE,
    currentNodeResolved: true,
    encounter: null,
    runStats: {
      ...run.runStats,
      battlesWon: (run.runStats?.battlesWon || 0) + 1,
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
    player: {
      ...run.player,
      hp: 0,
    },
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
    currentNodeResolved: true,
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

/**
 * ROGUE EXPEDITION V0.1 — SEEDED MAP GENERATION
 *
 * Deterministic procedural map generation following strict topological rules:
 * - Start node in Row 0
 * - Intermediate rows with branching paths
 * - Boss node in final row
 * - No orphans / unreachable nodes
 * - Every reachable non-final node can reach Boss
 * - Edges strictly progress forward (row r -> row r+1)
 * - Identical seed produces identical map
 */

import { createPrng } from './prng';

export const ROGUE_NODE_TYPES = Object.freeze({
  START: 'START',
  BATTLE: 'BATTLE',
  ELITE: 'ELITE',
  REST: 'REST',
  EVENT: 'EVENT',
  BOSS: 'BOSS',
});

export const DEFAULT_ROW_COUNT = 5;

/**
 * Generates a deterministic branching map from a seed.
 *
 * @param {number|string} seed
 * @param {object} [options]
 * @param {number} [options.rowCount=5]
 * @returns {object} Seeded map topology
 */
export function generateRogueMap(seed, options = {}) {
  const rowCount = Math.max(3, options.rowCount || DEFAULT_ROW_COUNT);
  const prng = createPrng(seed);

  // 1. Determine number of nodes per row
  // Row 0: Start (1 node)
  // Intermediate rows: 2 to 3 nodes
  // Final row: Boss (1 node)
  const rowNodeCounts = [];
  for (let r = 0; r < rowCount; r++) {
    if (r === 0 || r === rowCount - 1) {
      rowNodeCounts.push(1);
    } else {
      rowNodeCounts.push(prng.nextInt(2, 3));
    }
  }

  // 2. Generate nodes per row
  const rowNodes = [];
  const nodes = {};

  for (let r = 0; r < rowCount; r++) {
    const count = rowNodeCounts[r];
    const currentRowNodes = [];

    for (let c = 0; c < count; c++) {
      const id = `node-${r}-${c}`;
      let type;

      if (r === 0) {
        type = ROGUE_NODE_TYPES.START;
      } else if (r === rowCount - 1) {
        type = ROGUE_NODE_TYPES.BOSS;
      } else if (r === 1) {
        // First floor after start: mostly standard battles, occasional mystery event
        type = prng.next() < 0.7 ? ROGUE_NODE_TYPES.BATTLE : ROGUE_NODE_TYPES.EVENT;
      } else if (r === rowCount - 2) {
        // Floor before boss: elite challenge, rest site, or tough battle
        const roll = prng.next();
        if (roll < 0.45) type = ROGUE_NODE_TYPES.ELITE;
        else if (roll < 0.75) type = ROGUE_NODE_TYPES.REST;
        else type = ROGUE_NODE_TYPES.BATTLE;
      } else {
        // Middle floors: balanced mix of battle, event, rest, elite
        const roll = prng.next();
        if (roll < 0.45) type = ROGUE_NODE_TYPES.BATTLE;
        else if (roll < 0.70) type = ROGUE_NODE_TYPES.EVENT;
        else if (roll < 0.85) type = ROGUE_NODE_TYPES.REST;
        else type = ROGUE_NODE_TYPES.ELITE;
      }

      const node = {
        id,
        row: r,
        col: c,
        type,
        nextNodes: [],
      };

      currentRowNodes.push(node);
      nodes[id] = node;
    }

    rowNodes.push(currentRowNodes);
  }

  // 3. Connect edges from Row r to Row r+1
  for (let r = 0; r < rowCount - 1; r++) {
    const currentList = rowNodes[r];
    const nextList = rowNodes[r + 1];
    const uCount = currentList.length;
    const vCount = nextList.length;

    if (r === 0) {
      // Start connects to all nodes in row 1 for immediate branching
      for (const nextNode of nextList) {
        currentList[0].nextNodes.push(nextNode.id);
      }
    } else if (r + 1 === rowCount - 1) {
      // Row before Boss: all connect to Boss
      for (const currNode of currentList) {
        currNode.nextNodes.push(nextList[0].id);
      }
    } else {
      // Intermediate row connections
      // Step A: Primary connection for each node in current row
      for (let u = 0; u < uCount; u++) {
        const primaryV = Math.floor((u * vCount) / uCount);
        currentList[u].nextNodes.push(nextList[primaryV].id);

        // Deterministic branching: chance to connect to adjacent node in next row
        if (vCount > 1) {
          if (primaryV + 1 < vCount && prng.next() < 0.5) {
            currentList[u].nextNodes.push(nextList[primaryV + 1].id);
          }
          if (primaryV - 1 >= 0 && prng.next() < 0.5) {
            currentList[u].nextNodes.push(nextList[primaryV - 1].id);
          }
        }
      }

      // Step B: Ensure every node in next row has at least one incoming edge
      for (let v = 0; v < vCount; v++) {
        const nextId = nextList[v].id;
        const hasIncoming = currentList.some((u) => u.nextNodes.includes(nextId));
        if (!hasIncoming) {
          const closestU = Math.min(uCount - 1, Math.floor((v * uCount) / vCount));
          currentList[closestU].nextNodes.push(nextId);
        }
      }

      // Step C: Ensure at least one branching choice exists if vCount > 1
      if (vCount > 1) {
        const hasBranching = currentList.some((u) => u.nextNodes.length >= 2);
        if (!hasBranching) {
          // Connect first node to another target in next row
          const firstNode = currentList[0];
          const unlinked = nextList.find((v) => !firstNode.nextNodes.includes(v.id));
          if (unlinked) {
            firstNode.nextNodes.push(unlinked.id);
          }
        }
      }
    }

    // Deduplicate and sort nextNodes for canonical stability
    for (const currNode of currentList) {
      currNode.nextNodes = Array.from(new Set(currNode.nextNodes)).sort();
    }
  }

  const startNodeId = rowNodes[0][0].id;
  const bossNodeId = rowNodes[rowCount - 1][0].id;

  const map = {
    seed,
    rowCount,
    startNodeId,
    bossNodeId,
    nodes,
  };

  return map;
}

/**
 * Validates map invariants:
 * - Start exists and can reach Boss
 * - All nodes are reachable from Start (no orphans)
 * - All reachable non-final nodes can reach Boss
 * - All edges only move forward (row r -> row r+1)
 * - Branching choices exist in the map
 *
 * @param {object} map
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateMapIntegrity(map) {
  const errors = [];
  if (!map || typeof map !== 'object') {
    return { valid: false, errors: ['Map is null or not an object'] };
  }

  const { nodes, startNodeId, bossNodeId, rowCount } = map;
  if (!nodes || typeof nodes !== 'object') {
    return { valid: false, errors: ['Map.nodes is missing'] };
  }
  if (!startNodeId || !nodes[startNodeId]) {
    errors.push(`startNodeId "${startNodeId}" missing from nodes`);
  }
  if (!bossNodeId || !nodes[bossNodeId]) {
    errors.push(`bossNodeId "${bossNodeId}" missing from nodes`);
  }

  const allNodeIds = Object.keys(nodes);

  // 1. Forward edge direction rule
  for (const id of allNodeIds) {
    const node = nodes[id];
    for (const nextId of node.nextNodes || []) {
      const nextNode = nodes[nextId];
      if (!nextNode) {
        errors.push(`Node "${id}" points to non-existent node "${nextId}"`);
      } else if (nextNode.row !== node.row + 1) {
        errors.push(`Invalid edge: "${id}" (row ${node.row}) -> "${nextId}" (row ${nextNode.row})`);
      }
    }
  }

  // 2. Reachability from Start (BFS)
  const reachableFromStart = new Set();
  const queue = [startNodeId];
  reachableFromStart.add(startNodeId);

  while (queue.length > 0) {
    const currId = queue.shift();
    const curr = nodes[currId];
    if (!curr) continue;
    for (const nextId of curr.nextNodes || []) {
      if (!reachableFromStart.has(nextId)) {
        reachableFromStart.add(nextId);
        queue.push(nextId);
      }
    }
  }

  for (const id of allNodeIds) {
    if (!reachableFromStart.has(id)) {
      errors.push(`Orphan node detected: "${id}" is not reachable from start`);
    }
  }

  // 3. Boss reachability (can reach Boss from every reachable node)
  // Build reverse adjacency list
  const reverseAdj = {};
  for (const id of allNodeIds) {
    reverseAdj[id] = [];
  }
  for (const id of allNodeIds) {
    for (const nextId of nodes[id].nextNodes || []) {
      if (reverseAdj[nextId]) {
        reverseAdj[nextId].push(id);
      }
    }
  }

  const canReachBoss = new Set();
  const revQueue = [bossNodeId];
  canReachBoss.add(bossNodeId);

  while (revQueue.length > 0) {
    const currId = revQueue.shift();
    for (const prevId of reverseAdj[currId] || []) {
      if (!canReachBoss.has(prevId)) {
        canReachBoss.add(prevId);
        revQueue.push(prevId);
      }
    }
  }

  for (const id of reachableFromStart) {
    if (!canReachBoss.has(id)) {
      errors.push(`Dead-end node: "${id}" cannot reach boss "${bossNodeId}"`);
    }
  }

  // 4. Branching exists: at least one non-final node has >= 2 outgoing edges
  const hasBranching = allNodeIds.some(
    (id) => nodes[id].row < rowCount - 1 && (nodes[id].nextNodes || []).length >= 2
  );
  if (!hasBranching) {
    errors.push('No branching choices exist in map');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

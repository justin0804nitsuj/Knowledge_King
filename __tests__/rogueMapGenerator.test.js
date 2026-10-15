import {
  generateRogueMap,
  validateMapIntegrity,
  ROGUE_NODE_TYPES,
  DEFAULT_ROW_COUNT
} from '../src/domain/rogue/mapGenerator';
import { createPrng, hashSeed } from '../src/domain/rogue/prng';

describe('Rogue Expedition V0.1 — Deterministic Seeded Map Generator', () => {
  describe('PRNG determinism & distribution', () => {
    test('produces identical random sequence given identical seed', () => {
      const prng1 = createPrng(12345);
      const prng2 = createPrng(12345);

      const seq1 = Array.from({ length: 20 }, () => prng1.next());
      const seq2 = Array.from({ length: 20 }, () => prng2.next());

      expect(seq1).toEqual(seq2);
    });

    test('produces different sequences given different seeds', () => {
      const prng1 = createPrng(12345);
      const prng2 = createPrng(54321);

      const seq1 = Array.from({ length: 10 }, () => prng1.next());
      const seq2 = Array.from({ length: 10 }, () => prng2.next());

      expect(seq1).not.toEqual(seq2);
    });

    test('hashes string seeds deterministically', () => {
      const h1 = hashSeed('expedition-seed-alpha');
      const h2 = hashSeed('expedition-seed-alpha');
      const h3 = hashSeed('expedition-seed-beta');

      expect(h1).toBe(h2);
      expect(h1).not.toBe(h3);
    });
  });

  describe('Map Invariants & Generation Rules', () => {
    test('same seed -> identical map (nodes, edges, types)', () => {
      const mapA = generateRogueMap(998877);
      const mapB = generateRogueMap(998877);

      expect(mapA).toEqual(mapB);
      expect(mapA.nodes).toEqual(mapB.nodes);
    });

    test('different seeds can produce different maps', () => {
      const map1 = generateRogueMap(1111);
      const map2 = generateRogueMap(8888);

      // Either node count, types, or edges differ
      const isIdentical = JSON.stringify(map1.nodes) === JSON.stringify(map2.nodes);
      expect(isIdentical).toBe(false);
    });

    test('Boss is always in the final row and reachable from start', () => {
      const seeds = [42, 100, 999, 'custom-seed', 20261015];

      for (const seed of seeds) {
        const map = generateRogueMap(seed);
        const bossNode = map.nodes[map.bossNodeId];

        expect(bossNode).toBeDefined();
        expect(bossNode.row).toBe(map.rowCount - 1);
        expect(bossNode.type).toBe(ROGUE_NODE_TYPES.BOSS);
        expect(bossNode.nextNodes).toEqual([]);

        const integrity = validateMapIntegrity(map);
        expect(integrity.valid).toBe(true);
        expect(integrity.errors).toEqual([]);
      }
    });

    test('no selectable orphan nodes: all nodes in the map are reachable from start', () => {
      const seeds = [7, 77, 777, 7777, 'explorer-run'];

      for (const seed of seeds) {
        const map = generateRogueMap(seed);

        // BFS from start
        const reachable = new Set();
        const queue = [map.startNodeId];
        reachable.add(map.startNodeId);

        while (queue.length > 0) {
          const curr = queue.shift();
          for (const next of map.nodes[curr].nextNodes) {
            if (!reachable.has(next)) {
              reachable.add(next);
              queue.push(next);
            }
          }
        }

        const totalNodes = Object.keys(map.nodes).length;
        expect(reachable.size).toBe(totalNodes);
      }
    });

    test('every reachable non-final node can ultimately reach Boss', () => {
      const testSeeds = [1, 2, 3, 10, 50, 100, 9999];

      for (const seed of testSeeds) {
        const map = generateRogueMap(seed);

        for (const [nodeId, node] of Object.entries(map.nodes)) {
          if (node.type === ROGUE_NODE_TYPES.BOSS) continue;

          // Check there is a path from nodeId to bossNodeId
          const visited = new Set();
          const q = [nodeId];
          visited.add(nodeId);
          let reachedBoss = false;

          while (q.length > 0) {
            const currId = q.shift();
            if (currId === map.bossNodeId) {
              reachedBoss = true;
              break;
            }
            for (const nxt of map.nodes[currId].nextNodes) {
              if (!visited.has(nxt)) {
                visited.add(nxt);
                q.push(nxt);
              }
            }
          }

          expect(reachedBoss).toBe(true);
        }
      }
    });

    test('branching choices exist in the map', () => {
      const seeds = [12, 34, 56, 78, 90];

      for (const seed of seeds) {
        const map = generateRogueMap(seed);

        // Start node connects to at least 2 nodes
        const startNext = map.nodes[map.startNodeId].nextNodes;
        expect(startNext.length).toBeGreaterThanOrEqual(2);

        // Verify there is at least one branching node with multiple choices
        const hasBranching = Object.values(map.nodes).some(
          (n) => n.row < map.rowCount - 1 && n.nextNodes.length >= 2
        );
        expect(hasBranching).toBe(true);
      }
    });

    test('edges only move strictly forward to row r + 1', () => {
      const map = generateRogueMap(5555);

      for (const node of Object.values(map.nodes)) {
        for (const nextId of node.nextNodes) {
          const nextNode = map.nodes[nextId];
          expect(nextNode.row).toBe(node.row + 1);
        }
      }
    });
  });
});

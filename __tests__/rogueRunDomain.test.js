import {
  createRogueRun,
  getSelectableNextNodes,
  canAdvanceToNode,
  advanceRunNode,
  abandonRogueRun,
  defeatRogueRun,
  completeRogueRun,
  resolveCurrentNode,
  resolveCombatVictory,
  isRunActive,
  isRunOver,
  ROGUE_RUN_STATUS,
  CURRENT_ROGUE_SCHEMA_VERSION,
} from '../src/domain/rogue/rogueRun';
import { generateRogueMap, ROGUE_NODE_TYPES } from '../src/domain/rogue/mapGenerator';

describe('Rogue Expedition V0.1 — Pure Run Domain Model', () => {
  const testSeed = 4242;

  test('creates a valid initial run model matching architectural schema', () => {
    const run = createRogueRun({ seed: testSeed });

    expect(run.schemaVersion).toBe(CURRENT_ROGUE_SCHEMA_VERSION);
    expect(typeof run.runId).toBe('string');
    expect(run.seed).toBe(testSeed);
    expect(run.status).toBe(ROGUE_RUN_STATUS.ACTIVE);
    expect(run.currentNodeId).toBe(run.route.startNodeId);
    expect(run.player).toEqual({ hp: 100, maxHp: 100 });
    expect(run.relics).toEqual([]);
    expect(run.cursedWords).toEqual([]);
    expect(run.runStats).toEqual({
      battlesWon: 0,
      correctAnswers: 0,
      wrongAnswers: 0,
      nodesVisited: 1,
    });
    expect(run.route.visitedNodeIds).toEqual([run.route.startNodeId]);
  });

  test('derives selectable connected next nodes accurately', () => {
    const run = createRogueRun({ seed: testSeed });
    const selectables = getSelectableNextNodes(run);

    expect(selectables.length).toBeGreaterThanOrEqual(1);
    const startNode = run.route.nodes[run.currentNodeId];
    expect(selectables).toEqual(startNode.nextNodes);

    for (const targetId of selectables) {
      expect(canAdvanceToNode(run, targetId)).toBe(true);
    }
  });

  test('only connected nodes may be selected, arbitrary jumps are rejected', () => {
    const run = createRogueRun({ seed: testSeed });
    const selectables = getSelectableNextNodes(run);
    const targetNodeId = selectables[0];

    // Legal move
    const nextRun = advanceRunNode(run, targetNodeId);
    expect(nextRun.currentNodeId).toBe(targetNodeId);
    expect(nextRun.route.visitedNodeIds).toContain(targetNodeId);
    expect(nextRun.runStats.nodesVisited).toBe(2);

    // Illegal jump: cannot jump directly to Boss from Start
    expect(canAdvanceToNode(run, run.route.bossNodeId)).toBe(false);
    expect(() => {
      advanceRunNode(run, run.route.bossNodeId);
    }).toThrow(/Invalid move/);

    // Illegal jump: cannot jump backwards to start once moved (even after resolved)
    const resolvedNextRun = resolveCurrentNode(nextRun);
    expect(canAdvanceToNode(resolvedNextRun, run.route.startNodeId)).toBe(false);
    expect(() => {
      advanceRunNode(resolvedNextRun, run.route.startNodeId);
    }).toThrow(/Invalid move/);

    // Non-existent node
    expect(canAdvanceToNode(run, 'node-999-999')).toBe(false);
    expect(() => {
      advanceRunNode(run, 'node-999-999');
    }).toThrow(/Invalid move/);
  });

  test('entering battle node marks it unresolved and locks next map nodes until victory', () => {
    const run = createRogueRun({ seed: testSeed });
    const nextNodeId = getSelectableNextNodes(run)[0];

    const battleRun = advanceRunNode(run, nextNodeId);
    expect(battleRun.currentNodeResolved).toBe(false);
    expect(battleRun.encounter).toBeDefined();
    expect(battleRun.encounter.status).toBe('ACTIVE');

    // Unresolved battle locks next map nodes
    expect(getSelectableNextNodes(battleRun)).toEqual([]);
    expect(() => {
      advanceRunNode(battleRun, nextNodeId);
    }).toThrow(/unresolved/);

    // Victory resolves node
    const resolvedRun = resolveCurrentNode(battleRun);
    expect(resolvedRun.currentNodeResolved).toBe(true);
    expect(getSelectableNextNodes(resolvedRun).length).toBeGreaterThanOrEqual(1);
  });

  test('cannot advance a finished (VICTORY / DEFEAT / ABANDONED) run', () => {
    const run = createRogueRun({ seed: testSeed });
    const available = getSelectableNextNodes(run)[0];

    // 1. Abandoned run
    const abandoned = abandonRogueRun(run);
    expect(isRunActive(abandoned)).toBe(false);
    expect(isRunOver(abandoned)).toBe(true);
    expect(getSelectableNextNodes(abandoned)).toEqual([]);
    expect(canAdvanceToNode(abandoned, available)).toBe(false);
    expect(() => {
      advanceRunNode(abandoned, available);
    }).toThrow(/Cannot advance/);

    // 2. Defeated run
    const defeated = defeatRogueRun(run);
    expect(isRunActive(defeated)).toBe(false);
    expect(isRunOver(defeated)).toBe(true);
    expect(getSelectableNextNodes(defeated)).toEqual([]);
    expect(canAdvanceToNode(defeated, available)).toBe(false);
    expect(() => {
      advanceRunNode(defeated, available);
    }).toThrow(/Cannot advance/);

    // 3. Victorious run
    const completed = completeRogueRun(run);
    expect(isRunActive(completed)).toBe(false);
    expect(isRunOver(completed)).toBe(true);
    expect(getSelectableNextNodes(completed)).toEqual([]);
    expect(canAdvanceToNode(completed, available)).toBe(false);
    expect(() => {
      advanceRunNode(completed, available);
    }).toThrow(/Cannot advance/);
  });

  test('advancing through a complete route to Boss triggers VICTORY', () => {
    let currentRun = createRogueRun({ seed: testSeed });

    // Step row by row until reaching Boss, resolving each battle node
    while (currentRun.status === ROGUE_RUN_STATUS.ACTIVE) {
      const nextOptions = getSelectableNextNodes(currentRun);
      expect(nextOptions.length).toBeGreaterThanOrEqual(1);

      const chosenNodeId = nextOptions[0];
      currentRun = advanceRunNode(currentRun, chosenNodeId);
      currentRun = resolveCurrentNode(currentRun);
    }

    expect(currentRun.status).toBe(ROGUE_RUN_STATUS.VICTORY);
    expect(currentRun.currentNodeId).toBe(currentRun.route.bossNodeId);
    expect(currentRun.route.visitedNodeIds[currentRun.route.visitedNodeIds.length - 1]).toBe(
      currentRun.route.bossNodeId
    );
    expect(getSelectableNextNodes(currentRun)).toEqual([]);
  });

  test('state updates are pure and immutable', () => {
    const originalRun = createRogueRun({ seed: testSeed });
    const nextNodeId = getSelectableNextNodes(originalRun)[0];

    const updated = advanceRunNode(originalRun, nextNodeId);

    expect(originalRun.currentNodeId).toBe(originalRun.route.startNodeId);
    expect(originalRun.route.visitedNodeIds).toEqual([originalRun.route.startNodeId]);
    expect(originalRun.runStats.nodesVisited).toBe(1);

    expect(updated.currentNodeId).toBe(nextNodeId);
    expect(updated.route.visitedNodeIds).toEqual([originalRun.route.startNodeId, nextNodeId]);
    expect(updated.runStats.nodesVisited).toBe(2);
  });
});

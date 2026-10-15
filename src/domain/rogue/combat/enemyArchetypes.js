/**
 * ROGUE EXPEDITION V0.1 — ENEMY ARCHETYPES & INTENT REGISTRY
 *
 * Data-driven enemy archetypes and deterministic intent cycles:
 * - SCOUT: Predictable consistent attacker (ATTACK cycle)
 * - BRUTE: Alternates standard and heavy attacks (ATTACK -> HEAVY_ATTACK cycle)
 * - SENTINEL: Alternates defenses and counterattacks (GUARD -> ATTACK cycle)
 * - OVERLORD: Boss foundation with 3-phase rotation (ATTACK -> GUARD -> HEAVY_ATTACK cycle)
 *
 * Invariant: Intent is deterministic from (archetype, turn). No Math.random.
 */

import { hashSeed } from '../prng';

export const INTENT_TYPES = Object.freeze({
  ATTACK: 'ATTACK',
  HEAVY_ATTACK: 'HEAVY_ATTACK',
  GUARD: 'GUARD',
});

export const ARCHETYPE_IDS = Object.freeze({
  SCOUT: 'SCOUT',
  BRUTE: 'BRUTE',
  SENTINEL: 'SENTINEL',
  OVERLORD: 'OVERLORD',
});

/**
 * Canonical registry of enemy archetypes.
 */
export const ENEMY_ARCHETYPES = Object.freeze({
  [ARCHETYPE_IDS.SCOUT]: Object.freeze({
    id: ARCHETYPE_IDS.SCOUT,
    nameKey: 'rogue.archetypes.scout.name',
    descriptionKey: 'rogue.archetypes.scout.desc',
    defaultName: 'Labyrinth Scout',
    hp: 40,
    maxHp: 40,
    baseDamage: 10,
    intentPattern: Object.freeze([
      Object.freeze({ type: INTENT_TYPES.ATTACK, value: 10 }),
    ]),
  }),

  [ARCHETYPE_IDS.BRUTE]: Object.freeze({
    id: ARCHETYPE_IDS.BRUTE,
    nameKey: 'rogue.archetypes.brute.name',
    descriptionKey: 'rogue.archetypes.brute.desc',
    defaultName: 'Ironjaw Brute',
    hp: 40,
    maxHp: 40,
    baseDamage: 10,
    heavyDamage: 20,
    intentPattern: Object.freeze([
      Object.freeze({ type: INTENT_TYPES.ATTACK, value: 10 }),
      Object.freeze({ type: INTENT_TYPES.HEAVY_ATTACK, value: 20 }),
    ]),
  }),

  [ARCHETYPE_IDS.SENTINEL]: Object.freeze({
    id: ARCHETYPE_IDS.SENTINEL,
    nameKey: 'rogue.archetypes.sentinel.name',
    descriptionKey: 'rogue.archetypes.sentinel.desc',
    defaultName: 'Stone Sentinel',
    hp: 60,
    maxHp: 60,
    baseDamage: 15,
    guardMitigation: 10,
    intentPattern: Object.freeze([
      Object.freeze({ type: INTENT_TYPES.ATTACK, value: 15 }),
      Object.freeze({ type: INTENT_TYPES.GUARD, value: 10 }),
    ]),
  }),

  [ARCHETYPE_IDS.OVERLORD]: Object.freeze({
    id: ARCHETYPE_IDS.OVERLORD,
    nameKey: 'rogue.archetypes.overlord.name',
    descriptionKey: 'rogue.archetypes.overlord.desc',
    defaultName: 'Labyrinth Overlord',
    hp: 80,
    maxHp: 80,
    baseDamage: 20,
    heavyDamage: 30,
    guardMitigation: 10,
    phaseThreshold: 40,
    intentPattern: Object.freeze([
      Object.freeze({ type: INTENT_TYPES.ATTACK, value: 20 }),
      Object.freeze({ type: INTENT_TYPES.GUARD, value: 10 }),
      Object.freeze({ type: INTENT_TYPES.HEAVY_ATTACK, value: 30 }),
    ]),
    phase2IntentPattern: Object.freeze([
      Object.freeze({ type: INTENT_TYPES.HEAVY_ATTACK, value: 30 }),
      Object.freeze({ type: INTENT_TYPES.ATTACK, value: 20 }),
      Object.freeze({ type: INTENT_TYPES.HEAVY_ATTACK, value: 30 }),
      Object.freeze({ type: INTENT_TYPES.GUARD, value: 10 }),
    ]),
  }),
});

/**
 * Returns the archetype definition for an ID.
 *
 * @param {string} archetypeId
 * @returns {object|null}
 */
export function getArchetype(archetypeId) {
  return ENEMY_ARCHETYPES[archetypeId] || null;
}

/**
 * Deterministically derives an enemy's intent for a specific turn.
 * Turn is 1-indexed.
 *
 * @param {object|string} archetypeOrId
 * @param {number} turn - Turn number (>= 1)
 * @param {object} [options]
 * @param {number} [options.bossPhase=1] - Current Boss phase (1 or 2)
 * @param {number|null} [options.phase2StartTurn=null] - Turn when Phase 2 began
 * @returns {{ type: string, value: number }}
 */
export function getIntentForTurn(archetypeOrId, turn = 1, options = {}) {
  const archetype =
    typeof archetypeOrId === 'string' ? getArchetype(archetypeOrId) : archetypeOrId;

  if (!archetype || !Array.isArray(archetype.intentPattern) || archetype.intentPattern.length === 0) {
    throw new Error(`[EnemyArchetypes] Invalid archetype or missing intentPattern: ${archetypeOrId}`);
  }

  const safeTurn = Math.max(1, Math.floor(turn));
  const { bossPhase = 1, phase2StartTurn = null } = options;

  let pattern = archetype.intentPattern;
  let patternIndex = (safeTurn - 1) % pattern.length;

  if (
    archetype.id === ARCHETYPE_IDS.OVERLORD &&
    bossPhase === 2 &&
    Array.isArray(archetype.phase2IntentPattern) &&
    archetype.phase2IntentPattern.length > 0
  ) {
    pattern = archetype.phase2IntentPattern;
    const phaseTurn = phase2StartTurn ? Math.max(1, safeTurn - phase2StartTurn + 1) : safeTurn;
    patternIndex = (phaseTurn - 1) % pattern.length;
  }

  const intent = pattern[patternIndex];

  return {
    type: intent.type,
    value: intent.value,
  };
}

/**
 * Deterministically assigns an archetype to a node encounter.
 * Node type (BATTLE/ELITE/BOSS) is decoupled from archetype ID.
 *
 * @param {string} nodeType - 'BATTLE' | 'ELITE' | 'BOSS'
 * @param {number|string} seed - Run seed
 * @param {string} nodeId - Node ID (e.g. 'node-1-0')
 * @returns {string} Assigned ARCHETYPE_ID
 */
export function selectArchetypeForNode(nodeType, seed, nodeId) {
  if (nodeType === 'BOSS') {
    return ARCHETYPE_IDS.OVERLORD;
  }

  if (seed === undefined || seed === null) {
    return nodeType === 'ELITE' ? ARCHETYPE_IDS.SENTINEL : ARCHETYPE_IDS.SCOUT;
  }

  const safeNodeId = nodeId || 'node-0';

  if (nodeType === 'ELITE') {
    const candidates = [ARCHETYPE_IDS.SENTINEL, ARCHETYPE_IDS.BRUTE];
    const hash = hashSeed(`${seed}_${safeNodeId}_elite`);
    return candidates[hash % candidates.length];
  }

  // BATTLE encounters choose between standard foundation archetypes
  const candidates = [ARCHETYPE_IDS.SCOUT, ARCHETYPE_IDS.BRUTE];
  const hash = hashSeed(`${seed}_${safeNodeId}_battle`);
  return candidates[hash % candidates.length];
}

/**
 * Validates the integrity of an encounter's archetype and intent structure.
 *
 * @param {object} encounter
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateEncounterIntegrity(encounter) {
  const errors = [];
  if (!encounter || typeof encounter !== 'object') {
    return { valid: false, errors: ['Encounter is not an object'] };
  }

  const { archetypeId, enemy } = encounter;
  if (!archetypeId || !ENEMY_ARCHETYPES[archetypeId]) {
    errors.push(`Unknown or missing archetypeId: "${archetypeId}"`);
  }

  if (!enemy || typeof enemy !== 'object') {
    errors.push('Encounter enemy is missing');
  } else {
    const intent = enemy.intent;
    if (!intent || typeof intent !== 'object') {
      errors.push('Enemy intent is missing');
    } else {
      const validTypes = Object.values(INTENT_TYPES);
      if (!validTypes.includes(intent.type)) {
        errors.push(`Invalid intent type: "${intent.type}"`);
      }
      if (typeof intent.value !== 'number' || !Number.isFinite(intent.value) || intent.value < 0) {
        errors.push(`Invalid intent value: "${intent.value}"`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

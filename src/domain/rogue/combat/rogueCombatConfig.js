/**
 * ROGUE EXPEDITION V0.1 — COMBAT CONFIGURATION & DIFFICULTY MAPPING
 *
 * Centralizes combat balance constants, archetype exports,
 * and vocabulary difficulty mapping.
 */

import {
  INTENT_TYPES,
  ARCHETYPE_IDS,
  ENEMY_ARCHETYPES,
  selectArchetypeForNode,
  getArchetype,
  getIntentForTurn,
} from './enemyArchetypes';

export {
  INTENT_TYPES,
  ARCHETYPE_IDS,
  ENEMY_ARCHETYPES,
  selectArchetypeForNode,
  getArchetype,
  getIntentForTurn,
};

export const ROGUE_COMBAT_CONSTANTS = Object.freeze({
  PLAYER_MAX_HP: 100,
  PLAYER_ATTACK_DAMAGE: 20,
  PLAYER_WRONG_DAMAGE: 0,
});

/**
 * Maps a map node and run context to a vocabulary difficulty level (1-6).
 *
 * Foundation Mapping:
 * - Row 0-1 (Early Floors): Level 1
 * - Row 2-3 (Mid Floors & Elites): Level 2
 * - Row 4+ (Boss Floor): Level 3
 *
 * @param {object} node
 * @param {object} [run]
 * @returns {number} Vocabulary level integer [1..6]
 */
export function getRogueQuestionDifficulty(node, run) {
  const row = node?.row ?? 1;
  const type = node?.type;

  if (type === 'BOSS' || row >= 4) {
    return 3;
  }
  if (type === 'ELITE' || row >= 2) {
    return 2;
  }
  return 1;
}

/**
 * Returns the enemy configuration for a given node type and seed/nodeId context.
 *
 * @param {string} nodeType - 'BATTLE' | 'ELITE' | 'BOSS'
 * @param {number|string} [seed]
 * @param {string} [nodeId]
 * @returns {object} Enemy template with initial turn 1 intent
 */
export function getEnemyConfigForNodeType(nodeType, seed = 0, nodeId = 'node-0') {
  const archetypeId = selectArchetypeForNode(nodeType, seed, nodeId);
  const archetype = getArchetype(archetypeId) || ENEMY_ARCHETYPES[ARCHETYPE_IDS.SCOUT];
  const initialIntent = getIntentForTurn(archetype, 1);

  return {
    enemyId: `enemy_${archetype.id.toLowerCase()}`,
    archetypeId: archetype.id,
    nameKey: archetype.nameKey,
    name: archetype.defaultName,
    hp: archetype.hp,
    maxHp: archetype.maxHp,
    baseDamage: archetype.baseDamage,
    intent: initialIntent,
  };
}

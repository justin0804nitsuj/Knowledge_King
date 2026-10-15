/**
 * ROGUE EXPEDITION V0.1 — COMBAT CONFIGURATION & DIFFICULTY MAPPING
 *
 * Centralizes all combat constants, enemy baseline templates,
 * and vocabulary difficulty mapping for Phase R2.
 */

export const ROGUE_COMBAT_CONSTANTS = Object.freeze({
  PLAYER_MAX_HP: 100,
  PLAYER_ATTACK_DAMAGE: 20,
  PLAYER_WRONG_DAMAGE: 0,

  /**
   * Data-driven enemy templates for Phase R2 foundation.
   */
  ENEMIES: Object.freeze({
    BATTLE: Object.freeze({
      enemyId: 'enemy_scout',
      name: 'Labyrinth Scout',
      hp: 40,
      maxHp: 40,
      baseDamage: 10,
    }),
    ELITE: Object.freeze({
      enemyId: 'enemy_sentinel',
      name: 'Iron Sentinel',
      hp: 60,
      maxHp: 60,
      baseDamage: 15,
    }),
    BOSS: Object.freeze({
      enemyId: 'enemy_overlord',
      name: 'Labyrinth Overlord',
      hp: 80,
      maxHp: 80,
      baseDamage: 20,
    }),
  }),
});

/**
 * Maps a map node and run context to a vocabulary difficulty level (1-6).
 *
 * R2 Foundation Mapping:
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
 * Returns the enemy configuration for a given node type.
 *
 * @param {string} nodeType - 'BATTLE' | 'ELITE' | 'BOSS'
 * @returns {object} Enemy template clone
 */
export function getEnemyConfigForNodeType(nodeType) {
  const template =
    ROGUE_COMBAT_CONSTANTS.ENEMIES[nodeType] || ROGUE_COMBAT_CONSTANTS.ENEMIES.BATTLE;
  return {
    ...template,
    intent: {
      type: 'ATTACK',
      value: template.baseDamage,
    },
  };
}

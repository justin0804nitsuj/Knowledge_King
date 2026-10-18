/**
 * ROGUE EXPEDITION V0.1 — PLAYER COMBAT ACTIONS REGISTRY
 *
 * Centralizes player combat action definitions, constants, and validation:
 * - ATTACK: 25 base damage on correct answer.
 * - GUARD: 20 block for current enemy intent on correct answer.
 * - RECOVER: 15 heal (clamped to max HP) on correct answer.
 *   Consumes 3-turn cooldown whether answer is correct or wrong.
 *
 * Invariant: Actions are visible every turn. Recover is disabled while on cooldown.
 */

export const PLAYER_ACTION_IDS = Object.freeze({
  ATTACK: 'ATTACK',
  GUARD: 'GUARD',
  RECOVER: 'RECOVER',
});

export const PLAYER_ACTION_CONSTANTS = Object.freeze({
  ATTACK_DAMAGE: 25,
  GUARD_BLOCK: 20,
  RECOVER_HEAL: 20,
  RECOVER_COOLDOWN_TURNS: 3,
});

export const PLAYER_ACTIONS = Object.freeze({
  [PLAYER_ACTION_IDS.ATTACK]: Object.freeze({
    id: PLAYER_ACTION_IDS.ATTACK,
    nameKey: 'rogue.actions.attack.name',
    descKey: 'rogue.actions.attack.desc',
    defaultName: 'Attack',
    defaultDesc: 'Deal 25 damage',
    value: PLAYER_ACTION_CONSTANTS.ATTACK_DAMAGE,
    icon: 'flash-outline',
  }),

  [PLAYER_ACTION_IDS.GUARD]: Object.freeze({
    id: PLAYER_ACTION_IDS.GUARD,
    nameKey: 'rogue.actions.guard.name',
    descKey: 'rogue.actions.guard.desc',
    defaultName: 'Guard',
    defaultDesc: 'Gain 20 block this turn',
    value: PLAYER_ACTION_CONSTANTS.GUARD_BLOCK,
    icon: 'shield-outline',
  }),

  [PLAYER_ACTION_IDS.RECOVER]: Object.freeze({
    id: PLAYER_ACTION_IDS.RECOVER,
    nameKey: 'rogue.actions.recover.name',
    descKey: 'rogue.actions.recover.desc',
    defaultName: 'Recover',
    defaultDesc: 'Heal 20 HP (Cooldown: 3 turns)',
    value: PLAYER_ACTION_CONSTANTS.RECOVER_HEAL,
    cooldownTurns: PLAYER_ACTION_CONSTANTS.RECOVER_COOLDOWN_TURNS,
    icon: 'heart-outline',
  }),
});

/**
 * Validates whether an action ID is a known player action.
 *
 * @param {string} actionId
 * @returns {boolean}
 */
export function isValidActionId(actionId) {
  return typeof actionId === 'string' && Object.values(PLAYER_ACTION_IDS).includes(actionId);
}

/**
 * Checks whether an action is currently available given encounter cooldown state.
 *
 * @param {string} actionId
 * @param {object} [encounter]
 * @returns {boolean}
 */
export function isActionAvailable(actionId, encounter) {
  if (!isValidActionId(actionId)) return false;
  if (actionId === PLAYER_ACTION_IDS.RECOVER) {
    const cd = encounter?.recoverCooldown ?? encounter?.player?.recoverCooldown ?? 0;
    return cd <= 0;
  }
  return true;
}

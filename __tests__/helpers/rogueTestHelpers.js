/**
 * ROGUE EXPEDITION V0.1 ??TEST HELPERS (PHASE R9)
 *
 * Provides standard test-only helpers that strictly execute the real production sequence:
 * 1. select Action (via selectActionInEncounter or selectCombatAction)
 * 2. submit Answer (via resolveEncounterTurn or submitCombatAnswer)
 *
 * NEVER directly mutates encounter.selectedAction or HP.
 */

import {
  selectActionInEncounter,
  resolveEncounterTurn,
  PLAYER_ACTION_IDS,
} from '../../src/domain/rogue/combat/rogueCombat';

/**
 * Domain-level helper: select ATTACK in encounter, then resolve turn.
 */
export function chooseAttackAndResolve(encounter, actionPayload, options = {}) {
  const armed = selectActionInEncounter(encounter, PLAYER_ACTION_IDS.ATTACK);
  return resolveEncounterTurn(armed, actionPayload, options);
}

/**
 * Domain-level helper: select GUARD in encounter, then resolve turn.
 */
export function chooseGuardAndResolve(encounter, actionPayload, options = {}) {
  const armed = selectActionInEncounter(encounter, PLAYER_ACTION_IDS.GUARD);
  return resolveEncounterTurn(armed, actionPayload, options);
}

/**
 * Domain-level helper: select RECOVER in encounter, then resolve turn.
 */
export function chooseRecoverAndResolve(encounter, actionPayload, options = {}) {
  const armed = selectActionInEncounter(encounter, PLAYER_ACTION_IDS.RECOVER);
  return resolveEncounterTurn(armed, actionPayload, options);
}

/**
 * Service-level helper: select ATTACK via selectCombatAction, then submitCombatAnswer.
 */
export async function chooseAttackAndSubmit({
  choiceId,
  token,
  explicitIdentity,
  options = {},
} = {}) {
  const { selectCombatAction, submitCombatAnswer } = require('../../src/services/rogue/rogueRunService');
  await selectCombatAction({ actionId: PLAYER_ACTION_IDS.ATTACK, explicitIdentity });
  return submitCombatAnswer({ choiceId, token, explicitIdentity, options });
}

/**
 * Service-level helper: select GUARD via selectCombatAction, then submitCombatAnswer.
 */
export async function chooseGuardAndSubmit({
  choiceId,
  token,
  explicitIdentity,
  options = {},
} = {}) {
  const { selectCombatAction, submitCombatAnswer } = require('../../src/services/rogue/rogueRunService');
  await selectCombatAction({ actionId: PLAYER_ACTION_IDS.GUARD, explicitIdentity });
  return submitCombatAnswer({ choiceId, token, explicitIdentity, options });
}

/**
 * Service-level helper: select RECOVER via selectCombatAction, then submitCombatAnswer.
 */
export async function chooseRecoverAndSubmit({
  choiceId,
  token,
  explicitIdentity,
  options = {},
} = {}) {
  const { selectCombatAction, submitCombatAnswer } = require('../../src/services/rogue/rogueRunService');
  await selectCombatAction({ actionId: PLAYER_ACTION_IDS.RECOVER, explicitIdentity });
  return submitCombatAnswer({ choiceId, token, explicitIdentity, options });
}

describe('Rogue Test Helpers', () => {
  it('exports valid test helper functions', () => {
    expect(typeof chooseAttackAndResolve).toBe('function');
    expect(typeof chooseGuardAndResolve).toBe('function');
    expect(typeof chooseRecoverAndResolve).toBe('function');
    expect(typeof chooseAttackAndSubmit).toBe('function');
    expect(typeof chooseGuardAndSubmit).toBe('function');
    expect(typeof chooseRecoverAndSubmit).toBe('function');
  });
});

/**
 * ROGUE EXPEDITION V0.1 — RELIC EFFECTS PIPELINE
 *
 * Centralizes pure effect calculations for all Rogue Relics (Phase R5).
 * Combat engines query these effect functions; screens only render results.
 */

import { RELIC_IDS } from './relicRegistry';

/**
 * Modifies outgoing player attack damage based on active relics.
 *
 * Glass Quill: +10 damage on correct answer.
 *
 * @param {object} params
 * @param {number} params.baseDamage
 * @param {Array<string>} [params.relics=[]]
 * @returns {{ playerDamage: number, glassQuillBonus: number }}
 */
export function modifyPlayerAttackDamage({ baseDamage, relics = [] }) {
  const safeBase = typeof baseDamage === 'number' ? baseDamage : 0;
  if (safeBase <= 0) {
    return { playerDamage: 0, glassQuillBonus: 0 };
  }

  const hasGlassQuill = Array.isArray(relics) && relics.includes(RELIC_IDS.GLASS_QUILL);
  const bonus = hasGlassQuill ? 10 : 0;

  return {
    playerDamage: safeBase + bonus,
    glassQuillBonus: bonus,
  };
}

/**
 * Modifies enemy Guard damage mitigation based on active relics.
 *
 * Piercing Nib: Reduces enemy Guard mitigation by 10 (min 0).
 *
 * @param {object} params
 * @param {number} params.mitigation
 * @param {Array<string>} [params.relics=[]]
 * @returns {{ effectiveMitigation: number, guardPierced: number }}
 */
export function modifyGuardMitigation({ mitigation, relics = [] }) {
  const safeMitigation = Math.max(0, typeof mitigation === 'number' ? mitigation : 0);
  if (safeMitigation <= 0) {
    return { effectiveMitigation: 0, guardPierced: 0 };
  }

  const hasPiercingNib = Array.isArray(relics) && relics.includes(RELIC_IDS.PIERCING_NIB);
  const reduction = hasPiercingNib ? 10 : 0;
  const effectiveMitigation = Math.max(0, safeMitigation - reduction);
  const guardPierced = safeMitigation - effectiveMitigation;

  return {
    effectiveMitigation,
    guardPierced,
  };
}

/**
 * Returns the number of curse stacks reduced on a correct cursed answer.
 *
 * Scholar's Lens: -2 stacks instead of -1.
 *
 * @param {object} params
 * @param {Array<string>} [params.relics=[]]
 * @returns {number}
 */
export function getCursePurificationAmount({ relics = [] }) {
  const hasScholarsLens =
    Array.isArray(relics) && relics.includes(RELIC_IDS.SCHOLARS_LENS);
  return hasScholarsLens ? 2 : 1;
}

/**
 * Modifies Curse Backlash damage.
 *
 * Glass Quill: +5 flat damage when Curse Backlash actually occurs.
 *
 * @param {object} params
 * @param {number} params.backlash
 * @param {boolean} params.isCursedReview
 * @param {Array<string>} [params.relics=[]]
 * @returns {{ effectiveBacklash: number, glassQuillBacklashBonus: number }}
 */
export function modifyCurseBacklashDamage({
  backlash,
  isCursedReview,
  relics = [],
}) {
  const safeBacklash = Math.max(0, typeof backlash === 'number' ? backlash : 0);
  if (safeBacklash <= 0 || !isCursedReview) {
    return { effectiveBacklash: 0, glassQuillBacklashBonus: 0 };
  }

  const hasGlassQuill = Array.isArray(relics) && relics.includes(RELIC_IDS.GLASS_QUILL);
  const bonus = hasGlassQuill ? 5 : 0;

  return {
    effectiveBacklash: safeBacklash + bonus,
    glassQuillBacklashBonus: bonus,
  };
}

/**
 * Determines whether a first-time normal mistake should be prevented from creating a curse.
 *
 * Mnemonic Charm: Prevents the FIRST normal-word mistake in each encounter.
 *
 * @param {object} params
 * @param {boolean} params.isNormalMistake
 * @param {Array<string>} [params.relics=[]]
 * @param {object} [params.encounterRelicState]
 * @returns {boolean}
 */
export function shouldPreventNewCurse({
  isNormalMistake,
  relics = [],
  encounterRelicState,
}) {
  if (!isNormalMistake) return false;

  const hasMnemonicCharm =
    Array.isArray(relics) && relics.includes(RELIC_IDS.MNEMONIC_CHARM);
  if (!hasMnemonicCharm) return false;

  const used = Boolean(encounterRelicState?.MNEMONIC_CHARM?.usedThisEncounter);
  return !used;
}

/**
 * Handles purification rewards.
 *
 * Purifying Ink: Whenever a Cursed Word becomes fully purified, restores 10 HP.
 *
 * @param {object} params
 * @param {number} params.playerHp
 * @param {number} params.playerMaxHp
 * @param {Array<string>} [params.relics=[]]
 * @returns {{ healedHp: number, actualHeal: number }}
 */
export function onCursePurified({ playerHp, playerMaxHp, relics = [] }) {
  const safeHp = Math.max(0, typeof playerHp === 'number' ? playerHp : 0);
  const safeMaxHp = Math.max(safeHp, typeof playerMaxHp === 'number' ? playerMaxHp : 100);

  const hasPurifyingInk =
    Array.isArray(relics) && relics.includes(RELIC_IDS.PURIFYING_INK);
  if (!hasPurifyingInk) {
    return { healedHp: safeHp, actualHeal: 0 };
  }

  const healedHp = Math.min(safeMaxHp, safeHp + 10);
  const actualHeal = healedHp - safeHp;

  return {
    healedHp,
    actualHeal,
  };
}

/**
 * Evaluates whether lethal protection activates on incoming damage.
 *
 * Second Chance: Once per run, when damage would reduce player HP to 0,
 * leaves the player at 1 HP instead and consumes the charge.
 *
 * @param {object} params
 * @param {number} params.currentHp
 * @param {number} params.incomingDamage
 * @param {Array<string>} [params.relics=[]]
 * @param {object} [params.runRelicState]
 * @returns {{ protected: boolean, newHp: number, consumedRelic: string|null }}
 */
export function applyLethalProtection({
  currentHp,
  incomingDamage,
  relics = [],
  runRelicState,
}) {
  const safeHp = Math.max(0, typeof currentHp === 'number' ? currentHp : 0);
  const safeDamage = Math.max(0, typeof incomingDamage === 'number' ? incomingDamage : 0);

  if (safeDamage < safeHp) {
    return {
      protected: false,
      newHp: safeHp - safeDamage,
      consumedRelic: null,
    };
  }

  // Damage is lethal: check Second Chance
  const hasSecondChance =
    Array.isArray(relics) && relics.includes(RELIC_IDS.SECOND_CHANCE);
  const isConsumed = Boolean(runRelicState?.SECOND_CHANCE?.consumed);

  if (hasSecondChance && !isConsumed && safeHp > 0) {
    return {
      protected: true,
      newHp: 1,
      consumedRelic: RELIC_IDS.SECOND_CHANCE,
    };
  }

  return {
    protected: false,
    newHp: 0,
    consumedRelic: null,
  };
}

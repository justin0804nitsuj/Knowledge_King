/**
 * ROGUE EXPEDITION V0.1 — RELIC REGISTRY
 *
 * Centralized, data-driven registry of all Rogue Relics (Phase R5).
 * All relic IDs are stable canonical identifiers.
 */

export const RELIC_IDS = Object.freeze({
  SCHOLARS_LENS: 'SCHOLARS_LENS',
  PIERCING_NIB: 'PIERCING_NIB',
  MNEMONIC_CHARM: 'MNEMONIC_CHARM',
  PURIFYING_INK: 'PURIFYING_INK',
  GLASS_QUILL: 'GLASS_QUILL',
  SECOND_CHANCE: 'SECOND_CHANCE',
});

export const RELIC_REGISTRY = Object.freeze({
  [RELIC_IDS.SCHOLARS_LENS]: Object.freeze({
    id: RELIC_IDS.SCHOLARS_LENS,
    nameKey: 'rogue.relics.scholarsLens.name',
    descriptionKey: 'rogue.relics.scholarsLens.desc',
    defaultName: "Scholar's Lens",
    defaultDesc: 'Correct answers on Cursed Words reduce 2 curse levels instead of 1.',
    rarity: 'UNCOMMON',
    icon: '🔍',
  }),

  [RELIC_IDS.PIERCING_NIB]: Object.freeze({
    id: RELIC_IDS.PIERCING_NIB,
    nameKey: 'rogue.relics.piercingNib.name',
    descriptionKey: 'rogue.relics.piercingNib.desc',
    defaultName: 'Piercing Nib',
    defaultDesc: 'Reduces enemy Guard damage mitigation by 10.',
    rarity: 'COMMON',
    icon: '✒️',
  }),

  [RELIC_IDS.MNEMONIC_CHARM]: Object.freeze({
    id: RELIC_IDS.MNEMONIC_CHARM,
    nameKey: 'rogue.relics.mnemonicCharm.name',
    descriptionKey: 'rogue.relics.mnemonicCharm.desc',
    defaultName: 'Mnemonic Charm',
    defaultDesc: 'The first normal word mistake in each battle does not create a Curse.',
    rarity: 'RARE',
    icon: '🧿',
  }),

  [RELIC_IDS.PURIFYING_INK]: Object.freeze({
    id: RELIC_IDS.PURIFYING_INK,
    nameKey: 'rogue.relics.purifyingInk.name',
    descriptionKey: 'rogue.relics.purifyingInk.desc',
    defaultName: 'Purifying Ink',
    defaultDesc: 'Fully purifying a Cursed Word restores 10 HP.',
    rarity: 'UNCOMMON',
    icon: '🧪',
  }),

  [RELIC_IDS.GLASS_QUILL]: Object.freeze({
    id: RELIC_IDS.GLASS_QUILL,
    nameKey: 'rogue.relics.glassQuill.name',
    descriptionKey: 'rogue.relics.glassQuill.desc',
    defaultName: 'Glass Quill',
    defaultDesc: 'Correct answers deal +10 attack damage, but Curse Backlash deals +5 damage.',
    rarity: 'RARE',
    icon: '🪶',
  }),

  [RELIC_IDS.SECOND_CHANCE]: Object.freeze({
    id: RELIC_IDS.SECOND_CHANCE,
    nameKey: 'rogue.relics.secondChance.name',
    descriptionKey: 'rogue.relics.secondChance.desc',
    defaultName: 'Second Chance',
    defaultDesc: 'Once per expedition, surviving lethal damage leaves you at 1 HP instead.',
    rarity: 'EPIC',
    icon: '⏳',
  }),
});

/**
 * Returns relic definition for given relic ID or null if unknown.
 *
 * @param {string} relicId
 * @returns {object|null}
 */
export function getRelic(relicId) {
  if (!relicId || typeof relicId !== 'string') return null;
  return RELIC_REGISTRY[relicId] || null;
}

/**
 * Returns all registered relic definitions in stable canonical order.
 *
 * @returns {Array<object>}
 */
export function getAllRelics() {
  return [
    RELIC_REGISTRY[RELIC_IDS.SCHOLARS_LENS],
    RELIC_REGISTRY[RELIC_IDS.PIERCING_NIB],
    RELIC_REGISTRY[RELIC_IDS.MNEMONIC_CHARM],
    RELIC_REGISTRY[RELIC_IDS.PURIFYING_INK],
    RELIC_REGISTRY[RELIC_IDS.GLASS_QUILL],
    RELIC_REGISTRY[RELIC_IDS.SECOND_CHANCE],
  ];
}

/**
 * ROGUE EXPEDITION V0.1 — EVENT REGISTRY
 *
 * Centralized deterministic registry of Rogue Events (Phase R6):
 * - HEALING_SPRING
 * - FORGOTTEN_SHRINE
 * - CURSED_ARCHIVE
 *
 * Uses data-driven effect primitives: HEAL, HP_COST, PURIFY_HIGHEST_CURSE, NONE.
 */

import { createPrng } from '../prng';

export const EVENT_EFFECT_TYPES = Object.freeze({
  HEAL: 'HEAL',
  HP_COST: 'HP_COST',
  PURIFY_HIGHEST_CURSE: 'PURIFY_HIGHEST_CURSE',
  NONE: 'NONE',
});

export const EVENT_IDS = Object.freeze({
  HEALING_SPRING: 'HEALING_SPRING',
  FORGOTTEN_SHRINE: 'FORGOTTEN_SHRINE',
  CURSED_ARCHIVE: 'CURSED_ARCHIVE',
});

export const EVENT_REGISTRY = Object.freeze({
  [EVENT_IDS.HEALING_SPRING]: Object.freeze({
    id: EVENT_IDS.HEALING_SPRING,
    nameKey: 'rogue.events.healingSpring.name',
    descriptionKey: 'rogue.events.healingSpring.desc',
    defaultName: 'Healing Spring',
    defaultDesc: 'A tranquil pool of crystalline water glows softly amidst ancient stone ruins.',
    icon: '💧',
    options: Object.freeze([
      Object.freeze({
        id: 'DRINK',
        labelKey: 'rogue.events.healingSpring.drink',
        defaultLabel: 'Drink from the spring (+25 HP)',
        effects: Object.freeze([{ type: EVENT_EFFECT_TYPES.HEAL, value: 25 }]),
      }),
      Object.freeze({
        id: 'LEAVE',
        labelKey: 'rogue.events.leave',
        defaultLabel: 'Leave without drinking',
        effects: Object.freeze([{ type: EVENT_EFFECT_TYPES.NONE }]),
      }),
    ]),
  }),

  [EVENT_IDS.FORGOTTEN_SHRINE]: Object.freeze({
    id: EVENT_IDS.FORGOTTEN_SHRINE,
    nameKey: 'rogue.events.forgottenShrine.name',
    descriptionKey: 'rogue.events.forgottenShrine.desc',
    defaultName: 'Forgotten Shrine',
    defaultDesc: 'A moss-covered altar dedicated to ancient wordcraft offers quiet sanctuary.',
    icon: '⛩️',
    options: Object.freeze([
      Object.freeze({
        id: 'CLEANSE',
        labelKey: 'rogue.events.forgottenShrine.cleanse',
        defaultLabel: 'Offer prayer at altar (Cleanse 1 Curse level)',
        requiresCurse: true,
        effects: Object.freeze([{ type: EVENT_EFFECT_TYPES.PURIFY_HIGHEST_CURSE, value: 1 }]),
      }),
      Object.freeze({
        id: 'REST',
        labelKey: 'rogue.events.forgottenShrine.rest',
        defaultLabel: 'Rest in the courtyard (+10 HP)',
        effects: Object.freeze([{ type: EVENT_EFFECT_TYPES.HEAL, value: 10 }]),
      }),
    ]),
  }),

  [EVENT_IDS.CURSED_ARCHIVE]: Object.freeze({
    id: EVENT_IDS.CURSED_ARCHIVE,
    nameKey: 'rogue.events.cursedArchive.name',
    descriptionKey: 'rogue.events.cursedArchive.desc',
    defaultName: 'Cursed Archive',
    defaultDesc: 'Rows of forbidden grimoires whisper secrets that burn the reader’s soul.',
    icon: '📜',
    options: Object.freeze([
      Object.freeze({
        id: 'STUDY',
        labelKey: 'rogue.events.cursedArchive.study',
        defaultLabel: 'Study forbidden pages (-10 HP, Cleanse 1 Curse level)',
        requiresCurse: true,
        minHpToPayCost: 10, // requires currentHp > 10
        effects: Object.freeze([
          Object.freeze({ type: EVENT_EFFECT_TYPES.HP_COST, value: 10 }),
          Object.freeze({ type: EVENT_EFFECT_TYPES.PURIFY_HIGHEST_CURSE, value: 1 }),
        ]),
      }),
      Object.freeze({
        id: 'LEAVE',
        labelKey: 'rogue.events.leave',
        defaultLabel: 'Back away cautiously',
        effects: Object.freeze([{ type: EVENT_EFFECT_TYPES.NONE }]),
      }),
    ]),
  }),
});

/**
 * Returns event definition for the given ID or null if unknown.
 *
 * @param {string} eventId
 * @returns {object|null}
 */
export function getEvent(eventId) {
  if (!eventId || typeof eventId !== 'string') return null;
  return EVENT_REGISTRY[eventId] || null;
}

/**
 * Returns all registered events in canonical order.
 *
 * @returns {Array<object>}
 */
export function getAllEvents() {
  return [
    EVENT_REGISTRY[EVENT_IDS.HEALING_SPRING],
    EVENT_REGISTRY[EVENT_IDS.FORGOTTEN_SHRINE],
    EVENT_REGISTRY[EVENT_IDS.CURSED_ARCHIVE],
  ];
}

/**
 * Deterministically selects an event for a node using seed + nodeId.
 *
 * @param {object} params
 * @param {string|number} params.seed
 * @param {string} params.nodeId
 * @returns {object} Event definition clone
 */
export function selectEventForNode({ seed, nodeId }) {
  const safeSeed = seed !== undefined && seed !== null ? seed : 'default_seed';
  const safeNodeId = String(nodeId || 'event_node');

  const prng = createPrng(`${safeSeed}_event_${safeNodeId}`);
  const pool = getAllEvents();
  const index = Math.floor(prng.next() * pool.length);

  return { ...pool[index] };
}

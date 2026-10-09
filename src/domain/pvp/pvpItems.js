export const ITEM_TYPES = {
  HEAL: 'HEAL',
  SHIELD: 'SHIELD',
  POWER: 'POWER'
};

export const PVP_ITEMS = {
  [ITEM_TYPES.HEAL]: {
    id: ITEM_TYPES.HEAL,
    startingCount: 2,
    healAmount: 25
  },
  [ITEM_TYPES.SHIELD]: {
    id: ITEM_TYPES.SHIELD,
    startingCount: 1,
    blockAmount: 20
  },
  [ITEM_TYPES.POWER]: {
    id: ITEM_TYPES.POWER,
    startingCount: 1,
    bonusDamage: 10
  }
};

export function getInitialItemsState() {
  return {
    [ITEM_TYPES.HEAL]: { remaining: PVP_ITEMS[ITEM_TYPES.HEAL].startingCount },
    [ITEM_TYPES.SHIELD]: { remaining: PVP_ITEMS[ITEM_TYPES.SHIELD].startingCount },
    [ITEM_TYPES.POWER]: { remaining: PVP_ITEMS[ITEM_TYPES.POWER].startingCount }
  };
}

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

export function getInitialItemsState(loadout) {
  const healCount = (loadout && typeof loadout[ITEM_TYPES.HEAL] === 'number')
    ? loadout[ITEM_TYPES.HEAL]
    : PVP_ITEMS[ITEM_TYPES.HEAL].startingCount;
  const shieldCount = (loadout && typeof loadout[ITEM_TYPES.SHIELD] === 'number')
    ? loadout[ITEM_TYPES.SHIELD]
    : PVP_ITEMS[ITEM_TYPES.SHIELD].startingCount;
  const powerCount = (loadout && typeof loadout[ITEM_TYPES.POWER] === 'number')
    ? loadout[ITEM_TYPES.POWER]
    : PVP_ITEMS[ITEM_TYPES.POWER].startingCount;

  return {
    [ITEM_TYPES.HEAL]: { remaining: healCount },
    [ITEM_TYPES.SHIELD]: { remaining: shieldCount },
    [ITEM_TYPES.POWER]: { remaining: powerCount }
  };
}

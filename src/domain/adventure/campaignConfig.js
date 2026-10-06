export const STAGE_TYPES = {
  NORMAL: 'NORMAL',
  ELITE: 'ELITE',
  BOSS: 'BOSS',
};

// Return a complete list of all 30 stages in order.
export function getCampaignStages() {
  const stages = [];
  for (let world = 1; world <= 6; world++) {
    for (let s = 1; s <= 5; s++) {
      let type = STAGE_TYPES.NORMAL;
      let title = `Stage ${s}`;
      let id = `L${world}-S${s}`;

      if (s === 4) {
        type = STAGE_TYPES.ELITE;
        title = 'Elite Gatekeeper';
        id = `L${world}-E1`;
      } else if (s === 5) {
        type = STAGE_TYPES.BOSS;
        title = 'Boss';
        id = `L${world}-BOSS`;
      }

      stages.push({
        id,
        world,
        stageNumber: s,
        type,
        title,
        vocabularyLevel: world,
        ...getBattleConfigForType(type)
      });
    }
  }
  return stages;
}

function getBattleConfigForType(type) {
  switch (type) {
    case STAGE_TYPES.NORMAL:
      return {
        playerHp: 100,
        enemyHp: 80,
        damagePerCorrect: 20,
        damagePerWrong: 20,
        damagePerTimeout: 20,
        timePerQuestionMs: 10000,
        baseScore: 100
      };
    case STAGE_TYPES.ELITE:
      return {
        playerHp: 100,
        enemyHp: 100,
        damagePerCorrect: 20,
        damagePerWrong: 20,
        damagePerTimeout: 20,
        timePerQuestionMs: 9000,
        baseScore: 120
      };
    case STAGE_TYPES.BOSS:
      return {
        playerHp: 100,
        enemyHp: 120,
        damagePerCorrect: 20,
        damagePerWrong: 20,
        damagePerTimeout: 20,
        timePerQuestionMs: 9000,
        baseScore: 150
      };
    default:
      throw new Error(`Unknown stage type: ${type}`);
  }
}

export function getStageById(stageId) {
  return getCampaignStages().find(s => s.id === stageId);
}

export function getWorlds() {
  return [1, 2, 3, 4, 5, 6];
}

export function getStagesForWorld(world) {
  return getCampaignStages().filter(s => s.world === world);
}

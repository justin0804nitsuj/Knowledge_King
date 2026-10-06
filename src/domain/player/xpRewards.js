import { STAGE_TYPES } from '../adventure/campaignConfig';

export const XP_REWARDS = {
  CORRECT_ANSWER: 10,
  REVIEW_CORRECT: 5,
  PERFECT_VICTORY: 15,
  VICTORY: {
    [STAGE_TYPES.NORMAL]: 20,
    [STAGE_TYPES.ELITE]: 35,
    [STAGE_TYPES.BOSS]: 50,
  },
  FIRST_CLEAR: {
    [STAGE_TYPES.NORMAL]: 20,
    [STAGE_TYPES.ELITE]: 30,
    [STAGE_TYPES.BOSS]: 50,
  }
};

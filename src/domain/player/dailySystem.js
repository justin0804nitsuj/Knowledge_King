/**
 * Returns a stable local YYYY-MM-DD date key.
 */
export function getLocalDailyKey() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const DAILY_MISSIONS = {
  MISSION_1: {
    id: 'm1',
    description: 'Answer 20 questions',
    target: 20,
    xpReward: 30
  },
  MISSION_2: {
    id: 'm2',
    description: 'Win 2 Adventure battles',
    target: 2,
    xpReward: 40
  },
  MISSION_3: {
    id: 'm3',
    description: 'Earn one Perfect Victory',
    target: 1,
    xpReward: 50
  }
};

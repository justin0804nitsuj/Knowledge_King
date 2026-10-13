import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocalDailyKey } from '../domain/player/dailySystem';

const STORAGE_KEY = '@KnowledgeKing:playerProgress';
const CURRENT_SCHEMA_VERSION = 1;

export async function loadPlayerProgress() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultPlayerProgress();
    
    let data = JSON.parse(raw);
    
    if (data.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      // Fallback for missing/old schema
      return createDefaultPlayerProgress();
    }
    
    // Check if day rolled over
    const today = getLocalDailyKey();
    if (data.daily.lastActiveDate !== today) {
      data = processDayRollover(data, today);
    }
    
    return data;
  } catch (err) {
    console.warn('Failed to load player progress, falling back.', err);
    return createDefaultPlayerProgress();
  }
}

export async function savePlayerProgress(progress) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch (err) {
    console.error('Failed to save player progress', err);
    throw err;
  }
}

export function createDefaultPlayerProgress() {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    totalXp: 0,
    processedEvents: [], // Bounded to 500 max
    stats: {
      battlesPlayed: 0,
      battlesWon: 0,
      battlesLost: 0,
      totalQuestions: 0,
      totalCorrect: 0,
      totalWrong: 0,
      totalTimeouts: 0,
      bestCombo: 0,
      perfectVictories: 0,
      normalWins: 0,
      eliteWins: 0,
      bossWins: 0,
      totalXpEarned: 0,
    },
    daily: {
      lastActiveDate: getLocalDailyKey(),
      streak: 0,
      streakLastIncrementedDate: null,
      missions: {
        m1: { progress: 0, claimed: false }, // Answer 20 questions
        m2: { progress: 0, claimed: false }, // Win 2 battles
        m3: { progress: 0, claimed: false }, // 1 Perfect Victory
      }
    }
  };
}

function processDayRollover(data, today) {
  const lastDateStr = data.daily.streakLastIncrementedDate;
  if (lastDateStr) {
    const lastDate = new Date(lastDateStr);
    const currDate = new Date(today);
    lastDate.setHours(0,0,0,0);
    currDate.setHours(0,0,0,0);
    
    const diffDays = Math.round((currDate - lastDate) / (1000 * 60 * 60 * 24));
    if (diffDays > 1) {
      data.daily.streak = 0;
    }
  }

  // Reset missions
  data.daily.lastActiveDate = today;
  data.daily.missions = {
    m1: { progress: 0, claimed: false },
    m2: { progress: 0, claimed: false },
    m3: { progress: 0, claimed: false },
  };

  return data;
}

export function recordDailyActivity(progress) {
  const today = getLocalDailyKey();
  if (progress.daily.lastActiveDate !== today) {
    progress = processDayRollover(progress, today);
  }
  
  if (progress.daily.streakLastIncrementedDate !== today) {
    progress.daily.streak += 1;
    progress.daily.streakLastIncrementedDate = today;
  }
  
  return progress;
}

export function hasProcessedEvent(progress, eventId) {
  return progress.processedEvents && progress.processedEvents.includes(eventId);
}

export function recordProcessedEvent(progress, eventId) {
  if (!progress.processedEvents) progress.processedEvents = [];
  progress.processedEvents.push(eventId);
  if (progress.processedEvents.length > 500) {
    progress.processedEvents.shift();
  }
  return progress;
}

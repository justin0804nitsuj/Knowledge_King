import AsyncStorage from '@react-native-async-storage/async-storage';
import { getActiveScopedKey, getScopedKey } from './storageIdentity';

const CURRENT_SCHEMA_VERSION = 1;

async function resolveKey(explicitIdentity) {
  if (explicitIdentity) {
    return getScopedKey('mistakes', explicitIdentity);
  }
  return getActiveScopedKey('mistakes');
}

export async function loadMistakes(explicitIdentity) {
  try {
    const key = await resolveKey(explicitIdentity);
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return createDefaultMistakes();
    
    const data = JSON.parse(raw);
    if (data.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      return createDefaultMistakes();
    }
    
    return data;
  } catch (err) {
    console.warn('Failed to load mistakes, falling back.', err);
    return createDefaultMistakes();
  }
}

export async function saveMistakes(mistakes, explicitIdentity) {
  try {
    const key = await resolveKey(explicitIdentity);
    await AsyncStorage.setItem(key, JSON.stringify(mistakes));
  } catch (err) {
    console.error('Failed to save mistakes', err);
    throw err;
  }
}

export function createDefaultMistakes() {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    processedEvents: [],
    records: {} 
    // wordId -> { wrongCount, timeoutCount, correctReviewCount, lastMistakeAt, isRecovered, level }
  };
}

export async function recordMistakesFromBattle(mistakes, correctIds, wrongIds, timeoutIds, level) {
  const now = Date.now();
  
  // Record mistakes
  const processMistake = (id, isTimeout) => {
    if (!mistakes.records[id]) {
      mistakes.records[id] = {
        wrongCount: 0,
        timeoutCount: 0,
        correctReviewCount: 0,
        lastMistakeAt: now,
        isRecovered: false,
        level: level
      };
    }
    
    if (isTimeout) mistakes.records[id].timeoutCount += 1;
    else mistakes.records[id].wrongCount += 1;
    
    mistakes.records[id].lastMistakeAt = now;
    mistakes.records[id].isRecovered = false; // new mistake makes it active again
  };

  for (const id of wrongIds) processMistake(id, false);
  for (const id of timeoutIds) processMistake(id, true);

  return mistakes;
}

export async function processReviewResult(mistakes, id, isCorrect) {
  const record = mistakes.records[id];
  if (!record) return mistakes;
  
  if (isCorrect) {
    record.correctReviewCount += 1;
    if (record.correctReviewCount >= 2) {
      record.isRecovered = true;
    }
  } else {
    record.wrongCount += 1;
    record.lastMistakeAt = Date.now();
    record.isRecovered = false;
  }
  
  return mistakes;
}

export function getActiveMistakes(mistakes) {
  return Object.keys(mistakes.records)
    .filter(id => !mistakes.records[id].isRecovered)
    .map(id => ({ id, ...mistakes.records[id] }));
}

export function hasProcessedMistakeEvent(mistakes, eventId) {
  return mistakes.processedEvents && mistakes.processedEvents.includes(eventId);
}

export function recordProcessedMistakeEvent(mistakes, eventId) {
  if (!mistakes.processedEvents) mistakes.processedEvents = [];
  mistakes.processedEvents.push(eventId);
  if (mistakes.processedEvents.length > 500) {
    mistakes.processedEvents.shift();
  }
  return mistakes;
}

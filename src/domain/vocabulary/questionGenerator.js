import { getDisplayMeaning, getSemanticFingerprint, getAllSemanticFingerprints } from './meaningResolver.js';
import { shuffleArray } from '../game/seededRandom.js';

/**
 * Generates a single question with 1 target and 3 distractors.
 * 
 * @param {Object} targetWord - The correct word object.
 * @param {Array} levelWords - The full array of words for the current level.
 * @param {Function} rng - A function returning a float [0,1), created by createSeededRandom.
 * @returns {Object|null} The question object, or null if generation fails.
 */
export function generateQuestion(targetWord, levelWords, rng) {
  const targetMeaning = getDisplayMeaning(targetWord);
  if (!targetMeaning) return null;

  const targetFingerprints = getAllSemanticFingerprints(targetWord);
  
  const choices = [{
    id: targetWord.id,
    isCorrect: true,
    text: targetMeaning
  }];

  const usedFingerprints = new Set(targetFingerprints);
  const usedLexical = new Set([targetWord.word.toLowerCase()]);

  // Create shuffled candidate list to ensure deterministic but varied selection
  // To avoid mutating the original array, we copy it.
  const candidates = [...levelWords];
  shuffleArray(candidates, rng);

  // Helper to add distractor
  const addDistractor = (w) => {
    if (choices.length >= 4) return false;
    if (usedLexical.has(w.word.toLowerCase())) return false;
    
    const meaning = getDisplayMeaning(w);
    if (!meaning) return false;
    
    const wFingerprints = getAllSemanticFingerprints(w);
    
    // If ANY fingerprint overlaps with what we've used, reject it
    for (const fp of wFingerprints) {
      if (usedFingerprints.has(fp)) return false;
    }

    choices.push({
      id: w.id,
      isCorrect: false,
      text: meaning
    });
    
    // Add all its fingerprints to used set
    for (const fp of wFingerprints) {
      usedFingerprints.add(fp);
    }
    
    usedLexical.add(w.word.toLowerCase());

    return choices.length === 4;
  };

  // Pass 1: Same Part of Speech
  for (const w of candidates) {
    if (w.partOfSpeech === targetWord.partOfSpeech) {
      if (addDistractor(w)) break;
    }
  }

  // Pass 2: Any Part of Speech (fallback)
  if (choices.length < 4) {
    for (const w of candidates) {
      if (addDistractor(w)) break;
    }
  }

  if (choices.length < 4) {
    // Failed to find enough distractors safely
    return null;
  }

  // Shuffle final choices
  shuffleArray(choices, rng);

  return {
    questionId: `q_${targetWord.id}_${Math.floor(rng() * 1000000)}`,
    targetId: targetWord.id,
    word: targetWord.word,
    partOfSpeech: targetWord.partOfSpeech,
    level: targetWord.level,
    choices: choices,
    correctChoiceId: targetWord.id,
  };
}

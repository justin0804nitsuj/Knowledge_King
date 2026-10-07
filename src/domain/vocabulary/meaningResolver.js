/**
 * Normalizes a Chinese meaning for semantic collision filtering.
 * Removes spaces, common punctuation, to prevent ambiguous choices.
 */
export function getSemanticFingerprint(meaning) {
  if (!meaning) return '';
  return meaning.replace(/[，、；;。.\s()（）]/g, '').trim();
}

/**
 * Extracts a normalized set of ALL useful learner meanings for a word.
 * This prevents distractors that overlap strongly with the target.
 */
export function getAllSemanticFingerprints(wordObject) {
  const fps = new Set();
  if (!wordObject) return fps;

  if (wordObject.primaryDefinitions && wordObject.primaryDefinitions.length > 0) {
    for (const def of wordObject.primaryDefinitions) {
      if (def.meaningZhTW) {
        fps.add(getSemanticFingerprint(def.meaningZhTW));
      }
    }
  }

  if (wordObject.fallbackMeaning) {
    fps.add(getSemanticFingerprint(wordObject.fallbackMeaning));
  }

  // Also include secondary definitions if they exist (optional, but requested for comprehensive collision)
  if (wordObject.secondaryDefinitions && wordObject.secondaryDefinitions.length > 0) {
    for (const def of wordObject.secondaryDefinitions) {
      if (def.meaningZhTW) {
        fps.add(getSemanticFingerprint(def.meaningZhTW));
      }
    }
  }
  return fps;
}

/**
 * Determines the best Chinese display meaning for a word.
 * Priority:
 * 1. explicit learner-priority (if available)
 * 2. curated fallbackMeaning (school-list meaning)
 * 3. resolved primary learner definition matching POS
 * 4. safe fallback (first valid primary)
 */
export function getDisplayMeaning(wordObject) {
  if (!wordObject) return '';

  if (wordObject.preferredMeaning) return wordObject.preferredMeaning;

  if (wordObject.fallbackMeaning) {
    return wordObject.fallbackMeaning;
  }

  if (wordObject.primaryDefinitions && wordObject.primaryDefinitions.length > 0) {
    if (wordObject.partOfSpeech) {
      const posMatch = wordObject.primaryDefinitions.find(d => 
        d.partOfSpeech && d.partOfSpeech.includes(wordObject.partOfSpeech)
      );
      if (posMatch && posMatch.meaningZhTW) return posMatch.meaningZhTW;
    }
    
    for (const def of wordObject.primaryDefinitions) {
      if (def.meaningZhTW) return def.meaningZhTW;
    }
  }

  return '';
}

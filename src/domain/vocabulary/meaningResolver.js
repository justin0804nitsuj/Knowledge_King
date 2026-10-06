/**
 * Normalizes a Chinese meaning for semantic collision filtering.
 * Removes spaces, common punctuation, to prevent ambiguous choices.
 */
export function getSemanticFingerprint(meaning) {
  if (!meaning) return '';
  // Remove punctuation and whitespaces
  return meaning.replace(/[，、；;。.\s()（）]/g, '').trim();
}

/**
 * Determines the best Chinese display meaning for a word.
 * 1. Prefers the first valid primary definition.
 * 2. Falls back to fallbackMeaning.
 */
export function getDisplayMeaning(wordObject) {
  if (!wordObject) return '';

  if (wordObject.primaryDefinitions && wordObject.primaryDefinitions.length > 0) {
    for (const def of wordObject.primaryDefinitions) {
      if (def.meaningZhTW) {
        return def.meaningZhTW;
      }
    }
  }

  // Fallback
  return wordObject.fallbackMeaning || '';
}

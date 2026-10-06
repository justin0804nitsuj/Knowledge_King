import { getWordsByLevel } from '../src/domain/vocabulary/vocabularyRepository';
import { generateQuestion } from '../src/domain/vocabulary/questionGenerator';
import { createSeededRandom } from '../src/domain/game/seededRandom';

describe('Question Quality Sanity Audit', () => {
  it('audits question generation across all levels', () => {
    const levels = [1, 2, 3, 4, 5, 6];
    const questionsPerLevel = 500;
    let totalGenerated = 0;
    
    console.log('--- Question Quality Sanity Audit ---');
    
    for (const level of levels) {
      const words = getWordsByLevel(level);
      const rng = createSeededRandom(12345 + level);
      
      let genFailures = 0;
      let dupChoices = 0;
      let collisionFailures = 0;
      
      for (let i = 0; i < questionsPerLevel; i++) {
        const targetWord = words[Math.floor(rng() * words.length)];
        try {
          const q = generateQuestion(targetWord, words, rng);
          if (!q || q.choices.length !== 4) {
            genFailures++;
          } else {
            const choiceSet = new Set(q.choices.map(c => c.text));
            if (choiceSet.size !== 4) {
              dupChoices++;
            }
          }
        } catch (err) {
          genFailures++;
          if (err.message.includes('semantic collision')) {
             collisionFailures++;
          }
        }
      }
      
      console.log(`Level ${level}:`);
      console.log(`  Sample size: ${questionsPerLevel}`);
      console.log(`  Generation failures: ${genFailures}`);
      console.log(`  Duplicate choice failures: ${dupChoices}`);
      
      totalGenerated += questionsPerLevel;
      
      // We expect 0 failures
      expect(genFailures).toBe(0);
      expect(dupChoices).toBe(0);
    }
    console.log('-----------------------------------');
  });
});

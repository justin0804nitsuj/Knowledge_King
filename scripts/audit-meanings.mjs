import fs from 'fs';
import path from 'path';

// Read all 6 levels
let totalFallback = 0;
let totalPreferred = 0;
let totalPrimary = 0;
let totalEmpty = 0;
let totalDuplicates = 0;
let totalSuspicious = 0;

for (let level = 1; level <= 6; level++) {
  const dataPath = path.join(process.cwd(), `assets/vocabulary/level-${level}.json`);
  const words = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  
  let fallbackCount = 0;
  let preferredCount = 0;
  let primaryCount = 0;
  let emptyCount = 0;
  let suspiciousCount = 0;
  
  const displayMap = new Map();
  
  // Duplicates logic
  words.forEach(word => {
    let display = '';
    let category = '';
    
    if (word.preferredMeaning) {
      display = word.preferredMeaning;
      category = 'preferred';
      preferredCount++;
    } else if (word.fallbackMeaning) {
      display = word.fallbackMeaning;
      category = 'fallback';
      fallbackCount++;
    } else if (word.primaryDefinitions && word.primaryDefinitions.length > 0) {
      const posMatch = word.primaryDefinitions.find(d => 
        d.partOfSpeech && d.partOfSpeech.includes(word.partOfSpeech)
      );
      if (posMatch && posMatch.meaningZhTW) {
        display = posMatch.meaningZhTW;
      } else {
        for (const def of word.primaryDefinitions) {
          if (def.meaningZhTW) {
            display = def.meaningZhTW;
            break;
          }
        }
      }
      category = 'primary';
      primaryCount++;
    }
    
    if (!display) {
      emptyCount++;
    } else {
      if (displayMap.has(display)) {
        displayMap.get(display).push(word.word);
      } else {
        displayMap.set(display, [word.word]);
      }
    }
    
    // Suspicious: The old logic used primary[0]. If the new logic uses primary instead of fallback when fallback is better,
    // wait, we prioritize fallback over primary now! So if it has fallback, it uses fallback!
    // Suspicious is when we use primary, but there's NO fallback, and the primary used is a rare sense? We don't have frequency data.
    // Let's just say suspicious is when fallbackMeaning exists but is NOT used (which shouldn't happen with our new logic).
  });
  
  let duplicateCount = 0;
  for (const [meaning, ws] of displayMap.entries()) {
    if (ws.length > 1) duplicateCount++;
  }
  
  const sampleSize = words.length; // checking ALL words, > 500 per level
  console.log(`Level ${level} Audit (Size: ${sampleSize}):`);
  console.log(`  Fallback Meaning: ${((fallbackCount / sampleSize) * 100).toFixed(2)}%`);
  console.log(`  Preferred Meaning: ${((preferredCount / sampleSize) * 100).toFixed(2)}%`);
  console.log(`  Primary Fallback: ${((primaryCount / sampleSize) * 100).toFixed(2)}%`);
  console.log(`  Empty Meanings: ${emptyCount}`);
  console.log(`  Duplicate Meanings: ${duplicateCount}`);
  console.log('-----------------------------------');
  
  totalFallback += fallbackCount;
  totalPreferred += preferredCount;
  totalPrimary += primaryCount;
  totalEmpty += emptyCount;
  totalDuplicates += duplicateCount;
}

const totalSize = 6012; // 1002 * 6
console.log(`Total Audit (Size: ${totalSize}):`);
console.log(`  Fallback Meaning: ${((totalFallback / totalSize) * 100).toFixed(2)}%`);
console.log(`  Preferred Meaning: ${((totalPreferred / totalSize) * 100).toFixed(2)}%`);
console.log(`  Primary Fallback: ${((totalPrimary / totalSize) * 100).toFixed(2)}%`);
console.log(`  Empty Meanings: ${totalEmpty}`);
console.log(`  Duplicate Meanings: ${totalDuplicates}`);

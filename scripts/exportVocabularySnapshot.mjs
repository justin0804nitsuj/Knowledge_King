import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import directly from the egg repository (BUILD-TIME ONLY)
import { WORDS } from 'file:///C:/Users/justi/.gemini/antigravity-ide/brain/6b2f30fc-a7fb-4397-8248-32a1bc01c21d/scratch/egg/src/data/words.js';
import { getWordDefinitions } from 'file:///C:/Users/justi/.gemini/antigravity-ide/brain/6b2f30fc-a7fb-4397-8248-32a1bc01c21d/scratch/egg/src/data/wordDefinitions.js';

const overridesPath = path.join(__dirname, 'vocabularyDisplayOverrides.json');
const overrides = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));

const outputDir = path.join(__dirname, '../assets/vocabulary');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const levels = {};
let totalWords = 0;
let totalDefinitions = 0;
let multiDefinitionWords = 0;
let missingFallback = 0;

for (const w of WORDS) {
  const lvl = w.level;
  if (lvl == null) continue;
  if (lvl < 1 || lvl > 6) {
    console.error(`Invalid level ${lvl} for word ${w.word}`);
    continue;
  }

  if (!w.meaning) {
    missingFallback++;
  }

  const defs = getWordDefinitions(w.id);
  
  const mapDef = (d) => ({
    senseKey: d.primarySenseId,
    partOfSpeech: d.partOfSpeechLabel,
    meaningZhTW: d.meaningZhTW
  });

  const primary = (defs?.primaryDefinitions || []).map(mapDef).filter(d => d.meaningZhTW);
  const secondary = (defs?.secondaryDefinitions || []).map(mapDef).filter(d => d.meaningZhTW);
  
  const defCount = primary.length + secondary.length;
  totalDefinitions += defCount;
  if (defCount > 1) multiDefinitionWords++;

  if (!levels[lvl]) levels[lvl] = [];
  
  const overrideMeaning = overrides[w.id];

  levels[lvl].push({
    id: w.id,
    word: w.word,
    partOfSpeech: w.partOfSpeech,
    level: Number(lvl),
    fallbackMeaning: overrideMeaning || w.meaning || "",
    preferredMeaning: overrideMeaning || undefined,
    primaryDefinitions: primary,
    secondaryDefinitions: secondary
  });
  
  totalWords++;
}

// Validation Step
let isValid = true;
if (totalWords !== 6012) {
  console.error(`Validation Failed: Expected 6012 words, got ${totalWords}`);
  isValid = false;
}
if (missingFallback > 0) {
  console.error(`Validation Failed: ${missingFallback} words missing fallback meaning`);
  isValid = false;
}

const manifest = {
  schemaVersion: "1.0",
  vocabularyVersion: "1.0.0",
  totalWords,
  totalDefinitions,
  multiDefinitionWordCount: multiDefinitionWords,
  sourceRepository: "https://github.com/justin0804nitsuj/egg",
  levels: {}
};

for (const [level, words] of Object.entries(levels)) {
  if (words.length !== 1002) {
    console.error(`Validation Failed: Level ${level} expected 1002 words, got ${words.length}`);
    isValid = false;
  }
  
  // check unique IDs
  const ids = new Set();
  for (const w of words) {
    if (ids.has(w.id)) {
      console.error(`Duplicate ID found: ${w.id}`);
      isValid = false;
    }
    ids.add(w.id);
  }
  
  const fileName = `level-${level}.json`;
  const fileContent = JSON.stringify(words, null, 2);
  const hash = crypto.createHash('sha256').update(fileContent).digest('hex').substring(0, 8);
  
  fs.writeFileSync(path.join(outputDir, fileName), fileContent, 'utf8');
  manifest.levels[level] = { file: fileName, wordCount: words.length, hash };
}

fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

if (isValid) {
  console.log(`Snapshot exported successfully.`);
  console.log(`Total Words: ${totalWords}`);
  console.log(`Total Definitions: ${totalDefinitions}`);
  console.log(`Words with Multiple Definitions: ${multiDefinitionWords}`);
} else {
  console.error('Snapshot exported with validation errors.');
  process.exit(1);
}

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

  if (overrideMeaning && w.meaning) {
    const safeReplacements = {
      "餅幹": "餅乾", "網絡": "網路", "出租車": "計程車", "服務器": "伺服器", "王後": "王后", "皇後": "皇后",
      "打印機": "印表機", "鼠標": "滑鼠", "內存": "記憶體", "公交車": "公車", "U盤": "隨身碟",
      "面包": "麵包", "幹淨": "乾淨", "幹的": "乾的", "頭發": "頭髮", "重復": "重複", "理發": "理髮",
      "小面包": "小麵包", "幹衣": "乾衣", "面條": "麵條", "面團": "麵團", "關系": "關係", "答復": "答覆",
      "面粉": "麵粉", "美發": "美髮", "幹草": "乾草", "一條面包": "一條麵包", "品脫(幹量": "品脫(乾量",
      "放松": "放鬆", "寬松": "寬鬆", "意大利面": "義大利麵", "弄復雜": "弄複雜", "松緊": "鬆緊",
      "葡萄幹": "葡萄乾", "松弛": "鬆弛", "復雜": "複雜", "生面團": "生麵團", "幹旱": "乾旱",
      "復數": "複數", "來復槍": "來福槍", "假發": "假髮", "幹辣椒": "乾辣椒", "無性系": "複製 / 無性繁殖"
    };

    let isSafeNormalization = false;
    let testMeaning = w.meaning;
    for (const [bad, good] of Object.entries(safeReplacements)) {
      if (testMeaning.includes(bad)) {
        testMeaning = testMeaning.split(bad).join(good);
      }
    }
    
    if (testMeaning === overrideMeaning) {
      isSafeNormalization = true;
    }

    if (isSafeNormalization) {
      const normalize = (defs) => {
        defs.forEach(d => {
          if (d.meaningZhTW === w.meaning) {
            d.meaningZhTW = overrideMeaning;
          }
        });
      };
      normalize(primary);
      normalize(secondary);
    }
  }

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

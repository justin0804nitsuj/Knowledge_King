import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const inputDir = path.join(__dirname, '../assets/vocabulary');
const reportDir = path.join(__dirname, '../reports');

if (!fs.existsSync(reportDir)) {
  fs.mkdirSync(reportDir, { recursive: true });
}

let totalWordsScanned = 0;
let highConfidence = [];
let mediumConfidence = [];
let humanReview = [];

const SIMPLIFIED_OR_REGIONAL = [
  { bad: '軟件', good: '軟體', type: 'REGIONAL_TERM' },
  { bad: '硬件', good: '硬體', type: 'REGIONAL_TERM' },
  { bad: '網絡', good: '網路', type: 'REGIONAL_TERM' },
  { bad: '打印機', good: '印表機', type: 'REGIONAL_TERM' },
  { bad: '鼠標', good: '滑鼠', type: 'REGIONAL_TERM' },
  { bad: '服務器', good: '伺服器', type: 'REGIONAL_TERM' },
  { bad: '內存', good: '記憶體', type: 'REGIONAL_TERM' },
  { bad: '公交車', good: '公車', type: 'REGIONAL_TERM' },
  { bad: '出租車', good: '計程車', type: 'REGIONAL_TERM' },
  { bad: 'U盤', good: '隨身碟', type: 'REGIONAL_TERM' },
  { bad: '餅幹', good: '餅乾', type: 'WRONG_CHARACTER' },
  { bad: '王後', good: '王后', type: 'WRONG_CHARACTER' },
  { bad: '皇後', good: '皇后', type: 'WRONG_CHARACTER' },
];

const SUSPICIOUS_CHARS = ['后', '發', '里', '只', '松', '征', '復', '系', '余', '面', '幹', '乾'];
const SUSPICIOUS_WORDS = ['視頻', '信息', 'hide'];

for (let i = 1; i <= 6; i++) {
  const filePath = path.join(inputDir, `level-${i}.json`);
  if (!fs.existsSync(filePath)) continue;
  
  const words = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  for (const w of words) {
    totalWordsScanned++;
    const meaning = w.fallbackMeaning || w.preferredMeaning || '';
    
    let matchedHigh = false;

    // 1. High confidence replacements
    for (const rule of SIMPLIFIED_OR_REGIONAL) {
      if (meaning.includes(rule.bad)) {
        highConfidence.push({
          id: w.id,
          word: w.word,
          level: w.level,
          partOfSpeech: w.partOfSpeech,
          currentMeaning: meaning,
          problemType: rule.type,
          suggestedMeaning: meaning.replace(new RegExp(rule.bad, 'g'), rule.good),
          confidence: 'AUTO_FIX_HIGH_CONFIDENCE',
          sourceFile: `level-${i}.json`
        });
        matchedHigh = true;
      }
    }
    
    // Exact fixes for known regression issues
    if (w.word === 'hide' && meaning.includes('獸皮')) {
      highConfidence.push({
        id: w.id,
        word: w.word,
        level: w.level,
        partOfSpeech: w.partOfSpeech,
        currentMeaning: meaning,
        problemType: 'WRONG_PRIMARY_SENSE',
        suggestedMeaning: '躲藏 / 隱藏',
        confidence: 'AUTO_FIX_HIGH_CONFIDENCE',
        sourceFile: `level-${i}.json`
      });
      matchedHigh = true;
    }
    
    if (w.word === 'queen' && meaning.includes('王後')) {
      // already caught by 王後 rule above, but just in case
      if (!matchedHigh) {
        highConfidence.push({
          id: w.id,
          word: w.word,
          level: w.level,
          partOfSpeech: w.partOfSpeech,
          currentMeaning: meaning,
          problemType: 'WRONG_CHARACTER',
          suggestedMeaning: meaning.replace('王後', '王后'),
          confidence: 'AUTO_FIX_HIGH_CONFIDENCE',
          sourceFile: `level-${i}.json`
        });
        matchedHigh = true;
      }
    }

    if (w.word === 'cookie' && meaning.includes('餅幹')) {
      if (!matchedHigh) {
        highConfidence.push({
          id: w.id,
          word: w.word,
          level: w.level,
          partOfSpeech: w.partOfSpeech,
          currentMeaning: meaning,
          problemType: 'WRONG_CHARACTER',
          suggestedMeaning: meaning.replace('餅幹', '餅乾'),
          confidence: 'AUTO_FIX_HIGH_CONFIDENCE',
          sourceFile: `level-${i}.json`
        });
        matchedHigh = true;
      }
    }

    if (matchedHigh) continue;

    // 2. Medium/Human review checks
    let needsReview = false;
    let reason = [];
    
    for (const sc of SUSPICIOUS_CHARS) {
      if (meaning.includes(sc)) {
        needsReview = true;
        reason.push(`Contains suspicious char: ${sc}`);
      }
    }
    for (const sw of SUSPICIOUS_WORDS) {
      if (meaning.includes(sw) || w.word === sw) {
        needsReview = true;
        reason.push(`Contains suspicious word: ${sw}`);
      }
    }

    if (needsReview) {
      humanReview.push({
        id: w.id,
        word: w.word,
        level: w.level,
        partOfSpeech: w.partOfSpeech,
        currentMeaning: meaning,
        problemType: 'NEEDS_HUMAN_REVIEW',
        reason: reason.join(', '),
        confidence: 'HUMAN_REVIEW_REQUIRED',
        sourceFile: `level-${i}.json`
      });
    }
  }
}

const allFindings = [...highConfidence, ...mediumConfidence, ...humanReview];

fs.writeFileSync(path.join(reportDir, 'zhTW-quality-audit.json'), JSON.stringify(allFindings, null, 2), 'utf8');

// CSV export
let csv = 'id,word,level,partOfSpeech,currentMeaning,problemType,suggestedMeaning,confidence,sourceFile,reason\n';
for (const f of allFindings) {
  const row = [
    f.id,
    f.word,
    f.level,
    f.partOfSpeech,
    `"${(f.currentMeaning || '').replace(/"/g, '""')}"`,
    f.problemType,
    `"${(f.suggestedMeaning || '').replace(/"/g, '""')}"`,
    f.confidence,
    f.sourceFile,
    `"${(f.reason || '').replace(/"/g, '""')}"`
  ];
  csv += row.join(',') + '\n';
}
fs.writeFileSync(path.join(reportDir, 'zhTW-quality-audit.csv'), csv, 'utf8');

console.log(`Total words scanned: ${totalWordsScanned}`);
console.log(`High-confidence errors: ${highConfidence.length}`);
console.log(`Medium-confidence candidates: ${mediumConfidence.length}`);
console.log(`Human-review candidates: ${humanReview.length}`);

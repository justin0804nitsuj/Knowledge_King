import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const inputDir = path.join(__dirname, '../assets/vocabulary');
const overridesPath = path.join(__dirname, 'vocabularyDisplayOverrides.json');

const overrides = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));

const nounEndings = ['物', '人', '器', '品', '機', '家', '者'];
const adjEndings = ['的'];
const verbEndings = ['化'];

let newIssues = 0;

for (let i = 1; i <= 6; i++) {
  const filePath = path.join(inputDir, `level-${i}.json`);
  if (!fs.existsSync(filePath)) continue;
  
  const words = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  for (const w of words) {
    const meaning = w.fallbackMeaning || w.preferredMeaning || '';
    const pos = w.partOfSpeech;
    
    // Explicit known bad senses (from typical translation errors)
    if (w.word === 'minute' && meaning.includes('微小的')) {
      overrides[w.id] = '分鐘';
      console.log(`FIXED: ${w.word} -> 分鐘`);
      newIssues++;
    } else if (w.word === 'well' && meaning === '井') {
      overrides[w.id] = '很好地 / 井';
      console.log(`FIXED: ${w.word} -> 很好地 / 井`);
      newIssues++;
    } else if (w.word === 'novel' && meaning === '新奇的') {
      overrides[w.id] = '小說';
      console.log(`FIXED: ${w.word} -> 小說`);
      newIssues++;
    } else if (w.word === 'book' && meaning === '預訂') {
      overrides[w.id] = '書 / 預訂';
      console.log(`FIXED: ${w.word} -> 書 / 預訂`);
      newIssues++;
    } else if (w.word === 'spring' && meaning === '彈簧') {
      overrides[w.id] = '春天 / 泉水';
      console.log(`FIXED: ${w.word} -> 春天 / 泉水`);
      newIssues++;
    } else if (w.word === 'bank' && meaning === '堤') {
      overrides[w.id] = '銀行 / 堤岸';
      console.log(`FIXED: ${w.word} -> 銀行 / 堤岸`);
      newIssues++;
    } else if (w.word === 'match' && meaning === '火柴') {
      overrides[w.id] = '比賽 / 相配';
      console.log(`FIXED: ${w.word} -> 比賽 / 相配`);
      newIssues++;
    } else if (w.word === 'fine' && meaning === '罰款') {
      overrides[w.id] = '好的 / 罰款';
      console.log(`FIXED: ${w.word} -> 好的 / 罰款`);
      newIssues++;
    } else if (w.word === 'date' && meaning === '棗') {
      overrides[w.id] = '日期 / 約會';
      console.log(`FIXED: ${w.word} -> 日期 / 約會`);
      newIssues++;
    } else if (w.word === 'watch' && meaning === '手表') { // Wait, 手表 is also simplified (手錶).
      // let's fix watch to 看 / 手錶
      overrides[w.id] = '觀看 / 手錶';
      console.log(`FIXED: ${w.word} -> 觀看 / 手錶`);
      newIssues++;
    } else if (w.word === 'watch' && meaning === '手錶') {
      overrides[w.id] = '觀看 / 手錶';
      console.log(`FIXED: ${w.word} -> 觀看 / 手錶`);
      newIssues++;
    }
  }
}

fs.writeFileSync(overridesPath, JSON.stringify(overrides, null, 2), 'utf8');
console.log(`\nSemantic Review Pass 2 complete. Found ${newIssues} new semantic issues.`);

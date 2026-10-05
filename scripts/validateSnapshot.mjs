import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputDir = path.join(__dirname, '../assets/vocabulary');

const manifestPath = path.join(outputDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error("Manifest not found.");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

let totalWordsChecked = 0;
let errors = 0;

for (const [level, info] of Object.entries(manifest.levels)) {
  const fileData = JSON.parse(fs.readFileSync(path.join(outputDir, info.file), 'utf8'));
  
  if (fileData.length !== 1002) {
    console.error(`Level ${level} has ${fileData.length} words instead of 1002.`);
    errors++;
  }
  
  const ids = new Set();
  for (const w of fileData) {
    if (ids.has(w.id)) {
      console.error(`Duplicate ID found: ${w.id}`);
      errors++;
    }
    ids.add(w.id);
    
    if (!w.word || !w.partOfSpeech || !w.fallbackMeaning || typeof w.level !== 'number') {
      console.error(`Word ${w.id} missing required fields.`);
      errors++;
    }
    
    // Check definitions
    for (const d of [...w.primaryDefinitions, ...w.secondaryDefinitions]) {
      if (!d.meaningZhTW) {
        console.error(`Word ${w.id} sense ${d.senseKey} missing meaningZhTW.`);
        errors++;
      }
    }
    
    // Spot check: override for 'plane'
    if (w.word === 'plane' && w.level === 1) {
      const planeMathSense = [...w.primaryDefinitions, ...w.secondaryDefinitions].find(d => d.senseKey === 'plane%1:25:00::');
      if (!planeMathSense || planeMathSense.meaningZhTW !== '（數學）平面') {
        console.error(`Override check failed for plane. Found: ${planeMathSense?.meaningZhTW}`);
        errors++;
      }
    }
    
    totalWordsChecked++;
  }
}

if (totalWordsChecked !== 6012) {
  console.error(`Total words checked: ${totalWordsChecked} (expected 6012)`);
  errors++;
}

if (errors > 0) {
  console.error(`Validation FAILED with ${errors} errors.`);
  process.exit(1);
} else {
  console.log("Validation PASSED.");
}

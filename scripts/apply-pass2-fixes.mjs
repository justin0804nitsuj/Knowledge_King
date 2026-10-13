import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const overridesPath = path.join(__dirname, 'vocabularyDisplayOverrides.json');
const overrides = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));

// Apply the Pass 2 Semantic Fixes based on my manual review of the mismatches
const pass2Fixes = {
  "reject-1936": "拒絕",
  "elect-2200": "選舉",
  "spoil-2650": "破壞 / 溺愛",
  "converse-4363": "交談",
  "convert-4364": "轉換",
  "festival-309": "節日 / 慶典",
  "respondent-4158": "受訪者 / 被告",
  "Celsius-5085": "攝氏",
  "directive-5309": "指令 / 規定",
  "Fahrenheit-5421": "華氏"
};

for (const [id, fixedMeaning] of Object.entries(pass2Fixes)) {
  overrides[id] = fixedMeaning;
}

fs.writeFileSync(overridesPath, JSON.stringify(overrides, null, 2), 'utf8');
console.log('Applied pass 2 fixes to vocabularyDisplayOverrides.json');

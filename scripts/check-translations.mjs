import en from '../src/localization/locales/en.js';
import zhTW from '../src/localization/locales/zh-TW.js';

function getKeys(obj, prefix = '') {
  let keys = [];
  for (const key in obj) {
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      keys = keys.concat(getKeys(obj[key], prefix + key + '.'));
    } else {
      keys.push(prefix + key);
    }
  }
  return keys;
}

const enKeys = new Set(getKeys(en));
const zhTWKeys = new Set(getKeys(zhTW));

let missingInZhTw = [];
for (const key of enKeys) {
  if (!zhTWKeys.has(key)) {
    missingInZhTw.push(key);
  }
}

let missingInEn = [];
for (const key of zhTWKeys) {
  if (!enKeys.has(key)) {
    missingInEn.push(key);
  }
}

if (missingInZhTw.length === 0 && missingInEn.length === 0) {
  console.log('✅ Translation parity check passed. No missing keys.');
  process.exit(0);
} else {
  console.log('❌ Translation parity check failed.');
  if (missingInZhTw.length > 0) {
    console.log('\nMissing in zh-TW:');
    missingInZhTw.forEach(k => console.log(`  - ${k}`));
  }
  if (missingInEn.length > 0) {
    console.log('\nMissing in en:');
    missingInEn.forEach(k => console.log(`  - ${k}`));
  }
  process.exit(1);
}

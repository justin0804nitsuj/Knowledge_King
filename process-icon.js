const sharp = require('sharp');
const path = require('path');

async function processIcon() {
  const source = path.join(__dirname, 'assets', 'knowledge-king-icon.png');
  const iconDest = path.join(__dirname, 'assets', 'icon.png');
  const adaptiveDest = path.join(__dirname, 'assets', 'adaptive-icon.png');

  await sharp(source)
    .trim()
    .resize(1024, 1024, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .toFile(iconDest);
    
  console.log('Created icon.png');
  
  await sharp(source)
    .trim()
    .resize(600, 600, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } }) // Try to use transparent bg where possible
    .extend({
      top: 212,
      bottom: 212,
      left: 212,
      right: 212,
      background: { r: 255, g: 255, b: 255, alpha: 0 }
    })
    .toFile(adaptiveDest);

  console.log('Created adaptive-icon.png');
}

processIcon().catch(console.error);

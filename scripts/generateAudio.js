const fs = require('fs');
const path = require('path');

function createWav(durationMs, frequency) {
  const sampleRate = 44100;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const numSamples = Math.floor(sampleRate * (durationMs / 1000));
  const dataSize = numSamples * blockAlign;
  const chunkSize = 36 + dataSize;
  
  const buffer = Buffer.alloc(44 + dataSize);
  
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(chunkSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * frequency * t) * 0.3 * 32767;
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.floor(sample))), 44 + i * 2);
  }
  
  return buffer;
}

const dir = path.join(__dirname, 'assets', 'audio', 'pvp');
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

fs.writeFileSync(path.join(dir, 'correct.wav'), createWav(200, 880));
fs.writeFileSync(path.join(dir, 'wrong.wav'), createWav(200, 220));
fs.writeFileSync(path.join(dir, 'damage.wav'), createWav(100, 110));
fs.writeFileSync(path.join(dir, 'hit.wav'), createWav(100, 440));
fs.writeFileSync(path.join(dir, 'heal.wav'), createWav(300, 660));
fs.writeFileSync(path.join(dir, 'tick.wav'), createWav(50, 1000));
fs.writeFileSync(path.join(dir, 'go.wav'), createWav(200, 1200));
fs.writeFileSync(path.join(dir, 'victory.wav'), createWav(600, 880));
fs.writeFileSync(path.join(dir, 'defeat.wav'), createWav(600, 220));
fs.writeFileSync(path.join(dir, 'draw.wav'), createWav(400, 440));

console.log('Audio files generated successfully.');

const fs = require('node:fs');
const path = require('node:path');

const sampleRate = 48_000;
const durationSeconds = 3;
const sampleCount = sampleRate * durationSeconds;
const bytesPerSample = 2;
const dataSize = sampleCount * bytesPerSample;
const output = Buffer.alloc(44 + dataSize);

output.write('RIFF', 0);
output.writeUInt32LE(36 + dataSize, 4);
output.write('WAVE', 8);
output.write('fmt ', 12);
output.writeUInt32LE(16, 16);
output.writeUInt16LE(1, 20);
output.writeUInt16LE(1, 22);
output.writeUInt32LE(sampleRate, 24);
output.writeUInt32LE(sampleRate * bytesPerSample, 28);
output.writeUInt16LE(bytesPerSample, 32);
output.writeUInt16LE(16, 34);
output.write('data', 36);
output.writeUInt32LE(dataSize, 40);

const notes = [261.63, 329.63, 392];
for (let index = 0; index < sampleCount; index += 1) {
  const timeSeconds = index / sampleRate;
  const noteIndex = Math.min(
    notes.length - 1,
    Math.floor(timeSeconds / (durationSeconds / notes.length)),
  );
  const frequency = notes[noteIndex];
  const fadeIn = Math.min(1, timeSeconds / 0.04);
  const fadeOut = Math.min(1, (durationSeconds - timeSeconds) / 0.12);
  const envelope = Math.max(0, Math.min(fadeIn, fadeOut));
  const fundamental = Math.sin(2 * Math.PI * frequency * timeSeconds);
  const harmonic = Math.sin(2 * Math.PI * frequency * 2 * timeSeconds) * 0.18;
  const sample = Math.max(-1, Math.min(1, fundamental + harmonic));
  output.writeInt16LE(Math.round(sample * envelope * 0.2 * 32_767), 44 + index * 2);
}

const outputPath = path.resolve(__dirname, '../public/probe/preview-tone.wav');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, output);
console.log(`Wrote ${outputPath} (${durationSeconds}s @ ${sampleRate}Hz mono PCM16).`);

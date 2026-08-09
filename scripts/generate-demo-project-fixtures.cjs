const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const repositoryRoot = path.resolve(__dirname, '..');
const assetsDirectory = path.join(repositoryRoot, 'demo-project', 'assets');
const width = 1_920;
const height = 1_080;

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function createBackgroundPng() {
  const bytesPerRow = 1 + width * 3;
  const pixels = Buffer.alloc(bytesPerRow * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * bytesPerRow;
    pixels[row] = 0;
    const verticalShade = Math.round((y / (height - 1)) * 36);
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 3;
      const bambooColumn = x % 320;
      const stem = bambooColumn >= 54 && bambooColumn <= 84;
      const joint = stem && y % 240 >= 112 && y % 240 <= 124;
      pixels[offset] = stem ? (joint ? 70 : 86) : 24 + verticalShade;
      pixels[offset + 1] = stem ? (joint ? 118 : 145) : 92 + verticalShade;
      pixels[offset + 2] = stem ? (joint ? 55 : 70) : 72 + verticalShade;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(pixels, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(assetsDirectory, { recursive: true });
fs.writeFileSync(
  path.join(assetsDirectory, 'bamboo-background.png'),
  createBackgroundPng(),
);
for (const fileName of ['panda-neutral.png', 'panda-happy.png']) {
  fs.copyFileSync(
    path.join(repositoryRoot, 'public', 'probe', 'panda-character.png'),
    path.join(assetsDirectory, fileName),
  );
}
fs.copyFileSync(
  path.join(repositoryRoot, 'public', 'probe', 'preview-tone.wav'),
  path.join(assetsDirectory, 'opening-dialogue.wav'),
);

console.log(`Generated demo project assets in ${assetsDirectory}`);

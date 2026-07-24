const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ffmpegPath = path.join(
  path.dirname(
    require.resolve('@ffmpeg-installer/win32-x64/package.json'),
  ),
  'ffmpeg.exe',
);

const fixtureDirectory = path.join(
  __dirname,
  '../tests/fixtures/assets',
);
mkdirSync(fixtureDirectory, { recursive: true });

function generate(arguments_) {
  const result = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...arguments_], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `FFmpeg exited with ${result.status}.`);
  }
}

generate([
  '-f',
  'lavfi',
  '-i',
  'color=c=0x53a36b:s=16x12',
  '-frames:v',
  '1',
  path.join(fixtureDirectory, '熊猫 图片.png'),
]);
generate([
  '-f',
  'lavfi',
  '-i',
  'color=c=0x365f9f:s=18x14',
  '-frames:v',
  '1',
  '-q:v',
  '2',
  path.join(fixtureDirectory, '熊猫 照片.jpg'),
]);
generate([
  '-f',
  'lavfi',
  '-i',
  'color=c=0xa35f53:s=20x10',
  '-frames:v',
  '1',
  path.join(fixtureDirectory, '另一张 图片.png'),
]);
generate([
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=440:sample_rate=8000:duration=0.25',
  '-ac',
  '1',
  '-c:a',
  'pcm_s16le',
  path.join(fixtureDirectory, '熊猫 声音.wav'),
]);
generate([
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=660:sample_rate=22050:duration=0.25',
  '-ac',
  '1',
  '-c:a',
  'libmp3lame',
  '-b:a',
  '64k',
  path.join(fixtureDirectory, '熊猫 声音.mp3'),
]);

console.log(`Generated Day 16 fixtures in ${fixtureDirectory}`);

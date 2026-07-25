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
  '../tests/fixtures/characters',
);
mkdirSync(fixtureDirectory, { recursive: true });

function generate(name, color, size) {
  const result = spawnSync(
    ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=${color}:s=${size}`,
      '-frames:v',
      '1',
      path.join(fixtureDirectory, name),
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || `FFmpeg exited with ${result.status}.`);
  }
}

generate('熊猫 normal.png', '0x53a36b', '160x120');
generate('熊猫 angry.png', '0xa35353', '240x120');
generate('熊猫 mouth-open.png', '0xefe6d2', '160x52');

console.log(`Generated Day 19 character fixtures in ${fixtureDirectory}`);

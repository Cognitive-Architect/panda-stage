import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

async function test() {
  const ffmpeg = new FFmpeg();
  await ffmpeg.load();
  console.log('FFmpeg WASM loaded');
  
  const fs = require('fs');
  const testPng = fs.readFileSync('demo-project/assets/background.png');
  await ffmpeg.writeFile('bg.png', testPng);
  
  await ffmpeg.exec(['-i', 'bg.png', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-frames:v', '1', 'test.mp4']);
  
  const data = await ffmpeg.readFile('test.mp4');
  fs.writeFileSync('test_output.mp4', data);
  console.log('MP4 generated, size:', data.length);
}

test().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

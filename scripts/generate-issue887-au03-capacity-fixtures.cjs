const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ProjectSchema } = require('../dist-electron/domain/models/project.js');

const acceptanceRoot = path.resolve(process.env.PANDA_STAGE_ISSUE887_ROOT ??
  'D:\\PandaStage-Acceptance\\issue887-au03');
fs.mkdirSync(acceptanceRoot, { recursive: true });
const runRoot = fs.mkdtempSync(path.join(acceptanceRoot, 'run-'));
const seedRoot = path.join(runRoot, 'seed');
const seedResult = spawnSync(process.execPath, [path.join(__dirname, 'generate-issue867-sample.cjs')], {
  encoding: 'utf8',
  env: { ...process.env, PANDA_STAGE_ISSUE867_ROOT: seedRoot },
});
if (seedResult.status !== 0) {
  throw new Error(`Could not generate the original v14 seed project: ${seedResult.stderr || seedResult.stdout}`);
}
const seed = JSON.parse(seedResult.stdout);
const seedProjectRoot = seed.projectPath;
const seedProject = JSON.parse(fs.readFileSync(path.join(seedProjectRoot, 'project.json'), 'utf8'));
if (seedProject.schemaVersion !== 14) throw new Error(`Expected v14 seed; received v${seedProject.schemaVersion}.`);
const repositoryRoot = path.resolve(__dirname, '..');
const packageManifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
function resolveInstalledMediaTool(packageName, executableName, fallbackCommand) {
  const version = packageManifest.devDependencies?.[packageName];
  const virtualStoreName = `${packageName.replace('/', '+')}@${version}`;
  const candidate = path.join(repositoryRoot, 'node_modules', '.pnpm', virtualStoreName,
    'node_modules', packageName, executableName);
  return fs.existsSync(candidate) ? candidate : fallbackCommand;
}
const ffmpegPath = process.env.PANDA_STAGE_FFMPEG ?? resolveInstalledMediaTool(
  '@ffmpeg-installer/win32-x64', 'ffmpeg.exe', 'ffmpeg');
const ffprobePath = process.env.PANDA_STAGE_FFPROBE ?? resolveInstalledMediaTool(
  '@ffprobe-installer/win32-x64', 'ffprobe.exe', 'ffprobe');

function writeAll(fd, bytes, position) {
  let offset = 0;
  while (offset < bytes.length) offset += fs.writeSync(fd, bytes, offset, bytes.length - offset, position + offset);
}

function hashFile(filePath) {
  const hash = createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let position = 0;
    while (true) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, position);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
      position += read;
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function writeStereoPcmWav(filePath, sampleRate, durationSeconds) {
  const channels = 2;
  const bitsPerSample = 16;
  const blockAlign = channels * bitsPerSample / 8;
  const frameCount = sampleRate * durationSeconds;
  const dataBytes = frameCount * blockAlign;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(dataBytes + 36, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataBytes, 40);
  const fd = fs.openSync(filePath, 'wx');
  try {
    writeAll(fd, header, 0);
    const framesPerChunk = 32_768;
    let fileOffset = header.length;
    for (let start = 0; start < frameCount; start += framesPerChunk) {
      const frames = Math.min(framesPerChunk, frameCount - start);
      const chunk = Buffer.allocUnsafe(frames * blockAlign);
      for (let index = 0; index < frames; index += 1) {
        const frame = start + index;
        const seconds = frame / sampleRate;
        const phrase = Math.floor(seconds / 6) % 4;
        const baseHz = [110, 130.8128, 146.8324, 98][phrase];
        const left = Math.sin(2 * Math.PI * baseHz * seconds) * 0.12;
        const right = Math.sin(2 * Math.PI * baseHz * 1.5 * seconds) * 0.1;
        chunk.writeInt16LE(Math.round(left * 32_767), index * blockAlign);
        chunk.writeInt16LE(Math.round(right * 32_767), index * blockAlign + 2);
      }
      writeAll(fd, chunk, fileOffset);
      fileOffset += chunk.length;
    }
  } finally {
    fs.closeSync(fd);
  }
  return { sampleRate, channels, durationSeconds, fileBytes: fs.statSync(filePath).size,
    sha256: hashFile(filePath), pcmBytesAtSourceRate: frameCount * channels * Float32Array.BYTES_PER_ELEMENT };
}

function makeAudioAsset(spec) {
  return { id: spec.id, kind: 'audio', name: spec.name, relativePath: spec.relativePath,
    mimeType: spec.mimeType, sha256: spec.sha256, durationMs: spec.durationMs };
}

function makeClip(assetId, name, startMs, endMs, offsetMs = 0) {
  return { id: randomUUID(), role: 'bgm', name, assetId, startMs, endMs, offsetMs, volume: 0.5 };
}

function cloneShot(source, name) {
  const shot = structuredClone(source);
  const layerIds = new Map(shot.layers.map((layer) => [layer.id, randomUUID()]));
  shot.id = randomUUID();
  shot.name = name;
  shot.layers = shot.layers.map((layer) => ({ ...layer, id: layerIds.get(layer.id) }));
  shot.backgroundLayerId = shot.backgroundLayerId ? layerIds.get(shot.backgroundLayerId) ?? null : null;
  shot.audioClips = [];
  shot.dialogues = [];
  shot.timelineEvents = [];
  return shot;
}

function writeProject(caseId, caseName, shots, audioAssets) {
  const projectRoot = path.join(runRoot, `${caseId}.pandastage`);
  const assetsRoot = path.join(projectRoot, 'assets');
  fs.mkdirSync(assetsRoot, { recursive: true });
  for (const entry of fs.readdirSync(path.join(seedProjectRoot, 'assets'), { withFileTypes: true })) {
    if (entry.isFile()) fs.copyFileSync(path.join(seedProjectRoot, 'assets', entry.name), path.join(assetsRoot, entry.name));
  }
  for (const asset of audioAssets) {
    const sourcePath = path.resolve(runRoot, asset.relativePath);
    const projectAssetPath = path.resolve(projectRoot, asset.relativePath);
    const sourceRelative = path.relative(runRoot, sourcePath);
    const projectAssetRelative = path.relative(projectRoot, projectAssetPath);
    if (sourceRelative.startsWith('..') || path.isAbsolute(sourceRelative) ||
        projectAssetRelative.startsWith('..') || path.isAbsolute(projectAssetRelative)) {
      throw new Error(`Generated audio asset path escaped its fixture root: ${asset.relativePath}`);
    }
    fs.mkdirSync(path.dirname(projectAssetPath), { recursive: true });
    fs.copyFileSync(sourcePath, projectAssetPath);
  }
  const project = ProjectSchema.parse(JSON.parse(JSON.stringify(seedProject)));
  project.assets = project.assets.filter((asset) => asset.kind === 'image');
  project.assets.push(...audioAssets.map(makeAudioAsset));
  const originalShot = project.shots[0];
  if (!originalShot) throw new Error('The original seed project has no Shot.');
  const generatedShots = shots.map((shotSpec, index) => {
    const shot = index === 0 ? originalShot : cloneShot(originalShot, shotSpec.name);
    shot.id = index === 0 ? originalShot.id : shot.id;
    shot.name = shotSpec.name;
    shot.durationMs = shotSpec.durationMs;
    shot.audioClips = shotSpec.clips;
    shot.dialogues = [];
    shot.timelineEvents = [];
    return shot;
  });
  project.name = caseName;
  project.shots = generatedShots;
  project.updatedAt = new Date().toISOString();
  const parsed = ProjectSchema.parse(project);
  const projectPath = path.join(projectRoot, 'project.json');
  fs.writeFileSync(projectPath, `${JSON.stringify(parsed, null, 2)}\n`, { flag: 'wx' });
  const projectHash = hashFile(projectPath);
  return { caseId, projectRoot, projectSha256: projectHash,
    shots: parsed.shots.map((shot) => ({ id: shot.id, durationMs: shot.durationMs,
      audioClips: shot.audioClips.map(({ assetId, startMs, endMs, offsetMs, role }) =>
        ({ assetId, role, startMs, endMs, offsetMs })) })) };
}

const aRelativePath = 'assets/issue887-a-four-minute-48k-stereo.wav';
fs.mkdirSync(path.join(runRoot, 'assets'), { recursive: true });
const aFilePath = path.join(runRoot, aRelativePath);
const aWav = writeStereoPcmWav(aFilePath, 48_000, 240);
const aAsset = { id: randomUUID(), name: 'A 4 minute 48 kHz stereo PCM WAV', relativePath: aRelativePath,
  durationMs: 240_000, mimeType: 'audio/wav', sha256: aWav.sha256 };

const b48RelativePath = 'assets/issue887-b-first-180s-48k.wav';
const b48FilePath = path.join(runRoot, b48RelativePath);
const b48Wav = writeStereoPcmWav(b48FilePath, 48_000, 180);
const b48Asset = { id: randomUUID(), name: 'B first 180s BGM 48 kHz stereo', relativePath: b48RelativePath,
  durationMs: 180_000, mimeType: 'audio/wav', sha256: b48Wav.sha256 };

const b44RelativePath = 'assets/issue887-b-second-180s-44k1.wav';
const b44FilePath = path.join(runRoot, b44RelativePath);
const b44Wav = writeStereoPcmWav(b44FilePath, 44_100, 180);
const b44Asset = { id: randomUUID(), name: 'B second 180s BGM 44.1 kHz stereo', relativePath: b44RelativePath,
  durationMs: 180_000, mimeType: 'audio/wav', sha256: b44Wav.sha256 };

const cRelativePath = 'assets/issue887-c-six-minute-original-sine-48k-stereo.mp3';
const cFilePath = path.join(runRoot, cRelativePath);
const ffmpeg = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
  'sine=frequency=220:sample_rate=48000:duration=360', '-ac', '2', '-ar', '48000', '-b:a', '128k',
  '-codec:a', 'libmp3lame', '-write_xing', '0', cFilePath], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
if (ffmpeg.status !== 0) throw new Error(`FFmpeg could not synthesize the original MP3 control: ${ffmpeg.stderr || ffmpeg.stdout}`);
const cFileBytes = fs.statSync(cFilePath).size;
const cProbe = spawnSync(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration:stream=sample_rate,channels',
  '-of', 'json', cFilePath], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
if (cProbe.status !== 0) throw new Error(`FFprobe could not inspect the original MP3: ${cProbe.stderr || cProbe.stdout}`);
const cProbeJson = JSON.parse(cProbe.stdout);
const cStream = cProbeJson.streams?.[0];
const cDurationMs = 360_000;
const cAsset = { id: randomUUID(), name: 'C 6 minute MP3 48 kHz stereo', relativePath: cRelativePath,
  durationMs: cDurationMs, mimeType: 'audio/mpeg', sha256: hashFile(cFilePath) };

const audioAssets = [aAsset, b48Asset, b44Asset, cAsset];
const cases = [];
cases.push(writeProject('A-full', 'Issue 887 A 4 minute full WAV', [
  { name: 'A full 240s WAV', durationMs: 240_000, clips: [makeClip(aAsset.id, 'Full 4 minute WAV', 0, 240_000)] },
], [aAsset]));
cases.push(writeProject('A-offset', 'Issue 887 A short use across different source offsets', [
  { name: 'A offset 0', durationMs: 10_000, clips: [makeClip(aAsset.id, 'Offset 0', 0, 10_000, 0)] },
  { name: 'A offset 60s', durationMs: 10_000, clips: [makeClip(aAsset.id, 'Offset 60 seconds', 0, 10_000, 60_000)] },
], [aAsset]));
cases.push(writeProject('A-proxy-control', 'Issue 887 A same-offset WAV proxy control', [
  { name: 'A proxy control 1', durationMs: 10_000, clips: [makeClip(aAsset.id, 'Same 10s source range', 0, 10_000, 30_000)] },
  { name: 'A proxy control 2', durationMs: 10_000, clips: [makeClip(aAsset.id, 'Same 10s source range', 0, 10_000, 30_000)] },
], [aAsset]));
cases.push(writeProject('B-overlap', 'Issue 887 B two overlapping 180s BGM WAVs', [
  { name: 'B overlapping 180s tracks', durationMs: 180_000, clips: [
    makeClip(b48Asset.id, 'First 48 kHz BGM', 0, 180_000),
    makeClip(b44Asset.id, 'Second 44.1 kHz BGM', 0, 180_000),
  ] },
], [b48Asset, b44Asset]));
cases.push(writeProject('C-mp3', 'Issue 887 C six minute MP3', [
  { name: 'C full 360s MP3', durationMs: cDurationMs, clips: [makeClip(cAsset.id, 'Full 6 minute MP3', 0, cDurationMs)] },
], [cAsset]));

const assetReceipt = audioAssets.map((asset) => {
  const filePath = path.join(runRoot, asset.relativePath);
  return { id: asset.id, name: asset.name, filePath, relativePath: asset.relativePath,
    durationMs: asset.durationMs, mimeType: asset.mimeType, sampleRateFromFileHz: asset === b44Asset ? 44_100 : 48_000,
    channelsInFile: 2, fileBytes: fs.statSync(filePath).size, sha256: asset.sha256,
    pcmBytesAt48kHz: Math.ceil(asset.durationMs * 48 * 2 * Float32Array.BYTES_PER_ELEMENT) };
});
const manifest = { issue: 887, parentIssue: 886, createdAt: new Date().toISOString(), runRoot,
  sourceRevision: 'b2001613abe7f8fe5be1bca598a3547f437ad756', seedProject: seed.projectPath,
  seedProjectSha256: seed.projectSha256, cases, assets: assetReceipt,
  mp3Probe: { formatDurationSeconds: Number(cProbeJson.format?.duration ?? 0),
    streamSampleRateHz: Number(cStream?.sample_rate ?? 0), channels: Number(cStream?.channels ?? 0),
    fileBytes: cFileBytes },
  budgets: { workingSetLimitBytes: 128 * 1024 * 1024, workingSetLimitMiB: 128,
    individualFileLimitBytes: 64 * 1024 * 1024, individualFileLimitMiB: 64 },
  attribution: 'All PCM WAV samples and MP3 input are generated from original repository sine-wave sources; no third-party recordings or purchased media are used.' };
const manifestPath = path.join(runRoot, 'manifest.json');
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ manifestPath, runRoot, cases: cases.map(({ caseId, projectRoot, projectSha256 }) =>
  ({ caseId, projectRoot, projectSha256 })), assets: assetReceipt, mp3Probe: manifest.mp3Probe }, null, 2));

const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ProjectSchema } = require('../dist-electron/domain/models/project.js');

const acceptanceRoot = path.resolve(
  process.env.PANDA_STAGE_ISSUE886_ROOT ?? 'D:\\PandaStage-Acceptance\\issue886-au03',
);
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
const projectRoot = path.join(runRoot, 'Issue 886 AU-03 long BGM.pandastage');
const assetsRoot = path.join(projectRoot, 'assets');
fs.mkdirSync(assetsRoot, { recursive: true });
for (const entry of fs.readdirSync(path.join(seedProjectRoot, 'assets'), { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  fs.copyFileSync(path.join(seedProjectRoot, 'assets', entry.name), path.join(assetsRoot, entry.name));
}

const DURATION_SECONDS = 180;
const DURATION_MS = DURATION_SECONDS * 1_000;
const CHANNELS = 2;
const BITS_PER_SAMPLE = 16;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function writeAll(fd, bytes, position) {
  let offset = 0;
  while (offset < bytes.length) {
    offset += fs.writeSync(fd, bytes, offset, bytes.length - offset, position + offset);
  }
}

function writeOriginalStereoWav(filePath, sampleRate) {
  const frameCount = sampleRate * DURATION_SECONDS;
  const dataBytes = frameCount * CHANNELS * (BITS_PER_SAMPLE / 8);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(dataBytes + 36, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * CHANNELS * (BITS_PER_SAMPLE / 8), 28);
  header.writeUInt16LE(CHANNELS * (BITS_PER_SAMPLE / 8), 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataBytes, 40);

  const fd = fs.openSync(filePath, 'wx');
  try {
    writeAll(fd, header, 0);
    const framesPerChunk = 32_768;
    let fileOffset = header.length;
    for (let startFrame = 0; startFrame < frameCount; startFrame += framesPerChunk) {
      const frames = Math.min(framesPerChunk, frameCount - startFrame);
      const chunk = Buffer.allocUnsafe(frames * CHANNELS * 2);
      for (let frameOffset = 0; frameOffset < frames; frameOffset += 1) {
        const frame = startFrame + frameOffset;
        const seconds = frame / sampleRate;
        const bar = Math.floor(seconds / 4) % 4;
        const rootHz = [110, 130.8128, 146.8324, 98][bar];
        const thirdHz = rootHz * 1.25;
        const fifthHz = rootHz * 1.5;
        const melodyHz = [220, 261.6256, 293.6648, 246.9417, 196, 220, 174.6141, 196][Math.floor(seconds * 2) % 8];
        const fade = Math.min(1, seconds / 0.04, (DURATION_SECONDS - seconds) / 0.04);
        const chord = Math.sin(2 * Math.PI * rootHz * seconds) * 0.42 +
          Math.sin(2 * Math.PI * thirdHz * seconds) * 0.28 +
          Math.sin(2 * Math.PI * fifthHz * seconds) * 0.18 +
          Math.sin(2 * Math.PI * melodyHz * seconds) * 0.12;
        const tremolo = 0.88 + 0.12 * Math.sin(2 * Math.PI * 0.25 * seconds);
        const left = Math.max(-0.8, Math.min(0.8, chord * tremolo * fade * 0.12));
        const right = Math.max(-0.8, Math.min(0.8,
          (chord * 0.92 + Math.sin(2 * Math.PI * melodyHz * 1.005 * seconds) * 0.08) * tremolo * fade * 0.12));
        const byteOffset = frameOffset * 4;
        chunk.writeInt16LE(Math.round(left * 32_767), byteOffset);
        chunk.writeInt16LE(Math.round(right * 32_767), byteOffset + 2);
      }
      writeAll(fd, chunk, fileOffset);
      fileOffset += chunk.length;
    }
  } finally {
    fs.closeSync(fd);
  }
  return { filePath, sampleRate, channels: CHANNELS, durationSeconds: DURATION_SECONDS,
    pcmBytes: frameCount * CHANNELS * Float32Array.BYTES_PER_ELEMENT,
    fileBytes: fs.statSync(filePath).size, sha256: sha256(fs.readFileSync(filePath)) };
}

function shortEffectWav() {
  const sampleRate = 48_000;
  const frameCount = sampleRate;
  const bytes = Buffer.alloc(44 + frameCount * 2);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8, 'ascii');
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36, 'ascii');
  bytes.writeUInt32LE(frameCount * 2, 40);
  for (let index = 0; index < frameCount; index += 1) {
    const seconds = index / sampleRate;
    const envelope = Math.min(1, seconds / 0.01, (1 - seconds) / 0.03);
    const sample = Math.round(0.1 * envelope * Math.sin(2 * Math.PI * (440 + 880 * seconds) * seconds) * 32_767);
    bytes.writeInt16LE(sample, 44 + index * 2);
  }
  return bytes;
}

function audioAsset(template, id, name, relativePath, bytes, durationMs) {
  return { ...template, id, name, relativePath, sha256: sha256(bytes), durationMs };
}

function audioClip(template, role, name, assetId, startMs, endMs, offsetMs = 0, volume = 0.5) {
  return { ...template, id: randomUUID(), role, name, assetId, startMs, endMs, offsetMs, volume };
}

function cloneShot(source, name) {
  const shot = structuredClone(source);
  const layerIds = new Map(shot.layers.map((layer) => [layer.id, randomUUID()]));
  shot.id = randomUUID();
  shot.name = name;
  shot.layers = shot.layers.map((layer) => ({ ...layer, id: layerIds.get(layer.id) }));
  shot.backgroundLayerId = shot.backgroundLayerId
    ? layerIds.get(shot.backgroundLayerId) ?? null
    : null;
  shot.dialogues = [];
  shot.timelineEvents = [];
  return shot;
}

const project = ProjectSchema.parse(JSON.parse(fs.readFileSync(path.join(seedProjectRoot, 'project.json'), 'utf8')));
if (project.schemaVersion !== 14) throw new Error(`Expected schema v14 seed; received v${project.schemaVersion}.`);
const firstShot = project.shots[0];
if (!firstShot || firstShot.audioClips.length === 0 || firstShot.dialogues.length === 0) {
  throw new Error('The v14 seed project is missing its synthetic dialogue.');
}
const dialogueClip = firstShot.audioClips[0];
const dialogueAsset = project.assets.find((asset) => asset.id === dialogueClip.assetId);
if (!dialogueAsset || dialogueAsset.kind !== 'audio') throw new Error('Could not find the seed dialogue asset.');

const largeRelativePath = 'assets/au03-original-bgm-48k-stereo.wav';
const controlRelativePath = 'assets/au03-original-bgm-44k1-stereo.wav';
const effectRelativePath = 'assets/au03-original-short-sfx.wav';
const largeBufferInfo = writeOriginalStereoWav(path.join(projectRoot, largeRelativePath), 48_000);
const controlBufferInfo = writeOriginalStereoWav(path.join(projectRoot, controlRelativePath), 44_100);
const effectBytes = shortEffectWav();
fs.writeFileSync(path.join(projectRoot, effectRelativePath), effectBytes, { flag: 'wx' });

const largeAssetId = randomUUID();
const controlAssetId = randomUUID();
const effectAssetId = randomUUID();
project.assets.push(
  audioAsset(dialogueAsset, largeAssetId, 'AU-03 original 180s BGM 48 kHz stereo', largeRelativePath,
    fs.readFileSync(path.join(projectRoot, largeRelativePath)), DURATION_MS),
  audioAsset(dialogueAsset, controlAssetId, 'AU-03 original 180s control 44.1 kHz stereo', controlRelativePath,
    fs.readFileSync(path.join(projectRoot, controlRelativePath)), DURATION_MS),
  audioAsset(dialogueAsset, effectAssetId, 'AU-03 original short SFX', effectRelativePath, effectBytes, 1_000),
);

firstShot.durationMs = DURATION_MS;
firstShot.name = 'AU-03 48 kHz long BGM and dialogue';
firstShot.audioClips = [
  { ...dialogueClip, startMs: 300, endMs: 2_700, offsetMs: 0, volume: 0.45 },
  audioClip(dialogueClip, 'bgm', 'Same long source, Shot 1', largeAssetId, 0, DURATION_MS, 0, 0.35),
  audioClip(dialogueClip, 'sfx', 'Original short cue', effectAssetId, 900, 1_000, 0, 0.7),
];
firstShot.dialogues[0] = { ...firstShot.dialogues[0], audioClipId: dialogueClip.id,
  startMs: 300, endMs: 2_700, text: 'AU-03 original procedural dialogue timing cue' };

const secondShot = cloneShot(firstShot, 'AU-03 same source, next Shot');
secondShot.durationMs = DURATION_MS;
secondShot.audioClips = [audioClip(dialogueClip, 'bgm', 'Same long source, Shot 2', largeAssetId, 0, DURATION_MS, 0, 0.35)];

const thirdShot = cloneShot(firstShot, 'AU-03 44.1 kHz control');
thirdShot.durationMs = DURATION_MS;
thirdShot.audioClips = [audioClip(dialogueClip, 'bgm', 'Under-budget control source', controlAssetId, 0, DURATION_MS, 0, 0.35)];

project.name = 'Issue 886 AU-03 long BGM working-set fixture';
project.shots = [firstShot, secondShot, thirdShot];
project.updatedAt = new Date().toISOString();
const parsedProject = ProjectSchema.parse(project);
fs.writeFileSync(path.join(projectRoot, 'project.json'), `${JSON.stringify(parsedProject, null, 2)}\n`, { flag: 'wx' });

const projectBytes = fs.readFileSync(path.join(projectRoot, 'project.json'));
const manifest = {
  issue: 886,
  createdAt: new Date().toISOString(),
  projectPath: projectRoot,
  projectSha256: sha256(projectBytes),
  schemaVersion: parsedProject.schemaVersion,
  originalSeed: { projectPath: seedProjectRoot, projectSha256: seed.projectSha256 },
  assets: [largeBufferInfo, controlBufferInfo, {
    filePath: path.join(projectRoot, effectRelativePath), sampleRate: 48_000, channels: 1,
    durationSeconds: 1, pcmBytes: 48_000 * Float32Array.BYTES_PER_ELEMENT,
    fileBytes: effectBytes.length, sha256: sha256(effectBytes),
  }],
  decodedPcmThreshold: { bytes: 64 * 1024 * 1024, MiB: 64 },
  sourceReuse: {
    largeAssetId,
    largeSha256: parsedProject.assets.find((asset) => asset.id === largeAssetId).sha256,
    shotIds: [firstShot.id, secondShot.id],
    sameAssetAndHashAcrossShots: parsedProject.shots.slice(0, 2).every((shot) =>
      shot.audioClips.some((clip) => clip.assetId === largeAssetId)) &&
      parsedProject.shots.slice(0, 2).every((shot) =>
        parsedProject.assets.find((asset) => asset.id === shot.audioClips.find((clip) => clip.assetId === largeAssetId)?.assetId)?.sha256 ===
          parsedProject.assets.find((asset) => asset.id === largeAssetId)?.sha256),
  },
  mediaAttribution: 'All audio is synthesized by this repository script from sine-wave components; no third-party recording or copyrighted source is used.',
};
const manifestPath = path.join(runRoot, 'manifest.json');
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ projectPath: projectRoot, manifestPath, projectSha256: manifest.projectSha256,
  schemaVersion: manifest.schemaVersion,
  audio: manifest.assets.map(({ sampleRate, channels, durationSeconds, pcmBytes, fileBytes, sha256: hash }) =>
    ({ sampleRate, channels, durationSeconds, pcmBytes, fileBytes, sha256: hash })) }, null, 2));

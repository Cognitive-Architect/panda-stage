const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ProjectSchema } = require('../dist-electron/domain/models/project.js');

const acceptanceRoot = path.resolve(process.env.PANDA_STAGE_ISSUE888_ROOT ??
  'D:\\PandaStage-Acceptance\\issue888-au03');
fs.mkdirSync(acceptanceRoot, { recursive: true });
const runRoot = fs.mkdtempSync(path.join(acceptanceRoot, 'run-'));
const repositoryRoot = path.resolve(__dirname, '..');
const sourceRevision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).stdout.trim();
const frozen = JSON.parse(fs.readFileSync(path.join(acceptanceRoot, 'frozen-head.json'), 'utf8').replace(/^\uFEFF/u, ''));
if (sourceRevision !== frozen.head || !frozen.workingTreeClean) {
  throw new Error('Issue #888 fixture generation must use the recorded clean frozen HEAD.');
}

const seedRoot = path.join(runRoot, 'seed');
const seedResult = spawnSync(process.execPath, [path.join(__dirname, 'generate-issue867-sample.cjs')], {
  encoding: 'utf8', env: { ...process.env, PANDA_STAGE_ISSUE867_ROOT: seedRoot },
});
if (seedResult.status !== 0) throw new Error(`Could not generate v14 seed: ${seedResult.stderr || seedResult.stdout}`);
const seed = JSON.parse(seedResult.stdout);
const seedProjectRoot = seed.projectPath;
const seedProject = JSON.parse(fs.readFileSync(path.join(seedProjectRoot, 'project.json'), 'utf8'));
if (seedProject.schemaVersion !== 14) throw new Error(`Expected v14 seed; got v${seedProject.schemaVersion}.`);

function hashFile(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function writeStereoPcmWav(filePath, durationSeconds, frequencyHz, phase) {
  const sampleRate = 48_000;
  const channels = 2;
  const blockAlign = channels * 2;
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
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataBytes, 40);
  const fd = fs.openSync(filePath, 'wx');
  try {
    fs.writeSync(fd, header, 0, header.length, 0);
    const framesPerChunk = 32_768;
    let fileOffset = header.length;
    for (let start = 0; start < frameCount; start += framesPerChunk) {
      const frames = Math.min(framesPerChunk, frameCount - start);
      const chunk = Buffer.allocUnsafe(frames * blockAlign);
      for (let index = 0; index < frames; index += 1) {
        const time = (start + index) / sampleRate;
        chunk.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequencyHz * time + phase) * 3_600), index * blockAlign);
        chunk.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequencyHz * 1.5 * time + phase) * 3_000), index * blockAlign + 2);
      }
      let written = 0;
      while (written < chunk.length) written += fs.writeSync(fd, chunk, written, chunk.length - written, fileOffset + written);
      fileOffset += chunk.length;
    }
  } finally {
    fs.closeSync(fd);
  }
  return { sampleRate, channels, durationSeconds, fileBytes: fs.statSync(filePath).size, sha256: hashFile(filePath),
    pcmBytesAt48kHz: frameCount * channels * Float32Array.BYTES_PER_ELEMENT,
    paddedReservationBytesAt48kHz: (frameCount + sampleRate) * channels * Float32Array.BYTES_PER_ELEMENT };
}

function createAudioAsset(name, relativePath, durationMs, wav) {
  return { id: randomUUID(), kind: 'audio', name, relativePath, durationMs, mimeType: 'audio/wav', sha256: wav.sha256 };
}

function createClip(asset, name, startMs, endMs, volume) {
  return { id: randomUUID(), role: 'bgm', name, assetId: asset.id, startMs, endMs, offsetMs: 0, volume };
}

function cloneShot(source) {
  const shot = structuredClone(source);
  const layerIds = new Map(shot.layers.map((layer) => [layer.id, randomUUID()]));
  shot.id = randomUUID();
  shot.layers = shot.layers.map((layer) => ({ ...layer, id: layerIds.get(layer.id) }));
  shot.backgroundLayerId = shot.backgroundLayerId ? layerIds.get(shot.backgroundLayerId) ?? null : null;
  shot.dialogues = [];
  shot.timelineEvents = [];
  shot.audioClips = [];
  return shot;
}

function writeProject(caseId, name, shotSpecs, assets) {
  const projectRoot = path.join(runRoot, `${caseId}.pandastage`);
  const assetsRoot = path.join(projectRoot, 'assets');
  fs.mkdirSync(assetsRoot, { recursive: true });
  for (const entry of fs.readdirSync(path.join(seedProjectRoot, 'assets'), { withFileTypes: true })) {
    if (entry.isFile()) fs.copyFileSync(path.join(seedProjectRoot, 'assets', entry.name), path.join(assetsRoot, entry.name));
  }
  for (const asset of assets) {
    const source = path.join(runRoot, asset.relativePath);
    const target = path.join(projectRoot, asset.relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  const project = ProjectSchema.parse(JSON.parse(JSON.stringify(seedProject)));
  project.assets = [...project.assets.filter((asset) => asset.kind === 'image'), ...assets];
  project.name = name;
  const firstShot = project.shots[0];
  if (!firstShot) throw new Error('The seed Project has no Shot.');
  project.shots = shotSpecs.map((spec, index) => {
    const shot = index === 0 ? firstShot : cloneShot(firstShot);
    shot.name = spec.name;
    shot.durationMs = spec.durationMs;
    shot.audioClips = spec.clips;
    shot.dialogues = [];
    shot.timelineEvents = [];
    return shot;
  });
  project.updatedAt = new Date().toISOString();
  const parsed = ProjectSchema.parse(project);
  const projectPath = path.join(projectRoot, 'project.json');
  fs.writeFileSync(projectPath, `${JSON.stringify(parsed, null, 2)}\n`, { flag: 'wx' });
  return { caseId, projectRoot, projectSha256: hashFile(projectPath), schemaVersion: parsed.schemaVersion,
    shots: parsed.shots.map((item) => ({ id: item.id, durationMs: item.durationMs,
      audioClips: item.audioClips.map(({ id, assetId, role, startMs, endMs, offsetMs, volume }) =>
        ({ id, assetId, role, startMs, endMs, offsetMs, volume })) })) };
}

fs.mkdirSync(path.join(runRoot, 'assets'), { recursive: true });
const f01Assets = [];
const f01Waves = [];
for (const [name, frequency, phase] of [['F01 lower voice 220 Hz', 220, 0], ['F01 upper voice 330 Hz', 330, Math.PI / 2]]) {
  const relativePath = `assets/${name.toLowerCase().replaceAll(' ', '-')}.wav`;
  const wav = writeStereoPcmWav(path.join(runRoot, relativePath), 150, frequency, phase);
  f01Waves.push({ ...wav, name, relativePath, durationMs: 150_000 });
  f01Assets.push(createAudioAsset(name, relativePath, 150_000, wav));
}
if (f01Assets[0].sha256 === f01Assets[1].sha256) throw new Error('F01 source hashes must differ.');
const f02RelativePath = 'assets/f02-future-240s-48k-stereo.wav';
const f02Wave = writeStereoPcmWav(path.join(runRoot, f02RelativePath), 240, 440, Math.PI / 4);
const f02Asset = createAudioAsset('F02 future 240s BGM', f02RelativePath, 240_000, f02Wave);

const cases = [
  writeProject('F01', 'Issue 888 F01 two simultaneous 150s WAVs', [
    { name: 'F01 overlapping 150s BGM', durationMs: 150_000, clips: [
      createClip(f01Assets[0], f01Assets[0].name, 0, 150_000, 0.35),
      createClip(f01Assets[1], f01Assets[1].name, 0, 150_000, 0.8),
    ] },
  ], f01Assets),
  writeProject('F02', 'Issue 888 F02 future long WAV at master 500ms', [
    { name: 'F02 silent lead-in', durationMs: 500, clips: [] },
    { name: 'F02 future long BGM', durationMs: 240_000,
      clips: [createClip(f02Asset, f02Asset.name, 0, 240_000, 0.7)] },
  ], [f02Asset]),
];

const assets = [...f01Waves, { ...f02Wave, name: f02Asset.name, relativePath: f02RelativePath, durationMs: 240_000 }]
  .map((asset) => ({ ...asset, filePath: path.join(runRoot, asset.relativePath), mimeType: 'audio/wav',
    fileBytes: fs.statSync(path.join(runRoot, asset.relativePath)).size }));
const manifest = { issue: 888, parentIssue: 887, createdAt: new Date().toISOString(), runRoot,
  baselineSourceRevision: frozen.head, baselineWorkingTreeCleanAtFreeze: frozen.workingTreeClean,
  seedProject: seed.projectPath, seedProjectSha256: seed.projectSha256, cases, assets,
  budgets: { workingSetLimitBytes: 128 * 1024 * 1024, workingSetLimitMiB: 128,
    individualFileLimitBytes: 64 * 1024 * 1024, individualFileLimitMiB: 64 },
  attribution: 'All F01/F02 PCM WAV audio is generated locally from sine waves; image assets are copied from the original synthetic v14 sample project.' };
const manifestPath = path.join(runRoot, 'manifest.json');
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ runRoot, manifestPath, sourceRevision, cases, assets: manifest.assets }, null, 2));

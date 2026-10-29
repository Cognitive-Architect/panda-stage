const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ProjectSchema } = require('../dist-electron/domain/models/project.js');

const acceptanceRoot = path.resolve(process.env.PANDA_STAGE_ISSUE889_ROOT ??
  'D:\\PandaStage-Acceptance\\issue889-au03');
fs.mkdirSync(acceptanceRoot, { recursive: true });
const runRoot = fs.mkdtempSync(path.join(acceptanceRoot, 'run-'));
const repositoryRoot = path.resolve(__dirname, '..');
const sourceRevision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).stdout.trim();
const frozenPath = path.join(acceptanceRoot, 'frozen-head.json');
const frozen = JSON.parse(fs.readFileSync(frozenPath, 'utf8').replace(/^\uFEFF/u, ''));
if (sourceRevision !== frozen.head || !frozen.workingTreeClean) {
  throw new Error('Issue #889 fixture generation must use the recorded clean frozen HEAD.');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
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
        chunk.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequencyHz * 1.5 * time + phase) * 3_000),
          index * blockAlign + 2);
      }
      let written = 0;
      while (written < chunk.length) {
        written += fs.writeSync(fd, chunk, written, chunk.length - written, fileOffset + written);
      }
      fileOffset += chunk.length;
    }
  } finally {
    fs.closeSync(fd);
  }
  return {
    sampleRateHz: sampleRate,
    channels,
    durationSeconds,
    fileBytes: fs.statSync(filePath).size,
    sha256: sha256(fs.readFileSync(filePath)),
    decodedPcmBytesAt48kHz: frameCount * channels * Float32Array.BYTES_PER_ELEMENT,
    paddedDecodeReservationBytesAt48kHz: (frameCount + sampleRate) * channels * Float32Array.BYTES_PER_ELEMENT,
    sampleBoundaries: Array.from({ length: durationSeconds / 10 }, (_, index) => {
      const offsetMs = index * 10_000;
      const frame = Math.round(offsetMs * sampleRate / 1_000);
      const sample = Math.round(Math.sin(2 * Math.PI * frequencyHz * frame / sampleRate + phase) * 3_600);
      return { offsetMs, firstChannelSample: sample / 32_768 };
    }),
  };
}

function createAudioAsset(name, relativePath, wav) {
  return { id: randomUUID(), kind: 'audio', name, relativePath, durationMs: 150_000,
    mimeType: 'audio/wav', sha256: wav.sha256 };
}

function createBgmClip(asset, startMs, endMs, volume) {
  return { id: randomUUID(), role: 'bgm', name: asset.name, assetId: asset.id,
    startMs, endMs, offsetMs: 0, volume };
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

const seedRoot = path.join(runRoot, 'seed');
const seedResult = spawnSync(process.execPath, [path.join(__dirname, 'generate-issue867-sample.cjs')], {
  encoding: 'utf8', env: { ...process.env, PANDA_STAGE_ISSUE867_ROOT: seedRoot },
});
if (seedResult.status !== 0) throw new Error(`Could not generate v14 seed: ${seedResult.stderr || seedResult.stdout}`);
const seed = JSON.parse(seedResult.stdout);
const seedProjectRoot = seed.projectPath;
const seedProject = JSON.parse(fs.readFileSync(path.join(seedProjectRoot, 'project.json'), 'utf8'));
if (seedProject.schemaVersion !== 14) throw new Error(`Expected v14 seed; got v${seedProject.schemaVersion}.`);

const assetsRoot = path.join(runRoot, 'assets');
fs.mkdirSync(assetsRoot, { recursive: true });
const sourceSpecs = [
  { key: 'A', name: 'Issue 889 A 150s WAV', frequencyHz: 220, phase: 0, volume: 0.35 },
  { key: 'B', name: 'Issue 889 B 150s WAV', frequencyHz: 330, phase: Math.PI / 2, volume: 0.8 },
];
const assets = sourceSpecs.map((spec) => {
  const relativePath = `assets/issue889-${spec.key.toLowerCase()}-150s-48k-stereo.wav`;
  const wav = writeStereoPcmWav(path.join(runRoot, relativePath), 150, spec.frequencyHz, spec.phase);
  return { ...createAudioAsset(spec.name, relativePath, wav), ...spec, ...wav,
    filePath: path.join(runRoot, relativePath) };
});
if (assets[0].sha256 === assets[1].sha256) throw new Error('Issue #889 A/B source hashes must differ.');

const projectRoot = path.join(runRoot, 'S01.pandastage');
const projectAssetsRoot = path.join(projectRoot, 'assets');
fs.mkdirSync(projectAssetsRoot, { recursive: true });
for (const entry of fs.readdirSync(path.join(seedProjectRoot, 'assets'), { withFileTypes: true })) {
  if (entry.isFile()) fs.copyFileSync(path.join(seedProjectRoot, 'assets', entry.name),
    path.join(projectAssetsRoot, entry.name));
}
for (const asset of assets) {
  fs.copyFileSync(asset.filePath, path.join(projectRoot, asset.relativePath));
}

const project = ProjectSchema.parse(JSON.parse(JSON.stringify(seedProject)));
project.name = 'Issue 889 A → B → A+B WAV route transition';
const generatorOnlyFields = new Set(['key', 'frequencyHz', 'phase', 'volume', 'sampleRateHz', 'channels',
  'durationSeconds', 'fileBytes', 'decodedPcmBytesAt48kHz', 'paddedDecodeReservationBytesAt48kHz',
  'sampleBoundaries', 'filePath']);
project.assets = [...project.assets.filter((asset) => asset.kind === 'image'),
  ...assets.map((asset) => Object.fromEntries(Object.entries(asset).filter(([key]) => !generatorOnlyFields.has(key))))];
const firstShot = project.shots[0];
if (!firstShot) throw new Error('The synthetic v14 seed has no Shot.');
const shotA = firstShot;
const shotB = cloneShot(firstShot);
const shotAB = cloneShot(firstShot);
const shotAA = cloneShot(firstShot);
const shotSpecs = [
  { shot: shotA, name: 'S01 Shot 1 — A only', clips: [createBgmClip(assets[0], 0, 150_000, assets[0].volume)] },
  { shot: shotB, name: 'S01 Shot 2 — B only', clips: [createBgmClip(assets[1], 0, 150_000, assets[1].volume)] },
  { shot: shotAB, name: 'S01 Shot 3 — A + B', clips: [
    createBgmClip(assets[0], 0, 150_000, assets[0].volume),
    createBgmClip(assets[1], 0, 150_000, assets[1].volume),
  ] },
  { shot: shotAA, name: 'S01 Shot 4 — A same-source overlap control', clips: [
    createBgmClip(assets[0], 0, 150_000, assets[0].volume),
    createBgmClip(assets[0], 0, 150_000, 0.2),
  ] },
];
project.shots = shotSpecs.map(({ shot, name, clips }) => {
  shot.name = name;
  shot.durationMs = 150_000;
  shot.audioClips = clips;
  shot.dialogues = [];
  shot.timelineEvents = [];
  return shot;
});
project.updatedAt = new Date().toISOString();
const parsed = ProjectSchema.parse(project);
const projectPath = path.join(projectRoot, 'project.json');
fs.writeFileSync(projectPath, `${JSON.stringify(parsed, null, 2)}\n`, { flag: 'wx' });
const caseManifest = {
  caseId: 'S01',
  projectRoot,
  projectSha256: sha256(fs.readFileSync(projectPath)),
  schemaVersion: parsed.schemaVersion,
  shots: parsed.shots.map((shot) => ({ id: shot.id, name: shot.name, durationMs: shot.durationMs,
    audioClips: shot.audioClips.map(({ id, assetId, role, startMs, endMs, offsetMs, volume }) =>
      ({ id, assetId, role, startMs, endMs, offsetMs, volume })) })),
  transitions: [
    { step: 1, shotIndex: 0, assets: ['A'], projectTimeMs: 0 },
    { step: 2, shotIndex: 1, assets: ['B'], projectTimeMs: 150_000 },
    { step: 3, shotIndex: 2, assets: ['A', 'B'], projectTimeMs: 300_000 },
    { step: 4, shotIndex: 3, assets: ['A', 'A'], projectTimeMs: 450_000 },
    { step: 5, shotIndex: 0, assets: ['A'], projectTimeMs: 0 },
    { step: 6, shotIndex: 2, assets: ['A', 'B'], projectTimeMs: 300_000 },
  ],
};
const manifest = {
  issue: 889,
  parentIssue: 888,
  createdAt: new Date().toISOString(),
  runRoot,
  sourceRevision,
  frozenHeadPath: frozenPath,
  frozenHead: frozen.head,
  seedProject: seed.projectPath,
  seedProjectSha256: seed.projectSha256,
  cases: [caseManifest],
  assets: assets.map(({ id, key, name, relativePath, filePath, sha256: hash, durationMs, sampleRateHz,
    channels, fileBytes, decodedPcmBytesAt48kHz, paddedDecodeReservationBytesAt48kHz, sampleBoundaries }) =>
    ({ id, key, name, relativePath, filePath, sha256: hash, durationMs, sampleRateHz, channels, fileBytes,
      decodedPcmBytesAt48kHz, paddedDecodeReservationBytesAt48kHz, sampleBoundaries })),
  budgets: { workingSetLimitBytes: 128 * 1024 * 1024, workingSetLimitMiB: 128,
    idlePcmLruEntries: 8, idlePcmLruBytes: 64 * 1024 * 1024,
    waveSourceEntries: 4, waveSourceBytes: 96 * 1024 * 1024, wavChunkMs: 10_000,
    maxInFlightReads: 4, recentOversizedTtlMs: 30_000 },
  attribution: 'A/B are distinct, locally generated v14 150s 48kHz stereo PCM16 WAVs; seed image assets are synthetic and unchanged.',
};
const manifestPath = path.join(runRoot, 'manifest.json');
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ runRoot, manifestPath, sourceRevision, projectRoot, case: caseManifest,
  sources: manifest.assets }, null, 2));

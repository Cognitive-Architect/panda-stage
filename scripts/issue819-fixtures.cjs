const { createHash, randomUUID } = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { deflateSync } = require('node:zlib');
const { migrateProject } = require('../dist-electron/domain/migrations/index.js');
const { ProjectSchema } = require('../dist-electron/domain/models/project.js');

const repositoryRoot = path.resolve(__dirname, '..');
const demoProjectPath = path.join(repositoryRoot, 'demo-project', 'project-v1.example.json');

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function syntheticAudioWav(durationMs, amplitude, frequencySegments) {
  const sampleRate = 48_000;
  const sampleCount = Math.round((sampleRate * durationMs) / 1_000);
  const pcm = Buffer.alloc(sampleCount * 2);
  let segmentIndex = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const timeMs = (index * 1_000) / sampleRate;
    while (
      segmentIndex + 1 < frequencySegments.length &&
      timeMs >= frequencySegments[segmentIndex + 1].startMs
    ) {
      segmentIndex += 1;
    }
    const frequency = frequencySegments[segmentIndex].frequencyHz;
    const sample = Math.round(
      amplitude * 32_767 * Math.sin((2 * Math.PI * frequency * index) / sampleRate),
    );
    pcm.writeInt16LE(sample, index * 2);
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const PNG_CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = PNG_CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(pngCrc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

function pandaExpressionPng(expression) {
  const width = 640;
  const height = 640;
  const pixels = Buffer.alloc(width * height * 4);
  const pixel = (x, y, color) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = (Math.floor(y) * width + Math.floor(x)) * 4;
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
    pixels[offset + 3] = color[3];
  };
  const ellipse = (cx, cy, rx, ry, color) => {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y += 1) {
      for (let x = Math.floor(cx - rx); x <= cx + rx; x += 1) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) pixel(x, y, color);
      }
    }
  };
  const line = (x1, y1, x2, y2, thickness, color) => {
    const radius = thickness / 2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    for (let y = Math.floor(Math.min(y1, y2) - radius); y <= Math.max(y1, y2) + radius; y += 1) {
      for (let x = Math.floor(Math.min(x1, x2) - radius); x <= Math.max(x1, x2) + radius; x += 1) {
        const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared));
        const nearestX = x1 + t * dx;
        const nearestY = y1 + t * dy;
        if ((x - nearestX) ** 2 + (y - nearestY) ** 2 <= radius * radius) pixel(x, y, color);
      }
    }
  };
  const black = [21, 26, 27, 255];
  const white = [255, 253, 246, 255];
  ellipse(185, 175, 95, 100, black);
  ellipse(455, 175, 95, 100, black);
  ellipse(320, 335, 215, 195, white);
  ellipse(242, 290, 61, 76, black);
  ellipse(398, 290, 61, 76, black);
  ellipse(253, 284, 17, 19, white);
  ellipse(387, 284, 17, 19, white);
  ellipse(257, 285, 8, 10, black);
  ellipse(391, 285, 8, 10, black);
  ellipse(320, 365, 24, 16, black);
  if (expression === 'happy') {
    ellipse(204, 365, 29, 15, [238, 145, 139, 255]);
    ellipse(436, 365, 29, 15, [238, 145, 139, 255]);
    const start = [278, 394];
    const control = [320, 453];
    const end = [362, 394];
    let previous = start;
    for (let index = 1; index <= 48; index += 1) {
      const t = index / 48;
      const inverse = 1 - t;
      const point = [
        inverse * inverse * start[0] + 2 * inverse * t * control[0] + t * t * end[0],
        inverse * inverse * start[1] + 2 * inverse * t * control[1] + t * t * end[1],
      ];
      line(previous[0], previous[1], point[0], point[1], 11, black);
      previous = point;
    }
  } else if (expression === 'mouth-open') {
    ellipse(320, 410, 34, 39, black);
    ellipse(320, 389, 16, 8, white);
  } else {
    line(282, 410, 358, 410, 10, black);
  }

  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    pixels.copy(scanlines, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const ISSUE827_BACKGROUND_PALETTES = {
  1: [[36, 82, 128], [193, 93, 49], [56, 126, 77]],
  2: [[115, 69, 140], [173, 132, 38], [36, 136, 151]],
};

function issue827BackgroundPng(sampleId, shotIndex) {
  const palette = ISSUE827_BACKGROUND_PALETTES[sampleId];
  const color = palette?.[shotIndex];
  if (!color) throw new Error(`No Issue #827 background palette for sample ${sampleId}, Shot ${shotIndex + 1}.`);
  const width = 1_920;
  const height = 1_080;
  const rowLength = 1 + width * 4;
  const row = Buffer.alloc(rowLength);
  for (let x = 0; x < width; x += 1) {
    const offset = 1 + x * 4;
    row[offset] = color[0];
    row[offset + 1] = color[1];
    row[offset + 2] = color[2];
    row[offset + 3] = 255;
  }
  const scanlines = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y += 1) row.copy(scanlines, y * rowLength);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return {
    bytes: Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk('IHDR', header),
      pngChunk('IDAT', deflateSync(scanlines)),
      pngChunk('IEND', Buffer.alloc(0)),
    ]),
    expectedRgb: [...color],
    width,
    height,
  };
}

async function generateIssue819Fixture(
  baseDirectory,
  { includeAudioMix = false, multiShot = false, sampleId = 1 } = {},
) {
  const runRoot = path.join(
    path.resolve(baseDirectory),
    `run-${new Date().toISOString().replace(/[:.]/gu, '-')}-${process.pid}`,
  );
  const projectRoot = path.join(
    runRoot,
    multiShot ? 'Panda Stage formal export.pandastage' : 'Panda Stage formal export',
  );
  const evidenceRoot = path.join(runRoot, 'evidence');
  await fsp.mkdir(path.join(projectRoot, 'assets'), { recursive: true });
  await fsp.mkdir(evidenceRoot, { recursive: true });

  const legacyProject = JSON.parse(await fsp.readFile(demoProjectPath, 'utf8'));
  const project = migrateProject(legacyProject);
  project.id = randomUUID();
  project.name = multiShot
    ? `DL-04 multi-shot sample ${sampleId}`
    : 'Panda Stage formal export';
  project.shots = project.shots.slice(0, 1);
  const shot = project.shots[0];
  if (!shot) throw new Error('The demo Project has no Shot for the Issue #819 fixture.');

  const multiShotDurations = sampleId === 1
    ? [10_003, 9_997, 10_000]
    : [9_000, 11_000, 10_000];
  shot.durationMs = multiShot ? multiShotDurations[0] : 6_501;
  shot.audioClips = [];
  shot.dialogues = shot.dialogues.map((dialogue, index) => {
    const result = { ...dialogue };
    delete result.audioClipId;
    if (index === 0) {
      result.startMs = 700;
      result.endMs = 6_150;
      result.text = 'Issue 819: Panda takes a brave first step.';
    }
    return result;
  });
  shot.timelineEvents = shot.timelineEvents.map((event) =>
    event.type === 'move' && event.startMs === 0
      ? { ...event, endMs: 3_300 }
      : event.type === 'expression'
        ? { ...event, startMs: multiShot ? 8_500 : 4_000, endMs: multiShot ? 8_500 : 4_000 }
        : event,
  );

  const projectAssets = [...project.assets];
  project.assets = [];
  for (const asset of projectAssets) {
    if (asset.kind === 'audio') {
      if (includeAudioMix) continue;
      const sourcePath = path.join(repositoryRoot, 'demo-project', asset.relativePath);
      const bytes = await fsp.readFile(sourcePath);
      asset.sha256 = hash(bytes);
      project.assets.push(asset);
      await fsp.copyFile(sourcePath, path.join(projectRoot, asset.relativePath));
      continue;
    }
    const sourcePath = path.join(repositoryRoot, 'demo-project', asset.relativePath);
    const bytes = asset.relativePath.endsWith('panda-neutral.png')
      ? pandaExpressionPng('neutral')
      : asset.relativePath.endsWith('panda-happy.png')
        ? pandaExpressionPng('happy')
        : await fsp.readFile(sourcePath);
    if (bytes.length < 24 || bytes.toString('ascii', 1, 4) !== 'PNG') {
      throw new Error(`Issue #819 fixture image is not a PNG: ${asset.relativePath}`);
    }
    asset.width = bytes.readUInt32BE(16);
    asset.height = bytes.readUInt32BE(20);
    asset.sha256 = hash(bytes);
    project.assets.push(asset);
    await fsp.writeFile(path.join(projectRoot, asset.relativePath), bytes);
  }

  let audioMixFixture = null;
  let backgroundEvidence = [];
  if (includeAudioMix) {
    const characterLayer = shot.layers.find((layer) => layer.source.kind === 'character');
    const character = project.characters.find(
      (candidate) => candidate.id === characterLayer?.source.characterId,
    );
    if (!character) throw new Error('DL-03 fixture requires a character layer.');
    const mouthOpenAssetId = randomUUID();
    const mouthOpenBytes = pandaExpressionPng('mouth-open');
    const mouthOpenAsset = {
      id: mouthOpenAssetId,
      kind: 'image',
      name: 'DL-03 synthetic mouth-open image',
      relativePath: 'assets/panda-mouth-open.png',
      mimeType: 'image/png',
      width: mouthOpenBytes.readUInt32BE(16),
      height: mouthOpenBytes.readUInt32BE(20),
      sha256: hash(mouthOpenBytes),
    };
    project.assets.push(mouthOpenAsset);
    character.mouthOpenAssetId = mouthOpenAssetId;
    await fsp.writeFile(path.join(projectRoot, mouthOpenAsset.relativePath), mouthOpenBytes);
    // Keep the character stationary around the mouth-flap sample boundary.
    // The expression change at 4s remains as an independent render control.
    shot.timelineEvents = shot.timelineEvents.filter((event) => event.type === 'expression');

    const audioDefinitions = [
      {
        key: 'dialogue',
        name: 'DL-03 synthetic dialogue',
        relativePath: 'assets/dl03-dialogue.wav',
        durationMs: 4_000,
        amplitude: 0.1,
        frequencySegments: [
          { startMs: 0, frequencyHz: 330 },
          { startMs: 250, frequencyHz: 440 },
          { startMs: 750, frequencyHz: 660 },
        ],
      },
      {
        key: 'bgm',
        name: 'DL-03 synthetic BGM',
        relativePath: 'assets/dl03-bgm.wav',
        durationMs: multiShot ? shot.durationMs : 6_501,
        amplitude: 0.08,
        frequencySegments: [
          { startMs: 0, frequencyHz: 220 },
          { startMs: 1_000, frequencyHz: 260 },
        ],
      },
      {
        key: 'sfx-one',
        name: 'DL-03 synthetic SFX one',
        relativePath: 'assets/dl03-sfx-one.wav',
        durationMs: 2_000,
        amplitude: 0.08,
        frequencySegments: [
          { startMs: 0, frequencyHz: 600 },
          { startMs: 250, frequencyHz: 880 },
        ],
      },
      {
        key: 'sfx-two',
        name: 'DL-03 synthetic SFX two',
        relativePath: 'assets/dl03-sfx-two.wav',
        durationMs: 2_000,
        amplitude: 0.08,
        frequencySegments: [
          { startMs: 0, frequencyHz: 600 },
          { startMs: 400, frequencyHz: 1_320 },
        ],
      },
    ];
    const audioAssetIds = new Map();
    for (const definition of audioDefinitions) {
      const id = randomUUID();
      const bytes = syntheticAudioWav(
        definition.durationMs,
        definition.amplitude,
        definition.frequencySegments,
      );
      project.assets.push({
        id,
        kind: 'audio',
        name: definition.name,
        relativePath: definition.relativePath,
        mimeType: 'audio/wav',
        sha256: hash(bytes),
        durationMs: definition.durationMs,
        metadata: { status: 'ready', warnings: [] },
      });
      audioAssetIds.set(definition.key, id);
      await fsp.writeFile(path.join(projectRoot, definition.relativePath), bytes);
    }

    const clipIds = {
      dialogue: randomUUID(),
      bgm: randomUUID(),
      sfxOne: randomUUID(),
      sfxTwo: randomUUID(),
      sfxOnly: randomUUID(),
      mutedSfx: randomUUID(),
    };
    shot.audioClips = [
      {
        id: clipIds.dialogue,
        name: 'DL-03 dialogue 0–3s',
        assetId: audioAssetIds.get('dialogue'),
        role: 'dialogue',
        startMs: 0,
        endMs: 3_000,
        offsetMs: 250,
        volume: 1,
      },
      {
        id: clipIds.bgm,
        name: 'DL-03 BGM full Shot',
        assetId: audioAssetIds.get('bgm'),
        role: 'bgm',
        startMs: 0,
        endMs: shot.durationMs,
        offsetMs: 0,
        volume: 0.5,
      },
      {
        id: clipIds.sfxOne,
        name: 'DL-03 SFX one 1.5–2.5s',
        assetId: audioAssetIds.get('sfx-one'),
        role: 'sfx',
        startMs: 1_500,
        endMs: 2_500,
        offsetMs: 250,
        volume: 1.5,
      },
      {
        id: clipIds.sfxTwo,
        name: 'DL-03 SFX two 2–3s',
        assetId: audioAssetIds.get('sfx-two'),
        role: 'sfx',
        startMs: 2_000,
        endMs: 3_000,
        offsetMs: 400,
        volume: 2,
      },
      {
        id: clipIds.sfxOnly,
        name: 'DL-03 moved SFX-only voice-isolation sample',
        assetId: audioAssetIds.get('sfx-one'),
        role: 'sfx',
        startMs: 3_500,
        endMs: 4_000,
        offsetMs: 250,
        volume: 1,
      },
      {
        id: clipIds.mutedSfx,
        name: 'DL-03 zero-gain SFX sample',
        assetId: audioAssetIds.get('sfx-one'),
        role: 'sfx',
        startMs: 4_000,
        endMs: 4_500,
        offsetMs: 250,
        volume: 0,
      },
    ];
    if (!shot.dialogues[0]) {
      throw new Error('DL-03 fixture requires a Dialogue to bind to its voice clip.');
    }
    shot.dialogues = [{
      ...shot.dialogues[0],
      startMs: 0,
      endMs: 6_150,
      text: 'DL-03: spoken line ends at 3 seconds; subtitle remains through 6.15 seconds.',
      audioClipId: clipIds.dialogue,
    }];
    audioMixFixture = {
      mouthOpenAssetId,
      mouthOpenAssetSha256: mouthOpenAsset.sha256,
      dialogueClipId: clipIds.dialogue,
      dialogueAssetId: audioAssetIds.get('dialogue'),
      dialogueStartMs: 0,
      dialogueEndMs: 3_000,
      dialogueOffsetMs: 250,
      subtitleStartMs: 0,
      subtitleEndMs: 6_150,
      bgmClipId: clipIds.bgm,
      bgmStartMs: 0,
      bgmEndMs: shot.durationMs,
      bgmVolume: 0.5,
      sfx: [
        { clipId: clipIds.sfxOne, startMs: 1_500, endMs: 2_500, offsetMs: 250, volume: 1.5 },
        { clipId: clipIds.sfxTwo, startMs: 2_000, endMs: 3_000, offsetMs: 400, volume: 2 },
      ],
      sfxOverlapMs: 500,
      sfxOnly: {
        clipId: clipIds.sfxOnly,
        movedFromStartMs: 3_250,
        movedFromEndMs: 3_750,
        startMs: 3_500,
        endMs: 4_000,
        offsetMs: 250,
        volume: 1,
      },
      mutedSfx: {
        clipId: clipIds.mutedSfx,
        startMs: 4_000,
        endMs: 4_500,
        offsetMs: 250,
        volume: 0,
      },
    };
  }

  if (multiShot) {
    if (!includeAudioMix || !audioMixFixture) {
      throw new Error('DL-04 multi-shot fixtures require generated audio media.');
    }
    const dialogueAssetId = audioMixFixture.dialogueAssetId;
    const bgmClip = shot.audioClips.find((clip) => clip.id === audioMixFixture.bgmClipId);
    const dialogueClip = shot.audioClips.find((clip) => clip.id === audioMixFixture.dialogueClipId);
    const sfxClip = shot.audioClips.find((clip) => clip.id === audioMixFixture.sfxOnly.clipId);
    if (!bgmClip || !dialogueClip || !sfxClip) {
      throw new Error('DL-04 fixture audio definitions are incomplete.');
    }
    const characterLayer = shot.layers.find((layer) => layer.source.kind === 'character');
    if (!characterLayer) throw new Error('DL-04 fixture requires a character layer.');
    const characterLayerId = characterLayer.id;
    const shotDialogue = shot.dialogues[0];
    if (!shotDialogue) throw new Error('DL-04 fixture requires a subtitle dialogue.');

    shot.audioClips = [
      { ...bgmClip, endMs: shot.durationMs - 1_000, volume: 0.35 },
      { ...dialogueClip, startMs: 0, endMs: 2_500, offsetMs: 0, volume: 1 },
    ];
    shot.dialogues = [{
      ...shotDialogue,
      startMs: 0,
      endMs: 6_150,
      text: `DL-04 sample ${sampleId}, Shot 1 dialogue and subtitle tail.`,
      audioClipId: dialogueClip.id,
    }];

    const cloneShot = (index) => {
      const clone = structuredClone(shot);
      const layerIds = new Map(clone.layers.map((layer) => [layer.id, randomUUID()]));
      clone.id = randomUUID();
      clone.name = `DL-04 sample ${sampleId} Shot ${index + 1}`;
      clone.durationMs = multiShotDurations[index];
      clone.backgroundLayerId = clone.backgroundLayerId
        ? layerIds.get(clone.backgroundLayerId)
        : null;
      clone.layers = clone.layers.map((layer) => ({
        ...layer,
        id: layerIds.get(layer.id),
        ...(layer.id === characterLayerId
          ? {
              x: layer.x + (sampleId === 1 ? 80 : 120) * index,
              ...(sampleId === 2 && index === 2 ? { flipX: !layer.flipX } : {}),
            }
          : {}),
      }));
      clone.timelineEvents = clone.timelineEvents.map((event) => ({
        ...event,
        id: randomUUID(),
        layerId: layerIds.get(event.layerId),
      }));
      clone.dialogues = clone.dialogues.map((dialogue) => {
        const clonedDialogue = { ...dialogue, id: randomUUID() };
        delete clonedDialogue.audioClipId;
        return clonedDialogue;
      });
      clone.audioClips = [];
      return clone;
    };

    const second = cloneShot(1);
    const secondDialogueClipId = randomUUID();
    second.audioClips = [{
      id: secondDialogueClipId,
      name: `DL-04 Shot 2 dialogue ${sampleId}`,
      assetId: dialogueAssetId,
      role: 'dialogue',
      startMs: 2_000,
      endMs: 3_500,
      offsetMs: 0,
      volume: 1,
    }];
    const secondSourceDialogue = second.dialogues[0];
    second.dialogues = secondSourceDialogue
      ? [{
          ...secondSourceDialogue,
          startMs: 2_000,
          endMs: 4_500,
          text: `DL-04 sample ${sampleId}, delayed Shot 2 dialogue.`,
          audioClipId: secondDialogueClipId,
        }]
      : [];

    const third = cloneShot(2);
    const thirdSfxClipId = randomUUID();
    third.dialogues = [];
    third.audioClips = [{
      id: thirdSfxClipId,
      name: `DL-04 Shot 3 SFX ${sampleId}`,
      assetId: sfxClip.assetId,
      role: 'sfx',
      startMs: 4_000,
      endMs: 5_000,
      offsetMs: 250,
      volume: 1,
    }];
    project.shots = [shot, second, third];
    const originalBackgroundLayer = shot.layers.find((layer) => layer.id === shot.backgroundLayerId);
    if (!originalBackgroundLayer || originalBackgroundLayer.source.kind !== 'asset') {
      throw new Error('DL-04 fixture requires an asset-backed background layer in every Shot.');
    }
    const originalBackgroundAsset = project.assets.find(
      (asset) => asset.id === originalBackgroundLayer.source.assetId,
    );
    if (!originalBackgroundAsset || originalBackgroundAsset.kind !== 'image') {
      throw new Error('DL-04 fixture background asset is missing or is not an image.');
    }
    const backgroundBytesByShot = [];
    backgroundEvidence = project.shots.map((projectShot, shotIndex) => {
      const layer = projectShot.layers.find((candidate) => candidate.id === projectShot.backgroundLayerId);
      if (!layer || layer.source.kind !== 'asset') {
        throw new Error(`DL-04 fixture Shot ${shotIndex + 1} has no asset-backed background layer.`);
      }
      const background = issue827BackgroundPng(sampleId, shotIndex);
      let asset;
      if (shotIndex === 0) {
        asset = originalBackgroundAsset;
        asset.name = `DL-04 sample ${sampleId} Shot 1 background`;
      } else {
        asset = {
          id: randomUUID(),
          kind: 'image',
          name: `DL-04 sample ${sampleId} Shot ${shotIndex + 1} background`,
          relativePath: `assets/dl04-sample-${sampleId}-shot-${shotIndex + 1}-background.png`,
          mimeType: 'image/png',
          width: background.width,
          height: background.height,
          sha256: hash(background.bytes),
        };
        project.assets.push(asset);
      }
      asset.width = background.width;
      asset.height = background.height;
      asset.sha256 = hash(background.bytes);
      layer.source = { kind: 'asset', assetId: asset.id };
      backgroundBytesByShot[shotIndex] = background.bytes;
      const evidence = {
        shotIndex,
        shotId: projectShot.id,
        shotName: projectShot.name,
        assetId: asset.id,
        relativePath: asset.relativePath,
        sha256: asset.sha256,
        expectedRgb: background.expectedRgb,
        width: background.width,
        height: background.height,
      };
      return evidence;
    });
    for (const shotIndex of [0, 1, 2]) {
      await fsp.writeFile(
        path.join(projectRoot, backgroundEvidence[shotIndex].relativePath),
        backgroundBytesByShot[shotIndex],
      );
    }
    audioMixFixture.shotPrefixes = [0, shot.durationMs, shot.durationMs + second.durationMs];
    audioMixFixture.mappedClips = [
      { shotIndex: 0, clipId: audioMixFixture.bgmClipId, role: 'bgm', localStartMs: 0, localEndMs: shot.durationMs - 1_000, globalStartMs: 0, globalEndMs: shot.durationMs - 1_000, sourceOffsetMs: 0 },
      { shotIndex: 0, clipId: audioMixFixture.dialogueClipId, role: 'dialogue', localStartMs: 0, localEndMs: 2_500, globalStartMs: 0, globalEndMs: 2_500, sourceOffsetMs: 0 },
      { shotIndex: 1, clipId: secondDialogueClipId, role: 'dialogue', localStartMs: 2_000, localEndMs: 3_500, globalStartMs: shot.durationMs + 2_000, globalEndMs: shot.durationMs + 3_500, sourceOffsetMs: 0 },
      { shotIndex: 2, clipId: thirdSfxClipId, role: 'sfx', localStartMs: 4_000, localEndMs: 5_000, globalStartMs: shot.durationMs + second.durationMs + 4_000, globalEndMs: shot.durationMs + second.durationMs + 5_000, sourceOffsetMs: 250 },
    ];
    audioMixFixture.secondDialogueClipId = secondDialogueClipId;
    audioMixFixture.thirdSfxClipId = thirdSfxClipId;
    audioMixFixture.durationMs = project.shots.reduce((total, item) => total + item.durationMs, 0);
  }

  const validated = ProjectSchema.parse(project);
  if (!multiShot && (
    validated.shots.length !== 1 ||
    validated.shots[0]?.audioClips.length !== (includeAudioMix ? 6 : 0)
  )) {
    throw new Error(`Issue #819 fixture must contain one ${includeAudioMix ? 'audio' : 'silent'} Shot.`);
  }
  if (multiShot && (validated.shots.length !== 3 || validated.shots.some((item) => item.durationMs < 9_000))) {
    throw new Error('Issue #827 fixture must contain three long Shots.');
  }
  await fsp.writeFile(
    path.join(projectRoot, 'project.json'),
    JSON.stringify(validated, null, 2),
    'utf8',
  );
  return {
    root: runRoot,
    projectRoot,
    evidenceRoot,
    project: validated,
    audioMixFixture,
    backgroundEvidence,
    mouthOpenAssetSha256: audioMixFixture?.mouthOpenAssetSha256 ?? null,
    expressionAssetHashes: Object.fromEntries(
      validated.assets
        .filter((asset) => asset.relativePath.endsWith('panda-neutral.png') || asset.relativePath.endsWith('panda-happy.png'))
        .map((asset) => [asset.relativePath, asset.sha256]),
    ),
  };
}

async function generateIssue827Fixture(baseDirectory, sampleId) {
  return generateIssue819Fixture(baseDirectory, {
    includeAudioMix: true,
    multiShot: true,
    sampleId,
  });
}

module.exports = { generateIssue819Fixture, generateIssue827Fixture };

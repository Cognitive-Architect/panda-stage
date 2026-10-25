const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const { ProjectSchema } = require('../dist-electron/domain/index.js');

const PROJECT_ID = '84800000-0000-4000-8000-000000000001';
const ASSET_IDS = {
  background: '84810000-0000-4000-8000-000000000001',
  body: '84810000-0000-4000-8000-000000000002',
  faceNormal: '84810000-0000-4000-8000-000000000003',
  faceAngry: '84810000-0000-4000-8000-000000000004',
  mouthOpen: '84810000-0000-4000-8000-000000000005',
  dialogue: '84810000-0000-4000-8000-000000000006',
};
const CHARACTER_ID = '84820000-0000-4000-8000-000000000001';
const VOICE_ID = '84830000-0000-4000-8000-000000000001';
const EXPRESSION_IDS = {
  normal: '84840000-0000-4000-8000-000000000001',
  angry: '84840000-0000-4000-8000-000000000002',
};
const SUBTITLE_ID = '84840000-0000-4000-8000-000000000003';

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(name, data) {
  const type = Buffer.from(name, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, checksum]);
}

function createPng(width, height, pixelAt) {
  const rowLength = width * 4 + 1;
  const raw = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowLength;
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * 4;
      const [red, green, blue, alpha] = pixelAt(x, y);
      raw[offset] = red;
      raw[offset + 1] = green;
      raw[offset + 2] = blue;
      raw[offset + 3] = alpha;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function backgroundPixel(x, y) {
  const band = Math.floor(x / 320) % 3;
  const shade = Math.floor(y / 108);
  const bases = [
    [31, 83, 125],
    [43, 119, 125],
    [62, 86, 128],
  ];
  const base = bases[band];
  return [
    Math.min(255, base[0] + shade * 2),
    Math.min(255, base[1] + shade * 2),
    Math.min(255, base[2] + shade * 2),
    255,
  ];
}

function bodyPixel(x, y) {
  const head = ((x - 320) / 168) ** 2 + ((y - 176) / 150) ** 2 <= 1;
  const torso = ((x - 320) / 206) ** 2 + ((y - 436) / 212) ** 2 <= 1;
  if (!head && !torso) return [0, 0, 0, 0];
  const shade = Math.max(0, Math.min(38, Math.floor((y - 90) / 14)));
  return head
    ? [241 - shade, 205 - shade, 153 - shade, 255]
    : [80 - Math.floor(shade / 3), 119 - Math.floor(shade / 4), 154, 255];
}

function facePixel(kind) {
  return (x, y) => {
    const inFace = ((x - 320) / 186) ** 2 + ((y - 325) / 162) ** 2 <= 1;
    if (!inFace) return [0, 0, 0, 0];
    const leftEye = (x - 258) ** 2 + (y - 300) ** 2 <= 12 ** 2;
    const rightEye = (x - 382) ** 2 + (y - 300) ** 2 <= 12 ** 2;
    const openMouth = kind === 'mouth-open';
    const mouthEllipse = ((x - 320) / (openMouth ? 27 : 34)) ** 2 +
      ((y - (openMouth ? 374 : 372)) / (openMouth ? 34 : 10)) ** 2 <= 1;
    const brow = kind === 'angry' &&
      ((Math.abs(y - (282 + (x < 320 ? (320 - x) * 0.12 : (x - 320) * 0.12))) < 6) &&
        x >= 236 && x <= 404);
    if (leftEye || rightEye || brow) return [48, 43, 42, 255];
    if (mouthEllipse) return openMouth ? [110, 35, 48, 255] : [124, 57, 53, 255];
    if (y > 335 && y < 356 && (Math.abs(x - 282) < 12 || Math.abs(x - 358) < 12)) {
      return [212, 113, 107, 255];
    }
    const tint = kind === 'angry' ? 8 : 0;
    return [246 - tint, 221 - tint, 181 - tint, 255];
  };
}

function createDialogueWav() {
  const sampleRate = 48_000;
  const channels = 1;
  const bitsPerSample = 16;
  const samples = sampleRate * 4.5;
  const dataLength = samples * channels * bitsPerSample / 8;
  const output = Buffer.alloc(44 + dataLength);
  output.write('RIFF', 0, 'ascii');
  output.writeUInt32LE(36 + dataLength, 4);
  output.write('WAVE', 8, 'ascii');
  output.write('fmt ', 12, 'ascii');
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(channels, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28);
  output.writeUInt16LE(channels * bitsPerSample / 8, 32);
  output.writeUInt16LE(bitsPerSample, 34);
  output.write('data', 36, 'ascii');
  output.writeUInt32LE(dataLength, 40);
  for (let index = 0; index < samples; index += 1) {
    const time = index / sampleRate;
    const envelope = 0.48 + 0.32 * Math.sin(2 * Math.PI * 2 * time);
    const sample = Math.round(
      16_000 * envelope * Math.sin(2 * Math.PI * 440 * time),
    );
    output.writeInt16LE(sample, 44 + index * 2);
  }
  return output;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function buildProject(assetHashes) {
  const shots = Array.from({ length: 3 }, (_, index) => {
    const suffix = String(index + 1).padStart(12, '0');
    const backgroundLayerId = `84860000-0000-4000-8000-${suffix}`;
    const characterLayerId = `84860000-0000-4000-8001-${suffix}`;
    const shotId = `84850000-0000-4000-8000-${suffix}`;
    const dialogueId = `84870000-0000-4000-8000-${suffix}`;
    const audioClipId = `84880000-0000-4000-8000-${suffix}`;
    const eventStart = `84890000-0000-4000-8000-${suffix}`;
    const startX = [450, 980, 1_430][index];
    const endX = [720, 1_240, 1_160][index];
    const expressionId = index === 1 ? EXPRESSION_IDS.angry : EXPRESSION_IDS.normal;
    const baseBackground = {
      id: backgroundLayerId,
      name: 'Scene background',
      source: { kind: 'asset', assetId: ASSET_IDS.background },
      anchor: 'center',
      x: 960,
      y: 540,
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 0,
      opacity: 1,
      visible: true,
      zIndex: 0,
      locked: false,
      flipX: false,
    };
    const baseCharacter = {
      id: characterLayerId,
      name: 'Speaking composite character',
      source: {
        kind: 'character',
        characterId: CHARACTER_ID,
        expressionId: EXPRESSION_IDS.normal,
      },
      anchor: 'center',
      x: startX,
      y: 635,
      scaleX: 0.88,
      scaleY: 0.88,
      rotationDeg: 0,
      opacity: 0.68,
      visible: true,
      zIndex: 1,
      locked: false,
      flipX: index === 1,
    };
    return {
      id: shotId,
      name: `Shot ${index + 1}`,
      durationMs: 1_500,
      defaultSubtitleStyleId: SUBTITLE_ID,
      dialogues: [{
        id: dialogueId,
        characterId: CHARACTER_ID,
        voiceProfileId: VOICE_ID,
        audioClipId,
        subtitleStyleId: SUBTITLE_ID,
        startMs: 180,
        endMs: 1_380,
        text: ['The camera follows me.', 'The face changes here.', 'The final shot holds.'][index],
      }],
      audioClips: [{
        id: audioClipId,
        name: `Dialogue ${index + 1}`,
        assetId: ASSET_IDS.dialogue,
        startMs: 180,
        endMs: 1_380,
        offsetMs: index * 1_200,
        volume: 0.72,
        role: 'dialogue',
      }],
      timelineEvents: [
        {
          id: eventStart,
          type: 'move',
          layerId: characterLayerId,
          startMs: 0,
          endMs: 1_500,
          from: { x: startX, y: 635 },
          to: { x: endX, y: 610 + index * 12 },
          easing: 'linear',
        },
        {
          id: `84890000-0000-4000-8001-${suffix}`,
          type: 'opacity',
          layerId: characterLayerId,
          startMs: 0,
          endMs: 1_500,
          from: 0.68,
          to: index === 2 ? 0.82 : 1,
          easing: 'linear',
        },
        {
          id: `84890000-0000-4000-8002-${suffix}`,
          type: 'expression',
          layerId: characterLayerId,
          startMs: 620,
          endMs: 1_500,
          expressionId,
        },
      ],
      layers: [baseBackground, baseCharacter],
      backgroundLayerId,
    };
  });

  return ProjectSchema.parse({
    schemaVersion: 8,
    id: PROJECT_ID,
    name: 'Issue 849 O2 PNG comparison sample',
    width: 1_920,
    height: 1_080,
    fps: 24,
    assets: [
      {
        id: ASSET_IDS.background,
        kind: 'image',
        name: 'Gradient scene background',
        relativePath: 'assets/background.png',
        mimeType: 'image/png',
        width: 1_920,
        height: 1_080,
        sha256: assetHashes.background,
      },
      {
        id: ASSET_IDS.body,
        kind: 'image',
        name: 'Character body',
        relativePath: 'assets/character-body.png',
        mimeType: 'image/png',
        width: 640,
        height: 640,
        sha256: assetHashes.body,
      },
      {
        id: ASSET_IDS.faceNormal,
        kind: 'image',
        name: 'Normal expression',
        relativePath: 'assets/face-normal.png',
        mimeType: 'image/png',
        width: 640,
        height: 640,
        sha256: assetHashes.faceNormal,
      },
      {
        id: ASSET_IDS.faceAngry,
        kind: 'image',
        name: 'Angry expression',
        relativePath: 'assets/face-angry.png',
        mimeType: 'image/png',
        width: 640,
        height: 640,
        sha256: assetHashes.faceAngry,
      },
      {
        id: ASSET_IDS.mouthOpen,
        kind: 'image',
        name: 'Open mouth face',
        relativePath: 'assets/face-mouth-open.png',
        mimeType: 'image/png',
        width: 640,
        height: 640,
        sha256: assetHashes.mouthOpen,
      },
      {
        id: ASSET_IDS.dialogue,
        kind: 'audio',
        name: 'Synthetic dialogue tone',
        relativePath: 'assets/dialogue.wav',
        mimeType: 'audio/wav',
        durationMs: 4_500,
        sha256: assetHashes.dialogue,
      },
    ],
    characters: [{
      id: CHARACTER_ID,
      mode: 'composite',
      name: 'Speaking composite character',
      baseAssetId: ASSET_IDS.faceNormal,
      defaultVoiceProfileId: VOICE_ID,
      expressions: [
        { id: EXPRESSION_IDS.normal, name: 'Normal', assetId: ASSET_IDS.faceNormal },
        { id: EXPRESSION_IDS.angry, name: 'Angry', assetId: ASSET_IDS.faceAngry },
      ],
      defaultExpressionId: EXPRESSION_IDS.normal,
      mouthOpenAssetId: ASSET_IDS.mouthOpen,
      defaultScale: 1,
      defaultFlipX: false,
      bodyAssetId: ASSET_IDS.body,
      facePlacement: { offsetX: 0, offsetY: -145, scale: 0.68 },
    }],
    voiceProfiles: [{
      id: VOICE_ID,
      name: 'Comparison voice',
      characterId: CHARACTER_ID,
      locale: 'en-US',
      rate: 1,
      pitch: 0,
    }],
    subtitleStyles: [{
      id: SUBTITLE_ID,
      name: 'Arial comparison subtitles',
      fontFamily: 'Arial',
      fontSize: 48,
      textColor: '#ffffff',
      backgroundColor: '#08152288',
      position: 'bottom',
      align: 'center',
      maxWidth: 1_600,
    }],
    shots,
    createdAt: '2026-10-25T00:00:00.000Z',
    updatedAt: '2026-10-25T00:00:00.000Z',
  });
}

async function main() {
  const fixtureRoot = path.resolve(
    process.argv[2] || process.env.PANDA_STAGE_O2_FIXTURE_ROOT ||
      'D:\\PandaStage-Acceptance\\issue849-o2',
  );
  const projectRoot = path.join(fixtureRoot, 'project');
  try {
    await fs.access(projectRoot);
    throw new Error(`Refusing to overwrite existing Issue #849 fixture: ${projectRoot}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await fs.mkdir(path.join(projectRoot, 'assets'), { recursive: true });
  const assets = {
    background: createPng(1_920, 1_080, backgroundPixel),
    body: createPng(640, 640, bodyPixel),
    faceNormal: createPng(640, 640, facePixel('normal')),
    faceAngry: createPng(640, 640, facePixel('angry')),
    mouthOpen: createPng(640, 640, facePixel('mouth-open')),
    dialogue: createDialogueWav(),
  };
  const relativePaths = {
    background: 'assets/background.png',
    body: 'assets/character-body.png',
    faceNormal: 'assets/face-normal.png',
    faceAngry: 'assets/face-angry.png',
    mouthOpen: 'assets/face-mouth-open.png',
    dialogue: 'assets/dialogue.wav',
  };
  const assetHashes = Object.fromEntries(
    Object.entries(assets).map(([key, bytes]) => [key, sha256(bytes)]),
  );
  for (const [key, bytes] of Object.entries(assets)) {
    await fs.writeFile(path.join(projectRoot, relativePaths[key]), bytes, { flag: 'wx' });
  }
  const project = buildProject(assetHashes);
  const projectBytes = Buffer.from(JSON.stringify(project, null, 2) + '\n', 'utf8');
  await fs.writeFile(path.join(projectRoot, 'project.json'), projectBytes, { flag: 'wx' });
  const manifest = {
    issue: 849,
    sample: {
      shotCount: project.shots.length,
      durationMs: project.shots.reduce((total, shot) => total + shot.durationMs, 0),
      fps: project.fps,
      width: project.width,
      height: project.height,
      expectedFrames: 108,
      cameraMode: 'speaker-focus',
      characterMode: 'composite',
      includes: ['character movement', 'opacity changes', 'face expressions', 'mouth cycles', 'subtitles', 'shot boundaries', 'speaker-focus camera', 'dialogue audio'],
    },
    projectSha256: sha256(projectBytes),
    assets: Object.fromEntries(
      Object.entries(assets).map(([key, bytes]) => [
        key,
        { relativePath: relativePaths[key], byteLength: bytes.length, sha256: sha256(bytes) },
      ]),
    ),
  };
  await fs.writeFile(
    path.join(fixtureRoot, 'fixture-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    { flag: 'wx' },
  );
  process.stdout.write(JSON.stringify({ fixtureRoot, projectRoot, manifest }, null, 2) + '\n');
}

main().catch((error) => {
  process.stderr.write((error?.stack || String(error)) + '\n');
  process.exitCode = 1;
});

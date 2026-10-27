const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { deflateSync } = require('node:zlib');
const { PROJECT_SCHEMA_VERSION } = require('../dist-electron/domain/constants.js');
const { ProjectSchema } = require('../dist-electron/domain/models/project.js');

const rootDirectory = path.resolve(
  process.env.PANDA_STAGE_ISSUE867_ROOT ?? 'D:\\PandaStage-Acceptance\\issue867-thm01',
);
const runName = `run-${new Date().toISOString().replace(/[:.]/gu, '-')}-${process.pid}`;
const runDirectory = path.join(rootDirectory, runName);
const projectRoot = path.join(runDirectory, 'Issue 867 diagonal dialogue.pandastage');
const assetsDirectory = path.join(projectRoot, 'assets');

const IDS = {
  project: '00000000-0000-4000-8000-000000008671',
  background: '10000000-0000-4000-8000-000000008671',
  body: '10000000-0000-4000-8000-000000008672',
  head: '10000000-0000-4000-8000-000000008673',
  face: '10000000-0000-4000-8000-000000008674',
  mouth: '10000000-0000-4000-8000-000000008675',
  audio: '10000000-0000-4000-8000-000000008676',
  character: '20000000-0000-4000-8000-000000008671',
  expression: '20000000-0000-4000-8000-000000008672',
  voice: '30000000-0000-4000-8000-000000008671',
  subtitle: '40000000-0000-4000-8000-000000008671',
  shot: '50000000-0000-4000-8000-000000008671',
  backgroundLayer: '60000000-0000-4000-8000-000000008671',
  characterLayer: '60000000-0000-4000-8000-000000008672',
  dialogue: '80000000-0000-4000-8000-000000008671',
  audioClip: '70000000-0000-4000-8000-000000008671',
};

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBytes.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, 8 + data.length)), 8 + data.length);
  return result;
}

function color(hex) {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16)).concat(255);
}

function createSurface(width, height, background = [0, 0, 0, 0]) {
  const pixels = Buffer.alloc(width * height * 4);
  if (background[3] > 0) {
    for (let offset = 0; offset < pixels.length; offset += 4) {
      pixels[offset] = background[0];
      pixels[offset + 1] = background[1];
      pixels[offset + 2] = background[2];
      pixels[offset + 3] = background[3];
    }
  }

  function paint(x, y, rgba, coverage = 1) {
    if (x < 0 || y < 0 || x >= width || y >= height || coverage <= 0) return;
    const offset = (Math.floor(y) * width + Math.floor(x)) * 4;
    const sourceAlpha = (rgba[3] / 255) * Math.min(1, coverage);
    const targetAlpha = pixels[offset + 3] / 255;
    const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
    if (outputAlpha <= 0) return;
    for (let channel = 0; channel < 3; channel += 1) {
      pixels[offset + channel] = Math.round(
        (rgba[channel] * sourceAlpha + pixels[offset + channel] * targetAlpha * (1 - sourceAlpha)) /
          outputAlpha,
      );
    }
    pixels[offset + 3] = Math.round(outputAlpha * 255);
  }

  function rect(left, top, rectWidth, rectHeight, fill) {
    const bounds = [
      Math.max(0, Math.floor(left)),
      Math.max(0, Math.floor(top)),
      Math.min(width, Math.ceil(left + rectWidth)),
      Math.min(height, Math.ceil(top + rectHeight)),
    ];
    for (let y = bounds[1]; y < bounds[3]; y += 1) {
      for (let x = bounds[0]; x < bounds[2]; x += 1) paint(x, y, fill);
    }
  }

  function ellipse(cx, cy, rx, ry, fill) {
    const left = Math.max(0, Math.floor(cx - rx - 1));
    const top = Math.max(0, Math.floor(cy - ry - 1));
    const right = Math.min(width, Math.ceil(cx + rx + 1));
    const bottom = Math.min(height, Math.ceil(cy + ry + 1));
    const edgeScale = Math.min(rx, ry);
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const distance = Math.sqrt(((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2);
        paint(x, y, fill, Math.max(0, Math.min(1, (1 - distance) * edgeScale + 0.5)));
      }
    }
  }

  function line(x1, y1, x2, y2, thickness, fill) {
    const radius = thickness / 2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    const left = Math.max(0, Math.floor(Math.min(x1, x2) - radius - 1));
    const top = Math.max(0, Math.floor(Math.min(y1, y2) - radius - 1));
    const right = Math.min(width, Math.ceil(Math.max(x1, x2) + radius + 1));
    const bottom = Math.min(height, Math.ceil(Math.max(y1, y2) + radius + 1));
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const amount = lengthSquared === 0
          ? 0
          : Math.max(0, Math.min(1, ((x + 0.5 - x1) * dx + (y + 0.5 - y1) * dy) / lengthSquared));
        const nearestX = x1 + amount * dx;
        const nearestY = y1 + amount * dy;
        const distance = Math.hypot(x + 0.5 - nearestX, y + 0.5 - nearestY);
        paint(x, y, fill, Math.max(0, Math.min(1, radius + 0.5 - distance)));
      }
    }
  }

  function encode() {
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
      pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
      pngChunk('IEND', Buffer.alloc(0)),
    ]);
  }

  return { rect, ellipse, line, paint, encode, pixels };
}

function backgroundPng() {
  const surface = createSurface(1_920, 1_080);
  for (let y = 0; y < 1_080; y += 1) {
    const amount = y / 1_079;
    const top = [235, 246, 255];
    const bottom = [255, 239, 220];
    const fill = top.map((channel, index) => Math.round(channel + (bottom[index] - channel) * amount)).concat(255);
    surface.rect(0, y, 1_920, 1, fill);
  }
  surface.ellipse(1_550, 180, 92, 92, color('#ffd887'));
  surface.ellipse(1_710, 920, 420, 180, color('#9fbea9'));
  surface.rect(0, 920, 1_920, 160, color('#9fbea9'));
  surface.line(0, 920, 1_920, 920, 5, color('#739b83'));
  return surface.encode();
}

function bodyPng() {
  const surface = createSurface(640, 800);
  const coat = color('#397f82');
  const dark = color('#235e68');
  const light = color('#e7f3e6');
  surface.rect(260, 10, 120, 230, color('#dfa46a'));
  surface.ellipse(150, 230, 160, 170, coat);
  surface.ellipse(490, 230, 160, 170, coat);
  surface.ellipse(320, 420, 270, 360, coat);
  surface.ellipse(320, 440, 125, 295, light);
  surface.ellipse(320, 170, 140, 115, dark);
  surface.line(200, 300, 320, 390, 18, dark);
  surface.line(440, 300, 320, 390, 18, dark);
  surface.ellipse(320, 640, 170, 95, color('#2a6d75'));
  return surface.encode();
}

function headPng() {
  const surface = createSurface(500, 540);
  surface.ellipse(94, 186, 78, 92, color('#ba8853'));
  surface.ellipse(406, 186, 78, 92, color('#ba8853'));
  surface.ellipse(250, 270, 220, 242, color('#e8b96e'));
  surface.ellipse(250, 116, 182, 84, color('#395d63'));
  surface.ellipse(95, 206, 28, 42, color('#e8b96e'));
  surface.ellipse(405, 206, 28, 42, color('#e8b96e'));
  surface.rect(196, 460, 108, 80, color('#dba461'));
  surface.ellipse(250, 424, 82, 34, color('#dba461'));
  return surface.encode();
}

function facePng(mouthOpen) {
  const surface = createSurface(360, 280);
  const ink = color('#29434a');
  const cream = color('#fff7e8');
  surface.line(66, 84, 128, 68, 13, ink);
  surface.line(232, 68, 294, 84, 13, ink);
  surface.ellipse(100, 119, 17, 21, ink);
  surface.ellipse(260, 119, 17, 21, ink);
  surface.ellipse(105, 113, 5, 6, cream);
  surface.ellipse(265, 113, 5, 6, cream);
  if (mouthOpen) {
    surface.ellipse(180, 208, 26, 36, ink);
    surface.ellipse(180, 192, 12, 6, cream);
  } else {
    surface.line(142, 204, 180, 218, 7, ink);
    surface.line(180, 218, 218, 204, 7, ink);
  }
  return surface.encode();
}

function dialogueWav() {
  const durationMs = 2_400;
  const sampleRate = 48_000;
  const sampleCount = Math.round((sampleRate * durationMs) / 1_000);
  const pcm = Buffer.alloc(sampleCount * 2);
  const syllables = [
    [80, 300, 250], [380, 600, 320], [690, 910, 220],
    [1_010, 1_230, 285], [1_330, 1_550, 205], [1_650, 1_870, 300],
    [1_970, 2_180, 240],
  ];
  for (let index = 0; index < sampleCount; index += 1) {
    const timeMs = (index * 1_000) / sampleRate;
    const syllable = syllables.find(([start, end]) => timeMs >= start && timeMs < end);
    let sample = 0;
    if (syllable) {
      const [start, end, frequency] = syllable;
      const edge = Math.min((timeMs - start) / 36, (end - timeMs) / 42, 1);
      const envelope = Math.max(0, edge) ** 0.7;
      const phase = (2 * Math.PI * frequency * index) / sampleRate;
      const voiceLikeTone = Math.sin(phase) * 0.7 + Math.sin(phase * 2.01) * 0.22 + Math.sin(phase * 3.02) * 0.08;
      sample = Math.round(0.22 * envelope * voiceLikeTone * 32_767);
    }
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

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function buildProject(assetRows) {
  const now = new Date().toISOString();
  const imageAsset = (id, name, relativePath, width, height, bytes) => ({
    id,
    kind: 'image',
    name,
    relativePath,
    mimeType: 'image/png',
    sha256: sha256(bytes),
    width,
    height,
    usage: 'uncategorized',
    keywords: [],
  });
  const audioAsset = {
    id: IDS.audio,
    kind: 'audio',
    name: 'Procedural dialogue timing track',
    relativePath: 'assets/dialogue-timing.wav',
    mimeType: 'audio/wav',
    sha256: sha256(assetRows.get('assets/dialogue-timing.wav')),
    durationMs: 2_400,
  };
  const project = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: IDS.project,
    name: 'Issue 867 — Diagonal dialogue motion',
    width: 1_920,
    height: 1_080,
    fps: 24,
    assets: [
      imageAsset(IDS.background, 'Pastel landscape', 'assets/background.png', 1_920, 1_080, assetRows.get('assets/background.png')),
      imageAsset(IDS.body, 'Sprout body', 'assets/sprout-body.png', 640, 800, assetRows.get('assets/sprout-body.png')),
      imageAsset(IDS.head, 'Sprout head', 'assets/sprout-head.png', 500, 540, assetRows.get('assets/sprout-head.png')),
      imageAsset(IDS.face, 'Sprout neutral face', 'assets/sprout-face.png', 360, 280, assetRows.get('assets/sprout-face.png')),
      imageAsset(IDS.mouth, 'Sprout open mouth', 'assets/sprout-mouth-open.png', 360, 280, assetRows.get('assets/sprout-mouth-open.png')),
      audioAsset,
    ],
    animations: [],
    characters: [
      {
        id: IDS.character,
        mode: 'composite',
        name: '小芽',
        baseAssetId: IDS.face,
        defaultVoiceProfileId: IDS.voice,
        expressions: [{ id: IDS.expression, name: '微笑', assetId: IDS.face }],
        defaultExpressionId: IDS.expression,
        mouthOpenAssetId: IDS.mouth,
        defaultScale: 1,
        defaultFlipX: false,
        bodyAssetId: IDS.body,
        bodyPlacement: { offsetX: 0, offsetY: 190, scale: 1 },
        facePlacement: { offsetX: 0, offsetY: -280, scale: 1 },
        head: {
          assetId: IDS.head,
          placement: { offsetX: 0, offsetY: -280, scale: 1, rotationDeg: 0, flipX: false },
          pivot: { x: 0, y: -280 },
        },
        talkingHeadMotionIntensityPercent: 100,
      },
    ],
    voiceProfiles: [
      { id: IDS.voice, name: '原创示例音轨', characterId: IDS.character, locale: 'zh-CN', rate: 1, pitch: 0 },
    ],
    subtitleStyles: [
      {
        id: IDS.subtitle,
        name: 'Bottom subtitle',
        fontFamily: 'Microsoft YaHei',
        fontSize: 48,
        textColor: '#fffdf6',
        backgroundColor: '#152a2ccc',
        position: 'bottom',
        align: 'center',
        maxWidth: 1_520,
      },
    ],
    shots: [
      {
        id: IDS.shot,
        name: 'Diagonal dialogue',
        durationMs: 3_200,
        defaultSubtitleStyleId: IDS.subtitle,
        dialogues: [
          {
            id: IDS.dialogue,
            characterId: IDS.character,
            voiceProfileId: IDS.voice,
            audioClipId: IDS.audioClip,
            subtitleStyleId: IDS.subtitle,
            startMs: 300,
            endMs: 2_700,
            text: '你好，今天我们来试试斜向往复吧。',
          },
        ],
        audioClips: [
          {
            id: IDS.audioClip,
            role: 'dialogue',
            name: 'Original procedural dialogue timing track',
            assetId: IDS.audio,
            startMs: 300,
            endMs: 2_700,
            offsetMs: 0,
            volume: 0.45,
          },
        ],
        timelineEvents: [],
        backgroundLayerId: IDS.backgroundLayer,
        layers: [
          {
            id: IDS.backgroundLayer,
            name: 'Pastel landscape',
            source: { kind: 'asset', assetId: IDS.background },
            anchor: 'center', x: 960, y: 540, scaleX: 1, scaleY: 1,
            rotationDeg: 0, opacity: 1, visible: true, zIndex: 0, locked: true, flipX: false,
          },
          {
            id: IDS.characterLayer,
            name: '小芽',
            source: { kind: 'character', characterId: IDS.character, expressionId: IDS.expression },
            anchor: 'center', x: 960, y: 660, scaleX: 0.9, scaleY: 0.9,
            rotationDeg: 0, opacity: 1, visible: true, zIndex: 1, locked: false, flipX: false,
          },
        ],
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  return ProjectSchema.parse(project);
}

async function main() {
  await fs.mkdir(assetsDirectory, { recursive: true });
  const assets = new Map([
    ['assets/background.png', backgroundPng()],
    ['assets/sprout-body.png', bodyPng()],
    ['assets/sprout-head.png', headPng()],
    ['assets/sprout-face.png', facePng(false)],
    ['assets/sprout-mouth-open.png', facePng(true)],
    ['assets/dialogue-timing.wav', dialogueWav()],
  ]);
  for (const [relativePath, bytes] of assets) {
    await fs.writeFile(path.join(projectRoot, relativePath), bytes, { flag: 'wx' });
  }

  const project = buildProject(assets);
  const projectBytes = Buffer.from(`${JSON.stringify(project, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(projectRoot, 'project.json'), projectBytes, { flag: 'wx' });
  const manifest = {
    issue: 867,
    createdAt: new Date().toISOString(),
    projectPath: projectRoot,
    projectSha256: sha256(projectBytes),
    dialogue: project.shots[0].dialogues[0],
    media: [...assets].map(([relativePath, bytes]) => ({
      relativePath,
      sha256: sha256(bytes),
      byteLength: bytes.length,
      attribution: 'Generated in-repository for Issue #867; no third-party media.',
    })),
    review: 'Automated fixture generation only; Windows Electron visual PASS/FAIL remains for the owner.',
  };
  const manifestPath = path.join(runDirectory, 'sample-manifest.json');
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ projectPath: projectRoot, manifestPath, projectSha256: manifest.projectSha256 }, null, 2));
}

main().catch((error) => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});

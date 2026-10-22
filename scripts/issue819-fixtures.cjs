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

async function generateIssue819Fixture(baseDirectory) {
  const runRoot = path.join(
    path.resolve(baseDirectory),
    `run-${new Date().toISOString().replace(/[:.]/gu, '-')}-${process.pid}`,
  );
  const projectRoot = path.join(runRoot, 'Panda Stage formal export');
  const evidenceRoot = path.join(runRoot, 'evidence');
  await fsp.mkdir(path.join(projectRoot, 'assets'), { recursive: true });
  await fsp.mkdir(evidenceRoot, { recursive: true });

  const legacyProject = JSON.parse(await fsp.readFile(demoProjectPath, 'utf8'));
  const project = migrateProject(legacyProject);
  project.id = randomUUID();
  project.name = 'Panda Stage formal export';
  project.shots = project.shots.slice(0, 1);
  const shot = project.shots[0];
  if (!shot) throw new Error('The demo Project has no Shot for the Issue #819 fixture.');

  shot.durationMs = 6_501;
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
        ? { ...event, startMs: 4_000, endMs: 4_000 }
        : event,
  );

  const projectAssets = [...project.assets];
  project.assets = [];
  for (const asset of projectAssets) {
    if (asset.kind === 'audio') {
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

  const validated = ProjectSchema.parse(project);
  if (validated.shots.length !== 1 || validated.shots[0]?.audioClips.length !== 0) {
    throw new Error('Issue #819 fixture must contain one silent Shot.');
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
    expressionAssetHashes: Object.fromEntries(
      validated.assets
        .filter((asset) => asset.relativePath.endsWith('panda-neutral.png') || asset.relativePath.endsWith('panda-happy.png'))
        .map((asset) => [asset.relativePath, asset.sha256]),
    ),
  };
}

module.exports = { generateIssue819Fixture };

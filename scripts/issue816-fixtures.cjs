const crypto = require('node:crypto');
const fs = require('node:fs');
const { createReadStream } = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { collectExportPreparationMedia, evaluateExportPreparationBudget } = require('../dist-electron/domain/export-preparation.js');
const { migrateProject } = require('../dist-electron/domain/migrations/index.js');
const { ProjectSchema } = require('../dist-electron/domain/models/project.js');

const MAX_SINGLE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const PNG_PATH = path.join(__dirname, '..', 'public', 'probe', 'panda-character.png');
const CRC_TABLE = new Uint32Array(256);

for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  CRC_TABLE[index] = crc >>> 0;
}

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const digest = crypto.createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(digest.digest('hex')));
  });
}

function updateCrc(crc, bytes) {
  let value = crc;
  for (const byte of bytes) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return value >>> 0;
}

function pngParts(pngBytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!pngBytes.subarray(0, 8).equals(signature)) {
    throw new Error('Probe fixture is not a PNG image.');
  }
  let offset = 8;
  while (offset + 12 <= pngBytes.length) {
    const length = pngBytes.readUInt32BE(offset);
    const type = pngBytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'IEND') {
      return {
        prefix: pngBytes.subarray(0, offset),
        suffix: pngBytes.subarray(offset),
      };
    }
    offset += length + 12;
  }
  throw new Error('Probe fixture PNG has no IEND chunk.');
}

function writeFully(fd, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    offset += fs.writeSync(fd, bytes, offset, bytes.length - offset);
  }
}

function writeLargePng(filePath, targetSize, pngBytes) {
  const { prefix, suffix } = pngParts(pngBytes);
  const textPrefix = Buffer.from('Comment\0\0\0\0\0', 'ascii');
  const chunkLength = targetSize - prefix.length - 12 - suffix.length;
  const textLength = chunkLength - textPrefix.length;
  if (textLength <= 0 || chunkLength > 0xffffffff) {
    throw new Error('Requested budget PNG size cannot be represented.');
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const fd = fs.openSync(filePath, 'w');
  const typeBytes = Buffer.from('iTXt', 'ascii');
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.writeUInt32BE(chunkLength, 0);
  typeBytes.copy(chunkHeader, 4);
  const checksum = Buffer.alloc(4);
  const textChunkBytes = Buffer.alloc(1024 * 1024, 0x20);
  let crc = updateCrc(0xffffffff, typeBytes);
  try {
    writeFully(fd, prefix);
    writeFully(fd, chunkHeader);
    writeFully(fd, textPrefix);
    crc = updateCrc(crc, textPrefix);
    let remaining = textLength;
    while (remaining > 0) {
      const count = Math.min(remaining, textChunkBytes.length);
      const bytes = count === textChunkBytes.length
        ? textChunkBytes
        : textChunkBytes.subarray(0, count);
      writeFully(fd, bytes);
      crc = updateCrc(crc, bytes);
      remaining -= count;
    }
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
    writeFully(fd, checksum);
    writeFully(fd, suffix);
  } finally {
    fs.closeSync(fd);
  }
  const stats = fs.statSync(filePath);
  if (stats.size !== targetSize) {
    throw new Error(`Budget fixture size mismatch: ${stats.size} !== ${targetSize}`);
  }
  return filePath;
}

function baseProject(pngBytes) {
  const project = migrateProject(
    JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'demo-project', 'project-v1.example.json'), 'utf8')),
  );
  project.name = 'DL-01 正式导出候选 01';
  project.shots = [project.shots[0]];
  if (!project.shots[0]) throw new Error('Demo project has no first shot.');
  const shot = project.shots[0];
  shot.durationMs = Math.max(1_000, shot.durationMs);
  shot.audioClips = [];
  shot.dialogues = shot.dialogues.map((dialogue) => {
    const textOnlyDialogue = { ...dialogue };
    delete textOnlyDialogue.audioClipId;
    return textOnlyDialogue;
  });
  project.assets = project.assets.filter((asset) => asset.kind === 'image');
  if (project.assets.length === 0) throw new Error('Demo project has no image assets.');
  for (const [index, asset] of project.assets.entries()) {
    asset.relativePath = `assets/f01-${String(index + 1).padStart(2, '0')}-${asset.id}.png`;
    asset.mimeType = 'image/png';
    asset.width = pngBytes.readUInt32BE(16);
    asset.height = pngBytes.readUInt32BE(20);
    asset.sha256 = hash(pngBytes);
  }
  const background = shot.layers.find((layer) =>
    layer.visible &&
    layer.source.kind === 'asset' &&
    project.assets.some((asset) => asset.id === layer.source.assetId),
  );
  if (!background) throw new Error('Demo project has no usable background layer.');
  shot.backgroundLayerId = background.id;
  const fixture = ProjectSchema.parse(project);
  return fixture;
}

function addExpressionsForUniqueImages(projectInput, count, pngBytes, label) {
  const project = structuredClone(projectInput);
  const shot = project.shots[0];
  const characterLayer = shot?.layers.find((layer) => layer.source.kind === 'character');
  if (!shot || !characterLayer || characterLayer.source.kind !== 'character') {
    throw new Error('Fixture project needs a character layer for expression assets.');
  }
  const character = project.characters.find((item) => item.id === characterLayer.source.characterId);
  if (!character) throw new Error('Fixture character reference is missing.');
  for (let index = 1; index <= count; index += 1) {
    const suffix = String(index).padStart(12, '0');
    const assetId = `80000000-0000-4000-8000-${suffix}`;
    const expressionId = `81000000-0000-4000-8000-${suffix}`;
    project.assets.push({
      id: assetId,
      kind: 'image',
      name: `${label}表情${index}`,
      relativePath: `assets/${assetId}.png`,
      mimeType: 'image/png',
      width: pngBytes.readUInt32BE(16),
      height: pngBytes.readUInt32BE(20),
      sha256: hash(pngBytes),
    });
    character.expressions.push({
      id: expressionId,
      name: `${label}表情${index}`,
      assetId,
    });
  }
  return ProjectSchema.parse(project);
}

async function writeProjectBundle(projectInput, projectRoot, options = {}) {
  const rawProject = structuredClone(projectInput);
  await fsp.mkdir(path.join(projectRoot, 'assets'), { recursive: true });
  for (const asset of rawProject.assets) {
    if (asset.kind !== 'image') continue;
    const target = path.join(projectRoot, asset.relativePath);
    const targetSize = options.sizes?.get(asset.id);
    const hardLinkFrom = options.hardLinkRoot
      ? path.join(options.hardLinkRoot, asset.relativePath)
      : null;
    if (hardLinkFrom && fs.existsSync(hardLinkFrom)) {
      try {
        await fsp.link(hardLinkFrom, target);
      } catch {
        await fsp.copyFile(hardLinkFrom, target);
      }
    } else if (targetSize && targetSize > options.pngBytes.length) {
      writeLargePng(target, targetSize, options.pngBytes);
    } else {
      await fsp.writeFile(target, options.smallBytes ?? options.pngBytes);
    }
    const info = await fsp.stat(target);
    if (targetSize && info.size !== targetSize) {
      throw new Error(`Fixture budget size mismatch for ${asset.id}: ${info.size} !== ${targetSize}`);
    }
    asset.sha256 = await hashFile(target);
    asset.width = options.pngBytes.readUInt32BE(16);
    asset.height = options.pngBytes.readUInt32BE(20);
  }
  const project = ProjectSchema.parse(rawProject);
  await fsp.writeFile(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2), 'utf8');
  return project;
}

async function budgetEvidence(project, projectRoot, label) {
  const entries = [];
  for (const entry of collectExportPreparationMedia(project)) {
    const sourcePath = path.join(projectRoot, entry.asset.relativePath);
    const details = await fsp.stat(sourcePath);
    entries.push({ byteLength: details.size, location: entry.usages[0] ?? entry.asset.name });
  }
  const result = evaluateExportPreparationBudget(entries);
  return {
    label,
    measuredAt: new Date().toISOString(),
    projectId: project.id,
    actualAssetSizes: entries,
    actualTotalBytes: entries.reduce((total, item) => total + item.byteLength, 0),
    limits: { maximumSingleAssetBytes: MAX_SINGLE_BYTES, maximumTotalMediaBytes: MAX_TOTAL_BYTES },
    evaluatedTotalBytes: result.totalBytes,
    issueCodes: result.issues.map((item) => item.code),
  };
}

async function generateIssue816Fixtures(baseDirectory) {
  const pngBytes = fs.readFileSync(PNG_PATH);
  const root = path.join(baseDirectory, `run-${new Date().toISOString().replace(/[:.]/gu, '-')}-${process.pid}`);
  await fsp.mkdir(root, { recursive: true });
  const base = baseProject(pngBytes);
  const f01Root = path.join(root, 'F01', 'project.pandastage');
  const f01Project = await writeProjectBundle(base, f01Root, { pngBytes });
  const requiredMedia = collectExportPreparationMedia(f01Project);
  if (requiredMedia.length === 0) throw new Error('F01 must contain required image media.');
  const firstShot = f01Project.shots[0];
  const backgroundLayer = firstShot?.layers.find((layer) => layer.id === firstShot.backgroundLayerId);
  const backgroundAsset = backgroundLayer?.source.kind === 'asset'
    ? f01Project.assets.find((asset) => asset.id === backgroundLayer.source.assetId)
    : null;
  const expressionAsset = f01Project.assets.find((asset) =>
    asset.id !== backgroundAsset?.id &&
    f01Project.characters.some((character) => character.expressions.some(
      (expression) => expression.id !== character.defaultExpressionId && expression.assetId === asset.id,
    )),
  );
  if (!backgroundAsset) throw new Error('F01 must contain a required background image.');
  if (!expressionAsset) throw new Error('F01 must contain an actual character expression image.');

  const f05Cases = {};
  for (const name of ['missing', 'missingExpression', 'corrupt', 'replaced']) {
    const projectRoot = path.join(root, 'F05', name, 'project.pandastage');
    const project = await writeProjectBundle(base, projectRoot, { pngBytes });
    const selectedAssetId = name === 'missing' ? backgroundAsset.id : expressionAsset.id;
    const selectedAsset = project.assets.find((asset) => asset.id === selectedAssetId);
    const usage = requiredMedia.find((entry) => entry.asset.id === selectedAssetId)?.usages[0];
    if (!selectedAsset || !usage) throw new Error(`F05 ${name} fixture media is not used by the shot.`);
    f05Cases[name] = {
      projectRoot,
      projectId: project.id,
      assetId: selectedAsset.id,
      expectedLocation: usage,
    };
    if (name === 'missing' || name === 'missingExpression') {
      await fsp.rm(path.join(projectRoot, selectedAsset.relativePath));
    }
    if (name === 'corrupt') {
      await fsp.writeFile(path.join(projectRoot, selectedAsset.relativePath), Buffer.from('broken media copy'));
    }
  }
  const invalidReferenceRoot = path.join(root, 'F05', 'invalid-reference', 'project.pandastage');
  const invalidReferenceProject = await writeProjectBundle(base, invalidReferenceRoot, { pngBytes });
  const invalidReferenceLayer = invalidReferenceProject.shots[0]?.layers.find((layer) => layer.source.kind === 'character');
  if (!invalidReferenceLayer || invalidReferenceLayer.source.kind !== 'character') {
    throw new Error('F05 invalid-reference fixture needs a character layer.');
  }
  invalidReferenceLayer.name = 'F05 invalid character layer';
  invalidReferenceLayer.source.characterId = '20000000-0000-4000-8000-000000000099';
  await fsp.writeFile(
    path.join(invalidReferenceRoot, 'project.json'),
    JSON.stringify(invalidReferenceProject, null, 2),
    'utf8',
  );
  f05Cases.invalidReference = {
    projectRoot: invalidReferenceRoot,
    projectId: invalidReferenceProject.id,
    layerName: invalidReferenceLayer.name,
    expectedIssueCode: 'INVALID_PROJECT',
  };
  const outputConflictRoot = path.join(root, 'F05', 'output-conflict');
  await fsp.mkdir(outputConflictRoot, { recursive: true });
  const outputConflictPath = path.join(outputConflictRoot, 'existing-user-movie.mp4');
  const outputConflictInitialContent = 'OWNER EXISTING OUTPUT v1';
  const outputConflictInitialBytes = Buffer.from(outputConflictInitialContent, 'utf8');
  await fsp.writeFile(outputConflictPath, outputConflictInitialBytes);
  f05Cases.cancel = {
    projectRoot: f01Root,
    expectedResult: 'cancelled',
    expectedTaskCount: 0,
  };
  f05Cases.sessionMismatch = {
    projectRoot: f01Root,
    selectedOpenInstanceId: 3,
    requestOpenInstanceId: 3,
    currentOpenInstanceId: 4,
    expectedIssueCode: 'PROJECT_SESSION_CHANGED',
  };
  f05Cases.outputConflict = {
    projectRoot: f01Root,
    targetPath: outputConflictPath,
    initialContent: outputConflictInitialContent,
    initialSha256: hash(outputConflictInitialBytes),
    replacementSha256: null,
  };
  await fsp.writeFile(
    path.join(root, 'F05', 'fixtures.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), cases: f05Cases }, null, 2),
    'utf8',
  );

  const withinRoot = path.join(root, 'F06', 'within', 'project.pandastage');
  const withinProject = await writeProjectBundle(base, withinRoot, { pngBytes });
  const within = await budgetEvidence(withinProject, withinRoot, 'within');

  const baseImageCount = collectExportPreparationMedia(base).length;
  if (baseImageCount > 4) throw new Error(`F06 base fixture already uses ${baseImageCount} images.`);
  const boundaryProject = addExpressionsForUniqueImages(base, 4 - baseImageCount, pngBytes, '预算边界');
  const boundaryRoot = path.join(root, 'F06', 'boundary', 'project.pandastage');
  const boundarySizes = new Map(collectExportPreparationMedia(boundaryProject).map((entry) => [entry.asset.id, MAX_SINGLE_BYTES]));
  const boundary = await writeProjectBundle(boundaryProject, boundaryRoot, {
    pngBytes,
    sizes: boundarySizes,
  });
  const boundaryResult = await budgetEvidence(boundary, boundaryRoot, 'aggregate-boundary');

  const overProject = addExpressionsForUniqueImages(base, 5 - baseImageCount, pngBytes, '预算超限');
  const overRoot = path.join(root, 'F06', 'aggregate-over', 'project.pandastage');
  const overMedia = collectExportPreparationMedia(overProject);
  const overSizes = new Map(overMedia.slice(0, 4).map((entry) => [entry.asset.id, MAX_SINGLE_BYTES]));
  const over = await writeProjectBundle(overProject, overRoot, {
    pngBytes,
    sizes: overSizes,
    hardLinkRoot: boundaryRoot,
  });
  const overResult = await budgetEvidence(over, overRoot, 'aggregate-over');

  const singleOverProject = structuredClone(base);
  const singleOverRoot = path.join(root, 'F06', 'single-over', 'project.pandastage');
  const singleOverId = collectExportPreparationMedia(singleOverProject)[0].asset.id;
  const singleOverSizes = new Map([[singleOverId, MAX_SINGLE_BYTES + 1]]);
  const singleOver = await writeProjectBundle(singleOverProject, singleOverRoot, {
    pngBytes,
    sizes: singleOverSizes,
  });
  const singleOverResult = await budgetEvidence(singleOver, singleOverRoot, 'single-asset-over');

  const f06 = { generatedAt: new Date().toISOString(), within, boundary: boundaryResult, aggregateOver: overResult, singleOver: singleOverResult };
  await fsp.mkdir(path.join(root, 'F06'), { recursive: true });
  await fsp.writeFile(path.join(root, 'F06', 'budget-results.json'), JSON.stringify(f06, null, 2), 'utf8');

  const f01Summary = {
    generatedAt: new Date().toISOString(),
    projectRoot: f01Root,
    projectId: f01Project.id,
    projectSha256: hash(Buffer.from(JSON.stringify(f01Project))),
    imageBytes: pngBytes.length,
    mediaManifest: requiredMedia.map((entry) => ({
      assetId: entry.asset.id,
      kind: entry.asset.kind,
      sourceRelativePath: entry.asset.relativePath,
      sha256: entry.asset.sha256,
      byteLength: pngBytes.length,
      usages: entry.usages,
    })),
  };
  await fsp.writeFile(path.join(root, 'F01', 'fixture-summary.json'), JSON.stringify(f01Summary, null, 2), 'utf8');
  await fsp.writeFile(path.join(root, 'fixture-index.json'), JSON.stringify({ root, F01: f01Summary, F05: f05Cases, F06: f06 }, null, 2), 'utf8');
  return { root, f01Root, f01Project, f05Cases, f06 };
}

async function loadIssue816Fixtures(root) {
  const f01Root = path.join(root, 'F01', 'project.pandastage');
  const f01Project = ProjectSchema.parse(
    JSON.parse(await fsp.readFile(path.join(f01Root, 'project.json'), 'utf8')),
  );
  const f05 = JSON.parse(
    await fsp.readFile(path.join(root, 'F05', 'fixtures.json'), 'utf8'),
  );
  const f06 = JSON.parse(
    await fsp.readFile(path.join(root, 'F06', 'budget-results.json'), 'utf8'),
  );
  return { root, f01Root, f01Project, f05Cases: f05.cases, f06 };
}

module.exports = { generateIssue816Fixtures, loadIssue816Fixtures };

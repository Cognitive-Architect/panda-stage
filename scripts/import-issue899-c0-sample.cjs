'use strict';

// Local-only bridge for the Issue #893 C0 frame-0 sample; it is not a general FLA importer.
// Usage: pnpm build; pnpm exec electron scripts/import-issue899-c0-sample.cjs <isolated-layers-dir> [new-output-dir]
// Open the generated .pandastage project through Panda Stage's normal Project Center flow.

const { app, nativeImage } = require('electron');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const fsp = require('node:fs/promises');
const path = require('node:path');
const {
  CharacterService,
  DEFAULT_CHARACTER_PART_STATIC_ADJUSTMENT,
  LayerService,
  ProjectSchema,
  ShotService,
} = require('../dist-electron/domain/index.js');
const { AssetImportService } = require('../dist-electron/main/services/AssetImportService.js');
const { ProjectService } = require('../dist-electron/main/services/ProjectService.js');
const { resolveMediaToolPaths } = require('../dist-electron/main/services/production-resources.js');
const {
  bodyArmOverlayArgs,
  orderedBodyArmRecords,
} = require('./issue899-c0-body-arm-overlay.cjs');

const [, , sourceDirArgument, outputRootArgument] = process.argv;
const sourceDir = sourceDirArgument ? path.resolve(sourceDirArgument) : null;
const outputRoot = path.resolve(
  outputRootArgument || path.join(
    'D:\\PandaStage-Acceptance',
    'issue899-c3-local-bridge',
    `run-${new Date().toISOString().replace(/[:.]/gu, '-')}`,
  ),
);
const appDataPath = path.join(
  'D:\\PandaStage-Acceptance',
  'issue899-c3-local-bridge-appdata',
  `${process.pid}-${randomUUID()}`,
);
const projectRoot = path.join(outputRoot, 'projects', 'c0-adaptive-parts.pandastage');
const cropRoot = path.join(outputRoot, 'source-crops');
const sourceRootTransform = { a: 1, b: 0, c: 0, d: 1, tx: 790, ty: 47.6 };
const sourceRestTransform = { a: 1, b: 0, c: 0, d: 1, tx: -790, ty: -47.6 };
fs.mkdirSync(appDataPath, { recursive: true });
app.setPath('userData', appDataPath);
const sourceRecords = [
  { sourceId: 'c0/com6', sourceName: 'com6', fileName: 'layer-04-com6.png', drawOrder: 0 },
  { sourceId: 'c0/com2', sourceName: 'com2', fileName: 'layer-03-com2.png', drawOrder: 1 },
  { sourceId: 'c0/com5', sourceName: 'com5', fileName: 'layer-02-com5.png', drawOrder: 2 },
  { sourceId: 'c0/com4', sourceName: 'com4', fileName: 'layer-01-com4.png', drawOrder: 3 },
  { sourceId: 'c0/com3', sourceName: 'com3', fileName: 'layer-00-com3.png', drawOrder: 4 },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function alphaBounds(bitmap, width, height) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (bitmap[(y * width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  assert(right >= left && bottom >= top, 'A source image contains no opaque pixels.');
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

function runProcess(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(executable)} exited with code ${code} (${signal ?? 'no signal'}).`));
    });
  });
}

async function createSampleProject() {
  assert(sourceDir, 'Pass the private Issue #893 isolated-layer PNG directory as the first argument.');
  assert(path.resolve(sourceDir) !== path.resolve(outputRoot), 'The output root must be separate from the source directory.');
  await fsp.access(sourceDir);
  await fsp.mkdir(path.dirname(outputRoot), { recursive: true });
  try {
    await fsp.access(outputRoot);
    throw new Error(`Refusing to overwrite existing output directory: ${outputRoot}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await fsp.mkdir(outputRoot, { recursive: false });
  await fsp.mkdir(cropRoot, { recursive: true });

  const candidateRecords = [];
  for (const record of sourceRecords) {
    const sourcePath = path.join(sourceDir, record.fileName);
    const sourceImage = nativeImage.createFromPath(sourcePath);
    const size = sourceImage.getSize();
    assert(size.width === 1920 && size.height === 1080, `${record.fileName} must be a 1920x1080 C0 frame-0 PNG.`);
    const bounds = alphaBounds(sourceImage.toBitmap(), size.width, size.height);
    const cropPath = path.join(cropRoot, `${record.sourceName}-crop.png`);
    await fsp.writeFile(cropPath, sourceImage.crop(bounds).toPNG());
    candidateRecords.push({ ...record, sourcePath, cropPath, bounds });
  }

  const byName = new Map(candidateRecords.map((record) => [record.sourceName, record]));
  const [bodyRecord, armRecord] = orderedBodyArmRecords(byName);
  const bodyArmFullPath = path.join(cropRoot, 'c0-body-arm-com2-back-com5-front-full.png');
  const mediaTools = resolveMediaToolPaths({ isPackaged: false, resourcesPath: process.resourcesPath });
  await runProcess(mediaTools.ffmpegPath, bodyArmOverlayArgs(
    bodyRecord.sourcePath,
    armRecord.sourcePath,
    bodyArmFullPath,
  ));
  const bodyArmImage = nativeImage.createFromPath(bodyArmFullPath);
  const bodyArmSize = bodyArmImage.getSize();
  assert(bodyArmSize.width === 1920 && bodyArmSize.height === 1080, 'The local Body+Arm composite must retain the C0 stage frame.');
  const bodyArmBounds = alphaBounds(bodyArmImage.toBitmap(), bodyArmSize.width, bodyArmSize.height);
  const bodyArmCropPath = path.join(cropRoot, 'c0-body-arm-com2-back-com5-front-crop.png');
  await fsp.writeFile(bodyArmCropPath, bodyArmImage.crop(bodyArmBounds).toPNG());

  const backgroundPath = path.join(cropRoot, 'synthetic-canvas-background.png');
  const background = nativeImage.createFromBuffer(makeSolidPng(1920, 1080, [34, 42, 54, 255]));
  await fsp.writeFile(backgroundPath, background.toPNG());

  await fsp.mkdir(path.dirname(projectRoot), { recursive: true });
  const projectService = new ProjectService();
  const created = await projectService.create(projectRoot, { name: 'Issue 899 C0 Local Sample Bridge' });
  let importSnapshot = { project: created.project, revision: 0 };
  const importService = new AssetImportService({
    projectService,
    getCurrentProjectSnapshot: (root) =>
      path.resolve(root).toLowerCase() === path.resolve(projectRoot).toLowerCase()
        ? structuredClone(importSnapshot)
        : null,
  });
  const operation = await importService.importCandidates({
    projectRoot,
    project: created.project,
    baseRevision: 0,
    candidates: [
      ...candidateRecords.map((record) => ({ sourcePath: record.cropPath, declaredMimeType: 'image/png' })),
      { sourcePath: bodyArmCropPath, declaredMimeType: 'image/png' },
      { sourcePath: backgroundPath, declaredMimeType: 'image/png' },
    ],
  });
  assert(operation.projectChanged && operation.savedRevision === 1, 'AssetImportService did not import the local C0 sample.');
  assert(operation.results.length === 7 && operation.results.every((result) => result.asset && ['imported', 'duplicate'].includes(result.status)), 'One or more local C0 sample assets failed to import.');
  importSnapshot = { project: operation.project, revision: operation.savedRevision };

  const assetBySourceId = new Map(candidateRecords.map((record, index) => [record.sourceId, operation.results[index].asset]));
  const bodyArmAsset = operation.results[5]?.asset;
  const backgroundAsset = operation.results[6]?.asset;
  assert(bodyArmAsset?.kind === 'image' && backgroundAsset?.kind === 'image', 'The Body+Arm or background image did not import.');
  const parts = candidateRecords.map((record) => {
    const asset = assetBySourceId.get(record.sourceId);
    assert(asset?.kind === 'image', `C0 source ${record.sourceId} did not import as an image.`);
    return {
      partId: randomUUID(),
      assetId: asset.id,
      source: { kind: 'source-instance', sourceId: record.sourceId, sourcePoseFrame: 0, effectiveFrame: 0 },
      restTransform: { ...sourceRestTransform },
      sourceRestTransform: { ...sourceRestTransform },
      staticAdjustment: { ...DEFAULT_CHARACTER_PART_STATIC_ADJUSTMENT },
      imageMapping: {
        sourceWidth: 1920,
        sourceHeight: 1080,
        crop: { ...record.bounds },
        exportScale: 1,
      },
      drawOrder: record.drawOrder,
      visible: true,
      displayName: record.sourceName,
    };
  });
  const characterService = new CharacterService();
  let project = characterService.createAdaptiveParts(operation.project, {
    name: 'C0 五部件角色',
    sourceRootTransform: { ...sourceRootTransform },
    parts,
  });
  const c0Character = project.characters.at(-1);
  assert(c0Character?.mode === 'adaptive-parts' && c0Character.parts.length === 5, 'CharacterService did not create the five-part C0 Character.');
  const bodyArmPartId = randomUUID();
  project = characterService.createAdaptiveParts(project, {
    name: 'Body+Arm（C0 com2+com5）',
    sourceRootTransform: { ...sourceRootTransform },
    parts: [{
      partId: bodyArmPartId,
      assetId: bodyArmAsset.id,
      source: { kind: 'manual', sourceId: 'c0/body-arm/com2+com5' },
      restTransform: { ...sourceRestTransform },
      sourceRestTransform: { ...sourceRestTransform },
      staticAdjustment: { ...DEFAULT_CHARACTER_PART_STATIC_ADJUSTMENT },
      imageMapping: {
        sourceWidth: 1920,
        sourceHeight: 1080,
        crop: { ...bodyArmBounds },
        exportScale: 1,
      },
      drawOrder: 0,
      visible: true,
      displayName: 'Body+Arm',
    }],
  });
  const bodyArmCharacter = project.characters.at(-1);
  assert(bodyArmCharacter?.mode === 'adaptive-parts' && bodyArmCharacter.parts[0]?.partId === bodyArmPartId, 'CharacterService did not create Body+Arm as one Part.');

  const shotService = new ShotService();
  const layerService = new LayerService();
  const shotIds = [];
  for (const [name, character] of [['C0 五部件复核', c0Character], ['Body+Arm 单件复核', bodyArmCharacter]]) {
    project = shotService.create(project, { name, durationMs: 6_000 });
    const shot = project.shots.at(-1);
    assert(shot, `Could not create review Shot: ${name}`);
    shotIds.push(shot.id);
    const backgroundLayer = layerService.createFromAsset(project, shot.id, {
      version: 2,
      type: 'asset-image',
      assetId: backgroundAsset.id,
      position: { x: 960, y: 540 },
    });
    project = layerService.setBackground(backgroundLayer.project, shot.id, backgroundLayer.layer.id);
    project = layerService.createFromAdaptiveCharacter(project, shot.id, character.id, { x: 960, y: 540 }).project;
  }

  await projectService.save(projectRoot, ProjectSchema.parse(project));
  const persisted = await projectService.open(projectRoot);
  const persistedC0 = persisted.project.characters.find((character) => character.id === c0Character.id);
  const persistedBodyArm = persisted.project.characters.find((character) => character.id === bodyArmCharacter.id);
  assert(persistedC0?.mode === 'adaptive-parts' && persistedC0.parts.length === 5, 'The five-part Character did not survive save/reopen.');
  assert(persistedBodyArm?.mode === 'adaptive-parts' && persistedBodyArm.parts.length === 1 && persistedBodyArm.parts[0]?.sourceRestTransform, 'The local Body+Arm Character did not survive save/reopen.');

  const report = {
    checkpoint: 'Issue #899 local sample bridge',
    provenance: 'Private Issue #893 C0 frame-0 layer PNGs; source artwork and generated composite remain local.',
    projectRoot,
    projectId: persisted.project.id,
    sourceDir,
    sourcePartOrder: sourceRecords.map((record) => record.sourceId),
    bodyArmComposition: { sourceParts: ['c0/com2', 'c0/com5'], output: bodyArmCropPath, drawOrder: 'com2 back (1), com5 front (2)', partCount: 1, partId: bodyArmPartId },
    characterIds: { c0: c0Character.id, bodyArm: bodyArmCharacter.id },
    shotIds,
    importedAssets: operation.results.map((result) => ({ sourceName: result.sourceName, status: result.status, assetId: result.asset?.id, width: result.asset?.width, height: result.asset?.height, sha256: result.sha256 })),
    ownerAcceptance: 'NOT_ATTESTED: Owner must open the project in Panda Stage, inspect both assembly workspaces, save/reopen, add/export, and visually accept the real source material.',
  };
  await fsp.writeFile(path.join(outputRoot, 'local-intake-receipt.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

function makeSolidPng(width, height, color) {
  const { deflateSync } = require('node:zlib');
  const crc32 = (bytes) => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, bytes) => {
    const typeBytes = Buffer.from(type, 'ascii');
    const payload = Buffer.concat([typeBytes, bytes]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length, 0);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(payload), 0);
    return Buffer.concat([length, payload, checksum]);
  };
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (stride + 1);
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * 4;
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = color[3];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

createSampleProject()
  .then((report) => {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

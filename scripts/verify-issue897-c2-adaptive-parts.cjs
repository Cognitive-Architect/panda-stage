'use strict';

const { app, ipcMain, screen } = require('electron');
const { createHash, randomUUID } = require('node:crypto');
const { deflateSync } = require('node:zlib');
const { spawn } = require('node:child_process');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createMainWindow } = require('../dist-electron/main/windows/main-window.js');
const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');
const { ProjectSchema, PROJECT_SCHEMA_VERSION, CharacterService } = require('../dist-electron/domain/index.js');
const { evaluateShotAtTime } = require('../dist-electron/domain/evaluate-shot-at-time.js');
const { buildEditorStageRenderModel } = require('../dist-electron/domain/selectors/stageRenderModel.js');
const {
  resolveLayerVisualParts,
  visualPartRenderTransform,
} = require('../dist-electron/domain/selectors/visualParts.js');
const { registerIpcHandlers } = require('../dist-electron/main/ipc/register-ipc-handlers.js');
const { registerExportPreparationIpcHandlers } = require('../dist-electron/main/ipc/register-export-preparation-ipc-handlers.js');
const { ExportPreparationService, MainProjectAssetReader } = require('../dist-electron/main/services/ExportPreparationService.js');
const { NodeExportPreparationFileStore } = require('../dist-electron/main/services/ExportPreparationFileStore.js');
const { ExportService } = require('../dist-electron/main/services/ExportService.js');
const { FileSystemService } = require('../dist-electron/main/services/FileSystemService.js');
const { FFmpegAdapter } = require('../dist-electron/main/services/FFmpegAdapter.js');
const { resolveMediaToolPaths } = require('../dist-electron/main/services/production-resources.js');
const { HiddenWindowManager } = require('../dist-electron/main/windows/hidden-window-manager.js');

const acceptanceRoot = process.env.PANDA_STAGE_ISSUE897_ROOT ?? 'D:\\PandaStage-Acceptance\\issue897-c2';
const runId = new Date().toISOString().replace(/[:.]/gu, '-');
const runRoot = path.join(acceptanceRoot, `run-${runId}`);
const evidenceRoot = path.join(runRoot, 'evidence');
const projectRoot = path.join(runRoot, 'projects', 'synthetic-adaptive-parts.pandastage');
const outputPath = path.join(runRoot, 'issue897-c2-synthetic.mp4');
const resultPath = path.join(runRoot, 'issue897-c2-receipt.json');
const assetBytes = new Map();
const registeredChannels = [];
const jobUpdates = [];
const sampleTimes = [
  { name: 'start', timeMs: 0, frame: 0 },
  { name: 'middle', timeMs: 3_000, frame: 72 },
    { name: 'end', timeMs: 5_900, frame: 142 },
];

const IDS = Object.freeze({
  project: '89700000-0000-4000-8000-000000000001',
  background: '89700000-0000-4000-8000-000000000002',
  legacyImage: '89700000-0000-4000-8000-000000000003',
  bodyArm: '89700000-0000-4000-8000-000000000004',
  leg: '89700000-0000-4000-8000-000000000005',
  head: '89700000-0000-4000-8000-000000000006',
  skewPatch: '89700000-0000-4000-8000-000000000014',
  classicCharacter: '89700000-0000-4000-8000-000000000007',
  classicExpression: '89700000-0000-4000-8000-000000000008',
  classicVoice: '89700000-0000-4000-8000-000000000009',
  adaptiveCharacter: '89700000-0000-4000-8000-00000000000a',
  adaptiveVoice: '89700000-0000-4000-8000-00000000000b',
  shot: '89700000-0000-4000-8000-00000000000c',
  subtitle: '89700000-0000-4000-8000-00000000000d',
  backgroundLayer: '89700000-0000-4000-8000-00000000000e',
  leftLegPart: '89700000-0000-4000-8000-00000000000f',
  rightLegPart: '89700000-0000-4000-8000-000000000010',
  bodyArmPart: '89700000-0000-4000-8000-000000000011',
  headPart: '89700000-0000-4000-8000-000000000012',
  hiddenPart: '89700000-0000-4000-8000-000000000013',
  skewPart: '89700000-0000-4000-8000-000000000015',
});

const SKEW_MARKERS = [
  { name: 'top-left', x: 11, y: 11, color: [250, 230, 20] },
  { name: 'top-right', x: 133, y: 11, color: [20, 220, 60] },
  { name: 'bottom-right', x: 133, y: 97, color: [30, 110, 240] },
  { name: 'bottom-left', x: 11, y: 97, color: [10, 220, 230] },
];

let mainWindow = null;
let hiddenWindowManager = null;
let exportService = null;
let exportPreparationService = null;
let exportFileSystem = null;
let trackedSnapshot = null;
let activeExportPromise = null;
let activeProject = null;

process.env.VITE_DEV_SERVER_URL = '';
app.setPath('userData', path.join(runRoot, 'electron-user-data'));
app.on('window-all-closed', () => {});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, bytes) {
  const typeBytes = Buffer.from(type, 'ascii');
  const payload = Buffer.concat([typeBytes, bytes]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(payload), 0);
  return Buffer.concat([length, payload, checksum]);
}

function encodePng(width, height, pixels) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (stride + 1);
    raw[rowOffset] = 0;
    pixels.copy(raw, rowOffset + 1, y * stride, (y + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function bitmap(width, height) {
  return Buffer.alloc(width * height * 4);
}

function pixel(target, width, height, x, y, color) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= width || py >= height) return;
  const offset = (py * width + px) * 4;
  target[offset] = color[0];
  target[offset + 1] = color[1];
  target[offset + 2] = color[2];
  target[offset + 3] = color[3] ?? 255;
}

function rect(target, width, height, x, y, w, h, color) {
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(width, Math.ceil(x + w));
  const bottom = Math.min(height, Math.ceil(y + h));
  for (let py = top; py < bottom; py += 1) {
    for (let px = left; px < right; px += 1) pixel(target, width, height, px, py, color);
  }
}

function ellipse(target, width, height, cx, cy, rx, ry, color) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) pixel(target, width, height, x, y, color);
    }
  }
}

function createArtBytes(kind, width, height) {
  const rgba = bitmap(width, height);
  if (kind === 'background') {
    rect(rgba, width, height, 0, 0, width, height, [26, 39, 52]);
    for (let y = 90; y < height; y += 120) {
      rect(rgba, width, height, 0, y, width, 2, [36, 54, 69]);
    }
    ellipse(rgba, width, height, 1_520, 205, 96, 96, [72, 110, 126, 255]);
    ellipse(rgba, width, height, 1_520, 205, 70, 70, [40, 63, 76, 255]);
  } else if (kind === 'legacy') {
    ellipse(rgba, width, height, width / 2, height / 2, width * 0.43, height * 0.43, [230, 197, 144]);
    ellipse(rgba, width, height, width * 0.36, height * 0.42, 5, 8, [34, 39, 45]);
    ellipse(rgba, width, height, width * 0.64, height * 0.42, 5, 8, [34, 39, 45]);
  } else if (kind === 'body-arm') {
    rect(rgba, width, height, 26, 23, 94, 164, [42, 105, 147]);
    rect(rgba, width, height, 96, 46, 58, 31, [42, 105, 147]);
    rect(rgba, width, height, 35, 36, 18, 146, [73, 139, 170]);
    rect(rgba, width, height, 33, 145, 82, 10, [195, 160, 98]);
    rect(rgba, width, height, 126, 48, 18, 26, [195, 160, 98]);
  } else if (kind === 'leg') {
    rect(rgba, width, height, 22, 12, 39, 69, [52, 107, 146]);
    rect(rgba, width, height, 17, 70, 48, 15, [195, 160, 98]);
    rect(rgba, width, height, 9, 84, 62, 12, [24, 34, 46]);
  } else if (kind === 'head') {
    ellipse(rgba, width, height, 50, 52, 38, 43, [224, 184, 127]);
    ellipse(rgba, width, height, 50, 34, 40, 25, [32, 48, 61]);
    rect(rgba, width, height, 18, 42, 64, 11, [32, 48, 61]);
    ellipse(rgba, width, height, 38, 58, 3, 5, [28, 33, 39]);
    ellipse(rgba, width, height, 62, 58, 3, 5, [28, 33, 39]);
    rect(rgba, width, height, 43, 76, 14, 3, [155, 72, 65]);
  } else if (kind === 'skew-patch') {
    rect(rgba, width, height, 0, 0, width, height, [37, 38, 49]);
    rect(rgba, width, height, 4, 4, width - 8, height - 8, [226, 83, 45]);
    for (let y = 20; y < height - 12; y += 16) {
      for (let x = 20; x < width - 12; x += 20) {
        rect(rgba, width, height, x, y, 7, 9, [49, 59, 73]);
      }
    }
    rect(rgba, width, height, 4, 4, 14, 14, [250, 230, 20]);
    rect(rgba, width, height, width - 18, 4, 14, 14, [20, 220, 60]);
    rect(rgba, width, height, width - 18, height - 18, 14, 14, [30, 110, 240]);
    rect(rgba, width, height, 4, height - 18, 14, 14, [10, 220, 230]);
  }
  return encodePng(width, height, rgba);
}

function asset(id, name, width, height, kind, usage) {
  const bytes = createArtBytes(kind, width, height);
  assetBytes.set(id, bytes);
  return {
    id,
    kind: 'image',
    name,
    relativePath: `assets/${name.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}.png`,
    mimeType: 'image/png',
    width,
    height,
    sha256: sha256(bytes),
    usage,
    keywords: [],
  };
}

function makePart(partId, assetId, sourceId, displayName, drawOrder, transform, mapping, sourceKind = 'source-instance', visible = true) {
  return {
    partId,
    assetId,
    source: sourceKind === 'manual'
      ? { kind: 'manual', sourceId }
      : { kind: 'source-instance', sourceId, sourcePoseFrame: 0, effectiveFrame: 0 },
    restTransform: transform,
    imageMapping: mapping,
    drawOrder,
    visible,
    displayName,
  };
}

function buildProject() {
  const assets = [
    asset(IDS.background, 'Synthetic Stage Background', 1920, 1080, 'background', 'background'),
    asset(IDS.legacyImage, 'Legacy Single Image', 80, 80, 'legacy', 'character'),
    asset(IDS.bodyArm, 'Body Arm Composite', 160, 210, 'body-arm', 'character'),
    asset(IDS.leg, 'Repeated Leg Part', 80, 100, 'leg', 'character'),
    asset(IDS.head, 'Synthetic Head Part', 100, 100, 'head', 'character'),
    asset(IDS.skewPatch, 'Synthetic Skewed Part', 144, 108, 'skew-patch', 'character'),
  ];
  const legacyCharacter = {
    id: IDS.classicCharacter,
    mode: 'single-image',
    name: 'Legacy Single-image Control',
    baseAssetId: IDS.legacyImage,
    defaultVoiceProfileId: IDS.classicVoice,
    expressions: [{ id: IDS.classicExpression, name: 'Neutral', assetId: IDS.legacyImage }],
    defaultExpressionId: IDS.classicExpression,
    defaultScale: 1,
    defaultFlipX: false,
  };
  const project = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: IDS.project,
    name: 'Issue 897 C2 Synthetic Adaptive Parts',
    width: 1920,
    height: 1080,
    fps: 24,
    assets,
    animations: [],
    characters: [legacyCharacter],
    voiceProfiles: [{
      id: IDS.classicVoice,
      name: 'Legacy Control Voice',
      characterId: IDS.classicCharacter,
      locale: 'en-US',
      rate: 1,
      pitch: 0,
    }],
    subtitleStyles: [{
      id: IDS.subtitle,
      name: 'Synthetic Default',
      fontFamily: 'Arial',
      fontSize: 44,
      textColor: '#ffffff',
      backgroundColor: '#000000',
      position: 'bottom',
      align: 'center',
      maxWidth: 1600,
    }],
    shots: [{
      id: IDS.shot,
      name: 'Static Adaptive Parts',
      durationMs: 6_000,
      defaultSubtitleStyleId: IDS.subtitle,
      dialogues: [],
      audioClips: [],
      timelineEvents: [],
      backgroundLayerId: IDS.backgroundLayer,
      layers: [{
        id: IDS.backgroundLayer,
        name: 'Background',
        source: { kind: 'asset', assetId: IDS.background },
        anchor: 'center',
        x: 960,
        y: 540,
        scaleX: 1,
        scaleY: 1,
        rotationDeg: 0,
        opacity: 1,
        visible: true,
        zIndex: 0,
        locked: true,
        flipX: false,
      }],
    }],
    createdAt: '2026-10-30T00:00:00.000Z',
    updatedAt: '2026-10-30T00:00:00.000Z',
  };
  const mappings = {
    body: { sourceWidth: 180, sourceHeight: 230, crop: { x: 10, y: 10, width: 160, height: 210 }, exportScale: 1 },
    leg: { sourceWidth: 100, sourceHeight: 120, crop: { x: 10, y: 10, width: 80, height: 100 }, exportScale: 1 },
    head: { sourceWidth: 120, sourceHeight: 120, crop: { x: 10, y: 10, width: 100, height: 100 }, exportScale: 1 },
    skew: { sourceWidth: 160, sourceHeight: 120, crop: { x: 12, y: 8, width: 96, height: 72 }, exportScale: 1.5 },
  };
  const parts = [
    makePart(IDS.leftLegPart, IDS.leg, 'synthetic:leg:left', 'Left leg', 0,
      { a: 1, b: 0, c: 0, d: 1, tx: 785, ty: 580 }, mappings.leg),
    makePart(IDS.rightLegPart, IDS.leg, 'synthetic:leg:right', 'Right leg', 1,
      { a: 1, b: 0, c: 0, d: 1, tx: 865, ty: 580 }, mappings.leg),
    makePart(IDS.bodyArmPart, IDS.bodyArm, 'synthetic:body-arm:composite', 'Body + arm composite', 2,
      { a: 0.99, b: 0.04, c: -0.04, d: 0.99, tx: 785, ty: 430 }, mappings.body, 'manual'),
    makePart(IDS.skewPart, IDS.skewPatch, 'synthetic:skew:torso-panel', 'Skew oracle panel', 3,
      { a: 0.9, b: 0.2, c: 0.55, d: 1.05, tx: 775, ty: 465 }, mappings.skew, 'manual'),
    makePart(IDS.headPart, IDS.head, 'synthetic:head:instance', 'Head', 4,
      { a: 1, b: 0, c: 0, d: 1, tx: 815, ty: 345 }, mappings.head),
    makePart(IDS.hiddenPart, IDS.head, 'synthetic:hidden:control', 'Hidden visibility control', 5,
      { a: 1, b: 0, c: 0, d: 1, tx: 1_500, ty: 800 }, mappings.head, 'source-instance', false),
  ];
  const service = new CharacterService({
    createId: (() => {
      const generated = [IDS.adaptiveCharacter, IDS.adaptiveVoice];
      return () => generated.shift() ?? randomUUID();
    })(),
    now: () => new Date('2026-10-30T00:00:00.000Z'),
  });
  return ProjectSchema.parse(service.createAdaptiveParts(project, {
    name: 'Synthetic Adaptive Parts',
    sourceRootTransform: { a: 1.03, b: 0.025, c: -0.025, d: 1.03, tx: 15, ty: 8 },
    parts,
    defaultScale: 1,
    defaultFlipX: false,
  }));
}

function documentFor(root, project) {
  return {
    projectRoot: root,
    projectFilePath: path.join(root, 'project.json'),
    project,
    migrated: false,
    sourceVersion: PROJECT_SCHEMA_VERSION,
  };
}

function register(channel, handler) {
  ipcMain.handle(channel, handler);
  registeredChannels.push(channel);
}

async function readPersistedProject() {
  return ProjectSchema.parse(JSON.parse(await fsp.readFile(path.join(projectRoot, 'project.json'), 'utf8')));
}

function registerProjectHandlers() {
  const doc = (project = activeProject) => documentFor(projectRoot, project);
  register(IPC_CHANNELS.PROJECT_OPEN, async (_event, request) => {
    if (path.resolve(request.projectRoot).toLowerCase() !== path.resolve(projectRoot).toLowerCase()) {
      return { ok: false, error: { code: 'PROJECT_NOT_FOUND', message: 'Synthetic Issue 897 fixture not found.', projectRoot: request.projectRoot } };
    }
    activeProject = await readPersistedProject();
    return { ok: true, value: doc(activeProject) };
  });
  register(IPC_CHANNELS.PROJECT_SAVE, async (_event, request) => {
    assert(path.resolve(request.projectRoot).toLowerCase() === path.resolve(projectRoot).toLowerCase(), 'Save targeted a different Project root.');
    activeProject = ProjectSchema.parse(request.project);
    await fsp.writeFile(path.join(projectRoot, 'project.json'), `${JSON.stringify(activeProject, null, 2)}\n`, 'utf8');
    if (trackedSnapshot?.openInstanceId) {
      trackedSnapshot = { project: activeProject, revision: request.revision, dirty: false, openInstanceId: trackedSnapshot.openInstanceId };
    }
    return { ok: true, value: doc(activeProject) };
  });
  register(IPC_CHANNELS.PROJECT_CONFIRM_SWITCH, async () => ({ outcome: 'saved' }));
  register(IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY, async () => ({ ok: true, status: 'cancelled' }));
  register(IPC_CHANNELS.PROJECT_OPEN_FOLDER, async () => ({ ok: true }));
  register(IPC_CHANNELS.RECENT_PROJECTS_LIST, async () => ({ ok: true, entries: [] }));
  register(IPC_CHANNELS.RECENT_PROJECTS_OPEN, async (_event, request) => {
    assert(path.resolve(request.projectRoot).toLowerCase() === path.resolve(projectRoot).toLowerCase(), 'Reopen targeted a different Project root.');
    activeProject = await readPersistedProject();
    assert(activeProject.id === request.expectedProjectId, 'Reopened Project ID does not match the recent entry.');
    return { ok: true, document: doc(activeProject) };
  });
  register(IPC_CHANNELS.AUTOSAVE_TRACK, async (_event, request) => {
    if (path.resolve(request.projectRoot).toLowerCase() === path.resolve(projectRoot).toLowerCase()) {
      trackedSnapshot = {
        project: ProjectSchema.parse(request.project),
        revision: request.revision,
        dirty: request.dirty,
        openInstanceId: request.openInstanceId,
      };
    }
    return { ok: true };
  });
  register(IPC_CHANNELS.AUTOSAVE_UPDATE, async (_event, request) => {
    if (path.resolve(request.projectRoot).toLowerCase() === path.resolve(projectRoot).toLowerCase()) {
      trackedSnapshot = {
        project: ProjectSchema.parse(request.project),
        revision: request.revision,
        dirty: request.dirty,
        openInstanceId: request.openInstanceId,
      };
    }
    return { ok: true };
  });
  register(IPC_CHANNELS.AUTOSAVE_STOP, async () => { trackedSnapshot = null; return { ok: true }; });
  register(IPC_CHANNELS.RECOVERY_DETECT, async () => ({ ok: true, candidate: null }));
  register(IPC_CHANNELS.RECOVERY_IGNORE, async () => ({ ok: true, retained: true }));
  register(IPC_CHANNELS.ASSET_THUMBNAIL_READ, async (_event, request) => {
    const asset = activeProject.assets.find((entry) => entry.id === request.assetId);
    const bytes = assetBytes.get(request.assetId);
    if (!asset || !bytes || asset.sha256 !== request.sha256) {
      return { ok: true, status: 'missing', assetId: request.assetId };
    }
    return { ok: true, status: 'ready', assetId: asset.id, dataUrl: `data:image/png;base64,${bytes.toString('base64')}` };
  });
  register(IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ, async (_event, request) => {
    const asset = activeProject.assets.find((entry) => entry.id === request.assetId && entry.kind === 'image');
    const bytes = assetBytes.get(request.assetId);
    if (!asset || !bytes || asset.sha256 !== request.sha256) {
      return { ok: false, error: { code: 'ASSET_NOT_FOUND', message: 'Synthetic Issue 897 image is unavailable.', assetId: request.assetId } };
    }
    return {
      ok: true,
      status: 'ready',
      assetId: asset.id,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      byteLength: bytes.length,
      bytes: new Uint8Array(bytes),
    };
  });
}

function registerExportServices() {
  const mediaTools = resolveMediaToolPaths({ isPackaged: false, resourcesPath: process.resourcesPath });
  exportFileSystem = new FileSystemService(path.join(runRoot, 'frame-jobs'));
  hiddenWindowManager = new HiddenWindowManager();
  const mediaAdapter = new FFmpegAdapter({ ffmpegPath: mediaTools.ffmpegPath, ffprobePath: mediaTools.ffprobePath });
  const fileStore = new NodeExportPreparationFileStore(path.join(runRoot, 'frozen-media'));
  exportPreparationService = new ExportPreparationService({
    getCurrentProjectSnapshot: (root) =>
      trackedSnapshot && path.resolve(root).toLowerCase() === path.resolve(projectRoot).toLowerCase()
        ? structuredClone(trackedSnapshot)
        : null,
    assertFormalOutputLocation: (target) => exportFileSystem.assertFormalOutputLocation(target),
    fileStore,
    mediaReader: new MainProjectAssetReader(),
  });
  exportService = new ExportService(hiddenWindowManager, exportFileSystem, mediaAdapter);
  exportService.subscribe((update) => {
    jobUpdates.push(update);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC_CHANNELS.EXPORT_JOB_UPDATE, update);
  });
  registerExportPreparationIpcHandlers({
    getMainWindow: () => mainWindow,
    service: exportPreparationService,
    selectOutputPath: async () => outputPath,
  });
  registerIpcHandlers({
    getMainWindow: () => mainWindow,
    getHiddenWindow: () => hiddenWindowManager.getWindow(),
    markHiddenReady: (senderId) => hiddenWindowManager.markReady(senderId),
    markProbeLoaded: (senderId, request) => hiddenWindowManager.markProbeLoaded(senderId, request),
    markFormalLoaded: (senderId, request) => hiddenWindowManager.markFormalLoaded(senderId, request),
    markFrameReady: (senderId, request) => hiddenWindowManager.markFrameReady(senderId, request),
    markFrameFailed: (senderId, request) => hiddenWindowManager.markFrameFailed(senderId, request),
    startFullProbe: (request) => {
      const handle = exportService.startFullProbe(request);
      void handle.completion.catch(() => undefined);
      return { jobId: handle.jobId, status: 'running' };
    },
    startFormalExport: async (request) => {
      const input = await exportPreparationService.acquireCandidateForExport(request.snapshotId, request.reuseSnapshot);
      let handle;
      try {
        handle = exportService.startFormalExport(
          input,
          () => exportPreparationService.assertOutputTargetUnchanged(request.snapshotId),
        );
      } catch (error) {
        await exportPreparationService.retainCandidateForRetry(request.snapshotId);
        throw error;
      }
      activeExportPromise = handle.completion;
      void handle.completion.then(
        () => exportPreparationService.finalizeCandidateExport(request.snapshotId),
        () => exportPreparationService.retainCandidateForRetry(request.snapshotId),
      ).catch(() => undefined);
      return { jobId: handle.jobId, status: 'running' };
    },
    cancelExport: (jobId) => ({
      jobId,
      accepted: exportService.cancelJob(jobId),
      status: exportService.getJob(jobId)?.status ?? 'cancelled',
    }),
    revealExportOutput: async (jobId) => Boolean(exportService.getCompletedOutputPath(jobId)),
  });
  return mediaTools;
}

function browserWait(expression, message, timeout = 30_000) {
  return `(async () => {
    const deadline = Date.now() + ${timeout};
    while (Date.now() < deadline) {
      try { if (${expression}) return true; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(${JSON.stringify(message)});
  })()`;
}

async function waitFor(window, expression, message, timeout) {
  await window.webContents.executeJavaScript(browserWait(expression, message, timeout));
}

async function pause(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function page(window, script) {
  return window.webContents.executeJavaScript(script, true);
}

async function click(window, selector, label = selector) {
  await waitFor(window, `document.querySelector(${JSON.stringify(selector)})`, `${label} did not appear.`);
  const point = await page(window, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { width: rect.width, height: rect.height,
      visible: rect.width > 0 && rect.height > 0 && style.visibility === 'visible' && style.display !== 'none',
      disabled: Boolean(element.disabled) };
  })()`);
  assert(point.visible && !point.disabled, `${label} is not available for input: ${JSON.stringify(point)}`);
  await page(window, `document.querySelector(${JSON.stringify(selector)}).click()`);
  await pause(100);
  return point;
}

async function expandProjectActions(window) {
  await page(window, `(() => {
    const drawer = document.querySelector('[data-testid="quick-action-drawer"]');
    if (drawer?.dataset.expanded !== 'true') {
      drawer?.querySelector('[data-testid="quick-action-drawer-handle"]')?.click();
    }
  })()`);
  await waitFor(window, `document.querySelector('[data-testid="quick-action-drawer"]')?.dataset.expanded === 'true'`, 'Project actions drawer did not expand.');
}

async function openProject(window) {
  const selector = '[data-testid="project-center-screen"] .recovery-open-row input';
  await waitFor(window, `document.querySelector(${JSON.stringify(selector)})`, 'Project Center did not render its project path input.');
  await page(window, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(projectRoot)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('[data-testid="project-center-screen"] .recovery-open-row button').click();
  })()`);
  await waitFor(window, `document.querySelector('[data-testid="editor-layout"]')`, 'The synthetic Project did not open in the production editor.');
  await waitFor(window, `Number(document.querySelector('[data-testid="project-canvas-viewport"]')?.dataset.displayScale) > 0`, 'The editor Canvas viewport did not finish measuring.');
}

async function captureWhole(window, fileName) {
  await page(window, 'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const image = await window.webContents.capturePage();
  const target = path.join(evidenceRoot, fileName);
  await fsp.writeFile(target, image.toPNG());
  return target;
}

async function captureCanvas(window, selector, fileName) {
  const capture = await page(window, `(() => {
    try {
    const host = document.querySelector(${JSON.stringify(selector)});
    if (!host) throw new Error('Missing stage host ' + ${JSON.stringify(selector)});
    const layers = [...host.querySelectorAll('canvas')].filter((canvas) => canvas.width > 0 && canvas.height > 0);
    if (layers.length === 0) throw new Error('Stage has no painted Konva canvas layers.');
    const width = Math.max(...layers.map((canvas) => canvas.width));
    const height = Math.max(...layers.map((canvas) => canvas.height));
    const output = document.createElement('canvas');
    output.width = width;
    output.height = height;
    const context = output.getContext('2d');
    for (const layer of layers) context.drawImage(layer, 0, 0, width, height);
    const previewRenderLayers = host.dataset.layerRenderJson
      ? JSON.parse(host.dataset.layerRenderJson)
      : null;
    return {
      width,
      height,
      layerCount: layers.length,
      dataUrl: output.toDataURL('image/png'),
      stageData: {
        renderedAssetIds: previewRenderLayers
          ? []
          : JSON.parse(host.dataset.renderedAssetIds ?? '[]'),
        primaryRenderAssetIds: previewRenderLayers
          ? [...new Set(previewRenderLayers.map((layer) => layer.assetId))]
          : null,
        incompleteVisualLayerIds: previewRenderLayers
          ? null
          : JSON.parse(host.dataset.incompleteVisualLayerIds ?? '[]'),
        layerJson: previewRenderLayers ?? JSON.parse(host.dataset.layerJson ?? '[]'),
        currentTimeMs: Number(host.dataset.currentTimeMs ?? host.dataset.stageTime ?? 0),
        stageReady: host.dataset.stageReady ?? null,
        displayReady: host.dataset.stageDisplayReady ?? null,
        stageError: host.dataset.stageError ?? null,
      },
    };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : null };
    }
  })()`);
  if (capture?.error) throw new Error(`Canvas capture failed for ${selector}: ${capture.error}${capture.stack ? `\n${capture.stack}` : ''}`);
  const data = Buffer.from(capture.dataUrl.slice(capture.dataUrl.indexOf(',') + 1), 'base64');
  const target = path.join(evidenceRoot, fileName);
  await fsp.writeFile(target, data);
  return { width: capture.width, height: capture.height, layerCount: capture.layerCount, path: target, stageData: capture.stageData };
}

async function seekEditor(window, requestedTimeMs) {
  const state = await page(window, `(() => {
    const scroll = document.querySelector('[data-testid="timeline-ruler-scroll"]');
    const track = document.querySelector('[data-testid="timeline-ruler-track"]');
    const timecode = document.querySelector('[data-testid="timeline-timecode"]');
    if (!scroll || !track || !timecode) throw new Error('The expanded Shot Timeline ruler is unavailable.');
    const duration = Number(track.dataset.duration);
    const pixelsPerMs = (track.getBoundingClientRect().width - 82) / duration;
    const targetPx = pixelsPerMs * ${requestedTimeMs};
    scroll.scrollLeft = Math.max(0, Math.min(targetPx - 80, scroll.scrollWidth - scroll.clientWidth));
    scroll.dispatchEvent(new Event('scroll'));
    return { duration, pixelsPerMs, targetPx };
  })()`);
  await pause(80);
  const point = await page(window, `(() => {
    const scroll = document.querySelector('[data-testid="timeline-ruler-scroll"]');
    const track = document.querySelector('[data-testid="timeline-ruler-track"]');
    const rect = track.getBoundingClientRect();
    const scrollRect = scroll.getBoundingClientRect();
    return { x: rect.left + 2 + ${requestedTimeMs} * ${state.pixelsPerMs}, y: rect.top + 30,
      left: scrollRect.left, right: scrollRect.right, top: rect.top, bottom: rect.bottom };
  })()`);
  assert(point.x >= point.left + 2 && point.x <= point.right - 2, `Timeline seek point is outside the visible ruler: ${JSON.stringify(point)}`);
  const displayScale = screen.getDisplayMatching(window.getBounds()).scaleFactor;
  const dpr = await page(window, 'window.devicePixelRatio');
  const inputScale = dpr / displayScale;
  const inputPoint = { x: Math.round(point.x * inputScale), y: Math.round(point.y * inputScale) };
  window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...inputPoint });
  window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...inputPoint });
  await waitFor(window, `Math.abs(Number(document.querySelector('[data-testid="timeline-timecode"]')?.dataset.currentTime) - ${requestedTimeMs}) <= 45`, `Timeline did not seek to ${requestedTimeMs}ms.`, 8_000);
  return page(window, `Number(document.querySelector('[data-testid="timeline-timecode"]')?.dataset.currentTime ?? -1)`);
}

async function seekPreview(window, requestedTimeMs) {
  await page(window, `(() => {
    const input = document.querySelector('[data-testid="product-preview-scrubber"]');
    if (!input) throw new Error('Product Preview scrubber is unavailable.');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(${requestedTimeMs}));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor(window, `Math.abs(Number(document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewTime) - ${requestedTimeMs}) <= 45`, `Product Preview did not seek to ${requestedTimeMs}ms.`, 8_000);
  return page(window, `Number(document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewTime ?? -1)`);
}

function runProcess(executable, args, maxBuffer = 48 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.once('error', reject);
    child.once('close', (code) => {
      const result = { stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString('utf8'), code };
      if (code === 0) resolve(result);
      else reject(new Error(`${path.basename(executable)} exited ${code}: ${result.stderr.slice(-4_000)}`));
      if (result.stdout.length > maxBuffer) reject(new Error(`${path.basename(executable)} output exceeded ${maxBuffer} bytes.`));
    });
  });
}

async function captureExportFrames(ffmpegPath, ffprobePath, filePath) {
  const rawProbe = await runProcess(ffprobePath, [
    '-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', filePath,
  ]);
  const probe = JSON.parse(rawProbe.stdout.toString('utf8'));
  const video = probe.streams?.find((stream) => stream.codec_type === 'video');
  assert(video, 'FFprobe found no video stream in the formal MP4.');
  const frameCount = Number(video.nb_read_frames ?? video.nb_frames);
  const fpsParts = String(video.avg_frame_rate ?? '0/1').split('/');
  const fps = Number(fpsParts[0]) / Number(fpsParts[1] || 1);
  assert(video.codec_name === 'h264', `Formal MP4 codec was ${video.codec_name}, expected H.264.`);
  assert(video.width === 1920 && video.height === 1080, `Formal MP4 size was ${video.width}x${video.height}.`);
  assert(Math.abs(fps - 24) < 0.001, `Formal MP4 frame rate was ${fps}.`);
  assert(frameCount === 144, `Formal MP4 has ${frameCount} frames, expected 144 for a six-second 24fps Shot.`);
  const frames = {};
  for (const sample of sampleTimes) {
    const framePath = path.join(evidenceRoot, `export-${sample.name}-frame-${String(sample.frame).padStart(3, '0')}.png`);
    await runProcess(ffmpegPath, [
      '-y', '-v', 'error', '-i', filePath,
      '-vf', `select=eq(n\\,${sample.frame})`, '-vsync', '0', '-frames:v', '1', framePath,
    ]);
    const stat = await fsp.stat(framePath);
    assert(stat.size > 1_000, `Export ${sample.name} frame ${sample.frame} is empty.`);
    frames[sample.name] = framePath;
  }
  return { probe, frameCount, fps, frames };
}

async function decodeRgb(ffmpegPath, imagePath) {
  const result = await runProcess(ffmpegPath, [
    '-v', 'error', '-i', imagePath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
  ]);
  return result.stdout;
}

function affinePoint(matrix, point) {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.tx,
    y: matrix.b * point.x + matrix.d * point.y + matrix.ty,
  };
}

function ownerPoint(point, owner) {
  const radians = (owner.rotationDeg * Math.PI) / 180;
  const scaleX = owner.scaleX * (owner.flipX ? -1 : 1);
  const x = point.x * scaleX;
  const y = point.y * owner.scaleY;
  return {
    x: owner.x + x * Math.cos(radians) - y * Math.sin(radians),
    y: owner.y + x * Math.sin(radians) + y * Math.cos(radians),
  };
}

function buildSkewAffineOracle(Konva, part, owner, width, height) {
  const source = part.imageTransform;
  assert(source, `Skew Part ${part.partId} has no raw affine matrix.`);
  const render = visualPartRenderTransform(part);
  const node = new Konva.Group({
    x: render.x,
    y: render.y,
    offsetX: render.offsetX,
    offsetY: render.offsetY,
    rotation: render.rotation,
    scaleX: render.scaleX,
    scaleY: render.scaleY,
    skewX: render.skewX ?? 0,
    skewY: render.skewY ?? 0,
  });
  const actualMatrix = [...node.getTransform().getMatrix()];
  node.destroy();
  const sourceCorners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  let maxCornerDeviation = 0;
  const corners = sourceCorners.map((point) => {
    const expected = affinePoint(source, point);
    const actual = {
      x: actualMatrix[0] * point.x + actualMatrix[2] * point.y + actualMatrix[4],
      y: actualMatrix[1] * point.x + actualMatrix[3] * point.y + actualMatrix[5],
    };
    maxCornerDeviation = Math.max(
      maxCornerDeviation,
      Math.abs(expected.x - actual.x),
      Math.abs(expected.y - actual.y),
    );
    return {
      source: point,
      expectedLocal: expected,
      konvaLocal: actual,
      expectedStage: ownerPoint(expected, owner),
    };
  });
  const skewFactor = render.skewX ?? 0;
  assert(Math.abs(skewFactor) >= 0.3, `Skew fixture is not visibly nonzero: ${skewFactor}.`);
  assert(maxCornerDeviation <= 1e-8, `Konva corners differ from the raw source affine by ${maxCornerDeviation}.`);
  for (const corner of corners) {
    assert(
      corner.expectedStage.x >= 2 && corner.expectedStage.x <= 1918 &&
      corner.expectedStage.y >= 2 && corner.expectedStage.y <= 1078,
      `Skew Part corner is outside the Stage: ${JSON.stringify(corner.expectedStage)}.`,
    );
  }
  const markers = SKEW_MARKERS.map((marker) => ({
    ...marker,
    stagePoint: ownerPoint(affinePoint(source, marker), owner),
  }));
  return {
    partId: part.partId,
    sourceMatrix: { ...source },
    determinant: source.a * source.d - source.b * source.c,
    skewFactor,
    cropAndScale: { crop: { x: 12, y: 8, width: 96, height: 72 }, exportScale: 1.5 },
    konvaMatrix: actualMatrix,
    corners,
    maxCornerDeviation,
    markers,
  };
}

function sampleSkewMarkers(rgb, width, height, markers, tolerance, label) {
  assert(rgb.length === width * height * 3, `${label} RGB buffer does not match ${width}x${height}.`);
  const scaleX = width / 1920;
  const scaleY = height / 1080;
  return markers.map((marker) => {
    const x = Math.round(marker.stagePoint.x * scaleX);
    const y = Math.round(marker.stagePoint.y * scaleY);
    assert(x >= 0 && x < width && y >= 0 && y < height, `${label} ${marker.name} sample is outside the image.`);
    const offset = (y * width + x) * 3;
    const actual = [rgb[offset], rgb[offset + 1], rgb[offset + 2]];
    const maxChannelDeviation = Math.max(...actual.map((value, channel) => Math.abs(value - marker.color[channel])));
    assert(
      maxChannelDeviation <= tolerance,
      `${label} ${marker.name} marker missed its source-matrix point: expected ${JSON.stringify(marker.color)}, got ${JSON.stringify(actual)} at ${x},${y}.`,
    );
    return {
      name: marker.name,
      sourcePoint: { x: marker.x, y: marker.y },
      expectedStagePoint: marker.stagePoint,
      sampledPixel: { x, y },
      expectedRgb: marker.color,
      actualRgb: actual,
      maxChannelDeviation,
    };
  });
}

async function comparePngs(ffmpegPath, referencePath, candidatePath) {
  const [reference, candidate] = await Promise.all([
    decodeRgb(ffmpegPath, referencePath),
    decodeRgb(ffmpegPath, candidatePath),
  ]);
  assert(reference.length === candidate.length && reference.length > 0, `Pixel comparison dimensions differ: ${referencePath} (${reference.length}) vs ${candidatePath} (${candidate.length}).`);
  const histogram = new Uint32Array(256);
  let total = 0;
  let pixelsAboveFive = 0;
  let nonDarkPixels = 0;
  let maximum = 0;
  for (let offset = 0; offset < reference.length; offset += 3) {
    let pixelDifference = 0;
    let maxChannel = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = Math.abs(reference[offset + channel] - candidate[offset + channel]);
      total += difference;
      pixelDifference += difference;
      maxChannel = Math.max(maxChannel, difference);
    }
    const meanPixelDifference = Math.round(pixelDifference / 3);
    histogram[meanPixelDifference] += 1;
    if (meanPixelDifference > 5) pixelsAboveFive += 1;
    if (candidate[offset] + candidate[offset + 1] + candidate[offset + 2] > 35) nonDarkPixels += 1;
    maximum = Math.max(maximum, maxChannel);
  }
  const pixelCount = reference.length / 3;
  const threshold = Math.ceil(pixelCount * 0.95);
  let cumulative = 0;
  let p95 = 0;
  for (; p95 < histogram.length; p95 += 1) {
    cumulative += histogram[p95];
    if (cumulative >= threshold) break;
  }
  return {
    referencePath,
    candidatePath,
    width: 1920,
    height: 1080,
    meanAbsoluteChannelDifference: Number((total / reference.length).toFixed(3)),
    p95MeanPerPixelDifference: p95,
    maxChannelDifference: maximum,
    pixelsOver5DifferencePercent: Number((pixelsAboveFive * 100 / pixelCount).toFixed(3)),
    candidateNonDarkPixelPercent: Number((nonDarkPixels * 100 / pixelCount).toFixed(3)),
  };
}

async function normalizePng(ffmpegPath, sourcePath, fileName) {
  const target = path.join(evidenceRoot, fileName);
  await runProcess(ffmpegPath, ['-y', '-v', 'error', '-i', sourcePath, '-vf', 'scale=1920:1080:flags=bilinear', '-frames:v', '1', target]);
  return target;
}

async function main() {
  const Konva = (await import('konva')).default;
  await fsp.mkdir(evidenceRoot, { recursive: true });
  await fsp.mkdir(path.join(projectRoot, 'assets'), { recursive: true });
  activeProject = buildProject();
  for (const asset of activeProject.assets) {
    const bytes = assetBytes.get(asset.id);
    assert(bytes && sha256(bytes) === asset.sha256, `Synthetic fixture hash mismatch for ${asset.id}.`);
    await fsp.writeFile(path.join(projectRoot, asset.relativePath), bytes);
  }
  await fsp.writeFile(path.join(projectRoot, 'project.json'), `${JSON.stringify(activeProject, null, 2)}\n`, 'utf8');
  registerProjectHandlers();
  const mediaTools = registerExportServices();
  await app.whenReady();
  mainWindow = await createMainWindow({ show: true, issue816Acceptance: true });
  mainWindow.setSize(1660, 1100);
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.focus();

  const receipt = {
    issue: 897,
    checkpoint: 'C2',
    startedAt: new Date().toISOString(),
    runId,
    branch: require('node:child_process').execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(),
    headAtRun: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    platform: process.platform,
    electronVersion: process.versions.electron,
    fixture: {
      provenance: 'Generated synthetic PNG pixels; no private or third-party artwork.',
      projectPath: path.join(projectRoot, 'project.json'),
      projectId: activeProject.id,
      schemaVersion: activeProject.schemaVersion,
      durationMs: activeProject.shots[0].durationMs,
      assets: activeProject.assets.map(({ id, name, relativePath, width, height, sha256 }) => ({ id, name, relativePath, width, height, sha256 })),
      adaptiveCharacterId: IDS.adaptiveCharacter,
      parts: activeProject.characters.find((character) => character.id === IDS.adaptiveCharacter).parts,
    },
    evidenceRoot,
    outputPath,
    owner: 'NOT_ATTESTED',
    auto: 'RUNNING',
  };

  try {
    await openProject(mainWindow);
    await waitFor(mainWindow, `window.__pandaStageIssue816Acceptance?.inspect()?.project?.id === ${JSON.stringify(IDS.project)}`, 'Issue 816 acceptance inspect hook did not see the fixture Project.');
    const characterRail = '[data-testid="resource-activity-rail-characters"]';
    const characterList = '[data-testid="character-list-view"]';
    await waitFor(mainWindow, `document.querySelector(${JSON.stringify(characterRail)})`, 'Characters rail is unavailable.');
    await click(mainWindow, characterRail, 'Characters activity');
    await waitFor(mainWindow, `document.querySelector(${JSON.stringify(characterList)})`, 'Character list did not open.');
    await click(mainWindow, `${characterList} [data-character-id="${IDS.adaptiveCharacter}"]`, 'Synthetic Adaptive Parts Character');
    const placementSelector = '[data-testid="character-detail-place-current-shot"]';
    await waitFor(mainWindow, `document.querySelector('[data-testid="resource-activity-panel"]')?.dataset.activeSubview === 'detail' && document.querySelector(${JSON.stringify(placementSelector)})`, 'Adaptive Parts Character detail did not expose its production placement action.');
    const placementCount = await page(mainWindow, `document.querySelectorAll(${JSON.stringify(placementSelector)}).length`);
    assert(placementCount >= 1, 'Adaptive Parts detail did not expose the existing Add to Current Shot action.');
    await click(mainWindow, placementSelector, 'Add Adaptive Parts to current Shot');
    await waitFor(mainWindow, `JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.layerJson ?? '[]').some((layer) => layer.source?.characterId === ${JSON.stringify(IDS.adaptiveCharacter)})`, 'Adaptive Parts was not placed as a Shot Character Layer.');
    await waitFor(mainWindow, `(() => { const stage = document.querySelector('[data-testid="project-canvas-stage"]'); const ids = JSON.parse(stage?.dataset.renderedAssetIds ?? '[]'); const incomplete = JSON.parse(stage?.dataset.incompleteVisualLayerIds ?? '[]'); return [${JSON.stringify(IDS.background)}, ${JSON.stringify(IDS.bodyArm)}, ${JSON.stringify(IDS.leg)}, ${JSON.stringify(IDS.head)}, ${JSON.stringify(IDS.skewPatch)}].every((id) => ids.includes(id)) && incomplete.length === 0; })()`, 'The editor Stage did not load every visible Adaptive Part and the background.');

    const afterPlacement = await page(mainWindow, 'window.__pandaStageIssue816Acceptance.inspect()');
    const shotAfterPlacement = afterPlacement.project.shots.find((shot) => shot.id === IDS.shot);
    const adaptiveLayer = shotAfterPlacement.layers.find((layer) => layer.source?.characterId === IDS.adaptiveCharacter);
    assert(adaptiveLayer && !Object.hasOwn(adaptiveLayer.source, 'expressionId'), 'Adaptive Shot Layer retained a fake Expression reference.');
    receipt.placement = {
      revision: afterPlacement.revision,
      dirty: afterPlacement.dirty,
      undoCount: afterPlacement.undoCount,
      layer: adaptiveLayer,
      layerCount: shotAfterPlacement.layers.length,
    };

    await expandProjectActions(mainWindow);
    await click(mainWindow, '[data-testid="quick-action-history"] .history-actions button:first-of-type', 'Undo Adaptive Parts placement');
    await waitFor(mainWindow, `!JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.layerJson ?? '[]').some((layer) => layer.source?.characterId === ${JSON.stringify(IDS.adaptiveCharacter)})`, 'Undo did not remove the Adaptive Shot Layer.');
    const afterUndo = await page(mainWindow, 'window.__pandaStageIssue816Acceptance.inspect()');
    assert(afterUndo.redoCount >= 1, 'Undo did not create an available Redo entry.');
    receipt.undo = { revision: afterUndo.revision, undoCount: afterUndo.undoCount, redoCount: afterUndo.redoCount, adaptiveLayerPresent: false };
    await click(mainWindow, '[data-testid="quick-action-history"] .history-actions button:last-of-type', 'Redo Adaptive Parts placement');
    await waitFor(mainWindow, `JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.layerJson ?? '[]').some((layer) => layer.source?.characterId === ${JSON.stringify(IDS.adaptiveCharacter)})`, 'Redo did not restore the Adaptive Shot Layer.');
    const afterRedo = await page(mainWindow, 'window.__pandaStageIssue816Acceptance.inspect()');
    receipt.redo = { revision: afterRedo.revision, undoCount: afterRedo.undoCount, redoCount: afterRedo.redoCount, adaptiveLayerPresent: true };

    await expandProjectActions(mainWindow);
    await click(mainWindow, '[data-testid="quick-action-save"]', 'Save the placed Adaptive Parts Project');
    await waitFor(mainWindow, `document.querySelector('[data-testid="project-save-state"]')?.dataset.saveState === 'saved' || document.querySelector('[data-testid="quick-action-save"]')?.dataset.saveState === 'saved'`, 'The Project did not finish saving.');
    const savedProject = await readPersistedProject();
    const savedShot = savedProject.shots.find((shot) => shot.id === IDS.shot);
    assert(savedShot.layers.some((layer) => layer.source?.characterId === IDS.adaptiveCharacter), 'Saved Project did not persist the Adaptive Shot Layer.');
    receipt.savedProjectSha256 = sha256(await fsp.readFile(path.join(projectRoot, 'project.json')));
    receipt.savedLayerCount = savedShot.layers.length;

    const reopen = await page(mainWindow, 'window.__pandaStageIssue816Acceptance.reopenSamePath()');
    assert(reopen?.project?.shots?.find((shot) => shot.id === IDS.shot)?.layers?.some((layer) => layer.source?.characterId === IDS.adaptiveCharacter), 'Same-path close and reopen lost the Adaptive Shot Layer.');
    receipt.reopen = { projectId: reopen.project.id, revision: reopen.revision, dirty: reopen.dirty, openInstanceId: reopen.openInstanceId, layerCount: reopen.project.shots.find((shot) => shot.id === IDS.shot).layers.length };
    await waitFor(mainWindow, `document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.incompleteVisualLayerIds === '[]'`, 'Reopened Shot did not render all visual Layers.');

    const stageSelector = '[data-testid="project-canvas-stage"]';
    if (await page(mainWindow, `document.querySelector('[data-testid="timeline-collapse"]')?.dataset.expanded === 'false'`)) {
      await click(mainWindow, '[data-testid="timeline-collapse"]', 'Expand Timeline ruler');
    }
    receipt.stageSamples = {};
    for (const sample of sampleTimes) {
      const actualTime = await seekEditor(mainWindow, sample.timeMs);
      await waitFor(mainWindow, `document.querySelector(${JSON.stringify(stageSelector)})?.dataset.currentTimeMs === ${JSON.stringify(String(actualTime))}`, `Editor Stage did not settle at ${sample.name}.`);
      const rendered = await captureCanvas(mainWindow, stageSelector, `stage-${sample.name}-canvas.png`);
      const screenPath = await captureWhole(mainWindow, `stage-${sample.name}-screen.png`);
      assert(rendered.stageData.incompleteVisualLayerIds.length === 0, `Stage ${sample.name} has incomplete visual Layers.`);
      const shot = activeProject.shots.find((candidate) => candidate.id === IDS.shot);
      const evaluated = evaluateShotAtTime(shot, actualTime, activeProject);
      const model = buildEditorStageRenderModel(activeProject, shot, evaluated);
      const adaptiveEntry = model.layers.find(({ layer }) => layer.source.kind === 'character' && layer.source.characterId === IDS.adaptiveCharacter);
      assert(adaptiveEntry?.visual.kind === 'adaptive-parts-character', 'Editor Stage did not resolve the Adaptive visual through the shared render model.');
      const visualParts = resolveLayerVisualParts(activeProject, shot, adaptiveEntry.evaluated).parts;
      assert(visualParts.filter((part) => part.visible).length === 5, 'Visible Part count differs from the four source/composite instances plus skew oracle Part.');
      const sourceOrder = visualParts.map((part) => part.source.kind === 'adaptive-part' ? part.source.characterPartId : 'unexpected');
      assert(JSON.stringify(sourceOrder) === JSON.stringify([IDS.leftLegPart, IDS.rightLegPart, IDS.bodyArmPart, IDS.skewPart, IDS.headPart, IDS.hiddenPart]), 'Part draw order or identity changed in the shared editor model.');
      assert(visualParts[0].assetId === visualParts[1].assetId && visualParts[0].partId !== visualParts[1].partId, 'Repeated leg image was deduplicated by asset instead of Part identity.');
      const skewPart = visualParts.find((part) => part.source.kind === 'adaptive-part' && part.source.characterPartId === IDS.skewPart);
      assert(skewPart?.visible, 'Synthetic skew oracle Part is missing or hidden.');
      if (sample.name === 'start') {
        const oracle = buildSkewAffineOracle(Konva, skewPart, adaptiveEntry.evaluated, 144, 108);
        const stageRgb = await decodeRgb(mediaTools.ffmpegPath, rendered.path);
        oracle.stagePixels = sampleSkewMarkers(
          stageRgb,
          rendered.width,
          rendered.height,
          oracle.markers,
          20,
          'Editor Stage',
        );
        receipt.skewOracle = oracle;
      }
      receipt.stageSamples[sample.name] = {
        requestedTimeMs: sample.timeMs,
        actualTimeMs: actualTime,
        width: rendered.width,
        height: rendered.height,
        canvasLayerCount: rendered.layerCount,
        screenshot: screenPath,
        canvas: rendered.path,
        renderedAssetIds: rendered.stageData.renderedAssetIds,
        layer: adaptiveEntry.layer,
        visualParts: visualParts.map((part) => ({ partId: part.partId, assetId: part.assetId, drawOrder: part.drawOrder, visible: part.visible, imageTransform: part.imageTransform, localRect: part.localRect })),
      };
    }

    await expandProjectActions(mainWindow);
    await click(mainWindow, '[data-testid="quick-action-play"]', 'Open Product Preview');
    receipt.lastStep = 'product-preview:wait-active';
    await waitFor(mainWindow, `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewSurface === 'active'`, 'Product Preview did not become active.');
    receipt.lastStep = 'product-preview:wait-ready';
    await waitFor(mainWindow, `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewReadiness === 'ready'`, 'Product Preview did not finish loading its initial frame.');
    receipt.lastStep = 'product-preview:read-playback-state';
    const initiallyPlaying = await page(mainWindow, `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'true'`);
    if (initiallyPlaying) {
      receipt.lastStep = 'product-preview:pause';
      await click(mainWindow, '[data-testid="product-preview-play-pause"]', 'Pause Product Preview');
    }
    receipt.lastStep = 'product-preview:wait-paused';
    await waitFor(mainWindow, `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'false'`, 'Product Preview did not pause before seeking.');
    receipt.previewSamples = {};
    const previewSelector = '[data-testid="product-preview-overlay"] .product-preview-stage [data-testid="stage-renderer"]';
    for (const sample of sampleTimes) {
      receipt.lastStep = `product-preview:seek:${sample.name}`;
      const actualTime = await seekPreview(mainWindow, sample.timeMs);
      receipt.previewSeekActual = actualTime;
      receipt.lastStep = `product-preview:capture-canvas:${sample.name}`;
      const rendered = await captureCanvas(mainWindow, previewSelector, `preview-${sample.name}-canvas.png`);
      receipt.lastStep = `product-preview:capture-screen:${sample.name}`;
      const screenPath = await captureWhole(mainWindow, `preview-${sample.name}-screen.png`);
      assert(rendered.stageData.stageReady === 'true' && rendered.stageData.displayReady === 'true' && rendered.stageData.stageError === 'false', `Product Preview ${sample.name} has not loaded the full shared StageRenderer asset set: ${JSON.stringify(rendered.stageData)}.`);
      if (sample.name === 'start') {
        const previewRgb = await decodeRgb(mediaTools.ffmpegPath, rendered.path);
        receipt.skewOracle.previewPixels = sampleSkewMarkers(
          previewRgb,
          rendered.width,
          rendered.height,
          receipt.skewOracle.markers,
          20,
          'Product Preview',
        );
      }
      receipt.previewSamples[sample.name] = {
        requestedTimeMs: sample.timeMs,
        actualTimeMs: actualTime,
        width: rendered.width,
        height: rendered.height,
        canvasLayerCount: rendered.layerCount,
        screenshot: screenPath,
        canvas: rendered.path,
        renderedAssetIds: rendered.stageData.renderedAssetIds,
      };
    }
    await click(mainWindow, '[data-testid="product-preview-close"]', 'Close Product Preview');
    await waitFor(mainWindow, `!document.querySelector('[data-testid="product-preview-overlay"]')`, 'Product Preview did not close.');

    await expandProjectActions(mainWindow);
    await click(mainWindow, '[data-testid="quick-action-export"]', 'Start formal MP4 export');
    await waitFor(mainWindow, `Boolean(document.querySelector('[data-testid="export-task-surface"]'))`, 'Formal export task surface did not open.');
    await waitFor(mainWindow, `Boolean(document.querySelector('[data-testid="export-task-surface"]')?.dataset.taskStatus === 'running' || document.querySelector('[data-testid="export-task-surface"]')?.dataset.taskStatus === 'completed')`, 'Formal export did not start.', 60_000);
    await waitFor(mainWindow, `Boolean(window.__pandaStageIssue816Acceptance?.inspect()?.project?.shots?.[0]?.layers?.some((layer) => layer.source?.characterId === ${JSON.stringify(IDS.adaptiveCharacter)}))`, 'The export snapshot lost the Adaptive Shot Layer.');
    const exportDeadline = Date.now() + 20 * 60_000;
    while (!activeExportPromise && Date.now() < exportDeadline) await pause(100);
    assert(activeExportPromise, 'The actual formal export handler did not receive an Export request.');
    const exportResult = await Promise.race([
      activeExportPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Formal MP4 export exceeded the 20-minute evidence timeout.')), 20 * 60_000)),
    ]);
    assert(exportResult.status === 'completed', `Formal Export status was ${exportResult.status}.`);
    assert(exportResult.outputPath === outputPath, `Formal Export path was ${exportResult.outputPath}, expected ${outputPath}.`);
    const outputStat = await fsp.stat(outputPath);
    assert(outputStat.isFile() && outputStat.size > 10_000, 'Formal MP4 output is absent or unexpectedly small.');
    receipt.export = {
      status: exportResult.status,
      jobId: exportResult.jobId,
      outputPath: exportResult.outputPath,
      byteLength: outputStat.size,
      render: exportResult.render,
      updates: jobUpdates,
      mediaTools: { ffmpegPath: mediaTools.ffmpegPath, ffprobePath: mediaTools.ffprobePath },
    };
    const decoded = await captureExportFrames(mediaTools.ffmpegPath, mediaTools.ffprobePath, outputPath);
    receipt.export.ffprobe = decoded.probe;
    receipt.export.frameCount = decoded.frameCount;
    receipt.export.fps = decoded.fps;
    receipt.export.frames = decoded.frames;
    const exportRgb = await decodeRgb(mediaTools.ffmpegPath, decoded.frames.start);
    receipt.skewOracle.exportPixels = sampleSkewMarkers(
      exportRgb,
      1920,
      1080,
      receipt.skewOracle.markers,
      44,
      'Formal MP4',
    );
    receipt.comparisons = {};
    for (const sample of sampleTimes) {
      const stagePath = await normalizePng(mediaTools.ffmpegPath, receipt.stageSamples[sample.name].canvas, `stage-${sample.name}-normalized.png`);
      const previewPath = await normalizePng(mediaTools.ffmpegPath, receipt.previewSamples[sample.name].canvas, `preview-${sample.name}-normalized.png`);
      const exportPath = decoded.frames[sample.name];
      const stageToPreview = await comparePngs(mediaTools.ffmpegPath, stagePath, previewPath);
      const stageToExport = await comparePngs(mediaTools.ffmpegPath, stagePath, exportPath);
      const previewToExport = await comparePngs(mediaTools.ffmpegPath, previewPath, exportPath);
      assert(stageToPreview.meanAbsoluteChannelDifference <= 1.5, `${sample.name}: Stage and Product Preview differ by more than 1.5 mean channel values.`);
      assert(stageToExport.meanAbsoluteChannelDifference <= 18, `${sample.name}: Stage and formal MP4 differ by more than 18 mean channel values.`);
      assert(previewToExport.meanAbsoluteChannelDifference <= 18, `${sample.name}: Product Preview and formal MP4 differ by more than 18 mean channel values.`);
      assert(stageToExport.candidateNonDarkPixelPercent > 2, `${sample.name}: formal MP4 frame contains no meaningful non-background visual.`);
      receipt.comparisons[sample.name] = {
        actualTimeMs: receipt.previewSamples[sample.name].actualTimeMs,
        exportFrameIndex: sample.frame,
        stageToPreview,
        stageToExport,
        previewToExport,
      };
    }
    receipt.auto = 'AUTO_PASS';
    receipt.status = 'C2_SYNTHETIC_ELECTRON_CHAIN_PASS';
    receipt.completedAt = new Date().toISOString();
    await fsp.writeFile(resultPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    return receipt;
  } catch (error) {
    receipt.auto = 'AUTO_FAIL';
    receipt.status = 'C2_PARTIAL';
    receipt.failedAt = new Date().toISOString();
    receipt.error = error instanceof Error ? error.stack ?? error.message : String(error);
    receipt.trackedSnapshot = trackedSnapshot;
    receipt.jobUpdates = jobUpdates;
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        receipt.failureUi = await page(mainWindow, `(() => ({
          title: document.title,
          activeActivity: document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.activeActivity ?? null,
          activeSubview: document.querySelector('[data-testid="resource-activity-panel"]')?.dataset.activeSubview ?? null,
          drawerOpen: document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceDrawerOpen ?? null,
          characterListPresent: Boolean(document.querySelector('[data-testid="character-list-view"]')),
          characterCards: [...document.querySelectorAll('[data-testid="character-list-view"] [data-character-id]')].map((element) => ({
            id: element.dataset.characterId ?? '',
            selected: element.getAttribute('aria-pressed'),
            rect: (() => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; })(),
          })),
          detailCharacterId: document.querySelector('[data-testid="character-detail-view"]')?.dataset.characterEditorId ?? null,
          characterEditors: [...document.querySelectorAll('[data-character-editor-id]')].map((element) => ({ id: element.dataset.characterEditorId ?? '', testId: element.getAttribute('data-testid') ?? '' })),
          placementActions: [...document.querySelectorAll('[data-testid="character-detail-place-current-shot"]')].map((element) => ({ disabled: element.disabled, title: element.title })),
          preview: (() => {
            const overlay = document.querySelector('[data-testid="product-preview-overlay"]');
            if (!overlay) return null;
            return {
              surface: overlay.dataset.previewSurface ?? null,
              readiness: overlay.dataset.previewReadiness ?? null,
              handoff: overlay.dataset.previewHandoff ?? null,
              reveal: overlay.dataset.previewReveal ?? null,
              playing: overlay.dataset.previewPlaying ?? null,
              failedAssetIds: overlay.dataset.previewFailedAssetIds ?? null,
              stageFailures: overlay.dataset.previewStageFailures ?? null,
            };
          })(),
          bodyText: document.body.innerText.slice(0, 2_000),
        }))()`);
        receipt.failureScreenshot = await captureWhole(mainWindow, 'failure-screen.png');
      } catch (diagnosticError) {
        receipt.failureDiagnosticsError = diagnosticError instanceof Error
          ? diagnosticError.message
          : String(diagnosticError);
      }
    }
    await fsp.writeFile(resultPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    throw error;
  } finally {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    hiddenWindowManager?.close();
    await exportPreparationService?.dispose().catch(() => undefined);
    for (const channel of registeredChannels) ipcMain.removeHandler(channel);
  }
}

main()
  .then((receipt) => {
    process.stdout.write(`${JSON.stringify({ status: receipt.status, evidenceRoot, outputPath, resultPath }, null, 2)}\n`);
    app.exit(0);
  })
  .catch((error) => {
    process.stderr.write(`[issue897-c2] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    app.exit(1);
  });

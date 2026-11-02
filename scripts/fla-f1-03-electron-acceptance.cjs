#!/usr/bin/env node
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { deflateSync } = require('node:zlib');

const REPO_ROOT = path.resolve(__dirname, '..');
const ACCEPTANCE_ROOT = 'D:\\PandaStage-Acceptance';
const DEFAULT_SOURCE = path.join(ACCEPTANCE_ROOT, 'issue-893-r1c-20261030-0d4aecbc', 'source-readonly.fla');
const EXPECTED_SOURCE_SHA256 = '0d4aecbc159990ce54b9d0d8c31ea0f3354cd7ed86df77bac19a562dfc761fa2';
const MAX_SOURCE_BYTES = 256 * 1024 * 1024;

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === '--help' || current === '-h') {
      options.help = true;
      continue;
    }
    if (!current || !current.startsWith('--')) continue;
    options[current.slice(2)] = argv[index + 1];
    index += 1;
  }
  return options;
}

function isWithin(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function realRegularFile(inputPath, label) {
  const resolved = path.resolve(inputPath);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file, not a link`);
  const actual = fs.realpathSync(resolved);
  if (actual.toLocaleLowerCase('en-US') !== resolved.toLocaleLowerCase('en-US')) {
    throw new Error(`${label} resolves through an alias; supply its real path`);
  }
  if (isWithin(fs.realpathSync(REPO_ROOT), actual)) throw new Error(`${label} must stay outside the repository`);
  return actual;
}

function makeNewOutputDirectory(inputPath) {
  const resolved = path.resolve(inputPath);
  if (!isWithin(path.resolve(ACCEPTANCE_ROOT), resolved) || resolved === path.resolve(ACCEPTANCE_ROOT)) {
    throw new Error('Output directory must be a new child of D:\\PandaStage-Acceptance');
  }
  if (fs.existsSync(resolved)) throw new Error('Output directory already exists; refusing to overwrite private evidence');
  fs.mkdirSync(ACCEPTANCE_ROOT, { recursive: true });
  const parent = path.dirname(resolved);
  fs.mkdirSync(parent, { recursive: true });
  if (isWithin(fs.realpathSync(REPO_ROOT), fs.realpathSync(parent))) throw new Error('Output directory must stay outside the repository');
  fs.mkdirSync(resolved, { recursive: false });
  return resolved;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return output;
}

function acceptanceSeedPng() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(2, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc(18);
  for (let row = 0; row < 2; row += 1) {
    scanlines[row * 9] = 0;
    scanlines.fill(0x66, row * 9 + 1, (row + 1) * 9);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function writeNewFile(filePath, bytes) {
  const resolved = path.resolve(filePath);
  if (!isWithin(fs.realpathSync(OUTPUT_DIRECTORY), resolved)) throw new Error('Evidence file escaped the new acceptance directory');
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const fd = fs.openSync(resolved, 'wx');
  try {
    fs.writeFileSync(fd, buffer);
  } finally {
    fs.closeSync(fd);
  }
  return { file: path.basename(resolved), byteLength: buffer.byteLength, sha256: sha256(buffer) };
}

function outputDirectoryDefault() {
  const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('-', '').replaceAll('.', '');
  return path.join(ACCEPTANCE_ROOT, `issue908-f1-03-${stamp}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function closeOnce(window) {
  if (window && !window.isDestroyed()) window.destroy();
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write([
    'Usage: electron scripts/fla-f1-03-electron-acceptance.cjs [--source <sample-a-copy.fla>] [--output-dir <new-directory>]',
    'Uses only the previously accepted Sample A source and writes all artifacts under a new D:\\PandaStage-Acceptance directory.',
  ].join('\n') + '\n');
  process.exit(0);
}

let OUTPUT_DIRECTORY;
let sourcePath;
let sourceCopyPath;
let movedSourcePath;
let sourceBytes;
let sourceHashBefore;
let mainWindow;
let inspectionService;
let snapshotWindowManager;
let renderSession;
let partPreviewService;
let createService;
let autosaveService;
let removeProjectHandlers;
let removeRecoveryHandlers;
let removeRecentProjectHandlers;
let removeImportHandlers;
let removeSnapshotHandlers;
let removePartPreviewHandlers;
let removeCreateHandlers;
let removeAssetImageHandler;
let removeSessionListener;
let sourceSessionId;
let observedPreviewResponse;
let responseLossOperationId = null;
let responseLossTriggered = false;
let primaryError;
let appReady = false;

try {
  sourcePath = realRegularFile(args.source || DEFAULT_SOURCE, 'Sample A source');
  sourceBytes = fs.readFileSync(sourcePath);
  if (sourceBytes.length <= 0 || sourceBytes.length > MAX_SOURCE_BYTES) throw new Error('Sample A source exceeds the accepted FLA source limit');
  sourceHashBefore = sha256(sourceBytes);
  if (sourceHashBefore !== EXPECTED_SOURCE_SHA256) throw new Error('Sample A source SHA-256 does not match the previously accepted readonly copy');
  OUTPUT_DIRECTORY = makeNewOutputDirectory(args['output-dir'] || outputDirectoryDefault());
  sourceCopyPath = path.join(OUTPUT_DIRECTORY, 'source-sample-a.fla');
  fs.copyFileSync(sourcePath, sourceCopyPath, fs.constants.COPYFILE_EXCL);
  const profileDirectory = path.join(OUTPUT_DIRECTORY, 'electron-profile');
  fs.mkdirSync(profileDirectory, { recursive: false });
  app.setName('Panda Stage F1-03 Acceptance');
  app.setPath('userData', profileDirectory);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

async function waitForHook(timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (mainWindow.isDestroyed()) throw new Error('The F1-03 Electron window closed before its acceptance hook became ready.');
    const ready = await mainWindow.webContents.executeJavaScript(
      "Boolean(window.__pandaStageFlaF103Acceptance && window.pandaStage)",
      true,
    ).catch(() => false);
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Timed out waiting for the real renderer F1-03 acceptance hook.');
}

async function inspectRenderer() {
  return mainWindow.webContents.executeJavaScript('window.__pandaStageFlaF103Acceptance.inspect()', true);
}

async function comparePngs(nativePng, reassembledPng, referencePng) {
  const toDataUrl = (image) => `data:image/png;base64,${Buffer.from(image.bytes).toString('base64')}`;
  const payload = {
    native: toDataUrl(nativePng),
    reassembled: toDataUrl(reassembledPng),
    reference: `data:image/png;base64,${referencePng.toString('base64')}`,
  };
  const script = `
    (async (images) => {
      const load = async (url) => { const image = new Image(); image.src = url; await image.decode(); return image; };
      const diff = async (leftUrl, rightUrl) => {
        const left = await load(leftUrl); const right = await load(rightUrl);
        if (left.naturalWidth !== right.naturalWidth || left.naturalHeight !== right.naturalHeight) {
          return { comparable: false, reason: 'Image dimensions differ', left: [left.naturalWidth, left.naturalHeight], right: [right.naturalWidth, right.naturalHeight] };
        }
        const canvas = document.createElement('canvas'); canvas.width = left.naturalWidth; canvas.height = left.naturalHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(left, 0, 0); const a = context.getImageData(0, 0, canvas.width, canvas.height).data;
        context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(right, 0, 0);
        const b = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let totalDifference = 0; let maximumChannelDifference = 0; let pixelsOverFive = 0; let differentPixels = 0;
        for (let i = 0; i < a.length; i += 4) {
          let pixelDifference = 0; let changed = false;
          for (let channel = 0; channel < 3; channel += 1) {
            const difference = Math.abs(a[i + channel] - b[i + channel]);
            totalDifference += difference;
            pixelDifference += difference;
            maximumChannelDifference = Math.max(maximumChannelDifference, difference);
            if (difference) changed = true;
          }
          const alphaDifference = Math.abs(a[i + 3] - b[i + 3]);
          maximumChannelDifference = Math.max(maximumChannelDifference, alphaDifference);
          if (alphaDifference) changed = true;
          if (changed) differentPixels += 1;
          if (pixelDifference / 3 > 5) pixelsOverFive += 1;
        }
        const pixels = canvas.width * canvas.height;
        return { comparable: true, width: canvas.width, height: canvas.height,
          meanAbsoluteChannelDifference: totalDifference / (pixels * 3),
          pixelsOver5DifferencePercent: pixelsOverFive * 100 / pixels,
          differentPixels, totalPixels: pixels, maximumChannelDifference };
      };
      return { nativeVsReassembled: await diff(images.native, images.reassembled), nativeVsAnimateReference: await diff(images.native, images.reference), reassembledVsAnimateReference: await diff(images.reassembled, images.reference) };
    })(${JSON.stringify(payload)})`;
  return mainWindow.webContents.executeJavaScript(script, true);
}

async function runAcceptance() {
  const {
    FlaImportService,
  } = require('../dist-electron/main/services/FlaImportService.js');
  const {
    FlaStaticSnapshotRenderSession,
  } = require('../dist-electron/main/services/fla-static-snapshot-render-session.js');
  const {
    FlaStaticSnapshotWindowManager,
  } = require('../dist-electron/main/services/fla-static-snapshot-window-manager.js');
  const {
    FlaPartPreviewService,
  } = require('../dist-electron/main/services/FlaPartPreviewService.js');
  const {
    FlaCharacterCreateService,
  } = require('../dist-electron/main/services/FlaCharacterCreateService.js');
  const {
    ProjectService,
  } = require('../dist-electron/main/services/ProjectService.js');
  const { CharacterService, ImageAssetSchema, ProjectSchema } = require('../dist-electron/domain/index.js');
  const {
    AutosaveService,
  } = require('../dist-electron/main/services/AutosaveService.js');
  const {
    RecoveryService,
  } = require('../dist-electron/main/services/RecoveryService.js');
  const {
    RecentProjectsService,
  } = require('../dist-electron/main/services/RecentProjectsService.js');
  const {
    ProjectOperationCoordinator,
  } = require('../dist-electron/main/services/ProjectOperationCoordinator.js');
  const {
    PathService,
  } = require('../dist-electron/main/services/PathService.js');
  const {
    AssetCanvasImageService,
  } = require('../dist-electron/main/services/AssetCanvasImageService.js');
  const {
    registerProjectIpcHandlers,
  } = require('../dist-electron/main/ipc/register-project-ipc-handlers.js');
  const {
    registerRecoveryIpcHandlers,
  } = require('../dist-electron/main/ipc/register-recovery-ipc-handlers.js');
  const {
    registerRecentProjectsIpcHandlers,
  } = require('../dist-electron/main/ipc/register-recent-projects-ipc-handlers.js');
  const {
    registerFlaImportIpcHandlers,
  } = require('../dist-electron/main/ipc/register-fla-import-ipc-handlers.js');
  const {
    registerFlaStaticSnapshotIpcHandlers,
  } = require('../dist-electron/main/ipc/register-fla-static-snapshot-ipc-handlers.js');
  const {
    registerFlaPartPreviewIpcHandlers,
  } = require('../dist-electron/main/ipc/register-fla-part-preview-ipc-handlers.js');
  const {
    registerFlaCharacterCreateIpcHandlers,
  } = require('../dist-electron/main/ipc/register-fla-character-create-ipc-handlers.js');
  const {
    stableRenderTargetId,
  } = require('../dist-electron/main/services/fla-static-snapshot-svg-builder.js');
  const {
    ProjectOpenFolderRequestSchema,
  } = require('../dist-electron/shared/project-api.js');
  const {
    AssetCanvasImageReadRequestSchema,
    AssetCanvasImageReadResponseSchema,
  } = require('../dist-electron/shared/asset-canvas-image-api.js');
  const {
    IPC_CHANNELS,
  } = require('../dist-electron/shared/ipc/channels.js');

  const recoveryService = new RecoveryService();
  const coordinator = new ProjectOperationCoordinator();
  let projectService;
  autosaveService = new AutosaveService({ recoveryService, coordinator });
  projectService = new ProjectService({
    coordinator,
    pathService: new PathService(),
    getCurrentProjectSnapshot: (root) => {
      const snapshot = autosaveService.getProjectSnapshot(root);
      return snapshot ? { project: snapshot.project, revision: snapshot.revision } : null;
    },
    onProjectSaved: async (root, project, revision) => {
      if (revision !== undefined) autosaveService.markFormalSaved(root, project, revision);
    },
    onProjectOpened: async (root, project) => {
      await createService?.recoverProjectArtifacts(root, project);
    },
  });

  const projectRoot = path.join(OUTPUT_DIRECTORY, 'F1-03 Acceptance.pandastage');
  const initialDocument = await projectService.create(projectRoot, { name: 'F1-03 Acceptance' });
  const existingImageBytes = acceptanceSeedPng();
  const existingImagePath = path.join(projectRoot, 'assets', 'existing-character-fixture.png');
  fs.writeFileSync(existingImagePath, existingImageBytes, { flag: 'wx' });
  const existingImageAsset = ImageAssetSchema.parse({
    id: crypto.randomUUID(),
    name: 'Existing Character Fixture',
    relativePath: 'assets/existing-character-fixture.png',
    mimeType: 'image/png',
    sha256: sha256(existingImageBytes),
    kind: 'image',
    width: 2,
    height: 2,
    usage: 'character',
    keywords: [],
    metadata: { status: 'ready', warnings: [] },
  });
  const projectWithSeedAsset = ProjectSchema.parse({
    ...initialDocument.project,
    assets: [...initialDocument.project.assets, existingImageAsset],
  });
  const existingCharacterProject = new CharacterService().create(projectWithSeedAsset, {
    name: 'Existing Character',
    expressions: [{ name: 'Normal', assetId: existingImageAsset.id }],
  });
  const initialProjectDocument = await projectService.transact(projectRoot, (transaction) =>
    transaction.save(existingCharacterProject, 1),
  );
  const initialProject = initialProjectDocument.project;
  const originalExistingCharacter = initialProject.characters[0];
  assert(originalExistingCharacter, 'The seeded Project does not contain its existing Character.');

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 980,
    show: true,
    title: 'Panda Stage — F1-03 Acceptance',
    webPreferences: {
      preload: path.join(REPO_ROOT, 'dist-electron', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });
  mainWindow.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) process.stderr.write(`Renderer: ${message}\n`);
  });
  removeProjectHandlers = registerProjectIpcHandlers({
    getMainWindow: () => mainWindow,
    projectService,
    openProjectFolder: async (root) => {
      ProjectOpenFolderRequestSchema.parse({ projectRoot: root });
      return '';
    },
    confirmProjectSwitch: async () => 'discarded',
  });
  removeRecoveryHandlers = registerRecoveryIpcHandlers({
    getMainWindow: () => mainWindow,
    projectService,
    recoveryService,
    autosaveService,
  });
  const recentProjectsService = new RecentProjectsService({
    configurationFilePath: path.join(app.getPath('userData'), 'recent-projects.json'),
  });
  removeRecentProjectHandlers = registerRecentProjectsIpcHandlers({
    getMainWindow: () => mainWindow,
    projectService,
    recentProjectsService,
    selectProjectDirectory: async () => null,
  });
  await mainWindow.loadFile(path.join(REPO_ROOT, 'dist', 'renderer', 'index.html'), {
    query: { flaF103Acceptance: '1' },
  });
  mainWindow.show();
  mainWindow.focus();
  await waitForHook();

  inspectionService = new FlaImportService();
  removeImportHandlers = registerFlaImportIpcHandlers({
    getMainWindow: () => mainWindow,
    flaImportService: inspectionService,
    flaAssetCommitService: {},
    selectFlaSource: async () => null,
  });
  snapshotWindowManager = new FlaStaticSnapshotWindowManager();
  renderSession = new FlaStaticSnapshotRenderSession({
    rasterizer: snapshotWindowManager,
    sourceLookup: {
      getSource(id) {
        const session = inspectionService.getSession(id);
        if (!session?.sourceBytes) return null;
        const { basename, sha256: normalizedSha256 } = session.ir.source;
        if (!basename || !normalizedSha256) return null;
        return {
          bytes: session.sourceBytes,
          basename,
          sha256: normalizedSha256,
          originalSourceSha256: session.originalSourceSha256 ?? normalizedSha256,
          media: session.ir.media,
        };
      },
    },
  });
  removeSnapshotHandlers = registerFlaStaticSnapshotIpcHandlers({
    getMainWindow: () => mainWindow,
    renderSession,
    commitService: {},
    windowManager: snapshotWindowManager,
  });
  partPreviewService = new FlaPartPreviewService({ flaImportService: inspectionService, renderSession, rasterizer: snapshotWindowManager });
  removeSessionListener = inspectionService.onSessionReleased((id) => partPreviewService.invalidateSession(id));
  removePartPreviewHandlers = registerFlaPartPreviewIpcHandlers({
    getMainWindow: () => mainWindow,
    service: {
      async preview(request) {
        observedPreviewResponse = await partPreviewService.preview(request);
        return observedPreviewResponse;
      },
      cancel: (request) => partPreviewService.cancel(request),
    },
  });
  createService = new FlaCharacterCreateService({
    projectService,
    partPreviewService,
    getCurrentProjectSnapshot: (root) => {
      const snapshot = autosaveService.getProjectSnapshot(root);
      return snapshot ? {
        projectRoot: snapshot.projectRoot,
        project: snapshot.project,
        revision: snapshot.revision,
        openInstanceId: snapshot.openInstanceId ?? null,
      } : null;
    },
  });
  removeCreateHandlers = registerFlaCharacterCreateIpcHandlers({
    getMainWindow: () => mainWindow,
    service: createService,
    afterCommitBeforeResponse(request) {
      if (request.operationId !== responseLossOperationId) return;
      responseLossTriggered = true;
      responseLossOperationId = null;
      throw new Error('Controlled F1-03 acceptance response loss after Main commit.');
    },
  });
  const assetImageService = new AssetCanvasImageService({
    getCurrentProjectSnapshot: (root) => {
      const snapshot = autosaveService.getProjectSnapshot(root);
      return snapshot ? { project: snapshot.project } : null;
    },
  });
  const assertTrustedAssetSender = (event) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) throw new Error('Untrusted canvas image IPC sender');
  };
  ipcMain.handle(IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ, async (event, rawRequest) => {
    assertTrustedAssetSender(event);
    const parsed = AssetCanvasImageReadRequestSchema.safeParse(rawRequest);
    if (!parsed.success) return AssetCanvasImageReadResponseSchema.parse({ ok: false, error: { code: 'ASSET_CANVAS_IMAGE_INVALID_REQUEST', message: 'Canvas image request is invalid.', assetId: '(invalid)' } });
    return AssetCanvasImageReadResponseSchema.parse(await assetImageService.read(parsed.data));
  });
  removeAssetImageHandler = () => ipcMain.removeHandler(IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ);

  const inspected = await inspectionService.inspectSource(sourceCopyPath, crypto.randomUUID());
  if (!inspected?.ok) throw new Error(`Main FLA inspection failed: ${inspected?.error?.code || 'unknown error'}`);
  sourceSessionId = inspected.sessionId;
  const sourceSession = inspectionService.getSession(sourceSessionId);
  assert(sourceSession?.sourceBytes, 'Main FLA inspection did not retain the Sample A bytes.');
  assert(sha256(sourceSession.sourceBytes) === sourceSession.ir.source.sha256.toLowerCase(), 'The retained FLA bytes do not match their normalized source hash.');
  assert((sourceSession.originalSourceSha256 || inspected.ir.source.sha256).toLowerCase() === EXPECTED_SOURCE_SHA256, 'The retained source identity is not the authorized Sample A copy.');

  const target = {
    renderTargetId: stableRenderTargetId(sourceSession.sourceBytes, 'scene\u0000timeline\u00000'),
    selectedFrameIndex: 0,
  };
  const previewRequest = {
    format: 'fla-part-preview',
    version: 1,
    requestId: crypto.randomUUID(),
    sessionId: sourceSessionId,
    generation: 1,
    target,
  };

  await mainWindow.webContents.executeJavaScript(
    `window.__pandaStageFlaF103Acceptance.openProject(${JSON.stringify(projectRoot)})`, true,
  );
  const initialState = await inspectRenderer();
  assert(initialState?.project?.id === initialProject.id && initialState.revision === 0 && initialState.dirty === false, 'The renderer did not open the expected fresh Project.');
  assert(initialState.project.characters.length === 1 && initialState.project.characters[0].id === originalExistingCharacter.id, 'The Project did not open with its pre-existing Character.');
  assert(initialState.project.assets.some((asset) => asset.id === existingImageAsset.id), 'The pre-existing Character image Asset is missing from the open Project.');
  const editedState = await mainWindow.webContents.executeJavaScript('window.__pandaStageFlaF103Acceptance.editUnsavedFixture()', true);
  assert(editedState.dirty === true && editedState.revision === 1, 'The dirty unsaved Project fixture was not established at revision 1.');
  assert(editedState.editedCharacterId === originalExistingCharacter.id, 'The acceptance edit did not target the existing Character.');
  assert(editedState.originalCharacterName === originalExistingCharacter.name && editedState.editedCharacterName !== originalExistingCharacter.name, 'The existing Character edit was not applied.');

  const previewSummary = await mainWindow.webContents.executeJavaScript(`(async () => {
    const response = await window.pandaStage.fla.partPreview(${JSON.stringify(previewRequest)});
    window.__f103PreparedPreview = response;
    return response.ok ? { ok: true, planId: response.planId, capability: response.capability, partCount: response.partPreviews.length } : { ok: false, error: response.error };
  })()`, true);
  assert(previewSummary?.ok && previewSummary.capability === 'EDITABLE_PARTS_READY', `F1-02 did not prepare an editable Part batch: ${JSON.stringify(previewSummary)}`);
  assert(observedPreviewResponse?.ok, 'The real Main Part preview IPC did not produce the captured response.');
  const preparedBatch = partPreviewService.getPreparedBatch(previewSummary.planId, sourceSessionId, previewRequest.generation);
  const plan = partPreviewService.getPlan(previewSummary.planId, sourceSessionId, previewRequest.generation);
  assert(preparedBatch && plan, 'The exact Main-held plan and PNG batch were not available.');
  assert(preparedBatch.parts.length === observedPreviewResponse.partPreviews.length, 'Main-held PNG batch length differs from the renderer preview.');
  for (let index = 0; index < preparedBatch.parts.length; index += 1) {
    const held = preparedBatch.parts[index];
    const emitted = observedPreviewResponse.partPreviews[index];
    assert(held.unitId === emitted.unitId && held.occurrenceId === emitted.occurrenceId && held.drawOrder === index, `Preview Part ${index} identity or order changed.`);
    assert(held.image.sha256 === emitted.image.sha256 && sha256(Buffer.from(held.image.bytes)) === held.image.sha256, `Preview Part ${index} image bytes changed.`);
    assert(JSON.stringify(held.stageMapping) === JSON.stringify(plan.units[index].stageMapping), `Preview Part ${index} stage mapping changed.`);
  }
  const comparison = await comparePngs(observedPreviewResponse.nativePreview, observedPreviewResponse.reassembledPreview, fs.readFileSync(path.join(ACCEPTANCE_ROOT, 'issue-893-r1c-20261030-0d4aecbc', 'animate-exports', 'an-original-stage-frame-000.png')));
  const changedRate = comparison.nativeVsReassembled.differentPixels / comparison.nativeVsReassembled.totalPixels;
  assert(comparison.nativeVsReassembled.comparable && changedRate <= 0.005 && comparison.nativeVsReassembled.maximumChannelDifference <= 8, `Native/reassembled pixels exceeded the accepted threshold (${(changedRate * 100).toFixed(3)}%, max channel ${comparison.nativeVsReassembled.maximumChannelDifference}).`);

  movedSourcePath = path.join(OUTPUT_DIRECTORY, 'source-sample-a.moved.fla');
  fs.renameSync(sourceCopyPath, movedSourcePath);
  assert(!fs.existsSync(sourceCopyPath) && sha256File(movedSourcePath) === EXPECTED_SOURCE_SHA256, 'The acceptance-owned FLA copy did not move cleanly while preserving its bytes.');

  const operationId = crypto.randomUUID();
  responseLossOperationId = operationId;
  const created = await mainWindow.webContents.executeJavaScript(`window.__pandaStageFlaF103Acceptance.createCharacter(window.__f103PreparedPreview, 'Sample A Character', ${JSON.stringify(operationId)})`, true);
  const stateAfterCreate = await inspectRenderer();
  assert(created.projectId === initialProject.id && created.baseRevision === editedState.revision && created.savedRevision === editedState.revision + 1, 'Character creation did not save exactly one revision from the edited Project snapshot.');
  assert(stateAfterCreate.revision === created.savedRevision && stateAfterCreate.dirty === false, 'The renderer did not accept the single saved Character revision.');
  assert(stateAfterCreate.project.name === editedState.project.name, 'The Project metadata changed during Character creation.');
  assert(stateAfterCreate.project.characters.find((item) => item.id === originalExistingCharacter.id)?.name === editedState.editedCharacterName, 'The unsaved edit to the existing Character was lost during Character creation.');
  assert(stateAfterCreate.project.characters.length === editedState.project.characters.length + 1, 'Character creation did not append exactly one Character.');
  assert(stateAfterCreate.project.voiceProfiles.length === editedState.project.voiceProfiles.length + 1, 'Character creation did not append exactly one default VoiceProfile.');
  assert(stateAfterCreate.undoCount === 2 && stateAfterCreate.nextUndoLabel === '\u5bfc\u5165\u89d2\u8272', 'The import did not append one History command after the existing Character edit.');
  assert(responseLossTriggered && responseLossOperationId === null, 'The IPC reply was not deliberately lost after Main committed the first operation.');
  assert(JSON.stringify(stateAfterCreate.project.shots) === JSON.stringify(editedState.project.shots), 'Character creation changed the Project Shots.');
  assert(stateAfterCreate.nextUndoLabel === '\u5bfc\u5165\u89d2\u8272', 'The F1-03 History command is not labeled 导入角色.');
  const character = stateAfterCreate.project.characters.find((item) => item.id === created.characterId);
  assert(character?.mode === 'adaptive-parts', 'F1-03 did not create one adaptive-parts Character.');
  assert(character.parts.length === preparedBatch.parts.length, 'Character Part count does not match the held PNG batch.');
  assert(character.defaultVoiceProfileId === created.voiceProfileId, 'The Character is not linked to the newly-created default VoiceProfile.');
  assert(created.assets.length === preparedBatch.parts.length, 'The saved asset outcomes do not represent every prepared occurrence.');
  const uniqueHashes = new Set(preparedBatch.parts.map((part) => part.image.sha256));
  const uniqueAssetIds = new Set(character.parts.map((part) => part.assetId));
  assert(uniqueAssetIds.size === uniqueHashes.size, 'Equal image content was not deduplicated to one Project Asset.');
  assert(new Set(character.parts.map((part) => part.partId)).size === character.parts.length, 'Distinct source occurrences were merged into one Part.');
  assert(new Set(character.parts.map((part) => part.source.sourceId)).size === character.parts.length, 'Distinct source occurrences do not retain separate source IDs.');
  for (let index = 0; index < preparedBatch.parts.length; index += 1) {
    const held = preparedBatch.parts[index];
    const part = character.parts[index];
    const assetOutcome = created.assets[index];
    assert(assetOutcome.occurrenceId === held.occurrenceId && part.assetId === assetOutcome.assetId, `Saved Part ${index} no longer matches the Main-held occurrence.`);
    assert(assetOutcome.sha256 === held.image.sha256, `Saved Part ${index} content hash changed.`);
    assert(part.drawOrder === index && part.source.effectiveFrame === (plan.units[index].sourceFrame.effectiveChildFrameIndex ?? plan.target.selectedFrameIndex), `Saved Part ${index} source frame or draw order changed.`);
    assert(part.source.sourcePoseFrame === plan.target.selectedFrameIndex && part.source.sourceId.endsWith(held.occurrenceId), `Saved Part ${index} source occurrence identity changed.`);
    const restTransform = part.restTransform;
    assert(restTransform.a === 1 && restTransform.b === 0 && restTransform.c === 0 && restTransform.d === 1 && restTransform.tx === 0 && restTransform.ty === 0, `Saved Part ${index} does not use the confirmed stage identity transform.`);
    assert(part.sourceRestTransform.a === 1 && part.sourceRestTransform.b === 0 && part.sourceRestTransform.c === 0 && part.sourceRestTransform.d === 1 && part.sourceRestTransform.tx === 0 && part.sourceRestTransform.ty === 0, `Saved Part ${index} retained an unintended source transform.`);
    assert(part.staticAdjustment.offsetX === 0 && part.staticAdjustment.offsetY === 0 && part.staticAdjustment.scale === 1 && part.staticAdjustment.rotationDeg === 0, `Saved Part ${index} did not start with default edit values.`);
    assert(part.imageMapping.sourceWidth === plan.stage.width && part.imageMapping.sourceHeight === plan.stage.height && part.imageMapping.crop.x === 0 && part.imageMapping.crop.y === 0 && part.imageMapping.crop.width === plan.stage.width && part.imageMapping.crop.height === plan.stage.height && part.imageMapping.exportScale === 1, `Saved Part ${index} image mapping does not preserve the full stage.`);
  }
  assert(stateAfterCreate.project.shots.every((shot) => !shot.characterIds.includes(created.characterId)), 'The new Character was automatically added to a Shot.');

  const status = await mainWindow.webContents.executeJavaScript(`window.pandaStage.fla.getCharacterCreateStatus({ format: 'panda-fla-character-create-status', version: 1, operationId: ${JSON.stringify(operationId)}, projectRoot: ${JSON.stringify(projectRoot)}, projectId: ${JSON.stringify(initialProject.id)} })`, true);
  assert(status?.ok && status.status === 'COMMITTED' && status.result.characterId === created.characterId, 'The idempotent operation status did not return the committed result.');

  const undoImport = await mainWindow.webContents.executeJavaScript('window.__pandaStageFlaF103Acceptance.undo()', true);
  const stateAfterUndoImport = await inspectRenderer();
  assert(undoImport === true && !stateAfterUndoImport.project.characters.some((item) => item.id === created.characterId), 'Undo import did not remove the new Character.');
  assert(stateAfterUndoImport.project.characters.find((item) => item.id === originalExistingCharacter.id)?.name === editedState.editedCharacterName, 'Undo import did not preserve the earlier Character edit.');
  assert(stateAfterUndoImport.undoCount === 1 && stateAfterUndoImport.redoCount === 1 && stateAfterUndoImport.nextUndoLabel === 'Edit existing Character', 'Undo import did not expose the earlier edit as the next undo command.');
  const retainedFilesAfterUndo = created.assets.filter((asset) => asset.status === 'created').map((asset) => ({
    assetId: asset.assetId,
    sha256: asset.sha256,
    path: path.join(projectRoot, asset.relativePath),
  }));
  assert(retainedFilesAfterUndo.every((asset) => fs.existsSync(asset.path) && sha256File(asset.path) === asset.sha256), 'Undo import deleted or changed a newly-created PNG still needed for Redo.');

  const undoExistingEdit = await mainWindow.webContents.executeJavaScript('window.__pandaStageFlaF103Acceptance.undo()', true);
  const stateAfterUndoExistingEdit = await inspectRenderer();
  assert(undoExistingEdit === true && stateAfterUndoExistingEdit.project.characters.find((item) => item.id === originalExistingCharacter.id)?.name === originalExistingCharacter.name, 'The second undo did not restore the original Character content.');
  assert(stateAfterUndoExistingEdit.undoCount === 0 && stateAfterUndoExistingEdit.redoCount === 2, 'The two-step undo did not preserve both redo commands.');

  const redoExistingEdit = await mainWindow.webContents.executeJavaScript('window.__pandaStageFlaF103Acceptance.redo()', true);
  const stateAfterRedoExistingEdit = await inspectRenderer();
  assert(redoExistingEdit === true && stateAfterRedoExistingEdit.project.characters.find((item) => item.id === originalExistingCharacter.id)?.name === editedState.editedCharacterName, 'The first redo did not restore the previous Character edit.');
  assert(!stateAfterRedoExistingEdit.project.characters.some((item) => item.id === created.characterId), 'The first redo restored the import before the edit command.');

  const redoImport = await mainWindow.webContents.executeJavaScript('window.__pandaStageFlaF103Acceptance.redo()', true);
  const stateAfterRedoImport = await inspectRenderer();
  assert(redoImport === true && stateAfterRedoImport.project.characters.some((item) => item.id === created.characterId), 'The second redo did not restore the imported Character.');
  assert(stateAfterRedoImport.dirty === false && stateAfterRedoImport.undoCount === 2 && stateAfterRedoImport.redoCount === 0, 'Redo twice did not return to the saved Project with both history commands intact.');
  assert(JSON.stringify((await projectService.open(projectRoot)).project) === JSON.stringify(stateAfterCreate.project), 'Undo/Redo wrote an extra Project revision or changed the saved Project snapshot.');

  const secondOperationId = crypto.randomUUID();
  const secondCreated = await mainWindow.webContents.executeJavaScript(`window.__pandaStageFlaF103Acceptance.createCharacter(window.__f103PreparedPreview, 'Sample A Character 2', ${JSON.stringify(secondOperationId)})`, true);
  const stateAfterSecondCreate = await inspectRenderer();
  const secondCharacter = stateAfterSecondCreate.project.characters.find((item) => item.id === secondCreated.characterId);
  const firstCharacterAfterSecond = stateAfterSecondCreate.project.characters.find((item) => item.id === created.characterId);
  assert(secondCreated.characterId !== created.characterId && firstCharacterAfterSecond?.name === character.name && secondCharacter?.name === 'Sample A Character 2', 'The second operation replaced or renamed the first Character.');
  assert(secondCreated.createdAssetCount === 0 && secondCreated.reusedAssetCount === preparedBatch.parts.length, 'The second Character did not reuse every existing FLA image Asset.');
  assert(secondCreated.assets.map((asset) => asset.assetId).join(',') === created.assets.map((asset) => asset.assetId).join(','), 'The second operation did not reuse the first Character image Asset IDs.');
  assert(stateAfterSecondCreate.project.characters.length === stateAfterCreate.project.characters.length + 1 && stateAfterSecondCreate.project.voiceProfiles.length === stateAfterCreate.project.voiceProfiles.length + 1, 'The second operation did not add exactly one independent Character and VoiceProfile.');
  assert(stateAfterSecondCreate.project.assets.length === stateAfterCreate.project.assets.length, 'The second operation added duplicate image Assets.');
  assert(secondCharacter?.mode === 'adaptive-parts' && new Set(secondCharacter.parts.map((part) => part.partId)).size === preparedBatch.parts.length, 'The second Character did not retain independent occurrence Parts.');
  assert(secondCharacter.parts.map((part) => part.partId).join(',') !== character.parts.map((part) => part.partId).join(','), 'The second operation reused Part identities from the first Character.');
  const secondStatus = await mainWindow.webContents.executeJavaScript(`window.pandaStage.fla.getCharacterCreateStatus({ format: 'panda-fla-character-create-status', version: 1, operationId: ${JSON.stringify(secondOperationId)}, projectRoot: ${JSON.stringify(projectRoot)}, projectId: ${JSON.stringify(initialProject.id)} })`, true);
  assert(secondStatus?.ok && secondStatus.status === 'COMMITTED' && secondStatus.result.characterId === secondCreated.characterId, 'The second operation status does not identify its committed Character.');

  await mainWindow.webContents.executeJavaScript('window.__pandaStageFlaF103Acceptance.closeProject()', true);
  await mainWindow.webContents.executeJavaScript(`window.__pandaStageFlaF103Acceptance.openProject(${JSON.stringify(projectRoot)})`, true);
  const reopenedState = await inspectRenderer();
  assert(reopenedState.project.characters.some((item) => item.id === created.characterId) && reopenedState.project.characters.some((item) => item.id === secondCreated.characterId), 'Both Characters did not survive Project save and reopen.');
  assert(reopenedState.project.characters.find((item) => item.id === originalExistingCharacter.id)?.name === editedState.editedCharacterName, 'The pre-existing Character edit did not survive Project reopen.');
  const imageReadsFirst = await mainWindow.webContents.executeJavaScript(`window.__pandaStageFlaF103Acceptance.readCreatedCharacterAssets(${JSON.stringify(created.characterId)})`, true);
  const imageReadsSecond = await mainWindow.webContents.executeJavaScript(`window.__pandaStageFlaF103Acceptance.readCreatedCharacterAssets(${JSON.stringify(secondCreated.characterId)})`, true);
  assert(imageReadsFirst.length === uniqueHashes.size && imageReadsFirst.every((item) => item.byteLength > 0), 'First Character Project-owned image Assets could not be read after the source FLA copy was moved.');
  assert(imageReadsSecond.length === uniqueHashes.size && imageReadsSecond.every((item) => item.byteLength > 0), 'Second Character Project-owned image Assets could not be read after the source FLA copy was moved.');
  assert([...imageReadsFirst, ...imageReadsSecond].every((item) => [...uniqueHashes].includes(item.sha256)), 'Reopened Project Asset hashes do not match the held Part images.');

  await mainWindow.webContents.executeJavaScript(`(() => {
    const rail = document.querySelector('[data-testid="resource-activity-rail-characters"]') || document.querySelector('[data-testid="resource-activity-dock"] [data-activity="characters"]');
    if (!rail) throw new Error('The existing Characters activity control is unavailable.');
    rail.click();
  })()`, true);
  let characterListReady = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    characterListReady = await mainWindow.webContents.executeJavaScript("Boolean(document.querySelector('[data-testid=\\\"character-list-view\\\"]'))", true);
    if (characterListReady) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(characterListReady, 'The existing Character management list did not open after Project reopen.');
  await mainWindow.webContents.executeJavaScript(`(() => {
    const characterId = ${JSON.stringify(created.characterId)};
    const item = [...document.querySelectorAll('[data-testid="character-list-view"] [data-character-id]')].find((candidate) => candidate.dataset.characterId === characterId);
    if (!item) throw new Error('The imported Character is not present in the existing Character management list.');
    item.click();
  })()`, true);
  let assemblySummary = null;
  for (let attempt = 0; attempt < 180; attempt += 1) {
    assemblySummary = await mainWindow.webContents.executeJavaScript(`(async () => {
      const root = document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]');
      if (!root || root.dataset.characterId !== ${JSON.stringify(created.characterId)}) return null;
      const rows = [...root.querySelectorAll('[data-testid="adaptive-parts-assembly-row"]')].map((row) => ({ partId: row.dataset.partId, drawOrder: Number(row.dataset.drawOrder) }));
      const canvasParts = [...root.querySelectorAll('[data-testid="adaptive-parts-assembly-canvas-part"]')];
      if (canvasParts.length !== ${preparedBatch.parts.length}) return null;
      const images = canvasParts.map((part) => part.querySelector('img'));
      if (images.some((image) => !image || !image.complete || image.naturalWidth !== ${plan.stage.width} || image.naturalHeight !== ${plan.stage.height})) return null;
      await Promise.all(images.map((image) => image.decode()));
      const canvas = document.createElement('canvas'); canvas.width = ${plan.stage.width}; canvas.height = ${plan.stage.height};
      const context = canvas.getContext('2d', { willReadFrequently: true });
      for (let index = 0; index < canvasParts.length; index += 1) {
        const part = canvasParts[index]; const image = images[index]; const matrix = new DOMMatrix(getComputedStyle(part).transform);
        context.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
        context.drawImage(image, image.offsetLeft, image.offsetTop, image.clientWidth, image.clientHeight);
      }
      return {
        characterId: root.dataset.characterId,
        rows,
        canvasPartIds: canvasParts.map((part) => part.dataset.partId),
        images: images.map((image) => ({ naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, complete: image.complete })),
        png: canvas.toDataURL('image/png').slice('data:image/png;base64,'.length),
      };
    })()`, true);
    if (assemblySummary) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(assemblySummary && assemblySummary.characterId === created.characterId, 'The existing C3 adaptive-parts assembly workbench did not open the imported Character.');
  const expectedManagementDrawOrder = [...preparedBatch.parts]
    .sort((left, right) => right.drawOrder - left.drawOrder)
    .map((part) => part.drawOrder)
    .join(',');
  assert(assemblySummary.rows.length === preparedBatch.parts.length && assemblySummary.rows.map((row) => row.drawOrder).join(',') === expectedManagementDrawOrder, 'The C3 management list did not retain its existing front-to-back order for the source draw order.');
  const expectedCanvasPartIds = character.parts.map((part) => part.partId).sort();
  const actualCanvasPartIds = [...assemblySummary.canvasPartIds].sort();
  assert(actualCanvasPartIds.length === expectedCanvasPartIds.length && actualCanvasPartIds.join(',') === expectedCanvasPartIds.join(','), `The C3 composition canvas did not render every formal Character Part exactly once: ${JSON.stringify({ actualCanvasPartIds, expectedCanvasPartIds })}`);
  assert(assemblySummary.images.length === preparedBatch.parts.length && assemblySummary.images.every((image) => image.complete && image.naturalWidth === plan.stage.width && image.naturalHeight === plan.stage.height), 'The C3 canvas did not load every project-owned full-stage image.');
  const c3PreviewBytes = Buffer.from(assemblySummary.png, 'base64');
  const c3Comparison = await comparePngs(observedPreviewResponse.reassembledPreview, { bytes: c3PreviewBytes }, Buffer.from(observedPreviewResponse.nativePreview.bytes));
  // DOM CSS transforms rasterize subpixels differently from Main's PNG path;
  // use the repository's existing Stage-to-Preview RGB mean tolerance.
  assert(c3Comparison.nativeVsReassembled.comparable && c3Comparison.nativeVsReassembled.meanAbsoluteChannelDifference <= 1.5, `The actual C3 composition differs from the F1-02 reassembly by more than the existing Stage-to-Preview tolerance: ${JSON.stringify(c3Comparison.nativeVsReassembled)}`);

  const screenshot = await mainWindow.webContents.capturePage();
  const persistedProject = (await projectService.open(projectRoot)).project;
  const persistedPngFiles = fs.readdirSync(path.join(projectRoot, 'assets')).filter((file) => file.toLocaleLowerCase('en-US').endsWith('.png'));
  assert(persistedProject.characters.length === 3 && persistedProject.voiceProfiles.length === 3 && persistedProject.assets.length === stateAfterCreate.project.assets.length, 'The reopened disk Project counts do not match both formal Character commits.');
  assert(sha256File(existingImagePath) === existingImageAsset.sha256, 'The pre-existing Character image was changed during import or deduplication.');
  const evidence = [
    writeNewFile(path.join(OUTPUT_DIRECTORY, 'electron-acceptance.png'), screenshot.toPNG()),
    writeNewFile(path.join(OUTPUT_DIRECTORY, 'c3-reassembled-preview.png'), c3PreviewBytes),
    writeNewFile(path.join(OUTPUT_DIRECTORY, 'preview-part-batch.json'), Buffer.from(JSON.stringify({
      plan: { planId: plan.planId, sessionId: plan.sessionId, requestId: plan.requestId, generation: plan.generation, poseIdentity: plan.poseIdentity, target: plan.target, stage: plan.stage, capability: plan.capability },
      parts: preparedBatch.parts.map((part) => ({ unitId: part.unitId, occurrenceId: part.occurrenceId, drawOrder: part.drawOrder, sha256: part.image.sha256, byteLength: part.image.byteLength, width: part.image.width, height: part.image.height, stageMapping: part.stageMapping })),
      sourceCopyMoved: true,
      sourceCopySha256: sha256File(movedSourcePath),
    }, null, 2), 'utf8')),
    writeNewFile(path.join(OUTPUT_DIRECTORY, 'c3-assembly-receipt.json'), Buffer.from(JSON.stringify({
      characterId: created.characterId,
      rows: assemblySummary.rows,
      canvasPartIds: assemblySummary.canvasPartIds,
      images: assemblySummary.images,
      pixelComparisonPolicy: 'RGB mean absolute channel difference <= 1.5 (existing Stage-to-Preview verifier tolerance).',
      pixelComparisonAgainstF102: c3Comparison.nativeVsReassembled,
    }, null, 2), 'utf8')),
  ];
  const receipt = {
    format: 'panda-stage-issue908-f1-03-electron-acceptance',
    version: 1,
    accepted: true,
    verifiedAt: new Date().toISOString(),
    platform: process.platform,
    source: { basename: path.basename(sourcePath), copiedTo: path.basename(movedSourcePath), rawSha256: sourceHashBefore, sha256AfterMove: sha256File(movedSourcePath) },
    project: {
      root: projectRoot,
      projectId: initialProject.id,
      initialStoreRevision: initialState.revision,
      firstBaseRevision: created.baseRevision,
      firstSavedRevision: created.savedRevision,
      secondBaseRevision: secondCreated.baseRevision,
      secondSavedRevision: secondCreated.savedRevision,
      reopenedStoreRevision: reopenedState.revision,
      diskCounts: { characters: persistedProject.characters.length, voiceProfiles: persistedProject.voiceProfiles.length, imageAssets: persistedProject.assets.filter((asset) => asset.kind === 'image').length, pngFiles: persistedPngFiles.length },
    },
    plan: { planId: plan.planId, sessionId: plan.sessionId, generation: plan.generation, capability: plan.capability, poseIdentity: plan.poseIdentity, target: plan.target },
    characters: {
      existing: { characterId: originalExistingCharacter.id, originalName: originalExistingCharacter.name, editedName: editedState.editedCharacterName, retainedAfterReopen: persistedProject.characters.some((item) => item.id === originalExistingCharacter.id && item.name === editedState.editedCharacterName) },
      first: { characterId: character.id, voiceProfileId: created.voiceProfileId, mode: character.mode, partCount: character.parts.length, createdAssetCount: created.createdAssetCount, reusedAssetCount: created.reusedAssetCount },
      second: { characterId: secondCharacter.id, voiceProfileId: secondCreated.voiceProfileId, mode: secondCharacter.mode, partCount: secondCharacter.parts.length, createdAssetCount: secondCreated.createdAssetCount, reusedAssetCount: secondCreated.reusedAssetCount },
    },
    assets: {
      uniqueImportedImageCount: uniqueAssetIds.size,
      diskPngFileCount: persistedPngFiles.length,
      secondOperationReusedFirstAssetIds: secondCreated.assets.map((asset) => asset.assetId).join(',') === created.assets.map((asset) => asset.assetId).join(','),
      firstCharacterReopenedReads: imageReadsFirst,
      secondCharacterReopenedReads: imageReadsSecond,
      retainedAfterUndo: retainedFilesAfterUndo.map((asset) => ({ assetId: asset.assetId, sha256: asset.sha256, byteLength: fs.statSync(asset.path).size })),
    },
    history: {
      afterExistingEdit: { undoCount: editedState.undoCount, nextUndoLabel: editedState.nextUndoLabel },
      afterImport: { undoCount: stateAfterCreate.undoCount, nextUndoLabel: stateAfterCreate.nextUndoLabel },
      undoImport: { accepted: undoImport, undoCount: stateAfterUndoImport.undoCount, redoCount: stateAfterUndoImport.redoCount },
      undoExistingEdit: { accepted: undoExistingEdit, undoCount: stateAfterUndoExistingEdit.undoCount, redoCount: stateAfterUndoExistingEdit.redoCount },
      redoExistingEdit: { accepted: redoExistingEdit, undoCount: stateAfterRedoExistingEdit.undoCount, redoCount: stateAfterRedoExistingEdit.redoCount },
      redoImport: { accepted: redoImport, undoCount: stateAfterRedoImport.undoCount, redoCount: stateAfterRedoImport.redoCount, dirty: stateAfterRedoImport.dirty },
    },
    operations: {
      first: { operationId, responseLostAfterMainCommit: responseLossTriggered, status: status.status, characterId: status.result.characterId, savedRevision: status.result.savedRevision },
      second: { operationId: secondOperationId, status: secondStatus.status, characterId: secondStatus.result.characterId, savedRevision: secondStatus.result.savedRevision },
    },
    geometry: character.parts.map((part) => ({ partId: part.partId, sourceId: part.source.sourceId, sourcePoseFrame: part.source.sourcePoseFrame, effectiveFrame: part.source.effectiveFrame, drawOrder: part.drawOrder, imageMapping: part.imageMapping, restTransform: part.restTransform, sourceRestTransform: part.sourceRestTransform, staticAdjustment: part.staticAdjustment, assetId: part.assetId })),
    comparisons: { f102NativeVsReassembled: comparison.nativeVsReassembled, c3VsF102Reassembled: c3Comparison.nativeVsReassembled },
    c3: { rows: assemblySummary.rows, canvasPartIds: assemblySummary.canvasPartIds, images: assemblySummary.images },
    evidence,
    issueAcceptanceStatus: 'PASS',
    acceptanceCoverage: { exactMainHeldBatch: 'PASS', dirtySnapshotPreserved: 'PASS', existingCharacterEditUndoRedo: 'PASS', oneRevisionAndOneHistoryCommandPerCreate: 'PASS', assetContentDeduplicationAcrossOperationIds: 'PASS', noAutomaticShotAddition: 'PASS', responseLossStatusRecovery: 'PASS', sourceMovedAfterPreview: 'PASS', saveAndReopen: 'PASS', projectOwnedImagesReadable: 'PASS', c3ManagementAndAssembly: 'PASS', c3VisualMatchesF102: 'PASS', wholeImageCapability: 'DEFERRED' },
  };
  writeNewFile(path.join(OUTPUT_DIRECTORY, 'receipt.json'), Buffer.from(JSON.stringify(receipt, null, 2), 'utf8'));
  process.stdout.write(`${JSON.stringify({ accepted: true, issueAcceptanceStatus: 'PASS', outputDirectory: OUTPUT_DIRECTORY, characterId: character.id, secondCharacterId: secondCharacter.id, partCount: character.parts.length, baseRevision: created.baseRevision, savedRevision: created.savedRevision, f102Comparison: comparison.nativeVsReassembled, c3Comparison: c3Comparison.nativeVsReassembled }, null, 2)}\n`);
}

function bestEffortCleanup(label, action) {
  try { action(); } catch (error) {
    process.stderr.write(`F1-03 cleanup warning (${label}): ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

async function cleanup() {
  if (autosaveService) await autosaveService.stopAll().catch(() => undefined);
  bestEffortCleanup('canvas image IPC', () => removeAssetImageHandler?.());
  bestEffortCleanup('Character create IPC', () => removeCreateHandlers?.());
  bestEffortCleanup('Part preview IPC', () => removePartPreviewHandlers?.());
  bestEffortCleanup('static snapshot IPC', () => removeSnapshotHandlers?.());
  bestEffortCleanup('FLA import/parser IPC', () => removeImportHandlers?.());
  bestEffortCleanup('recent projects IPC', () => removeRecentProjectHandlers?.());
  bestEffortCleanup('recovery IPC', () => removeRecoveryHandlers?.());
  bestEffortCleanup('project IPC', () => removeProjectHandlers?.());
  bestEffortCleanup('session listener', () => removeSessionListener?.());
  bestEffortCleanup('Part preview service', () => partPreviewService?.close());
  bestEffortCleanup('render session', () => renderSession?.close());
  bestEffortCleanup('source inspection service', () => inspectionService?.close());
  bestEffortCleanup('snapshot window manager', () => snapshotWindowManager?.close());
  bestEffortCleanup('main window', () => closeOnce(mainWindow));
}

app.whenReady()
  .then(async () => {
    appReady = true;
    await runAcceptance();
  })
  .catch((error) => {
    primaryError = error;
    process.stderr.write(`F1-03 Electron acceptance failed: ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    if (OUTPUT_DIRECTORY && fs.existsSync(OUTPUT_DIRECTORY)) {
      try {
        writeNewFile(path.join(OUTPUT_DIRECTORY, 'failure.json'), Buffer.from(JSON.stringify({
          format: 'panda-stage-issue908-f1-03-electron-acceptance-failure',
          recordedAt: new Date().toISOString(),
          sourceHashBefore: sourceHashBefore || null,
          error: error instanceof Error ? error.message : String(error),
        }, null, 2), 'utf8'));
      } catch (writeError) {
        process.stderr.write(`Could not write F1-03 failure receipt: ${writeError instanceof Error ? writeError.message : String(writeError)}\n`);
      }
    }
  })
  .finally(async () => {
    if (appReady) await cleanup();
    app.exit(primaryError ? 1 : 0);
  });

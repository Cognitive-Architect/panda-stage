const { app, contentTracing, ipcMain } = require('electron');
const { createHash } = require('node:crypto');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { deflateSync } = require('node:zlib');
const { createMainWindow } = require('../dist-electron/main/windows/main-window.js');
const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');
const { ProjectSchema } = require('../dist-electron/domain/index.js');
const { migrateProject } = require('../dist-electron/domain/migrations/index.js');
const exampleProject = require('../demo-project/project-v1.example.json');

// Isolated R02 fixture, optionally extended for Issue #631/#872 diagnosis.
// Issue #872 reads the owner project in place and refuses project-save IPC.
const graphicsMode = process.env.ISSUE631_GRAPHICS === '1';
const privateProjectRoot = process.env.ISSUE872_PRIVATE_PROJECT_ROOT
  ? path.resolve(process.env.ISSUE872_PRIVATE_PROJECT_ROOT)
  : null;
const issue872Mode = Boolean(privateProjectRoot) || process.env.ISSUE872_CAPTURE_GPU === '1';
const scenePixelRatio = graphicsMode ? Number(process.env.ISSUE631_PIXEL_RATIO ?? '1') : 1;
if (![1, 0.5, 0.25].includes(scenePixelRatio)) {
  throw new Error('ISSUE631_PIXEL_RATIO must be 1, 0.5, or 0.25.');
}
const traceSceneA = graphicsMode && process.env.ISSUE631_TRACE === '1';
const acceptanceRoot = 'D:\\PandaStage-Acceptance';
const runRoot = mkdtempSync(path.join(
  acceptanceRoot,
  issue872Mode ? 'issue872-thm01-' : graphicsMode ? 'issue631-' : 'issue629-',
));
const projectRoot = privateProjectRoot ?? path.join(runRoot, 'issue629-abc.pandastage');
const userDataRoot = path.join(runRoot, 'electron-user-data');
const measuredBranch = process.env.ISSUE872_BRANCH ?? 'issue-627-s09-r01';
const measuredSha = process.env.ISSUE872_SOURCE_SHA ?? null;
const ids = (n) => `a0629000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const ID = Object.freeze({
  project: ids(1), bg: ids(2), image: ids(3), body: ids(4),
  faceA: ids(5), faceB: ids(6), mouth: ids(7), audio: ids(8),
  composite: ids(9), singleA: ids(10), singleB: ids(11),
  exprA: ids(12), exprB: ids(13), singleExprA: ids(14), singleExprB: ids(15),
  voiceComposite: ids(16), voiceA: ids(17), voiceB: ids(18),
  shotA: ids(19), shotB: ids(20), shotC: ids(21),
  bgA: ids(22), bgB: ids(23), bgC: ids(24),
  moveA: ids(25), moveB: ids(26), moveC: ids(27),
  layerA: ids(28), layerB: ids(29), layerC: ids(30),
  extra1: ids(31), extra2: ids(32), extra3: ids(33),
  singleLayerA: ids(34), singleLayerB: ids(35),
  dialogue: ids(36), clip: ids(37), expressionEvent: ids(38),
});
const channels = [];
let windowRef = null;
let gpuInfoUpdated = false;
let privateSourceContext = null;
let privateMeasureShotIds = null;
app.on('window-all-closed', () => {});
app.on('gpu-info-update', () => { gpuInfoUpdated = true; });

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
  const checksum = Buffer.alloc(4);
  const payload = Buffer.concat([typeBytes, bytes]);
  checksum.writeUInt32BE(crc32(payload), 0);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length, 0);
  return Buffer.concat([length, payload, checksum]);
}

function solidPng(width, height, color) {
  const row = Buffer.alloc(width * 4 + 1);
  for (let x = 0; x < width; x += 1) {
    row[1 + x * 4] = color[0];
    row[2 + x * 4] = color[1];
    row[3 + x * 4] = color[2];
    row[4 + x * 4] = 255;
  }
  const raw = Buffer.alloc(row.length * height);
  for (let y = 0; y < height; y += 1) row.copy(raw, y * row.length);
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

function silentWav(durationMs) {
  const sampleRate = 8000;
  const sampleCount = Math.round(sampleRate * durationMs / 1000);
  const bytes = Buffer.alloc(44 + sampleCount * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(sampleCount * 2, 40);
  return bytes;
}

const assetBytes = new Map([
  [ID.bg, solidPng(1920, 1080, [40, 48, 44])],
  [ID.image, solidPng(640, 640, [96, 146, 202])],
  [ID.body, solidPng(720, 900, [210, 75, 68])],
  [ID.faceA, solidPng(280, 240, [232, 196, 112])],
  [ID.faceB, solidPng(280, 240, [116, 206, 139])],
  [ID.mouth, solidPng(280, 240, [242, 160, 70])],
  [ID.audio, silentWav(6000)],
]);

function asset(id, name, width, height) {
  return {
    id, kind: 'image', name, relativePath: `assets/${name}.png`,
    mimeType: 'image/png', width, height, usage: 'uncategorized', keywords: [],
    sha256: sha256(assetBytes.get(id)),
  };
}

function layer(id, name, source, x, y, zIndex, scale = 1) {
  return {
    id, name, source, anchor: 'center', x, y,
    scaleX: scale, scaleY: scale, rotationDeg: 0, opacity: 1,
    visible: true, zIndex, locked: false, flipX: false,
  };
}

function move(id, layerId) {
  return {
    id, type: 'move', layerId, startMs: 0, endMs: 5000,
    from: { x: 400, y: 540 }, to: { x: 1500, y: 540 }, easing: 'linear',
  };
}

function fixture() {
  const base = migrateProject(exampleProject);
  const baseCharacter = base.characters[0];
  const voice = base.voiceProfiles[0];
  const composite = {
    ...baseCharacter, id: ID.composite, name: 'Composite', mode: 'composite',
    baseAssetId: ID.faceA, defaultVoiceProfileId: ID.voiceComposite,
    expressions: [
      { id: ID.exprA, name: 'A', assetId: ID.faceA },
      { id: ID.exprB, name: 'B', assetId: ID.faceB },
    ],
    defaultExpressionId: ID.exprA, bodyAssetId: ID.body,
    facePlacement: { offsetX: 390, offsetY: -10, scale: 0.6 },
    mouthOpenAssetId: ID.mouth,
  };
  const single = (id, expressionId, voiceId, name) => ({
    ...baseCharacter, id, name, mode: 'single-image', baseAssetId: ID.image,
    defaultVoiceProfileId: voiceId,
    expressions: [{ id: expressionId, name: 'Default', assetId: ID.image }],
    defaultExpressionId: expressionId,
  });
  const shot = (id, name, bgId, layers, events, extras = {}) => ({
    ...base.shots[0], id, name, durationMs: 6000,
    backgroundLayerId: bgId, layers, timelineEvents: events,
    dialogues: extras.dialogues ?? [], audioClips: extras.audioClips ?? [],
  });
  const bg = (id) => layer(id, 'Background', { kind: 'asset', assetId: ID.bg }, 960, 540, 0);
  const image = (id, zIndex, x = 400, y = 540) =>
    layer(id, 'Image', { kind: 'asset', assetId: ID.image }, x, y, zIndex, 0.75);
  const character = (id, characterId, expressionId, zIndex, x = 400, y = 540) =>
    layer(id, 'Character', { kind: 'character', characterId, expressionId }, x, y, zIndex, 0.7);
  const project = ProjectSchema.parse({
    ...base, id: ID.project, name: 'Issue 629 A/B/C Position diagnosis',
    assets: [
      asset(ID.bg, 'bg', 1920, 1080), asset(ID.image, 'image', 640, 640),
      asset(ID.body, 'body', 720, 900), asset(ID.faceA, 'face-a', 280, 240),
      asset(ID.faceB, 'face-b', 280, 240), asset(ID.mouth, 'mouth', 280, 240),
      {
        id: ID.audio, kind: 'audio', name: 'Silent clock',
        relativePath: 'assets/clock.wav', mimeType: 'audio/wav',
        durationMs: 6000, sha256: sha256(assetBytes.get(ID.audio)),
      },
    ],
    characters: [
      composite,
      single(ID.singleA, ID.singleExprA, ID.voiceA, 'Single A'),
      single(ID.singleB, ID.singleExprB, ID.voiceB, 'Single B'),
    ],
    voiceProfiles: [
      { ...voice, id: ID.voiceComposite, characterId: ID.composite },
      { ...voice, id: ID.voiceA, characterId: ID.singleA },
      { ...voice, id: ID.voiceB, characterId: ID.singleB },
    ],
    shots: [
      shot(ID.shotA, 'A - ordinary image', ID.bgA,
        [bg(ID.bgA), image(ID.layerA, 1)], [move(ID.moveA, ID.layerA)]),
      shot(ID.shotB, 'B - composite', ID.bgB,
        [bg(ID.bgB), character(ID.layerB, ID.composite, ID.exprA, 1)],
        [move(ID.moveB, ID.layerB)]),
      shot(ID.shotC, 'C - production mix', ID.bgC,
        [
          bg(ID.bgC),
          character(ID.layerC, ID.composite, ID.exprA, 1),
          character(ID.singleLayerA, ID.singleA, ID.singleExprA, 2, 350, 620),
          character(ID.singleLayerB, ID.singleB, ID.singleExprB, 3, 1540, 620),
          image(ID.extra1, 4, 550, 310), image(ID.extra2, 5, 1000, 260),
          image(ID.extra3, 6, 1450, 310),
        ],
        [
          move(ID.moveC, ID.layerC),
          {
            id: ID.expressionEvent, type: 'expression', layerId: ID.layerC,
            startMs: 3000, endMs: 3000, expressionId: ID.exprB,
          },
        ],
        {
          dialogues: [{
            id: ID.dialogue, characterId: ID.composite,
            voiceProfileId: ID.voiceComposite, audioClipId: ID.clip,
            subtitleStyleId: base.subtitleStyles[0].id,
            startMs: 1000, endMs: 5000, text: 'Issue 629 speaking test',
          }],
          audioClips: [{
            id: ID.clip, name: 'Clock', assetId: ID.audio,
            startMs: 1000, endMs: 5000, offsetMs: 0, volume: 0, role: 'dialogue',
          }],
        }),
    ],
  });
  return project;
}

function privateProjectFixture() {
  const manifestBytes = readFileSync(path.join(privateProjectRoot, 'project.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.schemaVersion !== 15) {
    throw new Error(`Expected the owner project schema v15; found ${manifest.schemaVersion}.`);
  }
  const sourceProject = ProjectSchema.parse({ ...manifest, schemaVersion: 14 });
  const safeRoot = `${privateProjectRoot}${path.sep}`.toLowerCase();
  let verifiedAssetBytes = 0;
  for (const item of sourceProject.assets) {
    const assetPath = path.resolve(privateProjectRoot, item.relativePath);
    if (!assetPath.toLowerCase().startsWith(safeRoot)) {
      throw new Error('Owner asset path escaped the private project root.');
    }
    const bytes = readFileSync(assetPath);
    if (sha256(bytes) !== item.sha256) {
      throw new Error(`Owner asset integrity check failed for asset ${item.id}.`);
    }
    assetBytes.set(item.id, bytes);
    verifiedAssetBytes += bytes.byteLength;
  }

  const character = sourceProject.characters.find((item) =>
    item.mode === 'composite' && item.head && item.bodyAssetId &&
    item.facePlacement && item.mouthOpenAssetId,
  );
  if (!character || character.mode !== 'composite') {
    throw new Error('Owner project lacks a composite Character with Head, Body, Face, and Mouth.');
  }
  const dialogueShot = sourceProject.shots.find((item) =>
    item.dialogues.some((dialogue) => dialogue.characterId === character.id) &&
    item.layers.some((itemLayer) =>
      itemLayer.source.kind === 'character' && itemLayer.source.characterId === character.id,
    ),
  );
  if (!dialogueShot) throw new Error('Owner project has no speaking shot for its composite Character.');
  const originalBackground = dialogueShot.layers.find(
    (item) => item.id === dialogueShot.backgroundLayerId,
  );
  if (!originalBackground) throw new Error('Owner speaking shot has no background layer.');
  const expressionId = character.defaultExpressionId ?? character.expressions[0]?.id;
  const expressionAssetId = character.expressions.find((item) => item.id === expressionId)?.assetId;
  if (!expressionId || !expressionAssetId) {
    throw new Error('Owner composite Character has no default expression image.');
  }

  const backgroundLayer = (id) => ({
    ...originalBackground,
    id,
    name: 'Diagnostic background',
    zIndex: 0,
  });
  const imageLayer = layer(
    ID.layerA,
    'Diagnostic ordinary image',
    { kind: 'asset', assetId: expressionAssetId },
    400,
    540,
    1,
  );
  const characterLayer = layer(
    ID.layerB,
    'Diagnostic composite Character',
    { kind: 'character', characterId: character.id, expressionId },
    400,
    540,
    1,
    0.7,
  );
  const controlShot = (id, name, backgroundId, activeLayer, moveId) => ({
    ...dialogueShot,
    id,
    name,
    durationMs: 6000,
    backgroundLayerId: backgroundId,
    layers: [backgroundLayer(backgroundId), activeLayer],
    timelineEvents: [move(moveId, activeLayer.id)],
    dialogues: [],
    audioClips: [],
  });
  const shotA = controlShot(
    ID.shotA, 'A - ordinary image Position control', ID.bgA, imageLayer, ID.moveA,
  );
  const shotB = controlShot(
    ID.shotB, 'B - composite Character Position control', ID.bgB, characterLayer, ID.moveB,
  );
  const project = ProjectSchema.parse({
    ...sourceProject,
    shots: [shotA, shotB, ...sourceProject.shots],
  });
  const assetById = new Map(sourceProject.assets.map((item) => [item.id, item]));
  const assetSize = (assetId) => {
    const item = assetById.get(assetId);
    return item ? { width: item.width ?? null, height: item.height ?? null } : null;
  };
  const faceAssetId = expressionAssetId;
  const dialogueWindowsMs = dialogueShot.dialogues
    .filter((item) => item.characterId === character.id)
    .map((item) => ({ startMs: item.startMs, endMs: item.endMs }));
  privateSourceContext = {
    source: 'owner-private-local-project; identifiers and text redacted',
    manifestSha256: sha256(manifestBytes),
    sourceSchemaVersion: manifest.schemaVersion,
    runtimeSchemaVersion: sourceProject.schemaVersion,
    projectCanvas: { width: sourceProject.width, height: sourceProject.height },
    fps: sourceProject.fps,
    assetCount: sourceProject.assets.length,
    verifiedAssetCount: sourceProject.assets.length,
    verifiedAssetBytes,
    characterParts: {
      head: assetSize(character.head.assetId),
      body: assetSize(character.bodyAssetId),
      face: assetSize(faceAssetId),
      mouth: assetSize(character.mouthOpenAssetId),
    },
    talkingHeadMotionIntensityPercent: character.talkingHeadMotionIntensityPercent ?? null,
    dialogueWindowsMs,
    audioOutputMutedByProbe: true,
    persistedProjectWrites: 0,
    sourceAssetsCopied: false,
  };
  privateMeasureShotIds = { A: ID.shotA, B: ID.shotB, C: dialogueShot.id };
  return project;
}

function documentFor(project) {
  return {
    projectRoot, projectFilePath: path.join(projectRoot, 'project.json'),
    project, migrated: false, sourceVersion: project.schemaVersion,
  };
}

function register(channel, handler) {
  ipcMain.handle(channel, handler);
  channels.push(channel);
}

function registerHandlers(project) {
  register(IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY, () => ({ ok: true, status: 'cancelled' }));
  register(IPC_CHANNELS.PROJECT_OPEN, (_event, request) => ({
    ok: request.projectRoot === projectRoot,
    ...(request.projectRoot === projectRoot
      ? { value: documentFor(project) }
      : { error: { code: 'PROJECT_NOT_FOUND', message: 'Unknown diagnostic root.', projectRoot: request.projectRoot } }),
  }));
  register(IPC_CHANNELS.RECENT_PROJECTS_LIST, () => ({ ok: true, entries: [] }));
  register(IPC_CHANNELS.PROJECT_SAVE, (_event, request) => {
    if (privateProjectRoot) {
      throw new Error('Issue 872 private-project diagnostics are read-only.');
    }
    return { ok: true, value: documentFor(request.project) };
  });
  register(IPC_CHANNELS.PROJECT_CONFIRM_SWITCH, () => ({ outcome: 'saved' }));
  register(IPC_CHANNELS.AUTOSAVE_TRACK, () => ({ ok: true }));
  register(IPC_CHANNELS.AUTOSAVE_UPDATE, () => ({ ok: true }));
  register(IPC_CHANNELS.AUTOSAVE_STOP, () => ({ ok: true }));
  register(IPC_CHANNELS.RECOVERY_DETECT, () => ({ ok: true, candidate: null }));
  register(IPC_CHANNELS.ASSET_THUMBNAIL_READ, (_event, request) => {
    const bytes = assetBytes.get(request.assetId);
    return {
      ok: true, status: 'ready', assetId: request.assetId,
      dataUrl: `data:image/png;base64,${bytes?.toString('base64') ?? ''}`,
    };
  });
  register(IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ, (_event, request) => {
    const asset = project.assets.find((item) => item.id === request.assetId);
    const bytes = assetBytes.get(request.assetId);
    if (!asset || asset.kind !== 'image' || !bytes || asset.sha256 !== request.sha256) {
      throw new Error(`Invalid diagnostic image read: ${request.assetId}`);
    }
    return {
      ok: true, status: 'ready', assetId: asset.id, mimeType: 'image/png',
      width: asset.width, height: asset.height, byteLength: bytes.byteLength,
      bytes: new Uint8Array(bytes),
    };
  });
  register(IPC_CHANNELS.ASSET_PREVIEW_AUDIO_READ, (_event, request) => {
    const asset = project.assets.find((item) => item.id === request.assetId);
    const bytes = assetBytes.get(request.assetId);
    if (!asset || asset.kind !== 'audio' || !bytes || asset.sha256 !== request.sha256 || request.sha256 !== sha256(bytes)) {
      throw new Error('Invalid diagnostic audio read.');
    }
    return {
      ok: true, status: 'ready', assetId: asset.id, mimeType: asset.mimeType,
      byteLength: bytes.byteLength, bytes: new Uint8Array(bytes),
    };
  });
}

async function waitFor(expression, message, timeout = 20000) {
  await windowRef.webContents.executeJavaScript(`(async () => {
    const deadline = Date.now() + ${timeout};
    while (Date.now() < deadline) {
      if (${expression}) return true;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(${JSON.stringify(message)});
  })()`);
}

async function evaluate(source) {
  return windowRef.webContents.executeJavaScript(source);
}

async function captureGraphicsStatus() {
  const deadline = Date.now() + 10000;
  while (!gpuInfoUpdated && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  let gpuInfo;
  let gpuInfoError = null;
  try {
    gpuInfo = await app.getGPUInfo('complete');
  } catch (error) {
    gpuInfoError = String(error);
  }
  const graphicsSwitches = [
    'disable-gpu', 'disable-software-rasterizer', 'use-angle', 'use-gl',
    'enable-unsafe-swiftshader', 'enable-features', 'disable-features',
  ];
  const status = {
    gpuInfoUpdated,
    hardwareAccelerationEnabled: gpuInfoUpdated ? app.isHardwareAccelerationEnabled() : null,
    gpuFeatureStatus: gpuInfoUpdated ? app.getGPUFeatureStatus() : null,
    gpuInfo: gpuInfo ?? null,
    gpuInfoError,
    electronVersion: process.versions.electron,
    chromiumVersion: process.versions.chrome,
    processMetrics: app.getAppMetrics().map((metric) => ({
      pid: metric.pid, type: metric.type, serviceName: metric.serviceName ?? null,
    })),
    launchSwitches: Object.fromEntries(graphicsSwitches
      .filter((name) => app.commandLine.hasSwitch(name))
      .map((name) => [name, app.commandLine.getSwitchValue(name)])),
  };
  writeFileSync(path.join(runRoot, 'graphics-status.json'), JSON.stringify(status, null, 2));
  return status;
}

const traceCategories = [
  'toplevel', 'benchmark', 'cc', 'gpu', 'viz', 'devtools.timeline',
  'blink', 'blink.user_timing', 'renderer.scheduler', 'sequence_manager',
  'disabled-by-default-devtools.timeline.frame',
  'disabled-by-default-cc.debug.scheduler.frames',
];

async function startSceneTrace() {
  const availableCategories = await contentTracing.getCategories();
  await contentTracing.startRecording({
    recording_mode: 'record-until-full',
    trace_buffer_size_in_kb: 65536,
    included_categories: traceCategories,
    excluded_categories: ['*'],
  });
  return { startedAtUtc: new Date().toISOString(), availableCategories };
}

async function stopSceneTrace(started) {
  const bufferUsage = await contentTracing.getTraceBufferUsage();
  const tracePath = path.join(runRoot, 'trace-scene-A.json');
  await contentTracing.stopRecording(tracePath);
  return {
    ...started, stoppedAtUtc: new Date().toISOString(), tracePath,
    includedCategories: traceCategories, bufferUsage,
  };
}

async function openProject() {
  await waitFor(`document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input')`, 'Project Center missing.');
  await evaluate(`(() => {
    const input = document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(projectRoot)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-testid="project-center-screen"] .recovery-open-row button').click();
  })()`);
  await waitFor(`document.querySelector('[data-testid="editor-layout"]')`, 'Diagnostic project did not open.');
}

async function installProbe() {
  await evaluate(`(() => {
    const events = [];
    window.__pandaPreviewDiagnostics = {
      scenePixelRatio: ${scenePixelRatio},
      forceCompositeCacheRebuild: ${JSON.stringify(process.env.ISSUE872_CACHE_STRATEGY === 'force-rebuild')},
      record(event, atMs, detail) {
        if (events.length < 20000) events.push({ event, atMs, ...detail });
      },
      reset() { events.length = 0; },
      read() { return events.slice(); },
    };
    if (typeof PerformanceObserver !== 'undefined') {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__pandaPreviewDiagnostics.record('long-task', entry.startTime, {
            durationMs: entry.duration,
          });
        }
      });
      try { observer.observe({ entryTypes: ['longtask'] }); } catch { /* unavailable */ }
    }
    const nativePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      this.muted = true;
      window.__issue629Audio = this;
      return nativePlay.apply(this, args);
    };
  })()`);
}

async function selectShot(shotId) {
  await waitFor(`document.querySelector('.shot-list-item[data-shot-id="${shotId}"] button')`, 'Shot list item missing.');
  await evaluate(`document.querySelector('.shot-list-item[data-shot-id="${shotId}"] button').click()`);
  await waitFor(`document.querySelector('.shot-list-item-selected[data-shot-id="${shotId}"]')`, 'Shot selection failed.');
}

async function openPreview() {
  await evaluate(`(() => {
    const drawer = document.querySelector('[data-testid="quick-action-drawer"]');
    if (drawer?.dataset.expanded !== 'true') drawer?.querySelector('[data-testid="quick-action-drawer-handle"]')?.click();
  })()`);
  await waitFor(`document.querySelector('[data-testid="quick-action-drawer"]')?.dataset.expanded === 'true'`, 'Quick actions unavailable.');
  await evaluate(`document.querySelector('[data-testid="quick-action-play"]').click()`);
  await waitFor(`document.querySelector('[data-testid="product-preview-overlay"]')`, 'Preview did not open.');
  await evaluate(`document.querySelectorAll('[data-testid="product-preview-range"] [role="tab"]')[1].click()`);
  await waitFor(`document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewRange === 'shot'`, 'Shot range unavailable.');
  await waitFor(`document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewSurface === 'active' && document.querySelector('[data-testid="stage-renderer"]')?.dataset.stageDisplayReady === 'true'`, 'Preview not ready.', 30000);
  await evaluate(`(() => {
    const overlay = document.querySelector('[data-testid="product-preview-overlay"]');
    if (overlay.dataset.previewPlaying === 'true') document.querySelector('[data-testid="product-preview-play-pause"]').click();
    document.querySelector('[data-testid="product-preview-stop"]').click();
  })()`);
  await waitFor(`Number(document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewTime ?? -1) === 0`, 'Preview did not reset.');
}

async function measureScene(label, shotId, { hideStage = false, hideCanvas = false } = {}) {
  await selectShot(shotId);
  await openPreview();
  const pausedRaf = await measureIdleRaf(2000);
  if (hideStage) {
    await evaluate(`document.querySelector('[data-testid="stage-renderer"]').style.visibility = 'hidden'`);
  }
  if (hideCanvas) {
    await evaluate(`document.querySelector('[data-testid="stage-renderer"] canvas').style.visibility = 'hidden'`);
  }
  const traceStarted = traceSceneA && label === 'A' ? await startSceneTrace() : null;
  await evaluate(`(() => {
    window.__pandaPreviewDiagnostics.reset();
    window.__issue629ControlRafActive = true;
    const controlTick = (now) => {
      if (!window.__issue629ControlRafActive) return;
      window.__pandaPreviewDiagnostics.record('raf-control', now, {});
      requestAnimationFrame(controlTick);
    };
    requestAnimationFrame(controlTick);
    const stage = document.querySelector('[data-testid="stage-renderer"]');
    const observer = new MutationObserver(() => {
      window.__pandaPreviewDiagnostics.record('dom-stage-time', performance.now(), {
        timeMs: Number(stage?.dataset.stageTime ?? -1),
      });
    });
    observer.observe(stage, { attributes: true, attributeFilter: ['data-stage-time'] });
    window.__issue629Observer = observer;
    window.__issue629AudioTimer = setInterval(() => {
      const audio = window.__issue629Audio;
      if (audio) window.__pandaPreviewDiagnostics.record('audio-clock', performance.now(), {
        audioTimeMs: Math.round(audio.currentTime * 1000),
        previewTimeMs: Number(document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewTime ?? -1),
        paused: audio.paused,
      });
    }, 100);
    document.querySelector('[data-testid="product-preview-play-pause"]').click();
  })()`);
  await waitFor(`Number(document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewTime ?? 0) >= 5400`, `${label} playback did not advance.`, 25000);
  const result = await evaluate(`(() => {
    window.__issue629ControlRafActive = false;
    window.__issue629Observer.disconnect();
    clearInterval(window.__issue629AudioTimer);
    const overlay = document.querySelector('[data-testid="product-preview-overlay"]');
    const stage = document.querySelector('[data-testid="stage-renderer"]');
    const canvas = stage?.querySelector('canvas');
    return {
      events: window.__pandaPreviewDiagnostics.read(),
      stageReady: stage?.dataset.stageReady,
      stageDisplayReady: stage?.dataset.stageDisplayReady,
      previewDegraded: overlay?.dataset.previewDegraded,
      previewTimeMs: Number(overlay?.dataset.previewTime ?? -1),
      stageTimeMs: Number(stage?.dataset.stageTime ?? -1),
      devicePixelRatio: window.devicePixelRatio,
      windowSize: { width: innerWidth, height: innerHeight },
      canvas: canvas ? {
        width: canvas.width, height: canvas.height,
        cssWidth: canvas.getBoundingClientRect().width,
        cssHeight: canvas.getBoundingClientRect().height,
      } : null,
    };
  })()`);
  result.pausedRaf = {
    count: pausedRaf.count,
    medianMs: percentile(pausedRaf.deltas, 0.5),
    p95Ms: percentile(pausedRaf.deltas, 0.95),
    visibility: pausedRaf.visibility,
    focused: pausedRaf.focused,
  };
  if (traceStarted) result.trace = await stopSceneTrace(traceStarted);
  await evaluate(`document.querySelector('[data-testid="product-preview-close"]').click()`);
  await waitFor(`!document.querySelector('[data-testid="product-preview-overlay"]')`, 'Preview did not close.');
  return result;
}

async function capturePrivatePixelChecks() {
  if (!privateProjectRoot || !privateMeasureShotIds) return [];
  const checkpoints = [
    { label: 'dialogue-phase-125ms', timeMs: 1458 },
    { label: 'dialogue-phase-250ms', timeMs: 1583 },
    { label: 'dialogue-phase-375ms', timeMs: 1708 },
    { label: 'dialogue-late', timeMs: 3700 },
  ];
  await selectShot(privateMeasureShotIds.C);
  await openPreview();
  const checks = [];
  for (const checkpoint of checkpoints) {
    await evaluate(`(() => {
      const input = document.querySelector('[data-testid="product-preview-scrubber"]');
      if (!(input instanceof HTMLInputElement)) throw new Error('Preview scrubber missing.');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(String(checkpoint.timeMs))});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor(
      `(() => { const stage = document.querySelector('[data-testid="stage-renderer"]'); return stage?.dataset.stageReady === 'true' && Math.abs(Number(stage?.dataset.stageTime ?? -1) - ${checkpoint.timeMs}) <= 5; })()`,
      `Preview did not seek to ${checkpoint.timeMs}ms for pixel capture.`,
      30000,
    );
    await evaluate(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    const rect = await evaluate(`(() => {
      const stage = document.querySelector('[data-testid="stage-renderer"]');
      const canvas = stage?.querySelector('canvas');
      const bounds = stage?.getBoundingClientRect();
      if (!stage || !canvas || !bounds) throw new Error('Visible Stage capture target missing.');
      return {
        x: Math.floor(bounds.x), y: Math.floor(bounds.y),
        width: Math.ceil(bounds.width), height: Math.ceil(bounds.height),
        stageTimeMs: Number(stage.dataset.stageTime ?? -1),
        canvasWidth: canvas.width, canvasHeight: canvas.height,
      };
    })()`);
    const image = await windowRef.webContents.capturePage({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
    const png = image.toPNG();
    const size = image.getSize();
    checks.push({
      label: checkpoint.label,
      requestedTimeMs: checkpoint.timeMs,
      stageTimeMs: rect.stageTimeMs,
      cropWidth: size.width,
      cropHeight: size.height,
      canvasWidth: rect.canvasWidth,
      canvasHeight: rect.canvasHeight,
      pngByteLength: png.byteLength,
      pngSha256: sha256(png),
    });
  }
  await evaluate(`document.querySelector('[data-testid="product-preview-close"]').click()`);
  await waitFor(`!document.querySelector('[data-testid="product-preview-overlay"]')`, 'Pixel capture Preview did not close.');
  return checks;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))].toFixed(2));
}

function summarize(scene) {
  const events = scene.events;
  const byEvent = (name) => events.filter((sample) => sample.event === name);
  const cadence = (name) => {
    const samples = byEvent(name).filter((sample) => sample.timeMs == null || sample.timeMs >= 0);
    const distinct = samples.filter((sample, index) => index === 0 || sample.timeMs !== samples[index - 1].timeMs);
    const deltas = distinct.slice(1).map((sample, index) => sample.atMs - distinct[index].atMs);
    return { count: distinct.length, medianMs: percentile(deltas, 0.5), p95Ms: percentile(deltas, 0.95) };
  };
  const durations = (name) => {
    const values = byEvent(name).map((sample) => sample.durationMs).filter(Number.isFinite);
    return { count: values.length, medianMs: percentile(values, 0.5), p95Ms: percentile(values, 0.95), totalMs: Number(values.reduce((sum, value) => sum + value, 0).toFixed(2)) };
  };
  const raf = byEvent('raf');
  const controlRaf = byEvent('raf-control');
  const cache = byEvent('composite-cache-rebuild');
  const cacheReuse = byEvent('composite-cache-reuse');
  const cacheInputs = [...cache, ...cacheReuse];
  const audio = byEvent('audio-clock').filter((sample) => !sample.paused && sample.previewTimeMs >= 1000);
  const rafIntervals = raf.slice(1).map((sample, index) => sample.atMs - raf[index].atMs);
  const controlIntervals = controlRaf.slice(1).map((sample, index) => sample.atMs - controlRaf[index].atMs);
  const audioDrift = (sample) => sample.previewTimeMs - 1000 - sample.audioTimeMs;
  const steadyAudio = audio.filter((sample) => sample.previewTimeMs >= 1600 && sample.previewTimeMs <= 4900);
  return {
    ready: scene.stageReady === 'true' && scene.stageDisplayReady === 'true' && scene.previewDegraded !== 'true',
    raf: {
      count: raf.length,
      medianMs: percentile(rafIntervals, 0.5), p95Ms: percentile(rafIntervals, 0.95),
      deltaMedianMs: percentile(raf.map((sample) => sample.deltaMs), 0.5),
      clampedCount: raf.filter((sample) => sample.clamped).length,
      hiddenCount: raf.filter((sample) => sample.visibility !== 'visible').length,
      unfocusedCount: raf.filter((sample) => !sample.focused).length,
      wallElapsedMs: raf.length > 1 ? Number((raf.at(-1).atMs - raf[0].atMs).toFixed(1)) : null,
      previewElapsedMs: raf.length > 1 ? raf.at(-1).nextTimeMs - raf[0].nextTimeMs : null,
    },
    pausedRaf: scene.pausedRaf,
    controlRaf: {
      count: controlRaf.length,
      medianMs: percentile(controlIntervals, 0.5),
      p95Ms: percentile(controlIntervals, 0.95),
    },
    stageCommit: cadence('stage-commit'), domStageTime: cadence('dom-stage-time'),
    evaluateShot: durations('evaluate-shot'), mouthProjection: durations('mouth-projection'),
    imagePlan: durations('image-plan'), stageRenderModel: durations('stage-render-model'),
    compositeCache: {
      ...durations('composite-cache-rebuild'),
      reuseCount: cacheReuse.length,
      uniqueVisualSignatures: new Set(cacheInputs.map((sample) => sample.visualSignature)).size,
      previouslyCachedCount: cache.filter((sample) => sample.previouslyCached).length,
    },
    konvaDrawScene: durations('konva-draw-scene'),
    overlayRender: durations('overlay-render-pre-jsx'),
    overlayRenderToCommit: durations('overlay-render-to-commit'),
    stageRender: durations('stage-render-pre-jsx'),
    stageRenderToCommit: durations('stage-render-to-commit'),
    canvasStageRender: durations('canvas-stage-render-pre-jsx'),
    canvasStageRenderToCommit: durations('canvas-stage-render-to-commit'),
    longTasks: durations('long-task'),
    audioClock: {
      count: audio.length,
      firstDriftMs: audio.length ? audioDrift(audio[0]) : null,
      steadyDriftMedianMs: percentile(steadyAudio.map(audioDrift), 0.5),
      lastDriftMs: audio.length ? audioDrift(audio.at(-1)) : null,
    },
  };
}

async function measureIdleRaf(durationMs = 3000) {
  return evaluate(`new Promise((resolve) => {
    const samples = [];
    const startedAt = performance.now();
    let previous = startedAt;
    const tick = (now) => {
      samples.push(now - previous);
      previous = now;
      if (now - startedAt >= ${durationMs}) {
        resolve({
          count: samples.length,
          deltas: samples,
          visibility: document.visibilityState,
          focused: document.hasFocus(),
        });
      } else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })`);
}

function redactPrivateScene(scene) {
  if (!privateProjectRoot) return scene;
  return {
    ...scene,
    events: scene.events.map((event) => {
      const { ownerLayerId, visualSignature, ...redacted } = event;
      return {
        ...redacted,
        ...(ownerLayerId ? { ownerLayerToken: 'composite-character' } : {}),
        ...(typeof visualSignature === 'string'
          ? { visualSignatureSha256: sha256(Buffer.from(visualSignature)) }
          : {}),
      };
    }),
  };
}

async function run() {
  if (!privateProjectRoot) mkdirSync(projectRoot, { recursive: true });
  const project = privateProjectRoot ? privateProjectFixture() : fixture();
  if (privateSourceContext) {
    writeFileSync(path.join(runRoot, 'private-source-context.json'), JSON.stringify(privateSourceContext, null, 2));
  } else {
    writeFileSync(path.join(runRoot, 'fixture-project.json'), JSON.stringify(project, null, 2));
  }
  registerHandlers(project);
  await app.whenReady();
  for (const [name, location] of [
    ['userData', userDataRoot], ['sessionData', path.join(userDataRoot, 'session-data')],
    ['temp', path.join(runRoot, 'temp')], ['logs', path.join(runRoot, 'logs')],
    ['crashDumps', path.join(runRoot, 'crash-dumps')],
  ]) {
    mkdirSync(location, { recursive: true });
    try { app.setPath(name, location); } catch { /* path was already fixed */ }
  }
  try {
    windowRef = await createMainWindow({ show: true });
    windowRef.setSize(1600, 1000);
    windowRef.show();
    windowRef.focus();
    await openProject();
    const graphicsStatus = graphicsMode || process.env.ISSUE872_CAPTURE_GPU === '1'
      ? await captureGraphicsStatus()
      : null;
    await installProbe();
    const idleRaf = await measureIdleRaf();
    const scenes = {};
    const shotIds = privateMeasureShotIds ?? { A: ID.shotA, B: ID.shotB, C: ID.shotC };
    const cLabel = privateProjectRoot ? 'C-real' : 'C';
    const sceneSpecs = graphicsMode
      ? [['A', shotIds.A]]
      : [
          ['A', shotIds.A], ['A-canvas-hidden', shotIds.A, { hideCanvas: true }],
          ['A-hidden', shotIds.A, { hideStage: true }],
          ['B', shotIds.B], [cLabel, shotIds.C],
        ];
    for (const [label, shotId, options] of sceneSpecs) {
      scenes[label] = await measureScene(label, shotId, options);
      writeFileSync(
        path.join(runRoot, `scene-${label}.json`),
        JSON.stringify(redactPrivateScene(scenes[label])),
      );
      console.log(`${label}: ${JSON.stringify(summarize(scenes[label]))}`);
    }
    const pixelChecks = process.env.ISSUE872_CAPTURE_PIXELS === '1'
      ? await capturePrivatePixelChecks()
      : null;
    const summary = {
      runRoot, branch: measuredBranch,
      startingSha: measuredSha ?? (graphicsMode
        ? '67df04dc6896cc5d550ac019ad4366b8c19c0805'
        : '1563e918c6f2b7e96063682b227e4c307af4c35a'),
      ...(issue872Mode ? {
        experimentDiffSha256: process.env.ISSUE872_EXPERIMENT_DIFF_SHA256 ?? null,
        cacheStrategy: process.env.ISSUE872_CACHE_STRATEGY ?? 'signature-reuse',
      } : {}),
      diagnosticScenePixelRatio: scenePixelRatio,
      graphicsStatusPath: graphicsStatus ? path.join(runRoot, 'graphics-status.json') : null,
      fixture: privateSourceContext
        ? 'A/B Position controls use owner-private assets in memory; C-real is an original speaking shot. Source files and media were not copied or written.'
        : 'One 6s shot per scene; 1100px Position travel over 5s; synthetic full-size PNGs; C has silent WAV, subtitle, Mouth, Expression switch, seven visible Layers.',
      privateSourceContextPath: privateSourceContext ? path.join(runRoot, 'private-source-context.json') : null,
      ...(pixelChecks ? { pixelChecks } : {}),
      windowSize: scenes.A.windowSize, devicePixelRatio: scenes.A.devicePixelRatio,
      canvas: scenes.A.canvas,
      idleRaf: {
        count: idleRaf.count, medianMs: percentile(idleRaf.deltas, 0.5),
        p95Ms: percentile(idleRaf.deltas, 0.95),
        visibility: idleRaf.visibility, focused: idleRaf.focused,
      },
      A: summarize(scenes.A),
      ...(graphicsMode ? { trace: scenes.A.trace ?? null } : {
        ACanvasHidden: summarize(scenes['A-canvas-hidden']),
        AHidden: summarize(scenes['A-hidden']),
        B: summarize(scenes.B),
        [privateProjectRoot ? 'CReal' : 'C']: summarize(scenes[cLabel]),
      }),
    };
    writeFileSync(path.join(runRoot, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(`RESULT_PATH=${path.join(runRoot, 'summary.json')}`);
  } finally {
    if (windowRef && !windowRef.isDestroyed()) windowRef.destroy();
    for (const channel of channels) ipcMain.removeHandler(channel);
  }
  app.exit(0);
}

run().catch((error) => {
  console.error(error);
  app.exit(1);
});

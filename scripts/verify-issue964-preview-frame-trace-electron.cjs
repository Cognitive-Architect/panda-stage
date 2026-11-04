const { app, ipcMain } = require('electron');
const { createHash } = require('node:crypto');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { deflateSync } = require('node:zlib');
const { createMainWindow } = require('../dist-electron/main/windows/main-window.js');
const { AssetCanvasImageService } = require('../dist-electron/main/services/AssetCanvasImageService.js');
const { ProjectService } = require('../dist-electron/main/services/ProjectService.js');
const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');
const { LayerService } = require('../dist-electron/domain/services/LayerService.js');
const { ShotService } = require('../dist-electron/domain/services/ShotService.js');
const { ProjectSchema } = require('../dist-electron/domain/models/project.js');

const root = process.env.PANDA_STAGE_ISSUE964_ROOT
  ? path.resolve(process.env.PANDA_STAGE_ISSUE964_ROOT)
  : 'D:\\PandaStage-Acceptance\\issue964-preview-frame-trace';
const runRoot = path.join(root, `run-${process.pid}-${Date.now()}`);
const projectRoot = path.join(runRoot, 'synthetic-21-frame.pandastage');
const userData = path.join(runRoot, 'electron-user-data');
const resultPath = path.join(runRoot, 'result.json');
const animationId = '96400000-0000-4000-8000-000000000002';
const frameIds = Array.from({ length: 21 }, (_, index) =>
  `96400000-0000-4000-8000-${String(index + 11).padStart(12, '0')}`);
const evidence = { project: null, savedProject: null, imageReads: [] };
let currentPhase = 'bootstrap';
let windowRef = null;
let resultExitCode = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, bytes) {
  const typeBytes = Buffer.from(type, 'ascii');
  const payload = Buffer.concat([typeBytes, bytes]);
  const size = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length, 0);
  checksum.writeUInt32BE(crc32(payload), 0);
  return Buffer.concat([size, payload, checksum]);
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

function makeProject(project) {
  const bytesByAsset = new Map();
  const frames = frameIds.map((assetId, ordinal) => {
    const color = [30 + ordinal * 8, 220 - ordinal * 7, 60 + ordinal * 5];
    const bytes = solidPng(400, 400, color);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const relativePath = `assets/issue964-frame-${ordinal}.png`;
    const absolutePath = path.join(projectRoot, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, bytes);
    bytesByAsset.set(assetId, bytes);
    return {
      ordinal,
      sourceFrameIndex: ordinal,
      assetId,
      sha256,
      sourceViewport: { x: 0, y: 0, width: 400, height: 400 },
      offset: { x: 0, y: 0 },
      startMs: ordinal * 40,
      durationMs: 40,
      createdBySequenceImport: true,
      asset: {
        id: assetId,
        kind: 'image',
        name: `Synthetic frame ${ordinal}`,
        relativePath,
        mimeType: 'image/png',
        width: 400,
        height: 400,
        sha256,
        usage: 'uncategorized',
        keywords: ['synthetic', 'issue964'],
      },
    };
  });
  const animation = {
    id: animationId,
    name: 'Issue 964 synthetic 21-frame walk',
    source: {
      basename: 'issue964-synthetic.fla',
      sha256: 'a'.repeat(64),
      renderTargetId: 'issue964-target',
      targetKind: 'graphic-symbol',
      targetName: 'Synthetic 21-frame walk',
      startFrameIndex: 0,
      endFrameIndex: 20,
      sourceFps: 25,
      canvas: { width: 400, height: 400 },
      documentCanvas: { width: 400, height: 400 },
      anchor: { x: 0, y: 0 },
    },
    durationMs: 840,
    frames: frames.map((frame) => {
      const animationFrame = { ...frame };
      delete animationFrame.asset;
      return animationFrame;
    }),
  };
  let nextProject = ProjectSchema.parse({
    ...project,
    assets: frames.map((frame) => frame.asset),
    animations: [animation],
  });
  nextProject = new ShotService().create(nextProject, {
    name: 'Synthetic preview shot',
    durationMs: 12_000,
  });
  const shot = nextProject.shots[0];
  assert(shot, 'Synthetic shot was not created.');
  const result = new LayerService().createFromAsset(
    nextProject,
    shot.id,
    { type: 'animation', animationId, position: { x: 960, y: 540 }, startTimeMs: 0 },
  );
  nextProject = ProjectSchema.parse({
    ...result.project,
    shots: result.project.shots.map((candidate) => candidate.id === shot.id
      ? {
          ...candidate,
          layers: candidate.layers.map((layer) => layer.id === result.layer.id
            ? { ...layer, animationPlayback: { mode: 'loop', endBehavior: 'hold' } }
            : layer),
        }
      : candidate),
  });
  return { project: nextProject, bytesByAsset };
}

function register(channel, handler) {
  ipcMain.handle(channel, async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      console.error(`[issue964 ipc:error] ${channel}`, error);
      throw error;
    }
  });
}

function registerTestIpc(projectService, bytesByAsset) {
  const canvasImageService = new AssetCanvasImageService({
    getCurrentProjectSnapshot: (requestedRoot) => requestedRoot === projectRoot
      ? { project: evidence.savedProject ?? evidence.project }
      : null,
  });
  register(IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY, () => ({ ok: true, status: 'cancelled' }));
  register(IPC_CHANNELS.PROJECT_OPEN, async (_event, request) => {
    if (request.projectRoot !== projectRoot) {
      return { ok: false, error: { code: 'PROJECT_NOT_FOUND', message: 'Synthetic fixture missing.', projectRoot: request.projectRoot } };
    }
    const document = await projectService.open(projectRoot);
    evidence.savedProject = document.project;
    return { ok: true, value: document };
  });
  register(IPC_CHANNELS.PROJECT_SAVE, async (_event, request) => {
    const document = await projectService.save(request.projectRoot, request.project, request.revision);
    evidence.savedProject = document.project;
    return { ok: true, value: document };
  });
  register(IPC_CHANNELS.PROJECT_CONFIRM_SWITCH, () => ({ outcome: 'saved' }));
  register(IPC_CHANNELS.RECENT_PROJECTS_LIST, () => ({ ok: true, entries: [] }));
  register(IPC_CHANNELS.RECENT_PROJECTS_OPEN, async (_event, request) => {
    const document = await projectService.open(request.projectRoot);
    evidence.savedProject = document.project;
    return { ok: true, document };
  });
  register(IPC_CHANNELS.AUTOSAVE_TRACK, () => ({ ok: true }));
  register(IPC_CHANNELS.AUTOSAVE_UPDATE, () => ({ ok: true }));
  register(IPC_CHANNELS.AUTOSAVE_STOP, () => ({ ok: true }));
  register(IPC_CHANNELS.RECOVERY_DETECT, () => ({ ok: true, candidate: null }));
  register(IPC_CHANNELS.RECOVERY_IGNORE, () => ({ ok: true, retained: true }));
  register(IPC_CHANNELS.ASSET_THUMBNAIL_READ, (_event, request) => {
    const bytes = bytesByAsset.get(request.assetId);
    return bytes
      ? { ok: true, status: 'ready', assetId: request.assetId, dataUrl: `data:image/png;base64,${bytes.toString('base64')}` }
      : { ok: false, error: { code: 'ASSET_NOT_FOUND', assetId: request.assetId, message: 'Synthetic asset missing.' } };
  });
  register(IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ, async (_event, request) => {
    const startedAt = performance.now();
    const response = await canvasImageService.read(request);
    evidence.imageReads.push({
      assetId: request.assetId,
      status: response.ok ? response.status : response.error.code,
      byteLength: response.ok ? response.byteLength : null,
      durationMs: Number((performance.now() - startedAt).toFixed(3)),
    });
    return response;
  });
}

async function waitFor(expression, message, timeout = 20_000) {
  const script = '(async () => { const end=Date.now()+' + timeout + '; while(Date.now()<end) {' +
    'try { if (' + expression + ') return true; } catch {} await new Promise(r=>setTimeout(r,40)); }' +
    'throw new Error(' + JSON.stringify(message) + '); })()';
  await windowRef.webContents.executeJavaScript(script);
}

async function openProject() {
  currentPhase = 'wait for Project Center';
  await waitFor(
    'document.querySelector(\'[data-testid="project-center-screen"] .recovery-open-row input\')',
    'Project Center did not appear.',
  );
  currentPhase = 'submit synthetic project open';
  await windowRef.webContents.executeJavaScript(
    '(() => { const i=document.querySelector(\'[data-testid="project-center-screen"] .recovery-open-row input\');' +
      'const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;' +
      'set.call(i,' + JSON.stringify(projectRoot) + '); i.dispatchEvent(new Event("input",{bubbles:true}));' +
      'document.querySelector(\'[data-testid="project-center-screen"] .recovery-open-row button\')?.click(); })()',
  );
  currentPhase = 'wait for Editor';
  await waitFor(
    'document.querySelector(\'.editor-shell\')?.dataset.editorPage==="editor"&&document.querySelector(\'[data-testid="project-canvas-stage"]\')',
    'Synthetic project did not open in Editor.',
  );
}

async function run() {
  mkdirSync(runRoot, { recursive: true });
  const projectService = new ProjectService();
  const created = await projectService.create(projectRoot, { name: 'Issue 964 Frame Trace Evidence' });
  const fixture = makeProject(created.project);
  evidence.project = fixture.project;
  const saved = await projectService.save(projectRoot, fixture.project, 0);
  evidence.savedProject = saved.project;
  registerTestIpc(projectService, fixture.bytesByAsset);
  await app.whenReady();
  for (const [key, folder] of [
    ['userData', userData],
    ['sessionData', path.join(userData, 'session-data')],
  ]) {
    mkdirSync(folder, { recursive: true });
    try { app.setPath(key, folder); } catch { /* The isolated profile was already selected on the command line. */ }
  }
  windowRef = await createMainWindow({ show: false });
  windowRef.setSize(1440, 960);
  windowRef.webContents.setBackgroundThrottling(false);
  windowRef.webContents.on('render-process-gone', (_event, details) => {
    console.error('[issue964 renderer gone]', JSON.stringify(details));
  });
  await windowRef.webContents.executeJavaScript(
    'window.addEventListener("error",e=>console.error("issue964 window error",e.message,e.filename,e.lineno));' +
      'window.addEventListener("unhandledrejection",e=>console.error("issue964 rejection",String(e.reason)));',
  );
  await openProject();
  currentPhase = 'install frame trace sink';
  await windowRef.webContents.executeJavaScript(
    'window.__issue964FrameTraceEvents=[];' +
      'window.__pandaPreviewDiagnostics={frameTraceEnabled:true,record:(event,atMs,detail)=>' +
      'window.__issue964FrameTraceEvents.push({event,atMs:Number(atMs),detail})};true;',
  );
  currentPhase = 'open Product Preview';
  currentPhase = 'expand Quick Actions';
  await windowRef.webContents.executeJavaScript(
    '(() => { const drawer=document.querySelector(\'[data-testid="quick-action-drawer"]\');' +
      'if(drawer?.dataset.expanded!=="true") drawer?.querySelector(\'[data-testid="quick-action-drawer-handle"]\')?.click(); })()',
  );
  currentPhase = 'wait for Quick Actions';
  await waitFor(
    'document.querySelector(\'[data-testid="quick-action-drawer"]\')?.dataset.expanded==="true"',
    'Quick Actions drawer did not open.',
  );
  currentPhase = 'click Product Preview';
  await windowRef.webContents.executeJavaScript('document.querySelector(\'[data-testid="quick-action-play"]\')?.click()');
  currentPhase = 'wait for preview readiness';
  await waitFor(
    'document.querySelector(\'[data-testid="product-preview-overlay"]\')?.dataset.previewSurface==="active"&&' +
      'document.querySelector(\'[data-testid="product-preview-overlay"]\')?.dataset.previewDataReady==="true"',
    'Product Preview did not become ready.',
    30_000,
  );
  currentPhase = 'capture same-identity React/Konva trace';
  await waitFor(
    '(() => { const e=window.__issue964FrameTraceEvents||[]; return e.some(x=>x.event==="frame-trace:exact-ready-commit"&&' +
      'e.some(y=>y.event==="frame-trace:stage-paint"&&y.detail.traceId===x.detail.traceId&&' +
      'y.detail.displayedFrameId===x.detail.targetFrameId)); })()',
    'No exact-ready React commit was followed by a Konva Stage paint with the same displayed frame ID.',
    30_000,
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  const events = await windowRef.webContents.executeJavaScript('window.__issue964FrameTraceEvents');
  const traceIds = [...new Set(events.map((entry) => entry.detail?.traceId).filter(Boolean))];
  const traces = traceIds.map((traceId) => {
    const rows = events.filter((entry) => entry.detail?.traceId === traceId);
    const eventNames = new Set(rows.map((entry) => entry.event));
    const sample = (event) => rows.find((entry) => entry.event === `frame-trace:${event}`) ?? null;
    const target = sample('target-changed');
    const byteReadStart = sample('byte-read-start');
    const byteReadReady = sample('byte-read-ready');
    const decodeStart = sample('decode-start');
    const decodeReady = sample('decode-ready');
    const stageImageExactReady = sample('stage-image-exact-ready');
    const exact = rows.find((entry) => entry.event === 'frame-trace:exact-ready-commit' &&
      entry.detail.displayedFrameId === entry.detail.targetFrameId);
    const paint = rows.find((entry) => entry.event === 'frame-trace:stage-paint' &&
      entry.detail.displayedFrameId === entry.detail.targetFrameId);
    const elapsed = (later, earlier) => Number.isFinite(later) && Number.isFinite(earlier)
      ? Number((later - earlier).toFixed(3))
      : null;
    return {
      traceId,
      targetFrameId: rows[0]?.detail?.targetFrameId ?? null,
      targetAssetId: rows[0]?.detail?.targetAssetId ?? null,
      stages: {
        target: eventNames.has('frame-trace:target-changed'),
        requiredQueued: eventNames.has('frame-trace:required-queued'),
        byteReadStart: eventNames.has('frame-trace:byte-read-start'),
        byteReadReady: eventNames.has('frame-trace:byte-read-ready'),
        decodeStart: eventNames.has('frame-trace:decode-start'),
        decodeReady: eventNames.has('frame-trace:decode-ready'),
        exactReadyCommit: Boolean(exact),
        stagePaint: Boolean(paint),
      },
      timingMs: {
        targetToByteReadStart: elapsed(byteReadStart?.atMs, target?.detail?.requestedAt),
        targetToByteReadReady: elapsed(byteReadReady?.atMs, target?.detail?.requestedAt),
        byteReadToDecodeReady: elapsed(decodeReady?.atMs, byteReadReady?.atMs),
        targetToDecodeReady: elapsed(decodeReady?.atMs, target?.detail?.requestedAt),
        decodeReadyToStageImageExactReady: elapsed(stageImageExactReady?.atMs, decodeReady?.atMs),
        targetToExactReadyCommit: elapsed(exact?.atMs, target?.detail?.requestedAt),
        exactReadyCommitToStagePaint: elapsed(paint?.atMs, exact?.atMs),
      },
      eventSamples: {
        target,
        requiredQueued: sample('required-queued'),
        byteReadStart,
        byteReadReady,
        decodeStart,
        decodeReady,
        stageImageExactReady,
        exactReadyCommit: exact,
        stagePaint: paint,
      },
      exactReadyCommit: exact ? exact.detail : null,
      stagePaint: paint ? paint.detail : null,
      physicalDisplay: 'NOT_OBSERVABLE',
    };
  });
  const complete = traces.find((trace) => Object.values(trace.stages).every(Boolean));
  assert(complete, 'No single trace contained the complete byte/decode/exact-ready/Stage paint chain.');
  return {
    issue: 964,
    passed: true,
    phase: currentPhase,
    platform: 'Windows Electron 43.1.1 synthetic UI run',
    windowVisibility: 'hidden; background throttling disabled',
    fixture: { frames: 21, sourceFps: 25, frameDurationMs: 40, assetReads: evidence.imageReads.length },
    capture: { eventCount: events.length, traceCount: traces.length, traces },
    physicalDisplay: 'NOT_OBSERVABLE',
    projectRoot,
    runRoot,
  };
}

async function main() {
  try {
    const result = await run();
    writeFileSync(resultPath, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({
      issue: result.issue,
      passed: result.passed,
      platform: result.platform,
      windowVisibility: result.windowVisibility,
      fixture: result.fixture,
      eventCount: result.capture.eventCount,
      completeTraceCount: result.capture.traces.filter((trace) => Object.values(trace.stages).every(Boolean)).length,
      completeTraceTimingMs: result.capture.traces.find((trace) => Object.values(trace.stages).every(Boolean))?.timingMs ?? null,
      physicalDisplay: result.physicalDisplay,
      resultPath,
    }, null, 2));
  } catch (error) {
    const failure = {
      issue: 964,
      passed: false,
      phase: currentPhase,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
      projectRoot,
      runRoot,
    };
    mkdirSync(runRoot, { recursive: true });
    writeFileSync(resultPath, JSON.stringify(failure, null, 2));
    console.error('[issue964] ' + failure.error);
    resultExitCode = 1;
  } finally {
    if (windowRef && !windowRef.isDestroyed()) windowRef.destroy();
    app.exit(resultExitCode);
  }
}

main();

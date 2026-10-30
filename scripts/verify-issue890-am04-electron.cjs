const { app, ipcMain } = require('electron');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { deflateSync } = require('node:zlib');
const { createMainWindow } = require('../dist-electron/main/windows/main-window.js');
const { AssetCanvasImageService } = require('../dist-electron/main/services/AssetCanvasImageService.js');
const { ProjectService } = require('../dist-electron/main/services/ProjectService.js');
const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');
const { migrateProject } = require('../dist-electron/domain/migrations/index.js');

const root = 'D:\\PandaStage-Acceptance\\issue890-am04';
const evidence = path.join(root, 'electron');
const userData = path.join(root, 'electron-user-data');
const projectRoot = path.join(root, 'projects', 'issue890-electron-' + process.pid + '-' + Date.now() + '.pandastage');
const resultPath = path.join(evidence, 'results.json');
const example = require('../demo-project/project-v1.example.json');
const fallbackPng = readFileSync(path.join(__dirname, '..', 'public/probe/panda-character.png'));
const ids = {
  project: '89000000-0000-4000-8000-000000000001',
  animation: '89000000-0000-4000-8000-000000000002',
  frames: Array.from({ length: 21 }, (_, index) =>
    '89000000-0000-4000-8000-' + String(index + 11).padStart(12, '0')),
};
const colors = Array.from({ length: 21 }, (_, index) => [
  30 + index * 8,
  220 - index * 7,
  60 + index * 5,
]);
const sizeCycle = [
  { width: 200, height: 200 },
  { width: 160, height: 180 },
  { width: 180, height: 160 },
];
const sizes = Array.from({ length: 21 }, (_, index) => sizeCycle[index % sizeCycle.length]);
const offsets = sizes.map((size) => ({
  x: (400 - size.width) / 2,
  y: (400 - size.height) / 2,
}));
const bytesByAsset = new Map();
const projectOpenEvidence = [];
const projectSaveEvidence = [];
const canvasImageReadEvidence = [];
let fixture;
let savedProject = null;

app.on('window-all-closed', () => {});

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
  const typeBuffer = Buffer.from(type, 'ascii');
  const payload = Buffer.concat([typeBuffer, bytes]);
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

function makeFixture(projectId) {
  const frames = colors.map((color, index) => {
    const size = sizes[index];
    const bytes = solidPng(size.width, size.height, color);
    bytesByAsset.set(ids.frames[index], bytes);
    writeFileSync(path.join(evidence, 'frame-' + index + '.png'), bytes);
    return {
      ordinal: index,
      sourceFrameIndex: index,
      assetId: ids.frames[index],
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sourceViewport: {
        x: 100 + offsets[index].x,
        y: 100 + offsets[index].y,
        width: size.width,
        height: size.height,
      },
      offset: offsets[index],
      startMs: index * 40,
      durationMs: 40,
      createdBySequenceImport: true,
    };
  });
  const animation = {
    id: ids.animation,
    name: 'Issue 890 synthetic 21-frame walk',
    source: {
      basename: 'issue890-synthetic.fla',
      sha256: 'b'.repeat(64),
      renderTargetId: 'issue890-target',
      targetKind: 'graphic-symbol',
      targetName: 'Issue 890 synthetic 21-frame walk',
      startFrameIndex: 0,
      endFrameIndex: 20,
      sourceFps: 25,
      canvas: { width: 400, height: 400 },
      documentCanvas: { width: 400, height: 400 },
      anchor: { x: 100, y: 100 },
    },
    durationMs: 840,
    frames,
  };
  const base = migrateProject({
    ...example,
    id: projectId,
    name: 'Issue 890 AM-04 Electron Evidence',
  });
  const fallbackDimensions = {
    width: fallbackPng.readUInt32BE(16),
    height: fallbackPng.readUInt32BE(20),
  };
  const fallbackSha256 = createHash('sha256').update(fallbackPng).digest('hex');
  const baseAssets = base.assets.map((asset) => {
    if (asset.kind !== 'image') return asset;
    const assetPath = path.join(projectRoot, asset.relativePath);
    mkdirSync(path.dirname(assetPath), { recursive: true });
    writeFileSync(assetPath, fallbackPng);
    bytesByAsset.set(asset.id, fallbackPng);
    return {
      ...asset,
      mimeType: 'image/png',
      width: fallbackDimensions.width,
      height: fallbackDimensions.height,
      sha256: fallbackSha256,
    };
  });
  for (const frame of frames) {
    const framePath = path.join(projectRoot, 'assets', 'issue890-frame-' + frame.ordinal + '.png');
    mkdirSync(path.dirname(framePath), { recursive: true });
    writeFileSync(
      framePath,
      bytesByAsset.get(frame.assetId),
    );
  }
  return migrateProject({
    ...base,
    assets: [
      ...baseAssets,
      ...frames.map((frame, index) => ({
        id: frame.assetId,
        kind: 'image',
        name: 'Issue 890 frame ' + index,
        relativePath: 'assets/issue890-frame-' + index + '.png',
        mimeType: 'image/png',
        width: frame.sourceViewport.width,
        height: frame.sourceViewport.height,
        sha256: frame.sha256,
        usage: 'uncategorized',
        keywords: ['issue890', 'synthetic'],
      })),
    ],
    animations: [animation],
    shots: base.shots.map((shot, index) => ({
      ...shot,
      durationMs: index === 0 ? 15_000 : shot.durationMs,
      timelineEvents: [],
      backgroundLayerId: shot.layers[0].id,
      layers: shot.layers.map((layer) => ({
        ...layer,
        locked: false,
        flipX: false,
      })),
    })),
  });
}

function register(channel, handler) {
  ipcMain.handle(channel, handler);
}

function mockIpc(projectService) {
  const canvasImageService = new AssetCanvasImageService({
    getCurrentProjectSnapshot: (requestedRoot) => requestedRoot === projectRoot
      ? { project: savedProject ?? fixture }
      : null,
  });
  register(IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY, () => ({ ok: true, status: 'cancelled' }));
  register(IPC_CHANNELS.PROJECT_OPEN, async (_event, request) => {
    if (request.projectRoot !== projectRoot) {
      return {
        ok: false,
        error: {
          code: 'PROJECT_NOT_FOUND',
          message: 'Synthetic fixture missing.',
          projectRoot: request.projectRoot,
        },
      };
    }
    const document = await projectService.open(projectRoot);
    savedProject = document.project;
    projectOpenEvidence.push({
      projectId: document.project.id,
      sourceVersion: document.sourceVersion,
    });
    return { ok: true, value: document };
  });
  register(IPC_CHANNELS.PROJECT_SAVE, async (_event, request) => {
    assert(request.projectRoot === projectRoot, 'Unexpected project root in save request.');
    const document = await projectService.save(
      request.projectRoot,
      request.project,
      request.revision,
    );
    savedProject = document.project;
    const animationLayers = document.project.shots.flatMap((shot) => shot.layers)
      .filter((layer) => layer.source.kind === 'animation');
    projectSaveEvidence.push({
      revision: request.revision,
      projectId: document.project.id,
      schemaVersion: document.project.schemaVersion,
      animationLayers,
      animationCount: document.project.animations.length,
      animationFrameCount: document.project.animations[0]?.frames.length ?? 0,
      assetCount: document.project.assets.length,
    });
    return { ok: true, value: document };
  });
  register(IPC_CHANNELS.PROJECT_CONFIRM_SWITCH, () => ({ outcome: 'saved' }));
  register(IPC_CHANNELS.RECENT_PROJECTS_LIST, () => ({ ok: true, entries: [] }));
  register(IPC_CHANNELS.RECENT_PROJECTS_OPEN, async (_event, request) => {
    if (request.projectRoot !== projectRoot) {
      return {
        ok: false,
        error: {
          code: 'RECENT_PROJECT_NOT_FOUND',
          message: 'Synthetic fixture missing.',
          projectRoot: request.projectRoot,
        },
      };
    }
    const document = await projectService.open(projectRoot);
    savedProject = document.project;
    projectOpenEvidence.push({
      projectId: document.project.id,
      sourceVersion: document.sourceVersion,
    });
    return { ok: true, document };
  });
  register(IPC_CHANNELS.AUTOSAVE_TRACK, () => ({ ok: true }));
  register(IPC_CHANNELS.AUTOSAVE_UPDATE, () => ({ ok: true }));
  register(IPC_CHANNELS.AUTOSAVE_STOP, () => ({ ok: true }));
  register(IPC_CHANNELS.RECOVERY_DETECT, () => ({ ok: true, candidate: null }));
  register(IPC_CHANNELS.RECOVERY_IGNORE, () => ({ ok: true, retained: true }));
  register(IPC_CHANNELS.ASSET_THUMBNAIL_READ, (_event, request) => {
    const bytes = bytesByAsset.get(request.assetId) ?? fallbackPng;
    return {
      ok: true,
      status: 'ready',
      assetId: request.assetId,
      dataUrl: 'data:image/png;base64,' + bytes.toString('base64'),
    };
  });
  register(IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ, async (_event, request) => {
    const response = await canvasImageService.read(request);
    canvasImageReadEvidence.push({
      assetId: request.assetId,
      sha256: request.sha256,
      status: response.ok ? response.status : response.error.code,
      byteLength: response.ok ? response.byteLength : null,
    });
    return response;
  });
}

function waitScript(expression, message, timeout = 20_000) {
  return '(async () => { const end = Date.now() + ' + timeout + '; while (Date.now() < end) {' +
    'try { if (' + expression + ') return true; } catch {} await new Promise((r) => setTimeout(r, 40)); }' +
    'throw new Error(' + JSON.stringify(message) + '); })()';
}

async function waitFor(window, expression, message, timeout) {
  await window.webContents.executeJavaScript(waitScript(expression, message, timeout));
}

async function click(window, selector) {
  const point = await window.webContents.executeJavaScript(
    '(() => { const selector=' + JSON.stringify(selector) + ';' +
    'const e=Array.from(document.querySelectorAll(selector)).find((candidate) => {' +
    'if (!(candidate instanceof HTMLElement)) return false; const style=getComputedStyle(candidate);' +
    'const rect=candidate.getBoundingClientRect(); return style.display!=="none"&&style.visibility!=="hidden"&&' +
    'rect.width>0&&rect.height>0; });' +
    'if (!(e instanceof HTMLElement)) throw new Error("Missing visible target: " + selector);' +
    'e.scrollIntoView({block:"center",inline:"center"}); const r=e.getBoundingClientRect();' +
    'const points=[{x:r.left+r.width/2,y:r.top+r.height/2},' +
    '{x:r.left+r.width*0.2,y:r.top+r.height*0.2},{x:r.left+r.width*0.8,y:r.top+r.height*0.2},' +
    '{x:r.left+r.width*0.2,y:r.top+r.height*0.8},{x:r.left+r.width*0.8,y:r.top+r.height*0.8}];' +
    'const point=points.find(({x,y})=>{const hit=document.elementFromPoint(x,y);return hit===e||e.contains(hit);});' +
    'if(!point){const x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);' +
    'throw new Error("Target is not hit-testable after scroll: " + JSON.stringify({selector,rect:{x:r.x,y:r.y,width:r.width,height:r.height},' +
    'viewport:{width:document.documentElement.clientWidth,height:document.documentElement.clientHeight},' +
    'hit:hit?{tag:hit.tagName,id:hit.id,className:String(hit.className),testId:hit.dataset?.testid,text:hit.textContent?.trim().slice(0,80)}:null}));}' +
    'return {x:Math.round(point.x),y:Math.round(point.y)}; })()',
  );
  window.show();
  window.focus();
  window.webContents.focus();
  window.webContents.sendInputEvent({
    type: 'mouseMove',
    x: point.x,
    y: point.y,
  });
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function clickPoint(window, point) {
  window.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 180));
}

async function setControlValue(window, selector, value, blur = false) {
  await window.webContents.executeJavaScript(
    '(() => { const e=document.querySelector(' + JSON.stringify(selector) + ');' +
    'if (!(e instanceof HTMLInputElement || e instanceof HTMLSelectElement)) throw new Error("Missing input: " + ' +
    JSON.stringify(selector) + '); const p=e instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLSelectElement.prototype;' +
    (blur ? 'e.focus();' : '') +
    'Object.getOwnPropertyDescriptor(p,"value").set.call(e,' + JSON.stringify(String(value)) + ');' +
    'e.dispatchEvent(new Event("input",{bubbles:true})); e.dispatchEvent(new Event("change",{bubbles:true}));' +
    (blur ? 'e.blur();' : '') +
    'return true; })()',
  );
  await new Promise((resolve) => setTimeout(resolve, 120));
}

async function pressKey(window, keyCode) {
  window.show();
  window.focus();
  window.webContents.focus();
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  await new Promise((resolve) => setTimeout(resolve, 120));
}

async function openProject(window) {
  await waitFor(
    window,
    'document.querySelector(\'[data-testid="project-center-screen"] .recovery-open-row input\')',
    'Project Center did not appear.',
  );
  await window.webContents.executeJavaScript(
    '(() => { const i=document.querySelector(\'[data-testid="project-center-screen"] .recovery-open-row input\');' +
    'const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;' +
    'setter.call(i,' + JSON.stringify(projectRoot) + '); i.dispatchEvent(new Event("input",{bubbles:true}));' +
    'document.querySelector(\'[data-testid="project-center-screen"] .recovery-open-row button\')?.click(); })()',
  );
  await waitFor(
    window,
    'document.querySelector(\'.editor-shell\')?.dataset.editorPage==="editor"&&document.querySelector(\'[data-testid="project-canvas-stage"]\')',
    'Project did not open in Editor.',
  );
  await waitFor(
    window,
    'document.querySelector(\'[data-testid="project-canvas-stage"]\')?.dataset.backgroundReady==="true"',
    'Project background did not load.',
  );
}

async function canvasPoint(window, x, y) {
  return window.webContents.executeJavaScript(
    '(() => { const v=document.querySelector(\'[data-testid="project-canvas-viewport"]\');' +
    'const r=v.getBoundingClientRect(),s=Number(v.dataset.displayScale);' +
    'return {x:Math.round(r.left+Number(v.dataset.offsetX)+' + x + '*s),' +
    'y:Math.round(r.top+Number(v.dataset.offsetY)+' + y + '*s)}; })()',
  );
}

async function browserDrag(window, from, to, steps = 12) {
  const debuggerApi = window.webContents.debugger;
  let attachedHere = false;
  window.show();
  window.focus();
  window.webContents.focus();
  if (!debuggerApi.isAttached()) {
    debuggerApi.attach('1.3');
    attachedHere = true;
  }
  try {
    await debuggerApi.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: from.x,
      y: from.y,
      buttons: 0,
    });
    await debuggerApi.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: from.x,
      y: from.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    for (let index = 1; index <= steps; index += 1) {
      await debuggerApi.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: Math.round(from.x + (to.x - from.x) * index / steps),
        y: Math.round(from.y + (to.y - from.y) * index / steps),
        button: 'left',
        buttons: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 35));
    }
    await debuggerApi.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: to.x,
      y: to.y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
  } finally {
    if (attachedHere && debuggerApi.isAttached()) debuggerApi.detach();
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

async function seekEditor(window, timeMs) {
  const point = await window.webContents.executeJavaScript(
    '(() => { const t=document.querySelector(\'[data-testid="timeline-ruler-track"]\');' +
    'const c=document.querySelector(\'[data-testid="timeline-timecode"]\');' +
    'const ruler=document.querySelector(\'[data-testid="timeline-ruler"]\');' +
    'const dock=document.querySelector(\'[data-testid="timeline-dock"]\');' +
    'const r=t.getBoundingClientRect(),rr=ruler.getBoundingClientRect();' +
    'const x=Math.round(r.left+(r.width-Number(dock.dataset.laneLabelWidth||0))*' + timeMs + '/Number(c.dataset.duration));' +
    'return {x,y:Math.round(rr.top+rr.height/2)}; })()',
  );
  await clickPoint(window, point);
  await waitFor(
    window,
    'Math.abs(Number(document.querySelector(\'[data-testid="project-canvas-stage"]\')?.dataset.currentTimeMs)-' +
      timeMs + ')<=22',
    'Timeline seek did not reach ' + timeMs + 'ms.',
  );
  return Number(await window.webContents.executeJavaScript(
    'document.querySelector(\'[data-testid="project-canvas-stage"]\')?.dataset.currentTimeMs',
  ));
}

async function readStageState(window, stageSelector = '[data-testid="project-canvas-stage"]') {
  return window.webContents.executeJavaScript(
    '(() => { const s=document.querySelector(' + JSON.stringify(stageSelector) + '); if(!s) return null;' +
    'const source=JSON.parse(s.dataset.layerJson||"[]");' +
    'const evaluated=JSON.parse(s.dataset.evaluatedLayerJson||"[]");' +
    'const status=JSON.parse(s.dataset.visualStatusJson||"[]");' +
    'const ready=JSON.parse(s.dataset.targetReadyLayerIds||"[]");' +
    'return {time:Number(s.dataset.currentTimeMs),selected:s.dataset.selectedLayerId,' +
    'layers:source.filter(x=>x.source?.kind==="animation").map(layer=>({' +
    'layer,visual:evaluated.find(x=>x.id===layer.id)||null,' +
    'visualStatus:status.find(pair=>pair[0]===layer.id)?.[1]??null,' +
    'ready:ready.includes(layer.id)}))}; })()',
  );
}

async function readPreviewState(window) {
  return window.webContents.executeJavaScript(
    '(() => { const o=document.querySelector(\'[data-testid="product-preview-overlay"]\'); if(!o) return null;' +
    'const s=o.querySelector(\'[data-testid="project-canvas-stage"]\');' +
    'const state=s?JSON.parse(s.dataset.layerJson||"[]"):[];' +
    'const evaluated=s?JSON.parse(s.dataset.evaluatedLayerJson||"[]"):[];' +
    'const status=s?JSON.parse(s.dataset.visualStatusJson||"[]"):[];' +
    'const ready=s?JSON.parse(s.dataset.targetReadyLayerIds||"[]"):[];' +
    'return {time:Number(o.dataset.previewTime),projectTime:Number(o.dataset.previewProjectTime),' +
    'playing:o.dataset.previewPlaying==="true",surface:o.dataset.previewSurface,' +
    'layers:state.filter(x=>x.source?.kind==="animation").map(layer=>({' +
    'layer,visual:evaluated.find(x=>x.id===layer.id)||null,' +
    'visualStatus:status.find(pair=>pair[0]===layer.id)?.[1]??null,' +
    'ready:ready.includes(layer.id)}))}; })()',
  );
}

async function historyState(window) {
  return window.webContents.executeJavaScript(
    '(() => { const e=document.querySelector(\'[data-testid="history-controls"]\');' +
    'return e?{undoCount:Number(e.dataset.undoCount),redoCount:Number(e.dataset.redoCount)}:null; })()',
  );
}

async function canvasPixel(window, stageSelector, x, y) {
  return window.webContents.executeJavaScript(
    '(() => { const s=document.querySelector(' + JSON.stringify(stageSelector) + ');' +
    'const c=s?.querySelector("canvas"); if(!c) throw new Error("Canvas missing for pixel read.");' +
    'const g=c.getContext("2d"),px=Math.round(' + x + '*c.width/1920),py=Math.round(' + y + '*c.height/1080);' +
    'return [...g.getImageData(px,py,1,1).data]; })()',
  );
}

function animationRecord(state, id) {
  const record = state?.layers.find((candidate) => candidate.layer.id === id);
  assert(record, 'Animation layer not present in rendered state: ' + id);
  return record;
}

function nearColor(actual, expected) {
  return actual.length === 4 && expected.every((value, index) =>
    Math.abs(actual[index] - value) <= 2) && actual[3] >= 250;
}

async function run() {
  mkdirSync(evidence, { recursive: true });
  mkdirSync(path.dirname(projectRoot), { recursive: true });
  const projectService = new ProjectService();
  const createdDocument = await projectService.create(projectRoot, {
    name: 'Issue 890 AM-04 Electron Evidence',
  });
  fixture = makeFixture(createdDocument.project.id);
  const initialDocument = await projectService.save(projectRoot, fixture, 0);
  savedProject = initialDocument.project;
  const frameManifest = ids.frames.map((assetId, index) => ({
    assetId,
    sha256: createHash('sha256').update(bytesByAsset.get(assetId)).digest('hex'),
    dimensions: sizes[index],
    offset: offsets[index],
    sourceViewport: {
      x: 100 + offsets[index].x,
      y: 100 + offsets[index].y,
      width: sizes[index].width,
      height: sizes[index].height,
    },
    rgba: [...colors[index], 255],
  }));
  writeFileSync(path.join(evidence, 'frame-manifest.json'), JSON.stringify(frameManifest, null, 2));
  mockIpc(projectService);
  await app.whenReady();
  for (const [key, folder] of [
    ['userData', userData],
    ['sessionData', path.join(userData, 'session-data')],
  ]) {
    mkdirSync(folder, { recursive: true });
    try { app.setPath(key, folder); } catch { /* Electron may lock this path after startup. */ }
  }
  const window = await createMainWindow({ show: true });
  window.setSize(1600, 1050);
  window.show();
  window.focus();
  try {
    await openProject(window);
    await waitFor(window, 'document.querySelector(\'[data-testid="timeline-ruler-track"]\')', 'Timeline ruler missing.');
    await click(window, '[data-testid="resource-activity-rail-assets"]');
    await waitFor(
      window,
      'document.querySelector(\'[data-testid="animation-library-card"][data-animation-id="' + ids.animation + '"]\')',
      'Synthetic 21-frame animation card missing.',
    );
    await window.webContents.executeJavaScript(
      'window.__issue890Dnd=[];' +
      'document.addEventListener("dragstart",e=>{const d=e.dataTransfer;window.__issue890Dnd.push({' +
      'type:"dragstart",trusted:e.isTrusted,payload:d?.getData("application/x-panda-stage-asset")||"",context:d?.getData("application/x-panda-stage-animation-context")||""});},false);' +
      'document.addEventListener("drop",e=>{const d=e.dataTransfer;window.__issue890Dnd.push({' +
      'type:"drop",trusted:e.isTrusted,target:e.target?.closest?.(\'[data-testid="project-canvas-viewport"]\')?"canvas":"other",' +
      'payload:d?.getData("application/x-panda-stage-asset")||"",context:d?.getData("application/x-panda-stage-animation-context")||""});},false);',
    );
    const dragToShot = async (x, y, expectedCount) => {
      const source = await window.webContents.executeJavaScript(
        '(() => { const e=document.querySelector(\'[data-testid="animation-library-card"][data-animation-id="' +
          ids.animation + '"]\'); e.scrollIntoView({block:"center",inline:"center"}); const r=e.getBoundingClientRect();' +
          'return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; })()',
      );
      const target = await canvasPoint(window, x, y);
      await browserDrag(window, source, target);
      await waitFor(
        window,
        'JSON.parse(document.querySelector(\'[data-testid="project-canvas-stage"]\').dataset.layerJson||"[]")' +
          '.filter(x=>x.source?.kind==="animation").length===' + expectedCount,
        'Animation drop did not create instance ' + expectedCount + '.',
      );
      return { source, target };
    };

    const firstDrop = await dragToShot(700, 500, 1);
    let editor = await readStageState(window);
    assert(editor.layers.length === 1, 'First drag did not create one animation instance.');
    const layerAId = editor.layers[0].layer.id;
    assert(editor.layers[0].layer.startTimeMs === 0, 'First animation did not start at the 0ms playhead.');
    await waitFor(
      window,
      'document.querySelector(\'[data-testid="project-canvas-stage"]\')?.dataset.selectedLayerId==="' + layerAId + '"',
      'First animation instance was not selected after drop.',
    );
    await click(window, '[data-testid="right-activity-rail-properties"]');
    await waitFor(
      window,
      'document.querySelector(\'[data-testid="animation-playback-controls"]\')',
      'Animation playback controls did not appear in the Inspector.',
    );
    await setControlValue(window, '[data-testid="animation-playback-mode"]', 'loop');
    await waitFor(
      window,
      'JSON.parse(document.querySelector(\'[data-testid="project-canvas-stage"]\').dataset.layerJson||"[]")' +
        '.find(x=>x.id==="' + layerAId + '")?.animationPlayback?.mode==="loop"',
      'Inspector did not persist loop mode for instance A.',
    );
    await setControlValue(window, '[data-testid="animation-start-seconds"]', '0.04', true);
    await waitFor(
      window,
      'JSON.parse(document.querySelector(\'[data-testid="project-canvas-stage"]\').dataset.layerJson||"[]")' +
        '.find(x=>x.id==="' + layerAId + '")?.startTimeMs===40',
      'Inspector did not update instance A start time.',
    );
    await setControlValue(window, '[data-testid="animation-start-seconds"]', '0', true);
    await waitFor(
      window,
      'JSON.parse(document.querySelector(\'[data-testid="project-canvas-stage"]\').dataset.layerJson||"[]")' +
        '.find(x=>x.id==="' + layerAId + '")?.startTimeMs===0',
      'Inspector did not restore instance A start time.',
    );
    let a = animationRecord(await readStageState(window), layerAId).layer;
    const aStart = await canvasPoint(window, a.x, a.y);
    const aEnd = await canvasPoint(window, a.x + 20, a.y + 20);
    await browserDrag(window, aStart, aEnd, 6);
    await click(window, '[data-testid="layer-transform-scale"] .layer-transform-stepper button:last-of-type');
    editor = await readStageState(window);
    a = animationRecord(editor, layerAId).layer;
    assert(Math.abs(a.x - 720) < 3 && Math.abs(a.y - 520) < 3 && Math.abs(a.scaleX - 1.1) < 0.002,
      'Canvas/Inspector edits did not independently move and scale instance A: ' + JSON.stringify(a));

    const firstSeek = await seekEditor(window, 1_000);
    const secondDrop = await dragToShot(1_100, 500, 2);
    editor = await readStageState(window);
    const layerB = editor.layers.find((record) => record.layer.id !== layerAId);
    assert(layerB, 'Second drag did not create a second independent layer.');
    const layerBId = layerB.layer.id;
    assert(layerBId !== layerAId && layerB.layer.source.animationId === ids.animation,
      'The two animation instances do not have distinct layer IDs and the same source.');
    assert(layerB.layer.startTimeMs === 1_000, 'Second drag did not capture the 1000ms Shot playhead.');
    assert(editor.layers.find((record) => record.layer.id === layerAId)?.layer.startTimeMs === 0,
      'Creating instance B changed instance A start time.');
    await waitFor(
      window,
      'document.querySelector(\'[data-testid="layer-transform-panel"]\')?.dataset.selectedLayerId==="' + layerBId + '"',
      'Second animation was not selected in the Inspector.',
    );
    await setControlValue(window, '[data-testid="animation-start-seconds"]', '1.25', true);
    await waitFor(
      window,
      'JSON.parse(document.querySelector(\'[data-testid="project-canvas-stage"]\').dataset.layerJson||"[]")' +
        '.find(x=>x.id==="' + layerBId + '")?.startTimeMs===1250',
      'Inspector did not change instance B start time.',
    );
    await setControlValue(window, '[data-testid="animation-start-seconds"]', '1', true);
    await waitFor(
      window,
      'JSON.parse(document.querySelector(\'[data-testid="project-canvas-stage"]\').dataset.layerJson||"[]")' +
        '.find(x=>x.id==="' + layerBId + '")?.startTimeMs===1000',
      'Inspector did not set instance B start time to 1000ms.',
    );
    const historyBeforeEscape = await historyState(window);
    const saveStateBeforeEscape = await window.webContents.executeJavaScript(
      '(() => { const e=document.querySelector(\'[data-testid="quick-action-save"]\');' +
      'return e?{disabled:e.disabled,state:e.dataset.saveState??null}:null; })()',
    );
    assert(historyBeforeEscape && saveStateBeforeEscape,
      'Could not capture Project/History state before testing Escape cancellation.');
    await click(window, '[data-testid="animation-start-seconds"]');
    await setControlValue(window, '[data-testid="animation-start-seconds"]', '5', false);
    await waitFor(
      window,
      'document.querySelector(\'[data-testid="animation-start-seconds"]\')?.value==="5"&&' +
        'JSON.parse(document.querySelector(\'[data-testid="project-canvas-stage"]\').dataset.layerJson||"[]")' +
          '.find(x=>x.id==="' + layerBId + '")?.startTimeMs===1000',
      'Editing the start-time draft changed Project data before confirmation.',
    );
    await window.webContents.executeJavaScript(
      'window.__issue891EscapeTrusted=false;' +
      'document.addEventListener("keydown",e=>{if(e.key==="Escape")window.__issue891EscapeTrusted=e.isTrusted;},' +
      '{capture:true,once:true});',
    );
    await pressKey(window, 'Escape');
    await waitFor(
      window,
      'document.querySelector(\'[data-testid="animation-start-seconds"]\')?.value==="1"&&' +
        'JSON.parse(document.querySelector(\'[data-testid="project-canvas-stage"]\').dataset.layerJson||"[]")' +
          '.find(x=>x.id==="' + layerBId + '")?.startTimeMs===1000',
      'Escape did not restore the saved start time before blur.',
    );
    const historyAfterEscape = await historyState(window);
    const saveStateAfterEscape = await window.webContents.executeJavaScript(
      '(() => { const e=document.querySelector(\'[data-testid="quick-action-save"]\');' +
      'return e?{disabled:e.disabled,state:e.dataset.saveState??null}:null; })()',
    );
    const escapeWasTrusted = await window.webContents.executeJavaScript(
      'window.__issue891EscapeTrusted===true',
    );
    assert(escapeWasTrusted &&
      JSON.stringify(historyAfterEscape) === JSON.stringify(historyBeforeEscape) &&
      JSON.stringify(saveStateAfterEscape) === JSON.stringify(saveStateBeforeEscape),
    'Trusted Escape changed History or the Project save state.');
    const escapeCancelEvidence = {
      trustedKeyEvent: escapeWasTrusted,
      attemptedStartSeconds: 5,
      savedStartTimeMs: 1_000,
      historyBefore: historyBeforeEscape,
      historyAfter: historyAfterEscape,
      saveStateBefore: saveStateBeforeEscape,
      saveStateAfter: saveStateAfterEscape,
    };
    await setControlValue(window, '[data-testid="animation-end-behavior"]', 'hide');
    await waitFor(
      window,
      'JSON.parse(document.querySelector(\'[data-testid="project-canvas-stage"]\').dataset.layerJson||"[]")' +
        '.find(x=>x.id==="' + layerBId + '")?.animationPlayback?.endBehavior==="hide"',
      'Inspector did not set once+hide for instance B.',
    );
    editor = await readStageState(window);
    let b = animationRecord(editor, layerBId).layer;
    const bStart = await canvasPoint(window, b.x, b.y);
    const bEnd = await canvasPoint(window, b.x + 40, b.y + 40);
    await browserDrag(window, bStart, bEnd, 6);
    await click(window, '[data-testid="layer-transform-scale"] .layer-transform-stepper button:last-of-type');
    editor = await readStageState(window);
    b = animationRecord(editor, layerBId).layer;
    a = animationRecord(editor, layerAId).layer;
    assert(Math.abs(b.x - 1_140) < 3 && Math.abs(b.y - 540) < 3 && Math.abs(b.scaleX - 1.1) < 0.002,
      'Canvas/Inspector edits did not independently move and scale instance B: ' + JSON.stringify(b));
    assert(Math.abs(a.x - 720) < 3 && Math.abs(a.y - 520) < 3 && Math.abs(a.scaleX - 1.1) < 0.002,
      'Editing instance B changed instance A transform: ' + JSON.stringify(a));

    const beforeBStartTime = await seekEditor(window, 960);
    editor = await readStageState(window);
    assert(!animationRecord(editor, layerBId).visual?.visible,
      'Instance B appeared before its 1000ms start.');
    await clickPoint(window, await canvasPoint(window, 1_800, 900));
    await clickPoint(window, await canvasPoint(window, b.x, b.y));
    editor = await readStageState(window);
    assert(editor.selected !== layerBId,
      'Instance B could be selected while hidden before its start.');
    await seekEditor(window, 1_000);
    await clickPoint(window, await canvasPoint(window, b.x, b.y));
    await waitFor(
      window,
      'document.querySelector(\'[data-testid="layer-transform-panel"]\')?.dataset.selectedLayerId==="' + layerBId + '"',
      'Instance B did not become selectable at its start.',
    );
    editor = await readStageState(window);
    b = animationRecord(editor, layerBId).layer;
    a = animationRecord(editor, layerAId).layer;
    assert(a.startTimeMs === 0 && b.startTimeMs === 1_000,
      'Editing one instance start time changed the other instance.');

    await clickPoint(window, await canvasPoint(window, a.x, a.y));
    await waitFor(
      window,
      'document.querySelector(\'[data-testid="layer-transform-panel"]\')?.dataset.selectedLayerId==="' + layerAId + '"',
      'Could not select instance A for duplicate/delete coverage.',
    );
    const duplicateStateBefore = await window.webContents.executeJavaScript(`(() => {
      const stage = document.querySelector('[data-testid="project-canvas-stage"]');
      const layers = JSON.parse(stage?.dataset.layerJson || '[]');
      const selectedLayerId = document.querySelector('[data-testid="layer-transform-panel"]')?.dataset.selectedLayerId;
      const controls = Array.from(document.querySelectorAll('[data-testid="duplicate-animation-layer"]')).map((button, index) => {
        if (index === 0) button.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return { index, disabled: button.disabled, display: style.display, visibility: style.visibility,
          pointerEvents: style.pointerEvents, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          centerHitsButton: hit === button || button.contains(hit),
          centerHit: hit ? { tag: hit.tagName, id: hit.id, className: String(hit.className),
            testId: hit.dataset?.testid, text: hit.textContent?.trim().slice(0, 80) } : null };
      });
      return { selectedLayerId, viewport: { width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight },
        animationLayerIds: layers.filter((layer) => layer.source?.kind === 'animation').map((layer) => layer.id), controls };
    })()`);
    console.log('[issue890] duplicate state before click: ' + JSON.stringify(duplicateStateBefore));
    writeFileSync(path.join(evidence, 'duplicate-control-debug.png'),
      (await window.webContents.capturePage()).toPNG());
    await click(window, '[data-testid="duplicate-animation-layer"]');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const duplicateStateAfter = await window.webContents.executeJavaScript(`(() => {
      const stage = document.querySelector('[data-testid="project-canvas-stage"]');
      const layers = JSON.parse(stage?.dataset.layerJson || '[]');
      return { selectedLayerId: document.querySelector('[data-testid="layer-transform-panel"]')?.dataset.selectedLayerId,
        animationLayerIds: layers.filter((layer) => layer.source?.kind === 'animation').map((layer) => layer.id),
        alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((element) => element.textContent) };
    })()`);
    console.log('[issue890] duplicate state after click: ' + JSON.stringify(duplicateStateAfter));
    await waitFor(
      window,
      'JSON.parse(document.querySelector(\'[data-testid="project-canvas-stage"]\').dataset.layerJson||"[]")' +
        '.filter(x=>x.source?.kind==="animation").length===3',
      'Duplicate animation action did not create an independent instance.',
    );
    editor = await readStageState(window);
    const duplicate = editor.layers.find((record) =>
      record.layer.id !== layerAId && record.layer.id !== layerBId);
    assert(duplicate && duplicate.layer.source.animationId === ids.animation,
      'Duplicate did not keep the shared animation definition.');
    const duplicateId = duplicate.layer.id;
    assert(duplicate.layer.id !== layerAId && duplicate.layer.id !== layerBId,
      'Duplicate layer ID was not unique.');
    await click(window, '.layer-delete-button');
    await waitFor(
      window,
      'JSON.parse(document.querySelector(\'[data-testid="project-canvas-stage"]\').dataset.layerJson||"[]")' +
        '.filter(x=>x.source?.kind==="animation").length===2',
      'Deleting the duplicate removed the wrong animation instance.',
    );
    await click(window, '[data-testid="quick-action-drawer-handle"]');
    await waitFor(
      window,
      'document.querySelector(\'[data-testid="quick-action-drawer"]\')?.dataset.expanded==="true"&&document.querySelector(\'[data-testid="history-controls"]\')',
      'History controls did not open.',
    );
    const historyBeforeUndo = await historyState(window);
    assert(historyBeforeUndo && historyBeforeUndo.undoCount > 0,
      'Animation operations did not enter History.');
    await click(window, '[data-testid="history-controls"] button:first-of-type');
    await waitFor(
      window,
      'JSON.parse(document.querySelector(\'[data-testid="project-canvas-stage"]\').dataset.layerJson||"[]")' +
        '.filter(x=>x.source?.kind==="animation").length===3',
      'Undo did not restore the deleted duplicate.',
    );
    await click(window, '[data-testid="history-controls"] button:last-of-type');
    await waitFor(
      window,
      'JSON.parse(document.querySelector(\'[data-testid="project-canvas-stage"]\').dataset.layerJson||"[]")' +
        '.filter(x=>x.source?.kind==="animation").length===2',
      'Redo did not delete only the duplicate again.',
    );
    editor = await readStageState(window);
    assert(editor.layers.some((record) => record.layer.id === layerAId) &&
      editor.layers.some((record) => record.layer.id === layerBId) &&
      !editor.layers.some((record) => record.layer.id === duplicateId),
    'Duplicate/delete/undo/redo changed either original animation instance.');
    assert(fixture.animations.length === 1 && fixture.animations[0].frames.length === 21 &&
      fixture.assets.length > 21,
    'Synthetic fixture unexpectedly duplicated animation definitions or frame assets.');

    const saveCountBefore = projectSaveEvidence.length;
    await click(window, '[data-testid="quick-action-save"]');
    await waitFor(
      window,
      'document.querySelector(\'[data-testid="quick-action-save"]\')?.dataset.saveState!=="saving"&&' +
        'document.querySelector(\'[data-testid="quick-action-save"]\')?.disabled===true',
      'Quick Save did not settle with the project clean.',
    );
    assert(projectSaveEvidence.length === saveCountBefore + 1,
      'Quick Save did not call Main ProjectService.save.');
    const savedDocument = JSON.parse(readFileSync(path.join(projectRoot, 'project.json'), 'utf8'));
    const savedLayers = savedDocument.shots.flatMap((shot) => shot.layers)
      .filter((layer) => layer.source.kind === 'animation');
    assert(savedDocument.schemaVersion === 16 && savedDocument.animations.length === 1 &&
      savedDocument.animations[0].frames.length === 21 && savedLayers.length === 2 &&
      savedDocument.assets.length === fixture.assets.length,
    'Saved file duplicated source assets or did not persist two instances: ' + JSON.stringify({
      schemaVersion: savedDocument.schemaVersion,
      animationCount: savedDocument.animations.length,
      frameCount: savedDocument.animations[0]?.frames.length,
      layerCount: savedLayers.length,
    }));
    const savedA = savedLayers.find((layer) => layer.id === layerAId);
    const savedB = savedLayers.find((layer) => layer.id === layerBId);
    assert(savedA?.startTimeMs === 0 && savedA.animationPlayback?.mode === 'loop' &&
      savedB?.startTimeMs === 1_000 && savedB.animationPlayback?.mode === 'once' &&
      savedB.animationPlayback?.endBehavior === 'hide',
    'Save did not preserve the independent start/mode/end settings.');
    const savedAssetIds = savedDocument.assets.map((asset) => asset.id);
    assert(ids.frames.every((assetId) => savedAssetIds.includes(assetId)),
      'Save lost one or more shared frame assets.');
    const historyBeforePreview = await historyState(window);

    await click(window, '[data-testid="quick-action-play"]');
    await waitFor(
      window,
      'document.querySelector(\'[data-testid="product-preview-overlay"]\')?.dataset.previewSurface==="active"&&' +
        'document.querySelector(\'[data-testid="product-preview-overlay"]\')?.dataset.previewDataReady==="true"',
      'Product Preview did not become active and ready.',
      30_000,
    );
    await setControlValue(window, '[data-testid="product-preview-scrubber"]', 0);
    await waitFor(
      window,
      'Number(document.querySelector(\'[data-testid="product-preview-overlay"]\')?.dataset.previewProjectTime)===0',
      'Product Preview did not seek to its start.',
    );
    await click(window, '[data-testid="product-preview-play-pause"]');
    await waitFor(
      window,
      'Number(document.querySelector(\'[data-testid="product-preview-overlay"]\')?.dataset.previewProjectTime)>=2200',
      'Product Preview did not advance continuously past two 840ms animation periods.',
      12_000,
    );
    const continuous = await readPreviewState(window);
    assert(continuous.playing, 'Product Preview stopped before the pause action.');
    const continuousA = animationRecord(continuous, layerAId);
    const continuousB = animationRecord(continuous, layerBId);
    const continuousFrameIndex = Math.floor(continuous.time * 25 / 1_000) % 21;
    assert(continuousA.visual?.assetId === ids.frames[continuousFrameIndex] &&
      continuousA.visual.visible === true,
    'Looping instance A did not advance to the deterministic preview frame: ' + JSON.stringify(continuousA));
    assert(continuousB.visual?.visible === false,
      'Once+hide instance B remained visible after its 840ms cycle.');
    await click(window, '[data-testid="product-preview-play-pause"]');
    await waitFor(
      window,
      'document.querySelector(\'[data-testid="product-preview-overlay"]\')?.dataset.previewPlaying==="false"',
      'Product Preview did not pause.',
    );
    const paused = await readPreviewState(window);
    await new Promise((resolve) => setTimeout(resolve, 160));
    const pausedAgain = await readPreviewState(window);
    assert(pausedAgain.time === paused.time && pausedAgain.playing === false,
      'Product Preview time advanced after pause.');
    await click(window, '[data-testid="product-preview-replay"]');
    await waitFor(
      window,
      'document.querySelector(\'[data-testid="product-preview-overlay"]\')?.dataset.previewPlaying==="true"',
      'Product Preview replay did not start playback.',
    );
    await waitFor(
      window,
      'Number(document.querySelector(\'[data-testid="product-preview-overlay"]\')?.dataset.previewProjectTime)>100',
      'Product Preview replay did not advance from the beginning.',
    );
    await click(window, '[data-testid="product-preview-play-pause"]');
    await waitFor(
      window,
      'document.querySelector(\'[data-testid="product-preview-overlay"]\')?.dataset.previewPlaying==="false"',
      'Product Preview did not pause after replay.',
    );
    await setControlValue(window, '[data-testid="product-preview-scrubber"]', 1_040);
    await waitFor(
      window,
      'Number(document.querySelector(\'[data-testid="product-preview-overlay"]\')?.dataset.previewProjectTime)===1040',
      'Reverse seek did not return to 1040ms.',
    );
    await waitFor(
      window,
      '(() => { const s=document.querySelector(\'[data-testid="product-preview-overlay"] [data-testid="project-canvas-stage"]\');' +
        'const r=JSON.parse(s?.dataset.targetReadyLayerIds||"[]");return r.includes("' + layerAId + '")&&r.includes("' + layerBId + '"); })()',
      'Both animation frames did not become ready after reverse seek.',
      20_000,
    );
    const reverse = await readPreviewState(window);
    const reverseA = animationRecord(reverse, layerAId);
    const reverseB = animationRecord(reverse, layerBId);
    assert(reverseA.visual?.assetId === ids.frames[5] && reverseA.visual.visible === true &&
      reverseB.visual?.assetId === ids.frames[1] && reverseB.visual.visible === true,
    'Reverse seek did not independently restore expected frames for A and B: ' + JSON.stringify({
      time: reverse.time,
      a: reverseA,
      b: reverseB,
    }));
    assert(reverseA.layer.x === savedA.x && reverseA.layer.y === savedA.y &&
      reverseB.layer.x === savedB.x && reverseB.layer.y === savedB.y &&
      reverseA.layer.scaleX === savedA.scaleX && reverseB.layer.scaleX === savedB.scaleX,
    'Preview playback changed the independent instance transforms.');
    const pixelA = await canvasPixel(
      window,
      '[data-testid="product-preview-overlay"] [data-testid="project-canvas-stage"]',
      reverseA.layer.x,
      reverseA.layer.y,
    );
    const pixelB = await canvasPixel(
      window,
      '[data-testid="product-preview-overlay"] [data-testid="project-canvas-stage"]',
      reverseB.layer.x,
      reverseB.layer.y,
    );
    assert(nearColor(pixelA, [...colors[5], 255]) && nearColor(pixelB, [...colors[1], 255]),
      'Preview pixels did not match independently evaluated source frames: ' + JSON.stringify({ pixelA, pixelB }));

    const historyAfterPreview = await historyState(window);
    assert(JSON.stringify(historyAfterPreview) === JSON.stringify(historyBeforePreview),
      'Preview play, pause, replay, or seek created a History entry.');
    await click(window, '[data-testid="product-preview-close"]');
    await waitFor(
      window,
      '!document.querySelector(\'[data-testid="product-preview-overlay"]\')',
      'Product Preview did not close.',
    );
    const isCleanAfterPreview = await window.webContents.executeJavaScript(
      'document.querySelector(\'[data-testid="quick-action-save"]\')?.disabled===true',
    );
    assert(isCleanAfterPreview, 'Preview play/seek changed the saved Project dirty state.');

    const openCountBeforeClose = projectOpenEvidence.length;
    await click(window, '[data-testid="quick-action-close"]');
    await waitFor(
      window,
      'document.querySelector(\'.editor-shell\')?.dataset.editorPage==="project-center"',
      'Saved project did not close to Project Center.',
    );
    await openProject(window);
    assert(projectOpenEvidence.length > openCountBeforeClose,
      'Reopen did not call Main ProjectService.open.');
    const reopenState = await readStageState(window);
    assert(reopenState.layers.length === 2, 'Reopened project did not restore exactly two instances.');
    const reopenedA = animationRecord(reopenState, layerAId);
    const reopenedB = animationRecord(reopenState, layerBId);
    assert(reopenedA.layer.animationPlayback?.mode === 'loop' && reopenedA.layer.startTimeMs === 0 &&
      reopenedB.layer.animationPlayback?.mode === 'once' &&
      reopenedB.layer.animationPlayback?.endBehavior === 'hide' &&
      reopenedB.layer.startTimeMs === 1_000,
    'Reopen did not restore each instance playback contract.');
    const hiddenAt2000 = await seekEditor(window, 2_000);
    editor = await readStageState(window);
    assert(!animationRecord(editor, layerBId).visual?.visible &&
      animationRecord(editor, layerAId).visual?.assetId === ids.frames[8],
    'Reopened editor did not evaluate loop/hide instances at 2000ms.');
    const reverseEditorTime = await seekEditor(window, 1_040);
    editor = await readStageState(window);
    assert(animationRecord(editor, layerAId).visual?.assetId === ids.frames[5] &&
      animationRecord(editor, layerBId).visual?.assetId === ids.frames[1] &&
      animationRecord(editor, layerBId).visual?.visible === true,
    'Reopened editor reverse seek did not restore the expected frames.');
    const reopenedDocument = await projectService.open(projectRoot);
    const reopenedLayers = reopenedDocument.project.shots.flatMap((shot) => shot.layers)
      .filter((layer) => layer.source.kind === 'animation');
    assert(reopenedDocument.sourceVersion === 16 && reopenedLayers.length === 2 &&
      reopenedLayers.find((layer) => layer.id === layerAId)?.animationPlayback?.mode === 'loop' &&
      reopenedLayers.find((layer) => layer.id === layerBId)?.animationPlayback?.endBehavior === 'hide',
    'Main ProjectService.open did not return the two saved animation instance settings.');
    assert(ids.frames.every((assetId) => canvasImageReadEvidence.some((entry) =>
      entry.assetId === assetId && entry.status === 'ready')),
    'Not every synthetic animation frame passed through Main AssetCanvasImageService.');
    const dnd = await window.webContents.executeJavaScript('window.__issue890Dnd');
    const starts = dnd.filter((entry) => entry.type === 'dragstart');
    const drops = dnd.filter((entry) => entry.type === 'drop');
    assert(starts.length === 2 && drops.length === 2 &&
      starts.every((entry) => entry.trusted && JSON.parse(entry.payload).animationId === ids.animation) &&
      drops.every((entry) => entry.trusted && entry.target === 'canvas' &&
        JSON.parse(entry.payload).animationId === ids.animation),
    'The two Animation Library drops did not use trusted input into the Canvas: ' + JSON.stringify(dnd));

    const interactive = {
      issue: 890,
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      branch: execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(),
      workingTreeStatus: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim(),
      projectRoot,
      projectSchemaVersion: savedDocument.schemaVersion,
      oneAnimationDefinition: savedDocument.animations.length === 1,
      frameCount: savedDocument.animations[0].frames.length,
      frameAssetCount: ids.frames.length,
      layerIds: { a: layerAId, b: layerBId, copiedAndDeleted: duplicateId },
      drops: { first: firstDrop, second: secondDrop, trustedEvents: dnd },
      escapeCancel: escapeCancelEvidence,
      firstDropStartTimeMs: 0,
      secondDropStartTimeMs: firstSeek,
      startTimes: { a: savedA.startTimeMs, b: savedB.startTimeMs },
      playback: {
        a: savedA.animationPlayback,
        b: savedB.animationPlayback,
        continuousPreview: {
          timeMs: continuous.time,
          a: { assetId: continuousA.visual.assetId, visible: continuousA.visual.visible },
          b: { assetId: continuousB.visual.assetId, visible: continuousB.visual.visible },
        },
        pausedTimeMs: paused.time,
        replayAdvanced: true,
        reverseSeek: {
          timeMs: reverse.time,
          a: reverseA.visual.assetId,
          b: reverseB.visual.assetId,
          pixelA,
          pixelB,
        },
      },
      beforeStart: {
        requestedTimeMs: 960,
        actualTimeMs: beforeBStartTime,
        visible: false,
        selectable: false,
      },
      transforms: { a: savedA, b: savedB },
      history: { beforeUndo: historyBeforeUndo, beforePreview: historyBeforePreview, afterPreview: historyAfterPreview },
      dirtyAfterPreview: !isCleanAfterPreview,
      saveReopen: {
        saveCalls: projectSaveEvidence,
        openCalls: projectOpenEvidence,
        sourceVersion: reopenedDocument.sourceVersion,
        frameManifestCount: frameManifest.length,
        hiddenAt2000,
        reverseEditorTime,
      },
      canvasImageReadEvidence,
      evidence,
    };
    writeFileSync(path.join(evidence, 'interactive-state.json'), JSON.stringify(interactive, null, 2));
    writeFileSync(path.join(evidence, 'canvas-evidence.png'), (await window.webContents.capturePage()).toPNG());
    return {
      issue: 890,
      passed: true,
      commit: interactive.commit,
      branch: interactive.branch,
      projectRoot,
      animationInstances: savedLayers.map((layer) => ({
        id: layer.id,
        startTimeMs: layer.startTimeMs,
        animationPlayback: layer.animationPlayback,
        x: layer.x,
        y: layer.y,
        scaleX: layer.scaleX,
        scaleY: layer.scaleY,
      })),
      continuousPreviewTimeMs: continuous.time,
      reverseSeekTimeMs: reverse.time,
      saveCalls: projectSaveEvidence.length,
      openCalls: projectOpenEvidence.length,
      imageReads: canvasImageReadEvidence.length,
      evidence,
    };
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

async function main() {
  try {
    const result = await run();
    writeFileSync(resultPath, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const failure = {
      issue: 890,
      passed: false,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
      evidence,
      projectRoot,
    };
    mkdirSync(evidence, { recursive: true });
    writeFileSync(resultPath, JSON.stringify(failure, null, 2));
    console.error('[issue890] ' + failure.error);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
}

main();

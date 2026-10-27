const { app, ipcMain } = require('electron');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { deflateSync } = require('node:zlib');
const { createMainWindow } = require('../dist-electron/main/windows/main-window.js');
const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');
const { detectSchemaVersion, migrateProject } = require('../dist-electron/domain/migrations/index.js');

const root = 'D:\\PandaStage-Acceptance\\issue871-am03-fix';
const evidence = path.join(root, 'am03-electron');
const userData = path.join(root, 'electron-user-data');
const projectRoot = path.join(root, 'projects', 'issue871-electron.pandastage');
const resultPath = path.join(evidence, 'results.json');
const example = require('../demo-project/project-v1.example.json');
const fallbackPng = readFileSync(path.join(__dirname, '..', 'public/probe/panda-character.png'));
const ids = {
  project: '87100000-0000-4000-8000-000000000001',
  animation: '87100000-0000-4000-8000-000000000002',
  frames: [
    '87100000-0000-4000-8000-000000000011',
    '87100000-0000-4000-8000-000000000012',
    '87100000-0000-4000-8000-000000000013',
  ],
};
const colors = [[230, 45, 60], [35, 180, 95], [40, 110, 230]];
const sizes = [{ width: 200, height: 200 }, { width: 160, height: 180 }, { width: 180, height: 160 }];
const offsets = sizes.map((size) => ({ x: (400 - size.width) / 2, y: (400 - size.height) / 2 }));
const bytesByAsset = new Map();
const registeredChannels = [];
let fixture;
let savedProject = null;
let blockedAssetId = null;
let releaseBlockedAssetRead = null;

app.on('window-all-closed', () => {});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
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

function makeFixture() {
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
      sourceViewport: { x: 100 + offsets[index].x, y: 100 + offsets[index].y, width: size.width, height: size.height },
      offset: offsets[index],
      startMs: index * 40,
      durationMs: 40,
      createdBySequenceImport: true,
    };
  });
  const animation = {
    id: ids.animation,
    name: 'Issue 871 synthetic animation',
    source: {
      basename: 'issue871-synthetic.fla',
      sha256: 'b'.repeat(64),
      renderTargetId: 'issue871-target',
      targetKind: 'graphic-symbol',
      targetName: 'Issue 871 synthetic animation',
      startFrameIndex: 0,
      endFrameIndex: 2,
      sourceFps: 25,
      canvas: { width: 400, height: 400 },
      documentCanvas: { width: 400, height: 400 },
      anchor: { x: 100, y: 100 },
    },
    durationMs: 120,
    frames,
  };
  const base = migrateProject({
    ...example,
    id: ids.project,
    name: 'Issue 871 AM-03 Electron Evidence',
  });
  return migrateProject({
    ...base,
    assets: [
      ...base.assets.map((asset) => asset.kind === 'image' ? { ...asset, sha256: 'a'.repeat(64) } : asset),
      ...frames.map((frame, index) => ({
        id: frame.assetId,
        kind: 'image',
        name: 'Issue 871 frame ' + index,
        relativePath: 'assets/issue871-frame-' + index + '.png',
        mimeType: 'image/png',
        width: frame.sourceViewport.width,
        height: frame.sourceViewport.height,
        sha256: frame.sha256,
        usage: 'uncategorized',
        keywords: ['issue871', 'synthetic'],
      })),
    ],
    animations: [animation],
    shots: base.shots.map((shot) => ({
      ...shot,
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
  registeredChannels.push(channel);
}

function documentFor(candidate) {
  const current = migrateProject(candidate);
  return {
    projectRoot,
    projectFilePath: path.join(projectRoot, 'project.json'),
    project: current,
    migrated: false,
    sourceVersion: detectSchemaVersion(current),
  };
}

function mockIpc() {
  register(IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY, () => ({ ok: true, status: 'cancelled' }));
  register(IPC_CHANNELS.PROJECT_OPEN, (_event, request) => request.projectRoot === projectRoot
    ? { ok: true, value: documentFor(savedProject ?? fixture) }
    : { ok: false, error: { code: 'PROJECT_NOT_FOUND', message: 'Synthetic fixture missing.', projectRoot: request.projectRoot } });
  register(IPC_CHANNELS.PROJECT_SAVE, (_event, request) => {
    savedProject = request.project;
    return { ok: true, value: documentFor(savedProject) };
  });
  register(IPC_CHANNELS.PROJECT_CONFIRM_SWITCH, () => ({ outcome: 'saved' }));
  register(IPC_CHANNELS.RECENT_PROJECTS_LIST, () => ({ ok: true, entries: [] }));
  register(IPC_CHANNELS.RECENT_PROJECTS_OPEN, (_event, request) => request.projectRoot === projectRoot
    ? { ok: true, document: documentFor(savedProject ?? fixture) }
    : { ok: false, error: { code: 'RECENT_PROJECT_NOT_FOUND', message: 'Synthetic fixture missing.', projectRoot: request.projectRoot } });
  register(IPC_CHANNELS.AUTOSAVE_TRACK, () => ({ ok: true }));
  register(IPC_CHANNELS.AUTOSAVE_UPDATE, () => ({ ok: true }));
  register(IPC_CHANNELS.AUTOSAVE_STOP, () => ({ ok: true }));
  register(IPC_CHANNELS.RECOVERY_DETECT, () => ({ ok: true, candidate: null }));
  register(IPC_CHANNELS.RECOVERY_IGNORE, () => ({ ok: true, retained: true }));
  register(IPC_CHANNELS.ASSET_THUMBNAIL_READ, (_event, request) => {
    const bytes = bytesByAsset.get(request.assetId) ?? fallbackPng;
    return { ok: true, status: 'ready', assetId: request.assetId, dataUrl: 'data:image/png;base64,' + bytes.toString('base64') };
  });
  register(IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ, (_event, request) => {
    const asset = (savedProject ?? fixture).assets.find((item) => item.id === request.assetId);
    if (!asset || asset.kind !== 'image') {
      return { ok: false, error: { code: 'ASSET_CANVAS_IMAGE_ASSET_NOT_FOUND', message: 'Synthetic image not found.', assetId: request.assetId } };
    }
    const bytes = bytesByAsset.get(asset.id) ?? fallbackPng;
    const response = { ok: true, status: 'ready', assetId: asset.id, mimeType: 'image/png', width: asset.width, height: asset.height, byteLength: bytes.length, bytes: new Uint8Array(bytes) };
    if (asset.id === blockedAssetId) {
      blockedAssetId = null;
      return new Promise((resolve) => {
        releaseBlockedAssetRead = () => resolve(response);
      });
    }
    return response;
  });
}

function waitScript(expression, message, timeout = 20000) {
  return '(async () => { const end = Date.now() + ' + timeout + '; while (Date.now() < end) {' +
    'try { if (' + expression + ') return true; } catch {} await new Promise((r) => setTimeout(r, 40)); }' +
    'throw new Error(' + JSON.stringify(message) + '); })()';
}

async function waitFor(window, expression, message, timeout) {
  await window.webContents.executeJavaScript(waitScript(expression, message, timeout));
}

async function click(window, selector) {
  const p = await window.webContents.executeJavaScript(
    '(() => { const e = document.querySelector(' + JSON.stringify(selector) + ');' +
    'if (!(e instanceof HTMLElement)) throw new Error("Missing target: " + ' + JSON.stringify(selector) + ');' +
    'e.scrollIntoView({ block: "center", inline: "center" }); const r=e.getBoundingClientRect();' +
    'return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)}; })()',
  );
  window.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
  window.webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  window.webContents.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function openProject(window) {
  await waitFor(window, 'document.querySelector(\'[data-testid="project-center-screen"] .recovery-open-row input\')',
    'Project Center did not appear.');
  await window.webContents.executeJavaScript(
    '(() => { const i=document.querySelector(\'[data-testid="project-center-screen"] .recovery-open-row input\');' +
    'const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;' +
    'setter.call(i,' + JSON.stringify(projectRoot) + '); i.dispatchEvent(new Event("input",{bubbles:true}));' +
    'document.querySelector(\'[data-testid="project-center-screen"] .recovery-open-row button\')?.click(); })()',
  );
  await waitFor(window, 'document.querySelector(\'.editor-shell\')?.dataset.editorPage === "editor" && document.querySelector(\'[data-testid="project-canvas-stage"]\')',
    'Project did not open in Editor.');
  await waitFor(window, 'document.querySelector(\'[data-testid="project-canvas-stage"]\')?.dataset.backgroundReady === "true"',
    'Project background did not load.');
}

async function point(window, x, y) {
  return window.webContents.executeJavaScript(
    '(() => { const v=document.querySelector(\'[data-testid="project-canvas-viewport"]\'); const r=v.getBoundingClientRect();' +
    'const s=Number(v.dataset.displayScale); return {x:Math.round(r.left+Number(v.dataset.offsetX)+' + x + '*s),' +
    'y:Math.round(r.top+Number(v.dataset.offsetY)+' + y + '*s)}; })()',
  );
}

async function pointerDrag(window, from, to, steps = 6) {
  window.show();
  window.focus();
  window.webContents.focus();
  window.webContents.sendInputEvent({ type: 'mouseMove', x: from.x, y: from.y });
  window.webContents.sendInputEvent({ type: 'mouseDown', x: from.x, y: from.y, button: 'left', clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 80));
  for (let i = 1; i <= steps; i += 1) {
    window.webContents.sendInputEvent({
      type: 'mouseMove',
      x: Math.round(from.x + (to.x - from.x) * i / steps),
      y: Math.round(from.y + (to.y - from.y) * i / steps),
    });
    await new Promise((resolve) => setTimeout(resolve, 35));
  }
  window.webContents.sendInputEvent({ type: 'mouseUp', x: to.x, y: to.y, button: 'left', clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 250));
}

async function seek(window, timeMs) {
  const p = await window.webContents.executeJavaScript(
    '(() => { const t=document.querySelector(\'[data-testid="timeline-ruler-track"]\');' +
    'const c=document.querySelector(\'[data-testid="timeline-timecode"]\');' +
    'const ruler=document.querySelector(\'[data-testid="timeline-ruler"]\');' +
    'const r=t.getBoundingClientRect(); const rr=ruler.getBoundingClientRect();' +
    'const x=Math.round(r.left+(r.width-Number(document.querySelector(\'[data-testid="timeline-dock"]\').dataset.laneLabelWidth||0))*' + timeMs + '/Number(c.dataset.duration));' +
    'const y=Math.round(rr.top+rr.height/2); const hit=document.elementFromPoint(x,y);' +
    'return {x,y,duration:c.dataset.duration,rect:{left:r.left,width:r.width,height:r.height},ruler:{top:rr.top,height:rr.height},hit:String(hit?.className||hit?.tagName)}; })()',
  );
  window.show();
  window.focus();
  window.webContents.focus();
  window.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
  window.webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  window.webContents.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const actual = await window.webContents.executeJavaScript(
    'document.querySelector(\'[data-testid="project-canvas-stage"]\')?.dataset.currentTimeMs',
  );
  if (Math.abs(Number(actual) - timeMs) > 22) {
    throw new Error('Timeline seek mismatch: requested=' + timeMs + ', actual=' + actual + ', point=' + JSON.stringify(p));
  }
}
async function state(window) {
  return window.webContents.executeJavaScript(
    '(() => { const s=document.querySelector(\'[data-testid="project-canvas-stage"]\');' +
    'const p=document.querySelector(\'[data-testid="layer-transform-panel"]\');' +
    'const a=JSON.parse(s.dataset.layerJson||"[]").find(x=>x.source?.kind==="animation");' +
    'const e=JSON.parse(s.dataset.evaluatedLayerJson||"[]").find(x=>x.id===a?.id);' +
    'const visualStatus=JSON.parse(s.dataset.visualStatusJson||"[]").find(pair=>pair[0]===a?.id)?.[1]??null;' +
    'return {time:Number(s.dataset.currentTimeMs),selected:s.dataset.selectedLayerId,layer:a,visual:e,visualStatus,' +
    'ready:JSON.parse(s.dataset.targetReadyLayerIds||"[]"),controls:p?{' +
    'selected:p.dataset.selectedLayerId,temporal:p.dataset.temporalInspection,' +
    'xDisabled:p.querySelector(\'[data-testid="layer-transform-x"]\').disabled,' +
    'scaleDisabled:p.querySelector(\'[data-testid="layer-transform-scale"] button:last-of-type\').disabled}:null}; })()',
  );
}

async function pixel(window, x, y) {
  return window.webContents.executeJavaScript(
    '(() => { const c=document.querySelector(\'[data-testid="project-canvas-stage"] canvas\');' +
    'const g=c.getContext("2d"); const px=Math.round(' + x + '*c.width/1920); const py=Math.round(' + y + '*c.height/1080);' +
    'return [...g.getImageData(px,py,1,1).data]; })()',
  );
}

async function run() {
  mkdirSync(evidence, { recursive: true });
  fixture = makeFixture();
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
  }));
  mockIpc();
  await app.whenReady();
  for (const [key, folder] of [['userData', userData], ['sessionData', path.join(userData, 'session-data')]]) {
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
    await waitFor(window, 'document.querySelector(\'[data-testid="animation-library-card"][data-animation-id="' + ids.animation + '"]\')',
      'Synthetic animation card missing.');
    await seek(window, 1000);
    const source = await window.webContents.executeJavaScript(
      '(() => { const e=document.querySelector(\'[data-testid="animation-library-card"][data-animation-id="' + ids.animation + '"]\');' +
      'const r=e.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; })()',
    );
    const target = await point(window, 1300, 700);
    blockedAssetId = ids.frames[1];
    await window.webContents.executeJavaScript(
      'window.__issue871Drop=null; document.addEventListener("drop",e=>{const d=e.dataTransfer;' +
      'window.__issue871Drop={trusted:e.isTrusted,target:e.target?.closest?.(\'[data-testid="project-canvas-viewport"]\')?"canvas":"other",' +
      'payload:d?.getData("application/x-panda-stage-asset")||"",context:d?.getData("application/x-panda-stage-animation-context")||""};},true);',
    );
    await window.webContents.executeJavaScript(
      'window.__issue871From=' + JSON.stringify(source) + '; window.__issue871To=' + JSON.stringify(target) + ';' +
      '(() => {' +
      'const card=[...document.querySelectorAll("[data-testid=animation-library-card]")].find(e=>e.dataset.animationId==="' + ids.animation + '");' +
      'const viewport=document.querySelector("[data-testid=project-canvas-viewport]");' +
      'const transfer=new DataTransfer();' +
      'const event=(type,point)=>new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:point.x,clientY:point.y});' +
      'card.dispatchEvent(event("dragstart",window.__issue871From));' +
      'viewport.dispatchEvent(event("dragenter",window.__issue871To));' +
      'viewport.dispatchEvent(event("dragover",window.__issue871To));' +
      'viewport.dispatchEvent(event("drop",window.__issue871To));' +
      'card.dispatchEvent(event("dragend",window.__issue871To));' +
      '})()',
    );
    await waitFor(window, 'window.__issue871Drop!==null', 'Animation drag produced no drop event.', 5000);
    const drop = await window.webContents.executeJavaScript('window.__issue871Drop');
    assert(drop.target === 'canvas', 'Drag ended outside canvas: ' + JSON.stringify(drop));
    const payload = JSON.parse(drop.payload || 'null');
    assert(payload?.animationId === ids.animation && JSON.parse(drop.context || 'null')?.animationId === ids.animation,
      'Drop did not carry the active animation ID and context.');
    await waitFor(window,
      'JSON.parse(document.querySelector(\'[data-testid="project-canvas-stage"]\').dataset.layerJson).some(x=>x.source?.kind==="animation"&&x.source.animationId==="' + ids.animation + '"&&x.startTimeMs===1000)',
      'Drop did not create the animation at 1000ms.');
    let current = await state(window);
    assert(current.layer.startTimeMs === 1000 && current.visual.visible && current.ready.includes(current.layer.id),
      'Animation is not visible and ready at the 1000ms playhead.');
    const layerId = current.layer.id;
    await waitFor(window,
      'document.querySelector(\'[data-testid="project-canvas-stage"]\').dataset.selectedLayerId==="' + layerId + '"',
      'Animation was not selected after drop.');
    await click(window, '[data-testid="right-activity-rail-properties"]');
    await waitFor(window, 'document.querySelector(\'[data-testid="layer-transform-panel"]\')?.dataset.selectedLayerId==="' + layerId + '"',
      'Inspector did not select the dropped animation.');
    current = await state(window);
    assert(current.controls.temporal === 'true' && !current.controls.xDisabled && !current.controls.scaleDisabled,
      'Animation transform controls are not enabled at nonzero time.');

    const frames = [];
    let pendingEvidence = null;
    for (const timeMs of [1000, 1040, 1080]) {
      await seek(window, timeMs);
      if (timeMs === 1040) {
        await waitFor(window,
          '(() => { const s=document.querySelector(\'[data-testid="project-canvas-stage"]\');' +
          'const a=JSON.parse(s.dataset.layerJson||"[]").find(x=>x.source?.kind==="animation");' +
          'const status=JSON.parse(s.dataset.visualStatusJson||"[]").find(pair=>pair[0]===a?.id)?.[1];' +
          'return status==="previous-complete"&&!JSON.parse(s.dataset.targetReadyLayerIds||"[]").includes(a?.id); })()',
          'Pending frame state did not expose previous-complete and target-not-ready.');
        const pending = await state(window);
        assert(pending.visualStatus === 'previous-complete' && !pending.ready.includes(layerId),
          'Pending frame was incorrectly reported as ready: ' + JSON.stringify(pending));
        assert(typeof releaseBlockedAssetRead === 'function', 'Frame read was not held for the pending-state check.');
        const displayedPixel = await pixel(window, pending.layer.x, pending.layer.y);
        assert(displayedPixel.slice(0, 3).every((v, i) => Math.abs(v - colors[0][i]) <= 2),
          'Pending transition did not retain the previous complete frame.');
        pendingEvidence = { visualStatus: pending.visualStatus, targetReady: pending.ready.includes(layerId), displayedPixel };
        releaseBlockedAssetRead();
        releaseBlockedAssetRead = null;
        await waitFor(window,
          'JSON.parse(document.querySelector(\'[data-testid="project-canvas-stage"]\').dataset.targetReadyLayerIds||"[]").includes("' + layerId + '")',
          'Current frame did not become ready after its read completed.');
      }
      const sampleState = await state(window);
      const index = (timeMs - 1000) / 40;
      assert(sampleState.visual.assetId === ids.frames[index], 'Wrong evaluated frame at ' + timeMs + 'ms.');
      assert(sampleState.ready.includes(layerId), 'Frame is not ready at ' + timeMs + 'ms.');
      const sampledPixel = await pixel(window, sampleState.layer.x, sampleState.layer.y);
      assert(sampledPixel.slice(0, 3).every((v, i) => Math.abs(v - colors[index][i]) <= 2),
        'Canvas pixel does not match frame ' + index + ': ' + JSON.stringify(sampledPixel));
      if (frames.length > 0) assert(sampleState.layer.x === current.layer.x && sampleState.layer.y === current.layer.y, 'Animation base position drifted between distinct crop sizes.');
      frames.push({ timeMs, assetId: sampleState.visual.assetId, color: sampledPixel, position: { x: sampleState.layer.x, y: sampleState.layer.y } });
    }
    await seek(window, 1500);
    const last = await state(window);
    assert(last.visual.assetId === ids.frames[2], 'Last frame did not hold after the sequence.');
    await seek(window, 1040);
    const reverse = await state(window);
    assert(reverse.visual.assetId === ids.frames[1], 'Reverse seek did not select the second frame.');

    await seek(window, 960);
    const beforeStart = await state(window);
    assert(beforeStart.visual?.visible === false,
      'Animation is visible before its start time: ' + JSON.stringify(beforeStart));
    const blank = await point(window, 1800, 900);
    await pointerDrag(window, blank, blank, 1);
    const hidden = await point(window, beforeStart.layer.x, beforeStart.layer.y);
    await pointerDrag(window, hidden, hidden, 1);
    assert((await state(window)).selected !== layerId, 'Hidden animation was selectable before start.');

    await seek(window, 1000);
    current = await state(window);
    const start = await point(window, current.layer.x, current.layer.y);
    const finish = await point(window, current.layer.x + 80, current.layer.y + 40);
    await pointerDrag(window, start, finish, 8);
    const moved = await state(window);
    assert(Math.abs(moved.layer.x - (current.layer.x + 80)) < 3 && Math.abs(moved.layer.y - (current.layer.y + 40)) < 3,
      'Canvas drag did not change animation base transform: ' + JSON.stringify(moved.layer));
    await click(window, '[data-testid="layer-transform-scale"] .layer-transform-stepper button:last-of-type');
    const scaled = await state(window);
    assert(Math.abs(scaled.layer.scaleX - current.layer.scaleX * 1.1) < 0.002,
      'Inspector scale action did not change animation base scale.');
    await window.webContents.executeJavaScript('window.__issue871ReceiptState=true');
    writeFileSync(path.join(evidence, 'interactive-state.json'), JSON.stringify({
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      drop,
      layerId,
      startTimeMs: current.layer.startTimeMs,
      frames,
      reverseAssetId: reverse.visual.assetId,
      beforeStartVisible: beforeStart.visual.visible,
      moved: moved.layer,
      scaled: scaled.layer,
      saveReopen: 'Covered by focused animation-persistence integration; this runtime probe verifies Canvas/Inspector gestures and rendered pixels.',
      playback: 'Shot timeline is seek-only; no Shot playback state is present.',
    }, null, 2), 'utf8');
    writeFileSync(path.join(evidence, 'canvas-evidence.png'), (await window.webContents.capturePage()).toPNG());
    return {
      issue: 871,
      passed: true,
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      drop,
      frames,
      frameManifest,
      pendingEvidence,
      lastHold: { timeMs: 1500, assetId: last.visual.assetId },
      moved: moved.layer,
      scaled: scaled.layer,
      evidence,
    };
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

async function main() {
  mkdirSync(evidence, { recursive: true });
  let result;
  try {
    result = await run();
  } catch (error) {
    result = {
      issue: 871,
      passed: false,
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    };
    throw error;
  } finally {
    writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
    for (const channel of registeredChannels) ipcMain.removeHandler(channel);
  }
}

main()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error('[issue871] ' + (error instanceof Error ? error.stack ?? error.message : String(error)));
    app.exit(1);
  });

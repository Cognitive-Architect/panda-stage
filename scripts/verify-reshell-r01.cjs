// Run against pnpm build output. Use the same profile for layout, restore, and corrupt in that order.
// Focused regressions use dialogue-drop, curve-visibility, tools-visibility, and inspector-focus.
/* global document, window */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { app, BrowserWindow, dialog, nativeImage } = require('electron');

const root = path.resolve(__dirname, '..');
const acceptance = path.resolve(process.env.PANDA_R01_ACCEPTANCE_ROOT ?? 'D:/PandaStage-Acceptance/reshell-r01-1421-1422');
const projectRoot = path.join(acceptance, 'r01.pandastage');
const profile = path.join(acceptance, 'profile');
const phase = process.env.PANDA_R01_PHASE || 'layout';
const key = 'panda-stage:editor-workbench:v1';
if (process.env.PANDA_R01_SOFTWARE_RENDERING === '1') app.disableHardwareAcceleration();
fs.mkdirSync(projectRoot, { recursive: true });
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
process.env.VITE_DEV_SERVER_URL = '';
const { LayerMotionService, LayerService, migrateProject, ProjectSchema, ShotService } = require(path.join(root, 'dist-electron/domain/index.js'));
const example = migrateProject(require(path.join(root, 'demo-project/project-v1.example.json')));
const regression = ['r03-object-toolbar', 'r03-selection', 'r03-viewport', 'r02-regression', 'commands', 'dialogue-drop', 'curve-visibility', 'tools-visibility', 'inspector-focus'].includes(phase);
const pandaLayerId = '60000000-0000-4000-8000-000000000002';
const pendingId = '80000000-0000-4000-8000-000000000002';
let project = ProjectSchema.parse({
  ...example,
  shots: regression && !['commands', 'r02-regression', 'r03-viewport', 'r03-selection'].includes(phase) ? example.shots.map((shot, i) => i === 0 ? {
    ...shot,
    layers: [...shot.layers, { ...shot.layers.find(layer => layer.id === pandaLayerId), id: '60000000-0000-4000-8000-000000000003', name: 'Parent candidate', zIndex: 2 }],
    dialogues: [...shot.dialogues, { ...shot.dialogues[0], id: pendingId, startMs: 0, endMs: 0, audioClipId: undefined, text: 'R01 pending subtitle' }],
  } : shot) : example.shots,
  assets: example.assets.map(asset => ({
    ...asset,
    sha256: createHash('sha256').update(fs.readFileSync(path.join(root, 'demo-project', asset.relativePath))).digest('hex'),
  })),
});
if (phase === 'commands') {
  const shots = new ShotService();
  project = shots.duplicate(project, project.shots[0].id);
  project = shots.rename(project, project.shots[1].id, 'Command fixture');
}
let curveLayerId;
let curveFrameSvg;
if (['curve-visibility', 'tools-visibility', 'r02-regression', 'r03-object-toolbar'].includes(phase)) {
  const animationId = '91000000-0000-4000-8000-000000001429';
  const frameId = '92000000-0000-4000-8000-000000001429';
  const size = { width: 160, height: 120 };
  curveFrameSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#54cdf3"/></svg>';
  const sha256 = createHash('sha256').update(curveFrameSvg).digest('hex');
  const origin = { x: 0, y: 0 };
  const durationMs = 1000 / 24;
  project = ProjectSchema.parse({
    ...project,
    assets: [...project.assets, { id: frameId, kind: 'image', name: 'Curve frame', relativePath: 'assets/r01-curve-frame.svg', mimeType: 'image/svg+xml', ...size, sha256, usage: 'character', keywords: [], flaGraphicFrame: { definitionId: animationId, ordinal: 0 } }],
    animations: [...project.animations, {
      id: animationId, name: 'R01 curve fixture', kind: 'fla-graphic', durationMs,
      source: { basename: 'r01.fla', sha256, renderTargetId: 'r01', targetKind: 'graphic-symbol', targetName: 'r01', startFrameIndex: 0, endFrameIndex: 0, sourceFps: 24, canvas: size, anchor: origin, documentCanvas: { width: 1920, height: 1080 } },
      frames: [{ ordinal: 0, sourceFrameIndex: 0, assetId: frameId, sha256, sourceViewport: { ...origin, ...size }, offset: origin, startMs: 0, durationMs, createdBySequenceImport: false }],
    }],
  });
  if (phase !== 'r02-regression') {
    const shotId = project.shots[0].id;
    const placed = new LayerService().createFromAnimation(project, shotId, { animationId, position: phase === 'r03-object-toolbar' ? { x: 1100, y: 475 } : { x: 500, y: 350 }, startTimeMs: 0 });
    project = placed.project;
    curveLayerId = placed.layer.id;
    const motion = new LayerMotionService();
    for (const [timeMs, offset] of [[0, 0], [1000, 400]]) {
      project = motion.applyKeys(project, { shotId, layerId: curveLayerId, timeMs }, { 'transform.offsetX': offset });
    }
  }
}
if (phase === 'r02-regression') {
  const source = nativeImage.createFromPath(path.join(root, 'demo-project/assets/bamboo-background.png'));
  const assets = Array.from({ length: 10 }, (_, index) => {
    const name = 'PageFixture' + String(index).padStart(2, '0');
    const image = source.resize({ width: 48 + index });
    const bytes = image.toPNG();
    const relativePath = 'assets/' + name + '.png';
    fs.mkdirSync(path.join(projectRoot, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, relativePath), bytes);
    return { id: '94000000-0000-4000-8000-' + String(index).padStart(12, '0'), name, kind: 'image', relativePath,
      mimeType: 'image/png', ...image.getSize(), usage: index === 9 ? 'effect' : 'prop', keywords: [], sha256: createHash('sha256').update(bytes).digest('hex') };
  });
  project = ProjectSchema.parse({ ...project, assets: [...project.assets, ...assets] });
}
fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project));
fs.cpSync(path.join(root, 'demo-project/assets'), path.join(projectRoot, 'assets'), { recursive: true });
if (curveFrameSvg) fs.writeFileSync(path.join(projectRoot, 'assets/r01-curve-frame.svg'), curveFrameSvg);
const secondProjectRoot = path.join(acceptance, 'second.pandastage');
if (phase === 'r02-regression') fs.cpSync(projectRoot, secondProjectRoot, { recursive: true });
let chooserProjectRoot = projectRoot;
const chooserCalls = [];
let cancelProjectChooser = false;
const importedFile = path.join(acceptance, 'R02 imported.png');
const exportFile = path.join(acceptance, 'R02 export.mp4');
if (phase === 'commands') {
  const source = path.join(root, 'demo-project', project.assets.find(asset => asset.name === 'Bamboo background').relativePath);
  fs.writeFileSync(importedFile, nativeImage.createFromPath(source).resize({ width: 64 }).toPNG());
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: exportFile });
}
const showMessageBox = dialog.showMessageBox;
dialog.showMessageBox = async (...args) => {
  const options = args.at(-1);
  if (options.buttons?.includes('FLA / XFL 文件')) return { response: 0, checkboxChecked: false };
  return showMessageBox.call(dialog, ...args);
};
dialog.showOpenDialog = async (...args) => {
  const options = args.at(-1);
  chooserCalls.push(options);
  return options.properties?.includes('openDirectory')
    ? { canceled: cancelProjectChooser, filePaths: cancelProjectChooser ? [] : [chooserProjectRoot] }
    : phase === 'commands' && options.properties?.includes('multiSelections')
      ? { canceled: false, filePaths: [importedFile] }
      : { canceled: true, filePaths: [] };
};
require(path.join(root, 'dist-electron/main/index.js'));
const delay = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
let win;
const js = (fn, ...args) => win.webContents.executeJavaScript(`(${fn})(...${JSON.stringify(args)})`, true);
const waitFor = async (fn, ...args) => {
  for (let i = 0; i < 150; i++) {
    try {
      const value = await js(fn, ...args);
      if (value) return value;
    } catch {
      // A renderer navigation may replace the execution context between polls.
    }
    await delay();
  }
  throw new Error('Wait expired: ' + fn + ' ' + args);
};
async function click(selector) {
  const point = await waitFor((sel) => {
    const el = [...document.querySelectorAll(sel)].find(node => node.getBoundingClientRect().height);
    if (!el) return false;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
  }, selector);
  for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) {
    win.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 });
  }
  await delay(220);
}
async function pressKey(keyCode) {
  for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode });
  await delay(100);
}
async function pointInside(selector, horizontal = 0.5) {
  return waitFor((sel, ratio) => {
    const el = document.querySelector(sel);
    if (!el?.getClientRects().length) return false;
    const timeline = el.closest('[data-testid="timeline-ruler-scroll"]');
    const scrollLeft = timeline?.scrollLeft;
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (timeline && scrollLeft !== undefined) timeline.scrollLeft = scrollLeft;
    const box = el.getBoundingClientRect();
    return { x: Math.round(box.left + box.width * ratio), y: Math.round(box.top + box.height / 2) };
  }, selector, horizontal);
}
async function drag(x, y, targetX, targetY, beforeRelease) {
  const send = (type, px, py, modifiers = []) => win.webContents.sendInputEvent({
    type, x: Math.round(px), y: Math.round(py), button: 'left', clickCount: 1, modifiers,
  });
  send('mouseMove', x, y);
  send('mouseDown', x, y);
  for (let i = 1; i <= 16; i++) {
    send('mouseMove', x + (targetX - x) * i / 16, y + (targetY - y) * i / 16, ['leftButtonDown']);
    await delay(30);
  }
  await delay(180);
  try {
    await beforeRelease?.();
  } finally {
    send('mouseUp', targetX, targetY);
  }
  await delay(250);
}
async function dragDockTab(x, y, targetX, targetY) {
  const devtools = win.webContents.debugger;
  devtools.attach('1.3');
  let onIntercept;
  try {
    const dataReceived = new Promise(resolve => {
      onIntercept = (_event, method, params) => {
        if (method === 'Input.dragIntercepted') resolve(params.data);
      };
      devtools.on('message', onIntercept);
    });
    await devtools.sendCommand('Input.setInterceptDrags', { enabled: true });
    await devtools.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await devtools.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await devtools.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 14, y: y + 12, button: 'left', buttons: 1 });
    const data = await Promise.race([dataReceived, delay(1300).then(() => null)]);
    assert(data, 'Chromium started the Dockview tab drag');
    for (const type of ['dragEnter', 'dragOver', 'dragOver', 'drop']) {
      await devtools.sendCommand('Input.dispatchDragEvent', { type, x: targetX, y: targetY, data });
      await delay(120);
    }
    await devtools.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: targetX, y: targetY, button: 'left', buttons: 0, clickCount: 1 });
  } finally {
    devtools.removeListener('message', onIntercept);
    devtools.detach();
  }
  await delay(200);
}
const tab = text => js(name => {
  const el = [...document.querySelectorAll('.dv-tab')].find(item => item.textContent.trim() === name);
  return el.getBoundingClientRect().toJSON();
}, text);
const box = (id) => js(panel => {
  const el = document.querySelector(`[data-workbench-panel="${panel}"]`);
  return el?.closest('.dv-groupview')?.getBoundingClientRect().toJSON() ?? null;
}, id);
const saved = () => js(pref => JSON.parse(localStorage.getItem(pref)), key);
const menu = '[data-testid="workbench-window-menu"]';
const pref = name => `[role="menuitemcheckbox"][data-panel="${name}"]`;
async function visibleTab(title) {
  const b = await tab(title);
  const x = Math.round(b.x + b.width / 3);
  const y = Math.round(b.y + b.height / 2);
  for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) {
    win.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
  }
  await delay(200);
}
const shotClock = () => js(() => document.querySelector('[data-testid="timeline-timecode"]')?.dataset.currentTime);
const editingState = () => js(() => ({
  revision: document.querySelector('[data-testid="editor-layout"]')?.dataset.projectRevision,
  time: document.querySelector('[data-testid="timeline-timecode"]')?.dataset.currentTime,
  shot: document.querySelector('select[aria-label="切换镜头"]')?.value,
  selection: document.querySelector('[data-testid="shot-layer-list-panel"] [data-selected="true"]')?.dataset.layerId,
  dirty: document.querySelector('[data-testid="quick-action-save"]')?.dataset.saveState,
  undo: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount,
  redo: document.querySelector('[data-testid="history-controls"]')?.dataset.redoCount,
}));
const screenshot = async name => fs.writeFileSync(path.join(acceptance, name), (await win.webContents.capturePage()).toPNG());

async function clickText(selector, text) {
  const point = await waitFor((sel, value) => {
    const el = [...document.querySelectorAll(sel)].find(node => node.textContent.trim() === value && node.getClientRects().length);
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  }, selector, text);
  for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 });
  await delay(180);
}

async function waitForOpeningPaint() {
  return waitFor(() => {
    const viewport = document.querySelector('[data-testid="project-canvas-viewport"]');
    const stage = document.querySelector('[data-testid="project-canvas-stage"]');
    const bounds = viewport?.getBoundingClientRect();
    const scale = Number(viewport?.dataset.displayScale);
    if (!(bounds?.width > 0 && bounds.height > 0 && scale > 0) || stage?.dataset.backgroundReady !== 'true') return false;
    const painted = [...stage.querySelectorAll('.konvajs-content canvas')].some(canvas => {
      if (!canvas.width || !canvas.height) return false;
      const [r, g, b, a] = canvas.getContext('2d').getImageData(
        Math.floor(canvas.width / 5), Math.floor(canvas.height / 5), 1, 1,
      ).data;
      return a > 0 && g > r && g > b;
    });
    if (!painted) return false;
    const cards = [...document.querySelectorAll('.asset-grid .asset-card[data-asset-kind="image"]')].slice(0, 2);
    if (cards.length < 2 || !cards.every(card => {
      const image = card.querySelector('img');
      return (image?.complete && image.naturalWidth > 0) || Boolean(card.querySelector('[data-thumbnail-status="missing"]'));
    })) return false;
    return { scale, width: bounds.width, height: bounds.height, thumbnails: cards.map(card =>
      card.querySelector('img')?.naturalWidth > 0 ? 'decoded' : 'missing') };
  });
}

async function run() {
  await app.whenReady();
  for (let i = 0; i < 100 && !win; i++) {
    win = BrowserWindow.getAllWindows()[0];
    if (!win) await delay();
  }
  assert(win, 'Production window started');
  if (phase.startsWith('r03-')) win.webContents.on('console-message', details => {
    if (details.level === 'error') console.error(details.message);
  });
  win.setSize(...(phase === 'storage-unavailable' ? [1280, 768] : [1440, 900]));
  if (regression) {
    win.show();
    win.focus();
    await delay(250);
  }
  await waitFor(() => document.querySelector('[data-testid="open-project"]') !== null);
  if (phase === 'layout' || phase === 'assembly' || regression) await js(pref => localStorage.removeItem(pref), key);
  if (phase === 'storage-unavailable') {
    await js(pref => {
      localStorage.setItem('panda-r01-sentinel', 'preserved');
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === pref) throw new DOMException('Disabled workbench preference', 'QuotaExceededError');
        return original.call(this, key, value);
      };
      const originalGet = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key) {
        if (key === pref) throw new DOMException('Disabled workbench preference', 'SecurityError');
        return originalGet.call(this, key);
      };
    }, key);
  }
  await click('[data-testid="open-project"]');
  await waitFor(() => document.querySelector('[data-testid="workbench-dock"] .dv-tab'));
  const background = project.assets.find(asset => asset.relativePath.endsWith('bamboo-background.png'));
  const original = await js(async (projectRoot, assetId, sha256) => {
    const result = await window.pandaStage.assets.readCanvasImage({ projectRoot, assetId, sha256 });
    return result.ok ? result.status : result.error;
  }, projectRoot, background.id, background.sha256);
  assert.equal(original, 'ready', 'production canvas preload reads the real background');
  const panels = await js(() => [...document.querySelectorAll('.dv-tab')].map(el => el.textContent.trim()));
  console.log('panels:', JSON.stringify(panels));

  if (phase === 'r03-object-toolbar') {
    await waitFor(() => document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.backgroundReady === 'true');
    const toolbar = '[data-testid="canvas-object-toolbar"]';
    const undoCount = count => waitFor(n => document.querySelector('[data-testid="history-controls"]').dataset.undoCount === String(n), count);
    const button = (name) => toolbar + ' [aria-label="' + name + '"]';
    const choose = id => click('[data-testid="layer-list-row-' + id + '"] .workbench-layer-name');
    const target = id => waitFor((selector, layerId) => document.querySelector(selector)?.dataset.layerId === layerId, toolbar, id);
    await choose(curveLayerId);
    await target(curveLayerId);
    const clickPoint = async ({ x, y }) => {
      const devtools = win.webContents.debugger;
      devtools.attach('1.3');
      try {
        await devtools.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await devtools.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
        await devtools.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
      } finally { devtools.detach(); }
    };
    await click('[aria-label="台词查找替换"]');
    await click('.dialogue-find-replace input');
    await win.webContents.insertText(project.shots[0].dialogues[0].text);
    await click('.dialogue-find-results button');
    await click('[aria-label="关闭台词查找替换"]');
    await choose(curveLayerId);
    await target(curveLayerId);
    await waitFor(() => Number(document.querySelector('[data-testid="timeline-timecode"]').dataset.currentTime) > 0);
    const frame = Number(await shotClock());
    assert(frame < 1000);
    await click(button('添加关键帧'));
    await undoCount(1);
    assert(await js(sel => document.querySelector(sel).disabled, button('添加关键帧')));
    const graphLayer = (await js(id => JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]').dataset.layerJson).find(layer => layer.id === id), curveLayerId));
    assert(JSON.stringify(graphLayer).includes('"timeMs":' + frame), 'the current playhead was written to the formal layer motion tracks');
    const parentPoint = await js(() => {
      const v = document.querySelector('[data-testid="project-canvas-viewport"]');
      const r = v.getBoundingClientRect();
      const bounds = JSON.parse(document.querySelector('[data-testid="canvas-selection-geometry"]').dataset.bounds);
      return { x: Math.round(r.left + v.clientLeft + bounds.x + bounds.width / 2),
        y: Math.round(r.top + v.clientTop + bounds.y + bounds.height / 2) };
    });
    await choose(pandaLayerId);
    await target(pandaLayerId);
    await click(button('添加动作'));
    await waitFor(() => Boolean(document.activeElement.closest('[role="menu"]')));
    await clickText('[role="menuitem"]', '抖动…');
    await waitFor(() => !!document.querySelector('dialog.canvas-object-preset-dialog[open]'));
    await click('dialog.canvas-object-preset-dialog button[type="submit"]');
    await undoCount(2);
    await waitFor(() => !document.querySelector('dialog.canvas-object-preset-dialog[open]'));
    await click(button('上移图层'));
    await undoCount(3);
    await click(button('锁定图层'));
    await undoCount(4);
    assert(await js(sel => !document.querySelector(sel), button('隐藏图层')));
    assert(await js(sel => Boolean(document.querySelector(sel)), button('解锁图层')));
    await click(button('解锁图层'));
    await undoCount(5);
    await click('[data-testid="quick-action-play"]');
    await waitFor(() => document.querySelector('[data-testid="product-preview-overlay"]'));
    assert(await js(sel => !document.querySelector(sel), toolbar));
    const previewExit = await waitFor(() => {
      const overlay = document.querySelector('[data-testid="product-preview-overlay"]');
      if (overlay?.dataset.previewSurface === 'active') return '[data-testid="product-preview-close"]';
      return overlay?.querySelector('[data-testid="product-preview-cancel"]') ? '[data-testid="product-preview-cancel"]' : false;
    });
    await click(previewExit);
    await target(pandaLayerId);
    await screenshot('r03-object-toolbar.png');
    await click(button('隐藏图层'));
    await undoCount(6);
    await waitFor(sel => !document.querySelector(sel), toolbar);
    await click('[aria-label="撤销"]');
    await undoCount(5);
    await choose(pandaLayerId);
    await target(pandaLayerId);
    const beforeParent = Number((await editingState()).undo);
    const parentButton = await waitFor(() => {
      const button = [...document.querySelectorAll('button[data-canvas-interactive-chrome="true"]')].find(item => item.textContent === '在舞台选父级');
      if (!button) return false;
      const rect = button.getBoundingClientRect();
      const x = Math.round(rect.left + rect.width / 2), y = Math.round(rect.top + rect.height / 2);
      return document.elementFromPoint(x, y)?.closest('button') === button ? { x, y } : false;
    });
    await clickPoint(parentButton);
    await waitFor(() => [...document.querySelectorAll('button[aria-pressed="true"]')].some(button => button.textContent === '在舞台选父级'));
    await waitFor(sel => !document.querySelector(sel), toolbar);
    await clickPoint(parentPoint);
    await undoCount(beforeParent + 1);
    await target(pandaLayerId);
    const child = () => js(id => JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]').dataset.layerJson).find(layer => layer.id === id), pandaLayerId);
    const bound = await child();
    assert(bound.parentLayerId === curveLayerId || bound.parentKeys?.some(key => key.parentLayerId === curveLayerId));
    await click('summary[aria-label="镜头相机"]');
    await js(() => {
      const choice = document.querySelector('select[aria-label="相机模式"]');
      choice.value = 'manual';
      choice.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await undoCount(beforeParent + 2);
    const cameraButton = async (label) => {
      const coordinates = await waitFor(name => {
        const control = [...document.querySelectorAll('.shot-camera-actions button')].find(button => button.textContent === name);
        if (!control) return false;
        control.scrollIntoView({ block: 'nearest' });
        const { left, top, width, height } = control.getBoundingClientRect();
        const x = Math.round(left + width / 2), y = Math.round(top + height / 2);
        const target = document.elementFromPoint(x, y)?.closest('button');
        return { x, y, target: target?.textContent, open: control.closest('details')?.open };
      }, label);
      assert.equal(coordinates.target, label, JSON.stringify(coordinates));
      await clickPoint(coordinates);
    };
    await waitFor(() => document.querySelector('[data-testid="project-canvas-stage"]').dataset.cameraView);
    await cameraButton('相机视角');
    await waitFor(() => !document.querySelector('[data-testid="project-canvas-stage"]').dataset.cameraView);
    await cameraButton('相机视角');
    await waitFor(() => document.querySelector('[data-testid="project-canvas-stage"]').dataset.cameraView);
    await target(pandaLayerId);
    const captured = await editingState();
    await click('[data-testid="canvas-mode-actual"]');
    await click('[data-testid="canvas-mode-fit"]');
    assert.deepEqual(await editingState(), captured);
    await cameraButton('编辑相机框');
    await waitFor(() => document.querySelector('[data-testid="project-canvas-stage"]').dataset.cameraTool === 'active');
    await waitFor(sel => !document.querySelector(sel), toolbar);
    await click('summary[aria-label="镜头相机"]');
    const cameraCenter = await pointInside('[data-testid="canvas-logical-stage"]');
    await drag(cameraCenter.x, cameraCenter.y, cameraCenter.x + 24, cameraCenter.y - 14);
    await undoCount(beforeParent + 3);
    console.log('R03-C timeline key, real preset, layer order, lock, unlock, hide, undo, preview, parent binding, and camera tool isolation passed');
    return;
  }

  if (phase === 'r03-selection') {
    await waitForOpeningPaint();
    const geometry = '[data-testid="canvas-selection-geometry"]';
    const viewport = '[data-testid="project-canvas-viewport"]';
    const selectedBounds = () => js((g, v) => {
      const data = document.querySelector(g);
      if (!data) return null;
      const element = document.querySelector(v);
      const rect = element.getBoundingClientRect();
      const bounds = JSON.parse(data.dataset.bounds);
      const left = rect.left + element.clientLeft, top = rect.top + element.clientTop;
      const rotation = data.dataset.rotationHandle ? JSON.parse(data.dataset.rotationHandle) : null;
      return { ...bounds, x: bounds.x + left, y: bounds.y + top, target: data.dataset.layerId,
        rotation: rotation ? { x: rotation.x + left, y: rotation.y + top } : null };
    }, geometry, viewport);
    const ready = () => waitFor(sel => !!document.querySelector(sel), geometry);
    const model = () => js(id => JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]').dataset.layerJson).find(layer => layer.id === id), pandaLayerId);
    const cursor = (x, y) => ({ x: Math.round(x), y: Math.round(y) });
    const input = (type, x, y, modifiers = []) => win.webContents.sendInputEvent({ type, ...cursor(x, y), button: 'left', modifiers, clickCount: 1 });
    const undoCount = n => waitFor(count => document.querySelector('[data-testid="history-controls"]').dataset.undoCount === String(count), n);
    await click('[data-testid="layer-list-row-' + pandaLayerId + '"] .workbench-layer-name');
    await ready();
    const initial = await selectedBounds();
    assert.equal(initial.target, pandaLayerId);
    assert(initial.width > 20 && initial.height > 20);
    const x = initial.x + initial.width / 2, y = initial.y + initial.height * .54;
    let old = await model();

    input('mouseMove', x, y);
    input('mouseDown', x, y);
    input('mouseMove', x + 48, y - 24, ['leftButtonDown']);
    await waitFor(sel => !document.querySelector(sel), geometry);
    input('mouseUp', x + 48, y - 24);
    await undoCount(1);
    await ready();
    const moved = await selectedBounds();
    const current = await model();
    assert(current.x > old.x && current.y < old.y);
    assert(Math.abs(moved.x - initial.x - 48) < 2 && Math.abs(moved.y - initial.y + 24) < 2);
    await click('[aria-label="撤销"]');
    await undoCount(0);
    assert.deepEqual(await model(), old);
    await click('[aria-label="重做"]');
    await undoCount(1);
    assert.deepEqual(await model(), current);
    const b = await selectedBounds();
    const right = b.x + b.width, bottom = b.y + b.height;
    input('mouseMove', right, bottom);
    input('mouseDown', right, bottom);
    input('mouseMove', right + 30, bottom + 42, ['leftButtonDown']);
    await waitFor(sel => !document.querySelector(sel), geometry);
    input('mouseUp', right + 30, bottom + 42);
    await undoCount(2);
    await ready();
    const scaled = await selectedBounds();
    assert(scaled.width > b.width && scaled.height > b.height);
    assert(scaled.rotation, 'Konva provides a real rotation handle');
    const { x: rotX, y: rotY } = scaled.rotation;
    input('mouseMove', rotX, rotY);
    await delay(180);

    input('mouseDown', rotX, rotY);
    input('mouseMove', rotX + 54, rotY + 14, ['leftButtonDown']);
    await waitFor(sel => !document.querySelector(sel), geometry);
    input('mouseUp', rotX + 54, rotY + 14);
    await undoCount(3);
    await ready();
    old = await model();
    assert(Math.abs(old.rotationDeg) > 5);
    const rotated = await selectedBounds();
    assert(rotated.rotation);
    const center = rotated.rotation;
    input('mouseMove', center.x, center.y);
    await delay(180);
    input('mouseDown', center.x, center.y);
    input('mouseMove', center.x + 38, center.y + 16, ['leftButtonDown']);
    await waitFor(sel => !document.querySelector(sel), geometry);
    for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode: 'Escape' });
    input('mouseUp', center.x + 38, center.y + 16);
    await ready();
    assert.equal((await editingState()).undo, '3');
    assert.deepEqual(await model(), old);
    await screenshot('r03-selection.png');
    console.log('R03-B real move, scale, rotate, undo, redo, Escape cancellation, and live projected selection passed');
    return;
  }

  if (phase === 'r03-viewport') {
    await waitForOpeningPaint();
    const viewport = '[data-testid="project-canvas-viewport"]';
    const fit = '[data-testid="canvas-mode-fit"]';
    const actual = '[data-testid="canvas-mode-actual"]';
    const navigation = () => js(sel => {
      const node = document.querySelector(sel);
      const { left, top, width, height } = node.getBoundingClientRect();
      return { left: left + node.clientLeft, top: top + node.clientTop, width, height,
        scale: Number(node.dataset.displayScale), zoom: Number(node.dataset.viewZoom),
        pan: { x: Number(node.dataset.viewPanX), y: Number(node.dataset.viewPanY) },
        offset: { x: Number(node.dataset.offsetX), y: Number(node.dataset.offsetY) },
        panning: node.dataset.panActive === 'true' };
    }, viewport);
    const logical = (point, view) => ({
      x: (point.x - view.left - view.offset.x) / view.scale,
      y: (point.y - view.top - view.offset.y) / view.scale,
    });
    const near = (left, right, tolerance = 1) => Math.abs(left - right) <= tolerance;
    const assertCenter = async () => {
      const view = await navigation();
      assert(view.scale > 0);
      assert(near(view.offset.x, (view.width - 1920 * view.scale) / 2));
      assert(near(view.offset.y, (view.height - 1080 * view.scale) / 2));
      assert.deepEqual(view.pan, { x: 0, y: 0 });
    };
    const chosen = '[data-testid="layer-list-row-' + pandaLayerId + '"] .workbench-layer-name';
    await click(chosen);
    const beforeEdit = await editingState();
    const beforeView = await navigation();
    assert(beforeView.offset.y >= 15);
    await assertCenter();
    const anchor = { x: Math.round(beforeView.left + beforeView.width * .38), y: Math.round(beforeView.top + beforeView.height * .42) };
    const beforeAnchor = logical(anchor, beforeView);
    const devtools = win.webContents.debugger;
    devtools.attach('1.3');
    try {
      await devtools.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', ...anchor, deltaY: -180, deltaX: 0 });
    } finally {
      devtools.detach();
    }
    await waitFor(before => Number(document.querySelector('[data-testid="project-canvas-viewport"]').dataset.displayScale) > before, beforeView.scale);
    const afterAnchor = logical(anchor, await navigation());
    assert(near(beforeAnchor.x, afterAnchor.x, 0.05));
    assert(near(beforeAnchor.y, afterAnchor.y, 0.05));

    const pan = async (button, modifiers, distance) => {
      const start = await pointInside(viewport, .42);
      win.webContents.sendInputEvent({ type: 'mouseMove', ...start, button, modifiers });
      win.webContents.sendInputEvent({ type: 'mouseDown', ...start, button, modifiers, clickCount: 1 });
      await waitFor(() => document.querySelector('[data-testid="project-canvas-viewport"]').dataset.panActive === 'true');
      win.webContents.sendInputEvent({ type: 'mouseMove', x: start.x + distance, y: start.y + 25, button,
        modifiers: [...modifiers, button === 'middle' ? 'middleButtonDown' : 'leftButtonDown'] });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: start.x + distance, y: start.y + 25, button, modifiers, clickCount: 1 });
      await waitFor(() => document.querySelector('[data-testid="project-canvas-viewport"]').dataset.panActive === 'false');
      await delay(120);
    };
    const afterZoom = await navigation();
    await pan('left', ['alt'], 45);
    const alt = await navigation();
    assert(near(alt.pan.x - afterZoom.pan.x, 45));
    assert(near(alt.pan.y - afterZoom.pan.y, 25));
    await pan('middle', [], -15);
    const middle = await navigation();
    assert(near(middle.pan.x - alt.pan.x, -15));
    assert(near(middle.pan.y - alt.pan.y, 25));
    win.setSize(930, 700);
    await waitFor(previous => {
      const rect = document.querySelector('[data-testid="project-canvas-viewport"]').getBoundingClientRect();
      return Math.abs(rect.width - previous.width) > 1 || Math.abs(rect.height - previous.height) > 1;
    }, middle);
    const resized = await navigation();
    assert.equal(resized.zoom, middle.zoom);
    assert.deepEqual(resized.pan, middle.pan);
    await click('[data-testid="workbench-window-menu"]');
    await clickText('[role="menuitem"]', '恢复默认布局');
    await waitFor(() => document.querySelector('[data-testid="project-canvas-viewport"]').getBoundingClientRect().height > 0);
    assert.equal((await navigation()).zoom, middle.zoom);
    assert.deepEqual((await navigation()).pan, middle.pan);
    assert.deepEqual(await editingState(), beforeEdit);

    await click(fit);
    assert.equal((await navigation()).zoom, 1);
    await assertCenter();
    await click(actual);
    assert.equal((await navigation()).scale, 1);
    assert.equal(await js(() => document.querySelector('[data-testid="canvas-mode-feedback"]').textContent), '100.0%');
    await clickText('.workbench-menu-bar button', '视图');
    await clickText('[role="menuitem"]', '画布适合窗口');
    await assertCenter();
    assert.deepEqual(await editingState(), beforeEdit);
    win.setSize(1440, 900);
    await waitFor(previous => document.querySelector('[data-testid="project-canvas-viewport"]').getBoundingClientRect().height > previous, resized.height);
    await pan('middle', [], 20);
    const view = await navigation();
    const end = { x: Math.round(view.left + view.width * .60), y: Math.round(view.top + view.height * .45) };
    win.webContents.sendInputEvent({ type: 'mouseMove', ...end });
    const expected = logical(end, view);
    await waitFor(() => !document.querySelector('[data-testid="canvas-pointer-coordinate"]').hidden);
    const feedback = await js(() => document.querySelector('[data-testid="canvas-pointer-coordinate"]').textContent);
    assert(feedback.includes('x ' + expected.x.toFixed(1)) || near(Number(feedback.split(' ')[1]), expected.x));
    const asset = project.assets.find(candidate => candidate.name === 'Panda neutral');
    const origin = await pointInside('[data-asset-id="' + asset.id + '"]');
    await dragDockTab(origin.x, origin.y, end.x, end.y);
    const placed = await waitFor(() => JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]').dataset.layerJson).find(layer =>
      layer.id !== '60000000-0000-4000-8000-000000000001' && layer.id !== '60000000-0000-4000-8000-000000000002'));
    assert(near(placed.x, expected.x, 2));
    assert(near(placed.y, expected.y, 2));
    assert.equal((await editingState()).undo, '1');
    await screenshot('r03-viewport.png');
    console.log('R03-A pixel scale, anchored zoom, Alt and middle pan, resize and reset intent, true asset coordinates and one history edit passed');
    return;
  }

  if (phase === 'r02-regression') {
    const row = id => '[data-testid="layer-list-row-' + id + '"]';
    const file = '[data-testid="workbench-file-menu"]';
    const openFileAction = async label => { await click(file); await clickText('[role="menuitem"]', label); };
    const pickCategory = label => clickText('nav[aria-label="素材分类"] button', label);
    const filter = '[placeholder="搜索素材"]';
    const footer = '.workbench-asset-footer button';
    const visibleCards = () => js(() => [...document.querySelectorAll('.asset-grid [data-asset-id]')].map(card => card.dataset.assetId));
    const selected = () => js(() => document.querySelector('.asset-grid [aria-pressed="true"]')?.dataset.assetId);
    const commandsDisabled = () => js(() => [...document.querySelectorAll('.workbench-asset-footer button')]
      .filter(button => ['放入镜头', '素材操作'].includes(button.textContent.trim())).every(button => button.disabled));
    const enterText = async (selector, value) => {
      await click(selector);
      await js(sel => document.querySelector(sel).select(), selector);
      await win.webContents.insertText(value);
      await delay(180);
    };

    await click(row(pandaLayerId) + ' .workbench-layer-name');
    const beforeModal = await editingState();
    await openFileAction('新建项目…');
    await waitFor(() => Boolean(document.querySelector('[data-testid="new-project-dialog"]')));
    const nameInput = '[data-testid="new-project-name"]';
    await enterText(nameInput, 'XY');
    await pressKey('Backspace');
    assert.equal(await js(sel => document.querySelector(sel).value, nameInput), 'X');
    await js(() => document.querySelector('[data-testid="new-project-cancel"]').focus());
    for (const keyCode of ['Delete', 'Backspace']) await pressKey(keyCode);
    assert.deepEqual(await editingState(), beforeModal);
    await click('[data-testid="new-project-cancel"]');
    assert.deepEqual(await editingState(), beforeModal);
    await click(file);
    await waitFor(() => Boolean(document.activeElement.closest('[role="menu"]')));
    for (const keyCode of ['Delete', 'Backspace']) await pressKey(keyCode);
    assert.deepEqual(await editingState(), beforeModal);
    await pressKey('Escape');
    await openFileAction('导出设置… Ctrl+M');
    await waitFor(() => document.querySelector('[data-testid="export-options-dialog"]')?.open);
    await js(() => document.querySelector('[data-testid="export-options-dialog"] button[type="button"]').focus());
    await pressKey('Delete');
    assert.deepEqual(await editingState(), beforeModal);
    await pressKey('Escape');
    await click(row(pandaLayerId) + ' .workbench-layer-name');
    await pressKey('Delete');
    await waitFor(sel => !document.querySelector(sel), row(pandaLayerId));
    assert.equal((await editingState()).undo, '1');
    await click('[aria-label="撤销"]');
    await waitFor(sel => Boolean(document.querySelector(sel)), row(pandaLayerId));
    await click('[aria-label="重做"]');
    await waitFor(sel => !document.querySelector(sel), row(pandaLayerId));
    await click('[aria-label="撤销"]');
    console.log('1462 modal, menu, text input, layer delete, undo, redo passed');

    await pickCategory('道具');
    const firstPage = await visibleCards();
    assert.equal(firstPage.length, 8);
    await click('[data-asset-id="' + firstPage[0] + '"]');
    assert.equal(await selected(), firstPage[0]);
    const beforePage = await editingState();
    await click('[aria-label="下一页"]');
    const secondPage = await visibleCards();
    assert(secondPage.length > 0 && !secondPage.includes(firstPage[0]));
    assert.equal(await selected(), undefined);
    assert(await commandsDisabled());
    assert.deepEqual(await editingState(), beforePage);
    const itemB = secondPage[0];
    const assetB = project.assets.find(asset => asset.id === itemB);
    await click('[data-asset-id="' + itemB + '"]');
    await clickText(footer, '放入镜头');
    const created = await js(() => JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]').dataset.layerJson).find(layer => layer.source.assetId && layer.name.startsWith('PageFixture')));
    assert.equal(created?.source.assetId, itemB);
    assert.equal(Number((await editingState()).undo), Number(beforePage.undo) + 1);
    await click('[aria-label="撤销"]');
    await enterText(filter, assetB.name);
    assert.equal(await selected(), itemB, 'search keeps an item that remains on the current page');
    await clickText(footer, '素材操作');
    await clickText('[role="menuitem"]', '素材详情');
    await waitFor(() => Boolean(document.querySelector('[data-testid="asset-details-dialog"]')));
    await enterText('[data-testid="asset-author-name"] input', 'Uncommitted');
    await js(() => { window.originalR02Confirm = window.confirm; window.confirm = () => false; });
    await pressKey('Escape');
    assert.equal(await js(() => document.querySelector('[data-testid="asset-author-name"] input').value), 'Uncommitted');
    await js(() => { window.confirm = () => true; });
    await pressKey('Escape');
    await js(() => { window.confirm = window.originalR02Confirm; });
    assert.equal(await selected(), itemB);
    await enterText(filter, 'NoMatch');
    assert(await commandsDisabled());
    await click('[title="清除搜索"]');
    assert(await commandsDisabled(), 'a hidden selection does not return');
    await click('[data-asset-id="' + firstPage[0] + '"]');
    await click('[data-testid="asset-library-usage-filter"]');
    await click('[data-usage-filter-value="effect"]');
    assert(await commandsDisabled());
    await pickCategory('背景');
    assert(await commandsDisabled());
    await pickCategory('道具');
    const remove = firstPage[0];
    await click('[data-asset-id="' + remove + '"]');
    await clickText(footer, '素材操作');
    await clickText('[role="menuitem"]', '素材详情');
    await click('.asset-details-more > summary');
    await js(() => { window.originalR02Confirm = window.confirm; window.confirm = () => true; });
    await click('.asset-details-delete-action');
    await waitFor(() => !document.querySelector('[data-testid="asset-details-dialog"]'));
    await js(() => { window.confirm = window.originalR02Confirm; });
    assert(!(await visibleCards()).includes(remove));
    assert(await commandsDisabled());
    console.log('1462 page selection, formal placement, search, use filter, category, metadata draft and removal passed');

    const card = '[data-testid="animation-library-card"]';
    for (const keyCode of ['Enter', 'Space']) {
      await pickCategory('背景');
      await js(() => {
        const category = document.querySelector('select[aria-label="其他素材分类"]');
        category.value = 'animation';
        category.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await waitFor(selector => document.querySelector(selector)?.getAttribute('aria-pressed') === 'false', card);
      await js(selector => document.querySelector(selector).focus(), card);
      await pressKey(keyCode);
      assert.equal(await js(selector => document.querySelector(selector).getAttribute('aria-pressed'), card), 'true');
      assert.equal(await js(() => Boolean(document.querySelector('[data-testid="animation-preview-dialog"]'))), false);
    }
    await pressKey('Tab');
    await waitFor(() => document.activeElement.matches('.workbench-animation-preview'));
    await pressKey('Space');
    await waitFor(() => Boolean(document.querySelector('[data-testid="animation-preview-dialog"]')));
    await pressKey('Escape');
    await waitFor(() => !document.querySelector('[data-testid="animation-preview-dialog"]'));
    const beforeAnimation = Number((await editingState()).undo);
    await clickText(footer, '放入镜头');
    await waitFor(count => Number(document.querySelector('[data-testid="history-controls"]').dataset.undoCount) === count + 1, beforeAnimation);
    const origin = await pointInside(card);
    const target = await pointInside('.konvajs-content', 0.65);
    await dragDockTab(origin.x, origin.y, target.x, target.y);
    await waitFor(count => Number(document.querySelector('[data-testid="history-controls"]').dataset.undoCount) === count + 2, beforeAnimation);
    console.log('1462 Graphic keyboard selection, separate preview, placement and drag passed');

    await click('[data-testid="quick-action-save"]');
    await waitFor(() => document.querySelector('[data-testid="quick-action-save"]').dataset.saveState === 'saved');
    await pickCategory('道具');
    const sharedAssetId = (await visibleCards())[0];
    await click('[data-asset-id="' + sharedAssetId + '"]');
    assert.equal(await selected(), sharedAssetId);
    chooserProjectRoot = secondProjectRoot;
    await openFileAction('打开项目…');
    await waitFor(() => document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount === '0');
    await pickCategory('道具');
    assert((await visibleCards()).includes(sharedAssetId));
    assert(await commandsDisabled());
    assert.equal(await selected(), undefined);
    console.log('1462 project switch clears the selection even when the same asset ID exists');
    return;
  }
  if (phase === 'commands') {
    const file = '[data-testid="workbench-file-menu"]';
    const row = id => '[data-testid="layer-list-row-' + id + '"]';
    const rows = () => js(() => [...document.querySelectorAll('.workbench-layer-row[data-layer-id]')].map(node => node.dataset.layerId));
    const select = async (label, text) => {
      await js((name, value) => {
        const node = document.querySelector('select[aria-label="' + name + '"]');
        node.value = [...node.options].find(option => option.text === value).value;
        node.dispatchEvent(new Event('change', { bubbles: true }));
      }, label, text);
      await delay(150);
    };
    const opening = await waitForOpeningPaint();
    assert.deepEqual(opening.thumbnails, ['decoded', 'decoded']);
    console.log('Opening ready', opening);
    await screenshot('opening.png');
    const originalShot = (await editingState()).shot;
    await select('切换镜头', 'Command fixture');
    assert.notEqual((await editingState()).shot, originalShot);
    await select('切换镜头', 'Opening');
    assert.equal((await editingState()).shot, originalShot);

    await click(file);
    await clickText('[role="menuitem"]', '新建项目…');
    await waitFor(() => document.querySelector('[data-testid="new-project-dialog"]'));
    await click('[data-testid="new-project-cancel"]');
    await click(file);
    cancelProjectChooser = true;
    const openCount = chooserCalls.length;
    await clickText('[role="menuitem"]', '打开项目…');
    assert.equal(chooserCalls.length, openCount + 1);
    assert.equal((await editingState()).shot, originalShot);
    cancelProjectChooser = false;
    await click(file);
    await click('[data-testid="quick-action-home"]');
    await waitFor(() => document.querySelector('[data-testid="project-center-screen"]'));
    await click('[data-testid="return-to-editor"]');
    await waitFor(() => document.querySelector('[data-testid="workbench-command-bar"]').getBoundingClientRect().height);
    await click('[data-testid="quick-action-play"]');
    await waitFor(() => document.querySelector('[data-testid="product-preview-overlay"]'));
    await pressKey('Escape');
    await waitFor(() => !document.querySelector('[data-testid="product-preview-overlay"]'));
    await click(file);
    const previousChoosers = chooserCalls.length;
    await clickText('[role="menuitem"]', '导入 FLA / XFL…');
    assert.equal(chooserCalls.length, previousChoosers + 1);
    assert(chooserCalls.at(-1).filters.some(filter => filter.extensions.includes('fla')));

    const baseline = await editingState();
    await clickText('nav[aria-label="素材分类"] button', '音频');
    assert.equal(await js(() => document.querySelector('.asset-grid')?.dataset.display), 'list');
    assert.deepEqual(await js(() => [...document.querySelectorAll('.asset-grid [data-asset-kind]')].map(node => node.dataset.assetKind)), ['audio']);
    await click('[aria-label="切换素材视图"]');
    assert.equal(await js(() => document.querySelector('.asset-grid')?.dataset.display), 'grid');
    await clickText('nav[aria-label="素材分类"] button', '角色');
    assert.equal(await js(() => document.querySelector('.asset-grid')?.dataset.display), 'grid');
    await click('[placeholder="搜索素材"]');
    for (const type of ['char']) win.webContents.sendInputEvent({ type, keyCode: 'n' });
    await waitFor(() => document.querySelector('[placeholder="搜索素材"]').value === 'n');
    assert.deepEqual(await editingState(), baseline, 'asset browsing adds no revision or history');
    await click('[title="清除搜索"]');

    const asset = project.assets.find(candidate => candidate.name === 'Panda neutral');
    await click('[data-asset-id="' + asset.id + '"]');
    await clickText('.workbench-asset-footer button', '放入镜头');
    await waitFor(() => document.querySelector('[data-testid="history-controls"]').dataset.undoCount === '1');
    const created = (await rows()).find(id => !project.shots[0].layers.some(layer => layer.id === id));
    assert(created, 'placement creates a formal content layer');
    const prior = await rows();
    const from = await pointInside(row(created) + ' > button.workbench-layer-name');
    const to = await pointInside(row(pandaLayerId) + ' > button.workbench-layer-name');
    await dragDockTab(from.x, from.y, to.x, to.y);
    const reordered = await rows();
    assert.notDeepEqual(reordered, prior, 'drag changes formal row order');
    assert.equal((await editingState()).undo, '2', 'one reorder creates one undo step');
    await click('[aria-label="撤销"]');
    assert.deepEqual(await rows(), prior);
    await click('[aria-label="重做"]');
    assert.deepEqual(await rows(), reordered);
    await click(row(created) + ' [aria-label="隐藏图层"]');
    assert.equal(await js(sel => document.querySelector(sel).dataset.hidden, row(created)), 'true');
    const renameButton = row(created) + ' [aria-label^="图层操作"]';
    await click(renameButton);
    await clickText('[role="menuitem"]', '重命名');
    const field = row(created) + ' input[aria-label="图层名称"]';
    await waitFor(sel => document.activeElement === document.querySelector(sel), field);
    await js(sel => document.querySelector(sel).select(), field);
    const renamed = 'R02LongLayerNamePreservesItsFullTitle';
    for (const keyCode of renamed) win.webContents.sendInputEvent({ type: 'char', keyCode });
    await pressKey('Enter');
    await waitFor((sel, name) => document.querySelector(sel + ' .workbench-layer-name')?.textContent.trim() === name, row(created), renamed);

    await click(row(created) + ' [aria-label="锁定图层"]');
    assert.equal(await js(sel => document.querySelector(sel + ' [aria-label="显示图层"]').disabled, row(created)), true);
    assert.equal(await js(() => document.querySelector('[data-testid="layer-list-row-60000000-0000-4000-8000-000000000001"] [aria-label="锁定图层"]').disabled), true);

    await click(row(pandaLayerId) + ' > button.workbench-layer-name');
    await clickText('nav[aria-label="素材分类"] button', '动作');
    const preset = '[data-testid="preset-shake"]';
    await waitFor((selector) => {
      const button = document.querySelector(selector);
      if (!button) return false;
      button.scrollIntoView({ block: 'center', inline: 'nearest' });
      const bounds = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2));
    }, preset);
    await screenshot('action-list.png');
    await click(preset);
    await waitFor(() => document.querySelector('[data-testid="preset-shake"]').getAttribute('aria-pressed') === 'true');
    const applyPreset = '.action-preset-panel .workbench-asset-footer button:last-child';
    await waitFor((selector) => {
      const button = document.querySelector(selector);
      if (!button || button.disabled) return false;
      button.scrollIntoView({ block: 'nearest' });
      const bounds = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2));
    }, applyPreset);
    await delay(100);
    await click(applyPreset);
    await waitFor(() => Boolean(document.querySelector('.preset-parameter-form')));
    const beforeAction = Number((await editingState()).undo);
    await click('.preset-parameter-form button[type="submit"]');
    await waitFor(count => Number(document.querySelector('[data-testid="history-controls"]').dataset.undoCount) === count + 1, beforeAction);
    await clickText('nav[aria-label="素材分类"] button', '角色');
    console.log('R02 preview, asset placement, reorder, rename, lock, and preset application passed');

    const chooserCount = chooserCalls.length;
    await click(file);
    await clickText('[role="menuitem"]', '导入素材…');
    await waitFor(() => !document.querySelector('[role="menu"]'));
    assert.equal(chooserCalls.length, chooserCount + 1, 'File import uses the production native chooser');
    await clickText('nav[aria-label="素材分类"] button', '道具');
    await waitFor(() => [...document.querySelectorAll('.asset-card-name')].some(node => node.textContent.includes('R02 imported')));
    console.log('R02 native asset import returned a formal library item');
    await click(row(pandaLayerId) + ' [aria-label="隐藏图层"]');
    await waitFor(() => document.querySelector('[data-testid="quick-action-save"]').dataset.saveState === 'dirty');
    await click(file);
    await click('[data-testid="quick-action-close"]');
    await waitFor(() => document.querySelector('[data-testid="close-confirm-dialog"]'));
    await click('[data-testid="close-confirm-cancel"]');
    await click(row(pandaLayerId) + ' [aria-label="显示图层"]');
    await click('[data-testid="quick-action-save"]');
    await waitFor(() => document.querySelector('[data-testid="quick-action-save"]').dataset.saveState === 'saved');
    const persisted = JSON.parse(fs.readFileSync(path.join(projectRoot, 'project.json'), 'utf8'));
    assert.equal(persisted.shots[0].layers.find(layer => layer.id === created).locked, true);
    assert(persisted.assets.some(asset => asset.name.includes('R02 imported')));
    await click(file);
    await click('[data-testid="quick-action-export-settings"]');
    await waitFor(() => document.querySelector('[data-testid="export-options-dialog"]').open);
    await pressKey('Escape');
    await waitFor(() => !document.querySelector('[data-testid="export-options-dialog"]'));
    await click('[data-testid="quick-action-export"]');
    let exportStatus;
    for (let i = 0; i < 450; i++) {
      exportStatus = await js(() => document.querySelector('[data-testid="export-task-surface"]')?.dataset.taskStatus);
      if (['completed', 'failed', 'cancelled'].includes(exportStatus)) break;
      await delay();
    }
    assert.equal(exportStatus, 'completed', await js(() => document.querySelector('[data-testid="export-task-surface"]')?.innerText ?? 'No export task'));
    assert(fs.statSync(exportFile).size > 64, 'the production quick export writes the MP4');
    await screenshot('commands.png');
    win.setSize(930, 700);
    await delay(300);
    assert.equal(await js(() => {
      const bar = document.querySelector('[data-testid="workbench-command-bar"]');
      return bar.getBoundingClientRect().right >= bar.querySelector('[data-testid="quick-action-export"]').getBoundingClientRect().right;
    }), true, 'narrow workbench keeps export inside the command bar');
    assert(await js((sel, name) => {
      const node = document.querySelector(sel + ' .workbench-layer-name');
      const text = node.querySelector('span:last-child');
      return node.title.startsWith(name) && text.scrollWidth > text.clientWidth;
    }, row(created), renamed), 'long layer names truncate with the full name available');
    await screenshot('narrow.png');
    console.log('R02 Windows commands, library placement and import, reorder, history, visibility, lock, guarded close and persisted save passed');
    return;
  }
  if (phase === 'dialogue-drop') {
    await click('[data-testid="right-activity-rail-subtitles"]');
    const source = '[data-testid="dialogue-untimed-select"]';
    const target = '[data-testid="timeline-subtitle-track"] [data-pending-drop-surface]';
    const before = await editingState();
    const interval = () => js(id => {
      const clip = document.querySelector('[data-testid="dialogue-track"] [data-dialogue-id="' + id + '"]');
      return clip ? [Number(clip.dataset.startMs), Number(clip.dataset.endMs)] : null;
    }, pendingId);
    const dragState = () => js(() => document.querySelector('[data-testid="pending-dialogue-drag-ghost"]')?.dataset.dropState);
    const end = await pointInside(target, 0.04);
    const start = await pointInside(source);
    assert(await js(({ x, y }, selector) => Boolean(document.elementFromPoint(x, y)?.closest(selector)), start, source), 'the drag starts on the pending card');
    await drag(start.x, start.y, end.x, end.y, async () => {
      const feedback = await dragState();
      const hit = await js(({ x, y }) => ({
        element: document.elementFromPoint(x, y)?.outerHTML.slice(0, 250),
        message: document.querySelector('[data-testid="pending-dialogue-drop-status"]')?.textContent,
        target: document.querySelector('[data-pending-drop-surface]')?.getBoundingClientRect().toJSON(),
      }), end);
      assert.equal(feedback, 'valid', 'pending card feedback at ' + JSON.stringify({ end, hit }));
      assert(await js(() => document.querySelector('[data-testid="pending-dialogue-drop-preview"]')?.getBoundingClientRect().height > 0));
    });
    const arranged = await interval();
    assert(arranged && arranged[1] > arranged[0], 'pending subtitle receives a real interval');
    const edited = await editingState();
    assert.equal(Number(edited.revision), Number(before.revision) + 1);
    assert.equal(Number(edited.undo), Number(before.undo) + 1);
    await click('[aria-label="撤销"]');
    assert.deepEqual(await interval(), [0, 0]);
    await click('[aria-label="重做"]');
    assert.deepEqual(await interval(), arranged);
    await click('[aria-label="撤销"]');
    const undone = await editingState();
    const attempt = async (endPoint, beforeRelease) => {
      const origin = await pointInside(source);
      await drag(origin.x, origin.y, endPoint.x, endPoint.y, beforeRelease);
      assert.deepEqual(await interval(), [0, 0]);
      assert.deepEqual(await editingState(), undone);
    };
    await attempt(await pointInside(target, 0.3), async () => assert.equal(await dragState(), 'invalid'));
    await attempt(await pointInside(target, 0.04), async () => {
      assert.equal(await dragState(), 'valid');
      await pressKey('Escape');
    });
    await click('[aria-label="折叠时间轴"]');
    await attempt(end, async () => assert.equal(await dragState(), 'outside'));
    await click('[aria-label="展开时间轴"]');
    await click(menu);
    await click(pref('timeline'));
    await attempt(end, async () => assert.equal(await dragState(), 'outside'));
    console.log('desktop pending subtitle: feedback, one edit, Undo/Redo, overlap, Escape, and unavailable targets passed');
    return;
  }
  if (phase === 'curve-visibility') {
    await click('[data-testid="layer-list-row-' + curveLayerId + '"] > button');
    const ruler = await pointInside('[data-testid="timeline-ruler"]', 0.09);
    await drag(ruler.x, ruler.y, ruler.x, ruler.y);
    await visibleTab('缓动曲线');
    const stageX = () => js(id => JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]').dataset.evaluatedLayerJson).find(layer => layer.id === id).x, curveLayerId);
    const formal = await stageX();
    await js(() => {
      const field = document.querySelector('[data-testid="rich-easing-family"]');
      field.value = 'bounce';
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => document.querySelector('[data-testid="rich-easing-section"]')?.dataset.richEasingDraft === 'active');
    assert.notEqual(await stageX(), formal, 'draft changes the rendered layer position');
    const unchangedLayoutState = await editingState();
    const draft = await stageX();
    await visibleTab('属性检查器');
    assert.equal(await stageX(), formal, 'inactive curve tab relinquishes the canvas');
    await visibleTab('缓动曲线');
    assert.equal(await stageX(), draft, 'the same draft resumes when its tab is shown');
    await click('[aria-label="折叠缓动曲线"]');
    assert.equal(await stageX(), formal);
    const scrub = await pointInside('[data-testid="timeline-ruler"]', 0.12);
    await drag(scrub.x, scrub.y, scrub.x, scrub.y);
    assert.notEqual(await shotClock(), unchangedLayoutState.time);
    const laterFormal = await stageX();
    assert.notEqual(laterFormal, formal, 'hidden draft no longer pins the formal playhead');
    await click('[aria-label="展开缓动曲线"]');
    assert.equal(await stageX(), draft);
    await visibleTab('属性检查器');
    const curveTab = await tab('缓动曲线');
    const inspector = await box('props');
    await dragDockTab(curveTab.x + curveTab.width / 3, curveTab.y + curveTab.height / 2, inspector.x + inspector.width / 2, inspector.bottom - 27);
    assert((await box('curve'))?.y > inspector.y + 35, 'curve tab docks independently');
    await visibleTab('缓动曲线');
    assert.equal(await stageX(), draft, 'dock move preserves the draft');
    await click(menu);
    await click(pref('curve'));
    assert.equal(await stageX(), laterFormal);
    await click(menu);
    await click(pref('curve'));
    assert.equal(await stageX(), draft);
    await click(menu);
    await click('[role="menuitem"]');
    await visibleTab('缓动曲线');
    assert.equal(await stageX(), draft, 'default-layout rebuild preserves the valid draft');
    assert.deepEqual({ ...(await editingState()), time: unchangedLayoutState.time }, unchangedLayoutState);
    await click('[data-testid="rich-easing-apply"]');
    const applied = await editingState();
    assert.equal(Number(applied.undo), Number(unchangedLayoutState.undo) + 1);
    assert.equal(Number(applied.revision), Number(unchangedLayoutState.revision) + 1);
    await click('[aria-label="撤销"]');
    await js(() => {
      const field = document.querySelector('[data-testid="rich-easing-family"]');
      field.value = 'back';
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => document.querySelector('[data-testid="rich-easing-section"]')?.dataset.richEasingDraft === 'active');
    await visibleTab('属性检查器');
    await click('[data-testid="layer-list-row-' + curveLayerId + '"] [aria-label="锁定图层"]');
    await click('[aria-label="撤销"]');
    await visibleTab('缓动曲线');
    assert.equal(await stageX(), laterFormal, 'a hidden draft invalidated by a project revision cannot resume');
    console.log('curve draft pauses on tab switch, fold and close, resumes through reset, and only Apply commits');
    return;
  }
  if (phase === 'tools-visibility') {
    await click('[data-testid="layer-list-row-' + curveLayerId + '"] > button');
    await visibleTab('属性检查器');
    const overlay = async () => {
      const image = await js(() => Array.from(document.querySelectorAll('[data-testid="project-canvas-stage"] .konvajs-content canvas')).at(-1)?.toDataURL());
      return image && createHash('sha256').update(image).digest('hex');
    };
    const before = await editingState();
    const formal = await overlay();
    assert(formal, 'the formal stage has an overlay canvas');
    await click('[data-testid="right-activity-rail-tools"]');
    await click('[data-testid="project-tools-curve-motion"]');
    await waitFor(() => document.querySelector('[data-testid="curve-motion-submit"]:enabled'));
    const draft = await overlay();
    assert.notEqual(draft, formal, 'curve-motion draws into the overlay canvas');
    await click('[aria-label="折叠属性检查器"]');
    assert.equal(await overlay(), formal, 'folded tools relinquish the overlay canvas');
    await click('[aria-label="展开属性检查器"]');
    assert.equal(await overlay(), draft);
    await click('[data-testid="curve-motion-cancel"]');
    assert.equal(await overlay(), formal);
    assert.deepEqual(await editingState(), before);
    console.log('curve-motion overlay follows visibility and cancel without editing the project');
    return;
  }
  if (phase === 'inspector-focus') {
    await click('[data-testid="right-activity-rail-subtitles"]');
    assert(await js(() => Boolean(document.querySelector('[data-testid="right-inspector"]').closest('[inert]'))), 'covered inspector is inert');
    for (let i = 0; i < 8; i++) {
      await pressKey('Tab');
      assert.equal(await js(() => Boolean(document.activeElement?.closest('[data-testid="right-inspector"]'))), false);
    }
    await click('[data-testid="right-activity-rail-tools"]');
    assert(await js(() => Boolean(document.querySelector('[data-testid="right-inspector"]').closest('[inert]'))), 'tools also cover the inspector');
    await click('[data-testid="parent-chain-toggle"]');
    await click('[data-testid="parent-chain-node-' + pandaLayerId + '"]');
    await waitFor(() => document.activeElement?.getAttribute('aria-label') === '父级图层');
    assert.equal(await js(() => document.querySelector('[data-testid="right-workspace"]').dataset.activeActivity), 'none');
    assert.equal(await js(() => document.activeElement.closest('[data-testid="right-inspector"]').dataset.selectedLayerId), pandaLayerId);
    assert.equal(await js(() => Boolean(document.activeElement.closest('[inert]'))), false);
    const beforeBinding = await editingState();
    await js(() => {
      const select = document.activeElement;
      select.value = Array.from(select.options).find(option => option.value && !option.disabled).value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(count => Number(document.querySelector('[data-testid="history-controls"]').dataset.undoCount) === count, Number(beforeBinding.undo) + 1);
    await click('[aria-label="撤销"]');
    await click('[data-testid="right-activity-rail-subtitles"]');
    await pressKey('Escape');
    assert.equal(await js(() => document.activeElement.dataset.testid), 'right-activity-rail-subtitles');
    console.log('covered inspector is excluded from Tab and parent-chain jump closes the activity and focuses the selected layer');
    return;
  }
  if (phase === 'restore') {
    const layout = await saved();
    assert(layout?.panels?.timeline?.params?.folded, 'timeline preference written');
    assert(!(await box('props')), 'closed property panel restored on restart');
    assert((await box('timeline')).height < 55, 'folded timeline restored on restart');
    await click(menu);
    await click('[role="menuitem"]');
    assert.equal((await js(() => document.querySelectorAll('.dv-tab').length)), 6, 'reset restores six panels');
    await screenshot('restored-default.png');
    await js(pref => localStorage.setItem(pref, '{bad'), key);
    console.log('restart restoration, reset, corrupted preference seed passed');
    return;
  }
  assert.equal(panels.length, 6);
  const boxes = {};
  for (const id of ['assets', 'layers', 'stage', 'props', 'timeline']) boxes[id] = await box(id);
  console.log('boxes:', JSON.stringify(boxes));
  assert(boxes.stage.height > 240 && boxes.assets.height > 120 && boxes.timeline.height > 130);
  assert.equal(boxes.timeline.width, boxes.assets.width + boxes.stage.width + boxes.props.width);
  assert.equal(await js(() => document.querySelectorAll('[data-testid="shot-layer-list-panel"]').length), 1);
  assert.equal(await js(() => document.querySelectorAll('[data-testid="right-inspector"]').length), 1);
  assert(await js(() => {
    const asset = document.querySelector('[data-testid="asset-browser-view"]');
    return !!asset && asset.getBoundingClientRect().top < document.querySelector('[data-workbench-panel="assets"]').getBoundingClientRect().bottom;
  }), 'asset list is in the visible resource panel');
  if (phase === 'corrupt') {
    await screenshot('corrupt-fallback.png');
    console.log('corrupt preference fallback passed');
    return;
  }
  if (phase === 'fla-entry') {
    const before = await editingState();
    await click('[data-testid="resource-activity-tabs"] button[data-activity="characters"]');
    await click('[data-testid="resource-primary-action"]');
    await click('[data-testid="character-create-fla-import"]');
    for (let i = 0; i < 65 && !chooserCalls.some(call => call.filters?.some(filter => filter.extensions.includes('fla'))); i++) await delay();
    assert(chooserCalls.some(call => call.filters?.some(filter => filter.extensions.includes('fla'))));
    assert.deepEqual(await editingState(), before);
    console.log('character FLA entry reaches the real native chooser through preload and cancel preserves the project');
    return;
  }
  if (phase === 'assembly') {
    await click('[data-testid="resource-activity-tabs"] button[data-activity="characters"]');
    await click('[data-testid="resource-primary-action"]');
    await click('[data-testid="character-create-mode-switch"] input[value="composite"]');
    const input = '[data-testid="character-create-name"]';
    await waitFor(sel => document.querySelector(sel), input);
    await js(sel => {
      const input = document.querySelector(sel);
      input.focus();
      input.select();
    }, input);
    await win.webContents.insertText('R01 draft');
    await waitFor(sel => document.querySelector(sel)?.value === 'R01 draft', input);
    for (const [picker, asset] of [['body', '003'], ['face', '004']]) {
      const pickerId = `character-create-${picker}-picker`;
      await click(`[data-testid="${pickerId}-selected"]`);
      await click(`[data-testid="${pickerId}-candidates"] [data-asset-id="10000000-0000-4000-8000-000000000${asset}"]`);
    }
    await waitFor(() => document.querySelector('.editor-shell').dataset.characterAssemblyActive === 'true');
    await click(menu);
    assert.equal(await js(sel => document.querySelector(sel)?.hasAttribute('data-disabled'), pref('assets')), true);
    assert.equal(await js(sel => document.querySelector(sel)?.hasAttribute('data-disabled'), pref('stage')), true);
    await click('[role="menuitem"]');
    assert.equal(await js(sel => document.querySelector(sel)?.value, input), 'R01 draft');
    assert.equal(await js(() => document.querySelector('.editor-shell').dataset.characterAssemblyActive), 'true');
    await screenshot('assembly-draft.png');
    console.log('active composite creation draft survives reset and its required panels stay available');
    return;
  }
  if (phase === 'storage-unavailable') {
    await click('[aria-label="折叠时间轴"]');
    assert((await box('timeline')).height < 55);
    await click(menu);
    await click('[role="menuitem"]');
    assert((await box('timeline')).height > 100);
    assert.equal(await js(() => localStorage.getItem('panda-r01-sentinel')), 'preserved');
    console.log('read/write failure, preserved unrelated preference and functional workbench passed');
    return;
  }
  await click('[data-testid="timeline-ruler"]');
  const time = await shotClock();
  assert(Number(time) > 0, 'scrub seeks a nonzero frame');
  await click('[data-testid="layer-list-row-60000000-0000-4000-8000-000000000001"] > button');
  await visibleTab('缓动曲线');
  await waitFor(() => document.querySelector('.animation-curve-panel')?.getBoundingClientRect().height);
  await visibleTab('属性检查器');
  await click('[data-testid="layer-list-row-60000000-0000-4000-8000-000000000002"] > button');
  await waitFor(() => document.querySelector('[data-testid="right-inspector"]')?.dataset.selectedLayerId);
  const cleanState = await editingState();
  assert.equal(cleanState.dirty, 'saved');
  await click('[data-testid="layer-list-row-60000000-0000-4000-8000-000000000002"] [aria-label="锁定图层"]');
  assert.equal(await js(() => document.querySelectorAll('[data-testid="shot-layer-list-panel"]').length), 1);
  await waitFor(() => document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount === '1');
  const edited = await editingState();
  assert.equal(edited.dirty, 'dirty');
  assert.equal(Number(edited.revision), Number(cleanState.revision) + 1);
  assert.equal(edited.selection, cleanState.selection);
  await js(() => { window.r01Canvas = document.querySelector('.konvajs-content'); });
  await waitFor(() => !document.querySelector('[data-testid="canvas-background-warning"]'));
  await screenshot('default.png');
  await drag(boxes.timeline.x + 500, boxes.timeline.y, boxes.timeline.x + 500, boxes.timeline.y - 65);
  assert((await box('timeline')).height > boxes.timeline.height + 50, 'timeline sash changes real geometry');
  assert.deepEqual(await editingState(), edited);
  const curve = await tab('缓动曲线');
  const props = await box('props');
  await dragDockTab(curve.x + curve.width / 3, curve.y + curve.height / 2, props.x + props.width / 2, props.bottom - 27);
  assert((await box('curve'))?.y > props.y + 35, 'curve can be docked in a separate group');
  assert.deepEqual(await editingState(), edited);
  const curveDocked = await tab('缓动曲线');
  const propsTab = await tab('属性检查器');
  await dragDockTab(curveDocked.x + curveDocked.width / 3, curveDocked.y + curveDocked.height / 2,
    propsTab.x + 15, propsTab.y + propsTab.height / 2);
  assert(await js(() => [...document.querySelectorAll('.dv-groupview')].some(group => {
    const names = [...group.querySelectorAll('.dv-tab')].map(node => node.textContent.trim());
    return names.includes('属性检查器') && names.includes('缓动曲线');
  })), 'curve can rejoin inspector tabs');
  assert.deepEqual(await editingState(), edited);
  await click('[aria-label="折叠时间轴"]');
  assert((await box('timeline')).height < boxes.timeline.height - 60, 'fold gives space to upper panels');
  assert.equal(await shotClock(), time);
  await click('[aria-label="展开时间轴"]');
  assert((await box('timeline')).height > 100);
  await click(menu);
  await click(pref('stage'));
  assert.equal(await box('stage'), null);
  await click(menu);
  await click(pref('stage'));
  assert((await box('stage')).height > 100);
  assert(await js(() => window.r01Canvas === document.querySelector('.konvajs-content')));
  await click(menu);
  await click('[role="menuitem"]');
  assert(await js(() => window.r01Canvas === document.querySelector('.konvajs-content')));
  assert.equal(await shotClock(), time);
  assert.deepEqual(await editingState(), edited, 'layout operations retain edit and history');
  await click('[data-testid="workbench-file-menu"]');
  await click('[data-testid="quick-action-close"]');
  await waitFor(() => document.querySelector('[data-testid="close-confirm-dialog"]'));
  await click('[data-testid="close-confirm-cancel"]');
  assert.deepEqual(await editingState(), edited, 'project close cancellation retains the edit');
  await click('[aria-label="撤销"]');
  const undone = await editingState();
  assert.equal(undone.undo, '0');
  assert.equal(undone.redo, '1');
  assert.equal(undone.selection, cleanState.selection);
  await click('[aria-label="折叠时间轴"]');
  await click(menu);
  await click(pref('props'));
  await waitFor(prefKey => {
    const layout = JSON.parse(localStorage.getItem(prefKey));
    return !!layout?.panels?.timeline?.params?.folded && !layout?.panels?.props;
  }, key);
  assert.equal(fs.readFileSync(path.join(projectRoot, 'project.json'), 'utf8'), JSON.stringify(project), 'renderer layout does not write project JSON');
  await screenshot('custom.png');
  console.log('real panels and curves, sash resize, split/group, fold/reopen/reset, unchanged editing state, and undo passed');
}

run().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });

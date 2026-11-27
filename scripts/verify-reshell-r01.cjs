// Run against pnpm build output. Use the same profile for layout, restore, and corrupt in that order.
/* global document, window */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { app, BrowserWindow, dialog } = require('electron');

const root = path.resolve(__dirname, '..');
const acceptance = path.resolve(process.env.PANDA_R01_ACCEPTANCE_ROOT ?? 'D:/PandaStage-Acceptance/reshell-r01-1421-1422');
const projectRoot = path.join(acceptance, 'r01.pandastage');
const profile = path.join(acceptance, 'profile');
const phase = process.env.PANDA_R01_PHASE || 'layout';
const key = 'panda-stage:editor-workbench:v1';
fs.mkdirSync(projectRoot, { recursive: true });
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
process.env.VITE_DEV_SERVER_URL = '';
const { migrateProject, ProjectSchema } = require(path.join(root, 'dist-electron/domain/index.js'));
const example = migrateProject(require(path.join(root, 'demo-project/project-v1.example.json')));
const project = ProjectSchema.parse({
  ...example,
  assets: example.assets.map(asset => ({
    ...asset,
    sha256: createHash('sha256').update(fs.readFileSync(path.join(root, 'demo-project', asset.relativePath))).digest('hex'),
  })),
});
fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project));
fs.cpSync(path.join(root, 'demo-project/assets'), path.join(projectRoot, 'assets'), { recursive: true });
const chooserCalls = [];
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
    ? { canceled: false, filePaths: [projectRoot] }
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
async function drag(x, y, targetX, targetY) {
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
  send('mouseUp', targetX, targetY);
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

async function run() {
  await app.whenReady();
  for (let i = 0; i < 100 && !win; i++) {
    win = BrowserWindow.getAllWindows()[0];
    if (!win) await delay();
  }
  assert(win, 'Production window started');
  win.setSize(...(phase === 'storage-unavailable' ? [1280, 768] : [1440, 900]));
  await waitFor(() => document.querySelector('[data-testid="open-project"]') !== null);
  if (phase === 'layout' || phase === 'assembly') await js(pref => localStorage.removeItem(pref), key);
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
    await click('.resource-activity-tabs button[data-activity="characters"]');
    await click('[data-testid="resource-primary-action"]');
    await click('[data-testid="character-create-fla-import"]');
    for (let i = 0; i < 65 && !chooserCalls.some(call => call.filters?.some(filter => filter.extensions.includes('fla'))); i++) await delay();
    assert(chooserCalls.some(call => call.filters?.some(filter => filter.extensions.includes('fla'))));
    assert.deepEqual(await editingState(), before);
    console.log('character FLA entry reaches the real native chooser through preload and cancel preserves the project');
    return;
  }
  if (phase === 'assembly') {
    await click('.resource-activity-tabs button[data-activity="characters"]');
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
  await click('[data-testid="right-inspector-layer-section"] > summary');
  await click('[data-testid="layer-order-controls"] [role="switch"]');
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

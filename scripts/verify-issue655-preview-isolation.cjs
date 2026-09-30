const { app, ipcMain } = require('electron');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createMainWindow } = require('../dist-electron/main/windows/main-window.js');
const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');
const { migrateProject } = require('../dist-electron/domain/migrations/index.js');

// Real Electron DOM/input proof for #655. Synthetic IPC keeps the fixture
// isolated from user projects. This is automated evidence, not human acceptance.
const acceptanceRoot = 'D:\\PandaStage-Acceptance\\issue655-preview-isolation';
const projectRoot = path.join(acceptanceRoot, 'fixture.pandastage');
const png = readFileSync(path.join(__dirname, '../public/probe/panda-character.png'));
const project = migrateProject(require('../demo-project/project-v1.example.json'));
project.name = 'Issue 655 Preview Isolation';
project.shots = [project.shots[0]];
const shot = project.shots[0];
const layer = shot.layers.find((candidate) => candidate.source.kind === 'character');
shot.dialogues = [];
shot.audioClips = [];
shot.timelineEvents = [
  { id: 'a0655000-0000-4000-8000-000000000001', type: 'move', layerId: layer.id,
    startMs: 0, endMs: 1000, from: { x: layer.x, y: layer.y }, to: { x: 600, y: 690 }, easing: 'linear' },
  { id: 'a0655000-0000-4000-8000-000000000002', type: 'move', layerId: layer.id,
    startMs: 1000, endMs: 2000, from: { x: 600, y: 690 }, to: { x: 700, y: 690 }, easing: 'linear' },
];
for (const asset of project.assets) if (asset.kind === 'image') {
  asset.sha256 = createHash('sha256').update(png).digest('hex');
  const target = path.join(projectRoot, asset.relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, png);
}
mkdirSync(acceptanceRoot, { recursive: true });
writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2));
app.setPath('userData', path.join(acceptanceRoot, 'user-data'));
process.env.VITE_DEV_SERVER_URL = '';
app.on('window-all-closed', () => {});

const documentFor = () => ({ projectRoot, projectFilePath: path.join(projectRoot, 'project.json'), project, migrated: false, sourceVersion: 6 });
const register = (name, handler) => ipcMain.handle(IPC_CHANNELS[name], handler);
register('PROJECT_OPEN', () => ({ ok: true, value: documentFor() }));
register('RECENT_PROJECTS_LIST', () => ({ ok: true, entries: [{ projectId: project.id, projectName: project.name, projectRoot, lastOpenedAt: new Date().toISOString(), status: 'available' }] }));
register('RECENT_PROJECTS_OPEN', () => ({ ok: true, document: documentFor() }));
for (const name of ['AUTOSAVE_TRACK', 'AUTOSAVE_UPDATE', 'AUTOSAVE_STOP']) register(name, () => ({ ok: true }));
register('RECOVERY_DETECT', () => ({ ok: true, candidate: null }));
register('ASSET_THUMBNAIL_READ', (_event, request) => ({ ok: true, status: 'ready', assetId: request.assetId, dataUrl: `data:image/png;base64,${png.toString('base64')}` }));
register('ASSET_CANVAS_IMAGE_READ', (_event, request) => {
  const asset = project.assets.find((candidate) => candidate.id === request.assetId);
  return { ok: true, status: 'ready', assetId: asset.id, mimeType: 'image/png', width: asset.width, height: asset.height, byteLength: png.length, bytes: new Uint8Array(png) };
});

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };
async function wait(window, expression) {
  await window.webContents.executeJavaScript(`(async () => {
    const end = Date.now() + 15000;
    while (Date.now() < end) {
      if (${expression}) return;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error(${JSON.stringify(`Timed out: ${expression}`)});
  })()`);
}
async function click(window, selector) {
  await window.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await pause(100);
}
async function capture(window, name) {
  writeFileSync(path.join(acceptanceRoot, name), (await window.webContents.capturePage()).toPNG());
}
async function state(window) {
  return window.webContents.executeJavaScript(`(() => {
    const q = s => document.querySelector(s);
    return {
      action: !!q('[data-testid="position-key-action"]'),
      keys: document.querySelectorAll('[data-testid="position-key-marker"]').length,
      selectedLayerId: q('[data-testid="project-canvas-stage"]')?.dataset.selectedLayerId,
      revision: Number(q('[data-testid="project-canvas-stage"]')?.dataset.projectRevision),
      undo: Number(q('[data-testid="history-controls"]')?.dataset.undoCount),
      bodyInert: q('[data-testid="editor-body"]')?.inert,
      timelineInert: q('[data-testid="bottom-workspace"]')?.inert,
      focusInPreview: !!q('[data-testid="product-preview-overlay"]')?.contains(document.activeElement),
      playing: q('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying,
    };
  })()`);
}

async function run() {
  await app.whenReady();
  const window = await createMainWindow({ show: false });
  window.setContentSize(1280, 800);
  const result = { issue: 655, passed: false, states: {} };
  try {
    await wait(window, `document.querySelector('[data-task4-core="recent-open"]')`);
    await click(window, '[data-task4-core="recent-open"]');
    await wait(window, `document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.backgroundReady === 'true'`);
    await wait(window, `JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.renderedAssetIds ?? '[]').includes(${JSON.stringify(project.characters[0].expressions[0].assetId)})`);
    window.show();
    window.focus();
    window.webContents.focus();
    // Allow Konva's hit canvas to paint after the window becomes visible.
    await pause(250);
    const point = await window.webContents.executeJavaScript(`(() => {
      const v = document.querySelector('[data-testid="project-canvas-viewport"]');
      const r = v.getBoundingClientRect(), s = Number(v.dataset.displayScale);
      return { x: Math.round(r.left + Number(v.dataset.offsetX) + ${layer.x} * s), y: Math.round(r.top + Number(v.dataset.offsetY) + ${layer.y} * s) };
    })()`);
    window.webContents.sendInputEvent({ type: 'mouseMove', ...point });
    window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
    await wait(window, `document.querySelectorAll('[data-testid="position-key-marker"]').length === 2`);
    await click(window, '[data-testid="position-key-marker"]');
    await wait(window, `document.querySelector('[data-testid="position-key-action"]')`);
    result.states.before = await state(window);
    assert(result.states.before.revision === 0 && result.states.before.undo === 0, 'Selection mutated Project/History');
    await window.webContents.executeJavaScript(`(() => {
      window.__issue655OldDelete = document.querySelector('[aria-label="删除当前位置点"]');
      window.__issue655OldDelete.focus();
      window.__issue655OldRect = window.__issue655OldDelete.getBoundingClientRect().toJSON();
    })()`);
    await capture(window, 'before-preview.png');
    await click(window, '[data-testid="quick-action-drawer-handle"]');
    await click(window, '[data-testid="quick-action-play"]');
    await wait(window, `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewSurface === 'active'`);
    const oldPoint = await window.webContents.executeJavaScript(`({
      x: Math.round(window.__issue655OldRect.x + window.__issue655OldRect.width / 2),
      y: Math.round(window.__issue655OldRect.y + window.__issue655OldRect.height / 2),
    })`);
    window.webContents.sendInputEvent({ type: 'mouseDown', ...oldPoint, button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseUp', ...oldPoint, button: 'left', clickCount: 1 });
    await pause(60);
    await window.webContents.executeJavaScript(`(() => {
      window.__issue655OldDelete.click();
      const key = document.querySelector('[data-testid="position-key-marker"]');
      key.focus(); key.click();
    })()`);
    result.states.preview = await state(window);
    const during = result.states.preview;
    assert(!during.action && during.bodyInert && during.timelineInert && during.focusInPreview, 'Preview did not isolate contextual UI / focus');
    assert(during.revision === 0 && during.undo === 0 && during.keys === 2, 'Hidden editor action mutated Project/History');
    assert(during.playing === 'true', 'Preview autoplay regressed');
    await capture(window, 'during-preview.png');
    await click(window, '[data-testid="product-preview-close"]');
    result.states.closed = await state(window);
    assert(!result.states.closed.action && !result.states.closed.timelineInert && !result.states.closed.bodyInert, 'Close restored stale popup or kept editor inert');
    await click(window, '[data-testid="position-key-marker"]');
    await wait(window, `document.querySelector('[data-testid="position-key-action"]')`);
    await window.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await wait(window, `!document.querySelector('[data-testid="position-key-action"]')`);
    await click(window, '[data-testid="position-key-marker"]');
    await wait(window, `document.querySelector('[data-testid="position-key-action"]')`);
    await capture(window, 'explicit-reopen.png');
    await click(window, '[aria-label="删除当前位置点"]');
    await wait(window, `document.querySelectorAll('[data-testid="position-key-marker"]').length === 1`);
    result.states.deleted = await state(window);
    assert(result.states.deleted.revision === 1 && result.states.deleted.undo === 1, 'Normal Delete did not produce exactly one Project/History edit');
    result.passed = true;
    console.log(JSON.stringify(result));
  } catch (error) {
    result.failure = String(error);
    result.states.failure = await state(window);
    await capture(window, 'failure.png');
    throw error;
  } finally {
    writeFileSync(path.join(acceptanceRoot, 'results.json'), JSON.stringify(result, null, 2));
    window.destroy();
  }
}
run().then(() => app.exit(0)).catch((error) => { console.error(error); app.exit(1); });

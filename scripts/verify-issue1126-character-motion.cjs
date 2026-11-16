/* Focused Electron renderer interaction evidence, not OWNER or V0-04 UAT. */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const evidenceRoot = path.join('D:/PandaStage-Acceptance/issue1126', new Date().toISOString().replaceAll(':', '-'));
let server, window, failed = false;
const errors = [];
app.on('window-all-closed', () => {});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function page(code) { return window.webContents.executeJavaScript(code, true); }
async function wait(code) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { if (await page(code)) return; await delay(100); }
  throw new Error(`Timed out: ${code}`);
}
async function drag(kind, dx, dy) {
  const point = await page(`motionAcceptance.handle('${kind}')`);
  assert(point, `Missing ${kind} handle`);
  console.log(kind, JSON.stringify(point));
  const x = Math.round(point.x), y = Math.round(point.y);
  window.webContents.sendInputEvent({ type: 'mouseMove', x, y });
  window.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  for (let step = 1; step <= 12; step++) {
    window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x + dx * step / 12), y: Math.round(y + dy * step / 12), button: 'left' });
    await delay(30);
  }
  window.webContents.sendInputEvent({ type: 'mouseUp', x: x + dx, y: y + dy, button: 'left', clickCount: 1 });
  await delay(150);
}
(async () => {
  await app.whenReady(); await fs.mkdir(evidenceRoot, { recursive: true });
  const { createServer } = await import('vite');
  server = await createServer({ root: process.cwd(), server: { port: 5196, strictPort: true }, plugins: [{
    name: 'issue1126-harness', configureServer(devServer) {
      devServer.middlewares.use('/__motion', async (_request, response) => {
        response.setHeader('Content-Type', 'text/html');
        response.end(await devServer.transformIndexHtml('/__motion', '<html><div id="root"></div><script>window.motionErrors=[];window.addEventListener("error",e=>window.motionErrors.push(e.message));window.addEventListener("unhandledrejection",e=>window.motionErrors.push(String(e.reason)));</script><script type="module" src="/tests/electron/character-motion-harness.tsx"></script></html>'));
      });
    },
  }] });
  await server.listen();
  window = new BrowserWindow({ width: 1320, height: 1000, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  window.webContents.on('console-message', event => { if (event.level === 'error' || event.level === 3) errors.push(event.message); });
  await window.loadURL('http://127.0.0.1:5196/__motion');
  await wait('Boolean(window.motionAcceptance && document.querySelector("select[aria-label=人物动作部件]"))');
  await page(`(() => { const select = document.querySelector('select[aria-label="人物动作部件"]'); select.value = motionAcceptance.fixture.graphicPartId; select.dispatchEvent(new Event('change', {bubbles:true})); motionAcceptance.seek(500); })()`);
  await wait('Boolean(motionAcceptance.handle("move"))');
  await page(`document.querySelector('.character-motion-controls button').click()`);
  await wait(`document.querySelector('.character-motion-controls button').getAttribute('aria-pressed') === 'true'`);
  await fs.writeFile(path.join(evidenceRoot, 'before.png'), (await window.webContents.capturePage()).toPNG());
  const results = [];
  for (const [kind, dx, dy] of [['move', 30, 20], ['rotate', 35, 10], ['scale', 30, 0]]) {
    const before = await page('motionAcceptance.inspect()');
    await drag(kind, dx, dy);
    const after = await page('motionAcceptance.inspect()');
    assert.equal(after.history.undoCount, before.history.undoCount + 1, `${kind}: exactly one Undo`);
    await page('motionAcceptance.undo()');
    const undone = await page('motionAcceptance.inspect()'); assert.deepEqual(undone.project, before.project);
    await page('motionAcceptance.redo()');
    const redone = await page('motionAcceptance.inspect()'); assert.deepEqual(redone.project, after.project);
    await page('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    results.push({ kind, undoCount: after.history.undoCount });
  }
  const current = await page('motionAcceptance.inspect()');
  const layer = current.project.shots[0].layers.find(layer => layer.id === current.selectedPartId || layer.animationClip);
  assert.deepEqual(new Set(layer.animationClip.tracks.map(track => track.property)), new Set(['transform.offsetX', 'transform.offsetY', 'transform.rotationDeg', 'transform.scaleX', 'transform.scaleY']));
  assert.equal(await page(`document.querySelector('[data-testid="character-motion-key-state"]').textContent`), '◆');
  await fs.writeFile(path.join(evidenceRoot, 'after.png'), (await window.webContents.capturePage()).toPNG());
  await page('motionAcceptance.singleImage()');
  await page('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await page(`(() => { const select = document.querySelector('select[aria-label="人物动作部件"]'); select.value = motionAcceptance.fixture.imagePartId; select.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  await wait('Boolean(motionAcceptance.handle("move"))');
  await drag('move', 25, 15);
  const image = await page('motionAcceptance.inspect()');
  assert.equal(image.history.undoCount, 1, 'single Image Part uses the same gesture path');
  const imageLayer = image.project.shots[0].layers.find(layer => layer.animationClip);
  assert.deepEqual(imageLayer.animationClip.tracks.map(track => track.property), ['transform.offsetX', 'transform.offsetY']);
  await page(`document.querySelector('.character-motion-controls button').click()`);
  await page('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await drag('move', 20, 10);
  const off = await page('motionAcceptance.inspect()');
  assert.deepEqual(off.project.shots, image.project.shots, 'Auto-Key OFF does not change Clip/Tracks/Keys');
  assert.notDeepEqual(off.project.characters, image.project.characters, 'Auto-Key OFF uses static Character editing');
  results.push({ kind: 'single-image-move', undoCount: image.history.undoCount }, { kind: 'auto-key-off', undoCount: off.history.undoCount });
  errors.push(...await page('window.motionErrors'));
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(evidenceRoot, 'result.json'), JSON.stringify({ status: 'PASS', results, layer, errors }, null, 2));
  console.log(`PASS: ${evidenceRoot}`);
})().catch(async error => {
  console.error(error); await fs.mkdir(evidenceRoot, { recursive: true });
  const state = await page('({ state: window.motionAcceptance?.inspect(), html: document.body.innerHTML })').catch(() => null);
  await fs.writeFile(path.join(evidenceRoot, 'failure.json'), JSON.stringify({ error: String(error), errors, state }, null, 2));
  if (window) await fs.writeFile(path.join(evidenceRoot, 'failure.png'), (await window.webContents.capturePage()).toPNG());
  console.error(`Evidence: ${evidenceRoot}`); failed = true;
}).finally(async () => { window?.destroy(); await server?.close(); app.exit(failed ? 1 : 0); });

/* Focused Electron renderer interaction evidence, not OWNER or V0-04 UAT. */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const issue1128 = process.argv.includes('--issue1128');
const evidenceRoot = path.join(`D:/PandaStage-Acceptance/issue${issue1128 ? '1128' : '1126'}`, new Date().toISOString().replaceAll(':', '-'));
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
async function paintReady() {
  await wait(`(() => {const stage=document.querySelector('[data-testid="project-canvas-stage"]');return stage?.dataset.backgroundReady==='true' && JSON.parse(stage.dataset.targetReadyLayerIds||'[]').includes(motionAcceptance.fixture.layerId);})()`);
  await page('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
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
async function inspectorEdit(label, value) {
  await page(`(() => { const input = document.querySelector('[data-testid="character-part-transform-panel"] input[aria-label="${label}"]'); input.focus(); input.select(); })()`);
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'A',modifiers:['control']});
  window.webContents.sendInputEvent({type:'keyUp',keyCode:'A',modifiers:['control']});
  window.webContents.insertText(value); await delay(80);
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'Return'});
  window.webContents.sendInputEvent({type:'keyUp',keyCode:'Return'}); await delay(150);
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
  const uxResults = [];
  if (issue1128) for (const source of ['image','graphic']) {
    await page('motionAcceptance.reset(); motionAcceptance.clearSelection()'); await paintReady();
    const point = await page(`motionAcceptance.partPoint('${source}')`);
    console.log('direct selection',source,JSON.stringify(point));
    assert(point, `${source} has a direct Canvas hit target`);
    assert(point.hitPath.some(n=>n.name==='character-motion-part'),'The live hit graph identifies the Part');
    const x=Math.round(point.x),y=Math.round(point.y);
    window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x,y});
    window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x,y});
    await wait(`Boolean(document.querySelector('[data-testid="character-part-transform-panel"]'))`);
    const expectedName = source==='image'?'右手':'配件';
    const context = await page(`({part:motionAcceptance.inspect().selectedPartId,top:document.querySelector('select[aria-label="人物动作部件"]').selectedOptions[0].textContent,lane:document.querySelector('.character-motion-lane .timeline-lane-label').textContent,inspector:document.querySelector('[data-testid="right-inspector-part-context"]').textContent,layerFields:Boolean(document.querySelector('[data-testid="layer-transform-rotation"]')),isolatedDiamond:Boolean(document.querySelector('[data-testid="character-motion-key-state"]'))})`);
    assert.equal(context.top,expectedName);assert.equal(context.lane,expectedName);assert(context.inspector.includes(expectedName));
    assert.equal(context.layerFields,false);assert.equal(context.isolatedDiamond,false);
    assert.equal((await page('motionAcceptance.inspect()')).history.undoCount,0,'Selection is read-only');
    await page('motionAcceptance.seek(500)');
    assert.equal(await page(`document.querySelector('.character-motion-controls button').textContent`),'自动关键帧');
    await page(`document.querySelector('.character-motion-controls button').click()`);
    const before=await page('motionAcceptance.inspect()');
    await inspectorEdit('旋转 °','90');
    const after=await page('motionAcceptance.inspect()');
    assert.equal(after.history.undoCount,before.history.undoCount+1,'Inspector Enter is exactly one command');
    const layer=after.project.shots[0].layers.find(l=>l.animationClip);
    assert.deepEqual(layer.animationClip.tracks.map(t=>t.property),['transform.rotationDeg']);
    assert.equal(layer.animationClip.tracks[0].keys.at(-1).value,90);
    await page('motionAcceptance.undo()');assert.deepEqual((await page('motionAcceptance.inspect()')).project,before.project);
    await page('motionAcceptance.redo()');assert.deepEqual((await page('motionAcceptance.inspect()')).project,after.project);
    await inspectorEdit('缩放 %','125');
    const scaled=await page('motionAcceptance.inspect()');
    const scales=scaled.project.shots[0].layers.find(l=>l.animationClip).animationClip.tracks.filter(t=>t.property.startsWith('transform.scale'));
    assert.deepEqual(scales.map(t=>t.keys.at(-1).value),[1.25,1.25]);
    await page(`document.querySelector('.character-motion-controls button').click()`);
    await inspectorEdit('位置 X','40');
    const off=await page('motionAcceptance.inspect()');
    assert.deepEqual(off.project.shots,scaled.project.shots,'OFF Inspector keeps Clip/Tracks/Keys unchanged');
    assert.notDeepEqual(off.project.characters,scaled.project.characters);
    await paintReady();
    await fs.writeFile(path.join(evidenceRoot,`${source}-part-inspector.png`),(await window.webContents.capturePage()).toPNG());
    await page(`(() => {const select=document.querySelector('select[aria-label="人物动作部件"]');select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await wait(`Boolean(document.querySelector('[data-testid="layer-transform-rotation"]'))`);
    assert.equal(await page('motionAcceptance.handle("rotate")'),null,'Returning to Layer hides Part handles');
    uxResults.push({source,context,inspectorUndoCount:after.history.undoCount,uniformScale:scales.map(t=>t.keys.at(-1).value),off:'PASS'});
  }
  if(issue1128) await page('motionAcceptance.reset()');
  await page(`(() => { const select = document.querySelector('select[aria-label="人物动作部件"]'); select.value = motionAcceptance.fixture.graphicPartId; select.dispatchEvent(new Event('change', {bubbles:true})); motionAcceptance.seek(500); })()`);
  await wait('Boolean(motionAcceptance.handle("move"))');
  await page(`document.querySelector('.character-motion-controls button').click()`);
  await wait(`document.querySelector('.character-motion-controls button').getAttribute('aria-pressed') === 'true'`);
  await paintReady();
  await fs.writeFile(path.join(evidenceRoot, 'before.png'), (await window.webContents.capturePage()).toPNG());
  const results = [...uxResults];
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
  assert.equal(await page(`document.querySelector('.character-motion-keys button[aria-current="true"]').textContent`), '◆');
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
  for(const [kind,dx,dy] of [['rotate',35,10],['scale',25,0]]) {
    const before=await page('motionAcceptance.inspect()');
    await drag(kind,dx,dy);
    const after=await page('motionAcceptance.inspect()');
    assert.equal(after.history.undoCount,before.history.undoCount+1,`Image ${kind}: one command`);
    await page('motionAcceptance.undo()');assert.deepEqual((await page('motionAcceptance.inspect()')).project,before.project);
    await page('motionAcceptance.redo()');assert.deepEqual((await page('motionAcceptance.inspect()')).project,after.project);
    results.push({kind:`single-image-${kind}`,undoCount:after.history.undoCount});
  }
  const imageBaseline=await page('motionAcceptance.inspect()');
  await page(`document.querySelector('.character-motion-controls button').click()`);
  await page('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await drag('move', 20, 10);
  const off = await page('motionAcceptance.inspect()');
  assert.deepEqual(off.project.shots, imageBaseline.project.shots, 'Auto-Key OFF does not change Clip/Tracks/Keys');
  assert.notDeepEqual(off.project.characters, imageBaseline.project.characters, 'Auto-Key OFF uses static Character editing');
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

const { app, ipcMain } = require('electron');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const path = require('node:path');
const { createMainWindow } = require('../dist-electron/main/windows/main-window.js');
const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');
const { migrateProject } = require('../dist-electron/domain/migrations/index.js');
const { ProjectSchema } = require('../dist-electron/domain/models/project.js');

// Real sandboxed React + Preload interaction, isolated fixture IPC only.
// Does not stand in for human touch hardware or listening acceptance.
const root = 'D:\\PandaStage-Acceptance\\issue663-dialogue-voice';
mkdirSync(root, { recursive: true });
app.setPath('userData', path.join(root, 'user-data'));
process.env.VITE_DEV_SERVER_URL = '';
app.on('window-all-closed', () => {});
const projectRoot = path.join(root, 'fixture.pandastage');
const project = migrateProject(require('../demo-project/project-v1.example.json'));
project.shots = [project.shots[0]];
const shot = project.shots[0];
shot.durationMs = 4000;
shot.timelineEvents = [];
project.assets = project.assets.filter(a => a.kind !== 'audio');
const png = readFileSync(path.join(__dirname, '../public/probe/panda-character.png'));
const waves = new Map();
function wave(frequency) {
  const rate = 48000, samples = rate * 3, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(1000 * Math.sin(2 * Math.PI * frequency * i / rate)), 44 + i * 2);
  return bytes;
}
for (let i = 1; i <= 4; i++) {
  const bytes = wave(220 * i);
  const asset = { id: `10000000-0000-4000-8000-00000000066${i}`, kind: 'audio', name: ['配音甲', '配音乙', '未分析音频', '无法读取音频'][i - 1],
    relativePath: `assets/voice-${i}.wav`, mimeType: 'audio/wav', sha256: createHash('sha256').update(bytes).digest('hex') };
  if (i !== 3) asset.durationMs = 3000;
  if (i < 3) asset.metadata = { status: 'ready', warnings: [] };
  if (i === 4) asset.metadata = { status: 'error', code: 'ASSET_METADATA_FILE_UNREADABLE', message: 'Fixture unavailable' };
  project.assets.push(asset); waves.set(asset.id, bytes);
  mkdirSync(path.join(projectRoot, 'assets'), { recursive: true });
  writeFileSync(path.join(projectRoot, asset.relativePath), bytes);
}
const audioAssets = project.assets.filter(a => a.kind === 'audio');
shot.audioClips = ['bgm', 'sfx'].map((role, i) => ({ id: `70000000-0000-4000-8000-00000000066${i + 1}`, role,
  name: role, assetId: audioAssets[i].id, startMs: 0, endMs: 3000, offsetMs: 0, volume: 1 }));
shot.dialogues = [{ ...shot.dialogues[0], startMs: 500, endMs: 2500, text: '配音选择交互回归' }];
delete shot.dialogues[0].audioClipId;
for (const asset of project.assets) if (asset.kind === 'image') {
  asset.width = png.readUInt32BE(16); asset.height = png.readUInt32BE(20);
  asset.sha256 = createHash('sha256').update(png).digest('hex');
  const target = path.join(projectRoot, asset.relativePath);
  mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, png);
}
ProjectSchema.parse(project);
writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2));
const documentFor = () => ({ projectRoot, projectFilePath: path.join(projectRoot, 'project.json'), project, migrated: false, sourceVersion: project.schemaVersion });
let authored = project;
const register = (channel, handler) => ipcMain.handle(IPC_CHANNELS[channel], handler);
register('PROJECT_OPEN', () => ({ ok: true, value: documentFor() }));
register('RECENT_PROJECTS_LIST', () => ({ ok: true, entries: [{ projectId: project.id, projectName: project.name, projectRoot, lastOpenedAt: new Date().toISOString(), status: 'available' }] }));
register('RECENT_PROJECTS_OPEN', () => ({ ok: true, document: documentFor() }));
for (const channel of ['AUTOSAVE_TRACK', 'AUTOSAVE_UPDATE']) register(channel, (_e, request) => { authored = request.project; return { ok: true }; });
register('AUTOSAVE_STOP', () => ({ ok: true }));
register('RECOVERY_DETECT', () => ({ ok: true, candidate: null }));
register('ASSET_THUMBNAIL_READ', (_e, r) => ({ ok: true, status: 'ready', assetId: r.assetId, dataUrl: `data:image/png;base64,${png.toString('base64')}` }));
register('ASSET_CANVAS_IMAGE_READ', (_e, r) => {
  const asset = project.assets.find(a => a.id === r.assetId);
  return { ok: true, status: 'ready', assetId: asset.id, mimeType: 'image/png', width: asset.width, height: asset.height, byteLength: png.length, bytes: new Uint8Array(png) };
});
register('ASSET_PREVIEW_AUDIO_READ', (_e, r) => {
  const bytes = waves.get(r.assetId);
  return { ok: true, status: 'ready', assetId: r.assetId, mimeType: 'audio/wav', byteLength: bytes.length, bytes: new Uint8Array(bytes) };
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };
let win;
const js = code => win.webContents.executeJavaScript(code, true);
async function wait(expression) {
  await js(`(async () => { const end = Date.now()+15000; while (Date.now()<end) { if (${expression}) return; await new Promise(r=>setTimeout(r,40)); } throw new Error(${JSON.stringify(expression)}); })()`);
}
async function activate(selector, touch = true) {
  const point = await js(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('Missing control'); el.scrollIntoView({block:'nearest'}); const r=el.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; })()`);
  if (touch) {
    await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  }
  await pause(180);
}
function boundClip() {
  const current = authored.shots[0];
  return current.audioClips.find(c => c.id === current.dialogues[0].audioClipId);
}
async function historyKey(key) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: ['control'] });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: ['control'] });
  await pause(200);
}
async function historyCount() {
  return js(`Number(document.querySelector('[data-testid="history-controls"]').dataset.undoCount)`);
}
async function assertBound(asset, count) {
  await wait(`document.querySelector('[data-testid="dialogue-inspector-audio-summary"]')?.textContent.includes(${JSON.stringify(asset.name)})`);
  await pause(200);
  assert(boundClip()?.role === 'dialogue' && boundClip()?.assetId === asset.id, 'Wrong Dialogue binding');
  assert(authored.shots[0].audioClips.filter(c => c.role === 'dialogue').length === 1, 'Duplicate/orphan Dialogue clips');
  assert(await historyCount() === count, 'Action is not exactly one History command');
}
async function run() {
  await app.whenReady(); win = await createMainWindow({ show: false });
  win.setContentSize(1280, 800); win.setAlwaysOnTop(true); win.show(); win.focus();
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const result = { issue: 663, passed: false, nativeFailure: 'Separate pre-fix Windows reproduction: injected touch opens native popup but option tap does not bind; keyboard succeeds. Hardware root cause still requires maintainer confirmation.' };
  try {
    await wait(`document.querySelector('[data-task4-core="recent-open"]')`);
    await activate('[data-task4-core="recent-open"]', false);
    await wait(`document.querySelector('[data-testid="dialogue-clip"]')`);
    await activate('[data-testid="dialogue-clip"]', false);
    await activate('[data-testid="right-activity-rail-properties"]', false);
    await wait(`document.querySelector('[data-testid="dialogue-inspector-audio"]')`);
    assert(await js(`document.querySelector('.editor-shell').dataset.editorDeviceMode === 'cloud-touch' && document.querySelector('.editor-shell').dataset.editorShellLayout === 'landscape'`), 'Not landscape Cloud Touch');
    const baseline = await historyCount();
    await activate('[data-testid="dialogue-inspector-audio"]');
    await wait(`document.querySelectorAll('[data-testid="dialogue-inspector-audio-option"]').length === 4`);
    await wait(`(() => { const list=document.querySelector('[data-testid="dialogue-inspector-audio-options"]'); const r=list.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()`);
    const options = await js(`([...document.querySelectorAll('[data-testid="dialogue-inspector-audio-option"]')].map(el => ({ name:el.textContent, disabled:el.disabled })))`);
    result.options = options;
    assert(options.length === 4 && options[0].name.includes('可用') && options[0].name.includes('00:03.000'), 'Missing names/readiness/duration');
    assert(options[2].disabled && options[2].name.includes('尚未准备好') && options[3].disabled && options[3].name.includes('不可用'), 'Unavailable states not differentiated');
    writeFileSync(path.join(root, 'chooser.png'), (await win.webContents.capturePage()).toPNG());
    await activate(`[data-asset-id="${audioAssets[2].id}"][data-testid="dialogue-inspector-audio-option"]`);
    assert(!boundClip() && await historyCount() === baseline, 'Unanalysed asset bound');
    await activate(`[data-asset-id="${audioAssets[3].id}"][data-testid="dialogue-inspector-audio-option"]`);
    assert(!boundClip() && await historyCount() === baseline, 'Unavailable asset bound');
    await activate(`[data-asset-id="${audioAssets[0].id}"][data-testid="dialogue-inspector-audio-option"]`);
    await assertBound(audioAssets[0], baseline + 1);
    const clipId = boundClip().id;
    await historyKey('z');
    assert(!boundClip() && await historyCount() === baseline, 'One Undo did not remove binding');
    await historyKey('y'); await assertBound(audioAssets[0], baseline + 1);
    await activate('[data-testid="dialogue-inspector-audio"]', false);
    await activate(`[data-asset-id="${audioAssets[1].id}"][data-testid="dialogue-inspector-audio-option"]`, false);
    await assertBound(audioAssets[1], baseline + 2);
    assert(boundClip().id === clipId, 'Change orphaned old clip');
    await historyKey('z'); await assertBound(audioAssets[0], baseline + 1);
    await historyKey('y'); await assertBound(audioAssets[1], baseline + 2);
    await activate('[data-testid="dialogue-inspector-audio-unbind"]');
    assert(!boundClip() && !authored.shots[0].audioClips.some(c => c.role === 'dialogue'), 'Remove left orphan');
    assert(await historyCount() === baseline + 3, 'Remove created multiple commands');
    await historyKey('z'); await assertBound(audioAssets[1], baseline + 2);
    await historyKey('y'); assert(!boundClip(), 'Redo did not remove binding');
    assert(isDeepStrictEqual(authored.assets, project.assets), 'Removed/mutated source assets');
    assert(isDeepStrictEqual(authored.shots[0].audioClips, shot.audioClips), 'BGM/SFX changed');
    await activate('[data-testid="dialogue-inspector-audio"]');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await pause(150);
    assert(await js(`document.querySelector('[data-testid="dialogue-inspector-audio"]').getAttribute('aria-expanded') === 'false'`), 'Escape did not dismiss chooser');
    result.options = options; result.passed = true;
    writeFileSync(path.join(root, 'passed.png'), (await win.webContents.capturePage()).toPNG());
    writeFileSync(path.join(root, 'results.json'), JSON.stringify(result, null, 2));
    console.log('PASS #663 real Dialogue chooser touch/mouse + binding/change/remove + History + unavailable assets + BGM/SFX:', root);
    win.destroy(); app.exit(0);
  } catch (error) {
    result.error = String(error.stack ?? error);
    writeFileSync(path.join(root, 'results.json'), JSON.stringify(result, null, 2));
    writeFileSync(path.join(root, 'failure.png'), (await win.webContents.capturePage()).toPNG());
    console.error(result.error); win.destroy(); app.exit(1);
  }
}
run().catch(error => { console.error(error); app.exit(1); });

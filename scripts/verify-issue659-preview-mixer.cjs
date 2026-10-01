const { app, ipcMain } = require('electron');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { createMainWindow } = require('../dist-electron/main/windows/main-window.js');
const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');
const { migrateProject } = require('../dist-electron/domain/migrations/index.js');

// Native Web Audio + real sandboxed renderer/Preload. Isolated, not human listening acceptance.
const root = 'D:\\PandaStage-Acceptance\\issue659-preview-mixer';
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
const png = readFileSync(path.join(__dirname, '../public/probe/panda-character.png'));
function wav(frequency) {
  const rate = 48000, samples = rate * 3;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) bytes.writeInt16LE(Math.round(0.04 * 32767 * Math.sin(2 * Math.PI * frequency * index / rate)), 44 + index * 2);
  return bytes;
}
const audioBytes = new Map();
project.assets = project.assets.filter(asset => asset.kind !== 'audio');
shot.audioClips = [];
for (const [index, role, startMs, endMs, offsetMs, volume] of [
  [1, 'dialogue', 500, 2500, 100, 0.75], [2, 'bgm', 0, 3000, 0, 0.25],
  [3, 'sfx', 600, 2200, 200, 1.8], [4, 'sfx', 700, 2400, 300, 2],
]) {
  const id = `10000000-0000-4000-8000-00000000065${index}`;
  const bytes = wav(220 * index);
  const asset = { id, kind: 'audio', name: `${role}-${220 * index}Hz`, relativePath: `assets/${role}-${index}.wav`,
    sha256: createHash('sha256').update(bytes).digest('hex'), mimeType: 'audio/wav', durationMs: 3000,
    metadata: { status: 'ready', warnings: [] } };
  project.assets.push(asset); audioBytes.set(id, bytes);
  shot.audioClips.push({ id: `70000000-0000-4000-8000-00000000065${index}`, assetId: id, role, name: asset.name,
    startMs, endMs, offsetMs, volume });
  mkdirSync(path.join(projectRoot, 'assets'), { recursive: true });
  writeFileSync(path.join(projectRoot, asset.relativePath), bytes);
}
shot.dialogues = [{ ...shot.dialogues[0], startMs: 500, endMs: 2500, audioClipId: shot.audioClips[0].id, text: '只有对白驱动字幕和嘴型' }];
for (const asset of project.assets) if (asset.kind === 'image') {
  asset.width = png.readUInt32BE(16); asset.height = png.readUInt32BE(20);
  asset.sha256 = createHash('sha256').update(png).digest('hex');
  const target = path.join(projectRoot, asset.relativePath);
  mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, png);
}
require('../dist-electron/domain/models/project.js').ProjectSchema.parse(project);
writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2));
const documentFor = () => ({ projectRoot, projectFilePath: path.join(projectRoot, 'project.json'), project, migrated: false, sourceVersion: project.schemaVersion });
const register = (channel, handler) => ipcMain.handle(IPC_CHANNELS[channel], handler);
register('PROJECT_OPEN', () => ({ ok: true, value: documentFor() }));
register('RECENT_PROJECTS_LIST', () => ({ ok: true, entries: [{ projectId: project.id, projectName: project.name, projectRoot, lastOpenedAt: new Date().toISOString(), status: 'available' }] }));
register('RECENT_PROJECTS_OPEN', () => ({ ok: true, document: documentFor() }));
for (const channel of ['AUTOSAVE_TRACK', 'AUTOSAVE_UPDATE', 'AUTOSAVE_STOP']) register(channel, () => ({ ok: true }));
register('RECOVERY_DETECT', () => ({ ok: true, candidate: null }));
register('ASSET_THUMBNAIL_READ', (_event, request) => ({ ok: true, status: 'ready', assetId: request.assetId, dataUrl: `data:image/png;base64,${png.toString('base64')}` }));
register('ASSET_CANVAS_IMAGE_READ', (_event, request) => {
  const asset = project.assets.find(asset => asset.id === request.assetId);
  return { ok: true, status: 'ready', assetId: asset.id, mimeType: 'image/png', width: asset.width, height: asset.height, byteLength: png.length, bytes: new Uint8Array(png) };
});
let audioReads = 0;
register('ASSET_PREVIEW_AUDIO_READ', (_event, request) => {
  audioReads++;
  const bytes = audioBytes.get(request.assetId);
  return { ok: true, status: 'ready', assetId: request.assetId, mimeType: 'audio/wav', byteLength: bytes.length, bytes: new Uint8Array(bytes) };
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };
let win;
const js = code => win.webContents.executeJavaScript(code, true);
async function wait(expression) {
  await js(`(async () => { const end = Date.now() + 15000; while (Date.now() < end) { if (${expression}) return; await new Promise(resolve => setTimeout(resolve,40)); } throw new Error(${JSON.stringify(expression)}); })()`);
}
async function click(selector) { await js(`document.querySelector(${JSON.stringify(selector)}).click()`); await pause(80); }
async function seek(timeMs) {
  await js(`(() => { const input = document.querySelector('[data-testid="product-preview-scrubber"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(String(timeMs))});
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await pause(100);
}
async function audioState() {
  return js(`(() => {
    const probe = window.__mixerProbe;
    const voices = probe.sources.filter(source => !source.stopped);
    const context = probe.contexts[0];
    const bins = new Float32Array(context?.analyser.frequencyBinCount ?? 0);
    if (context) context.analyser.getFloatFrequencyData(bins);
    return { contexts: probe.contexts.length, active: voices.length, closed: probe.contexts.map(context => context.state),
      starts: voices.map(source => source.args), gains: voices.map(source => source.gain?.gain.value),
      frequencies: [220,440,660,880].map(frequency => {
        const bin = Math.round(frequency * 4096 / (context?.sampleRate ?? 48000));
        return Math.max(...bins.slice(Math.max(0,bin-1),bin+2));
      }), warning: document.querySelector('[data-testid="product-preview-audio-warning"]')?.textContent ?? null };
  })()`);
}
async function run() {
  await app.whenReady();
  win = await createMainWindow({ show: false }); win.setContentSize(1280,800); win.show(); win.focus();
  const result = { issue: 659, passed: false, states: {} };
  try {
    await wait(`document.querySelector('[data-task4-core="recent-open"]')`); await click('[data-task4-core="recent-open"]');
    await wait(`document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.backgroundReady === 'true'`);
    const before = await js(`({ revision: document.querySelector('[data-testid="project-canvas-stage"]').dataset.projectRevision, undo: document.querySelector('[data-testid="history-controls"]').dataset.undoCount })`);
    // Observe native sources/gains and the mixed spectrum without substituting a fake decoder.
    await js(`(() => {
      const NativeContext = window.AudioContext;
      const probe = window.__mixerProbe = { contexts: [], sources: [] };
      window.AudioContext = class extends NativeContext {
        constructor(options) {
          super(options); probe.contexts.push(this);
          this.analyser = this.createAnalyser(); this.analyser.fftSize = 4096; this.analyser.smoothingTimeConstant = 0;
          this.analyser.connect(this.destination);
        }
        createBufferSource() {
          const source = super.createBufferSource(), info = { source, stopped: false };
          probe.sources.push(info);
          const start = source.start.bind(source), stop = source.stop.bind(source), connect = source.connect.bind(source);
          source.start = (...args) => { info.args = args; return start(...args); };
          source.stop = (...args) => { info.stopped = true; return stop(...args); };
          source.connect = destination => { info.gain = destination; return connect(destination); };
          source.addEventListener('ended', () => { info.stopped = true; }); return source;
        }
        createGain() {
          const gain = super.createGain(), connect = gain.connect.bind(gain);
          gain.connect = destination => connect(destination === this.destination ? this.analyser : destination);
          return gain;
        }
      };
    })()`);
    await click('[data-testid="quick-action-drawer-handle"]'); await click('[data-testid="quick-action-play"]');
    await wait(`document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewSurface === 'active'`);
    await seek(1000); await click('[data-testid="product-preview-play"]');
    await wait(`window.__mixerProbe.sources.filter(source => !source.stopped).length === 4`); await pause(120);
    result.states.overlap = await audioState();
    assert(result.states.overlap.contexts === 1 && result.states.overlap.active === 4, 'Not one graph with four overlapping sources');
    // Native AudioParam is float32, unlike the unit fake's JS number.
    assert(result.states.overlap.gains.slice().sort((a,b) => a-b).every((gain,index) => Math.abs(gain - [0.25,0.75,1.8,2][index]) < 1e-6), 'Lost per-clip full linear gain');
    assert(result.states.overlap.frequencies.every(level => level > -60), 'Native mixed waveform missing a frequency');
    assert(!result.states.overlap.warning, 'Unexpected native audio read/decode warning');
    writeFileSync(path.join(root,'overlap-preview.png'), (await win.webContents.capturePage()).toPNG());
    await seek(100);
    result.states.pausedSeek = await audioState(); assert(result.states.pausedSeek.active === 0, 'Seek left obsolete sources audible');
    await click('[data-testid="product-preview-play"]'); await pause(100);
    result.states.bgmOnly = await audioState(); assert(result.states.bgmOnly.active === 1, 'BGM depends on active Dialogue');
    await click('[data-testid="product-preview-pause"]');
    assert((await audioState()).active === 0, 'Pause retained source');
    await seek(1000); await click('[data-testid="product-preview-play"]');
    await wait(`window.__mixerProbe.sources.filter(source => !source.stopped).length === 4`);
    result.states.resumed = await audioState();
    await click('[data-testid="product-preview-stop"]'); assert((await audioState()).active === 0, 'Stop retained sources');
    await click('[data-testid="product-preview-replay"]'); await pause(100);
    result.states.replay = await audioState(); assert(result.states.replay.active === 1, 'Replay did not rebuild at zero');
    await click('[data-testid="product-preview-close"]'); await pause(100);
    result.states.closed = await audioState();
    assert(result.states.closed.active === 0 && result.states.closed.closed.every(state => state === 'closed'), 'Unmount leaked native session resources');
    const after = await js(`({ revision: document.querySelector('[data-testid="project-canvas-stage"]').dataset.projectRevision, undo: document.querySelector('[data-testid="history-controls"]').dataset.undoCount })`);
    assert(JSON.stringify(before) === JSON.stringify(after), 'Mixer changed Project/History');
    assert(audioReads === 4, 'Read/decode cache did not reuse four assets across transport actions');
    result.audioReads = audioReads; result.passed = true;
    writeFileSync(path.join(root,'results.json'), JSON.stringify(result,null,2));
    console.log('PASS #659 native Preview mixer:', root); win.destroy(); app.exit(0);
  } catch (error) {
    result.error = String(error.stack ?? error);
    writeFileSync(path.join(root,'results.json'), JSON.stringify(result,null,2));
    writeFileSync(path.join(root,'failure.png'), (await win.webContents.capturePage()).toPNG());
    console.error(result.error); win.destroy(); app.exit(1);
  }
}
run().catch(error => { console.error(error); app.exit(1); });

const { app, ipcMain } = require('electron');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { createMainWindow } = require('../dist-electron/main/windows/main-window.js');
const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');
const { migrateProject } = require('../dist-electron/domain/migrations/index.js');

// Isolated actual Windows Electron renderer / sandboxed Preload, not human acceptance.
const root = 'D:\\PandaStage-Acceptance\\issue658-inline-audio-controls';
mkdirSync(root, { recursive: true });
app.setPath('userData', path.join(root, 'user-data'));
process.env.VITE_DEV_SERVER_URL = '';
app.on('window-all-closed', () => {});
const projectRoot = path.join(root, 'fixture.pandastage');
const png = readFileSync(path.join(__dirname, '../public/probe/panda-character.png'));
const project = migrateProject(require('../demo-project/project-v1.example.json'));
project.shots = [project.shots[0]];
project.shots[0].durationMs = 10000;
const shot = project.shots[0];
const layer = shot.layers.find(candidate => candidate.source.kind === 'character');
shot.timelineEvents = [];
const audioAsset = project.assets.find(asset => asset.kind === 'audio');
audioAsset.durationMs = 2000;
audioAsset.metadata = { status: 'ready', warnings: [] };
audioAsset.name = '沙雕之歌_' + '很长的背景音乐文件名称_'.repeat(12) + '.wav';
shot.audioClips = [{ id: '70000000-0000-4000-8000-000000000658', assetId: audioAsset.id, name: 'Dialogue sample', role: 'dialogue', startMs: 100, endMs: 1100, offsetMs: 0, volume: 1 }];
shot.dialogues = [{ ...shot.dialogues[0], id: '80000000-0000-4000-8000-000000000658', characterId: project.characters[0].id, text: '对白保留', startMs: 100, endMs: 2100, audioClipId: shot.audioClips[0].id }];
for (const asset of project.assets) if (asset.kind === 'image') {
  asset.width = png.readUInt32BE(16); asset.height = png.readUInt32BE(20);
  asset.sha256 = createHash('sha256').update(png).digest('hex');
  const target = path.join(projectRoot, asset.relativePath);
  mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, png);
}
writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2));
const documentFor = () => ({ projectRoot, projectFilePath: path.join(projectRoot, 'project.json'), project, migrated: false, sourceVersion: project.schemaVersion });
require('../dist-electron/domain/models/project.js').ProjectSchema.parse(project);
const register = (channel, handler) => ipcMain.handle(IPC_CHANNELS[channel], handler);
register('PROJECT_OPEN', () => ({ ok: true, value: documentFor() }));
register('RECENT_PROJECTS_LIST', () => ({ ok: true, entries: [{ projectId: project.id, projectName: project.name, projectRoot, lastOpenedAt: new Date().toISOString(), status: 'available' }] }));
register('RECENT_PROJECTS_OPEN', () => ({ ok: true, document: documentFor() }));
let authored = project;
for (const name of ['AUTOSAVE_TRACK', 'AUTOSAVE_UPDATE']) register(name, (_event, request) => { authored = request.project; return { ok: true }; });
register('AUTOSAVE_STOP', () => ({ ok: true }));
register('RECOVERY_DETECT', () => ({ ok: true, candidate: null }));
register('ASSET_THUMBNAIL_READ', (_event, request) => ({ ok: true, status: 'ready', assetId: request.assetId, dataUrl: `data:image/png;base64,${png.toString('base64')}` }));
register('ASSET_CANVAS_IMAGE_READ', (_event, request) => {
  const asset = project.assets.find(candidate => candidate.id === request.assetId);
  return { ok: true, status: 'ready', assetId: asset.id, mimeType: 'image/png', width: asset.width, height: asset.height, byteLength: png.length, bytes: new Uint8Array(png) };
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (ok, message) => { if (!ok) throw new Error(message); };
let win;
const js = code => win.webContents.executeJavaScript(code);
async function wait(expression) {
  await js(`(async () => { const end = Date.now()+12000; while (Date.now()<end) { if (${expression}) return; await new Promise(resolve => setTimeout(resolve,40)); } throw new Error(${JSON.stringify(expression)}); })()`);
}
async function click(selector) { await js(`document.querySelector(${JSON.stringify(selector)}).click()`); await pause(100); }
async function state() {
  return js(`(() => {
    const q = s => document.querySelector(s), r = el => el.getBoundingClientRect().toJSON();
    const media = q('.timeline-media-lanes');
    return { revision: Number(q('[data-testid="project-canvas-stage"]').dataset.projectRevision),
      undo: Number(q('[data-testid="history-controls"]').dataset.undoCount),
      order: [...q('[data-testid="timeline-lanes"]').querySelectorAll('.timeline-lane')].map(el => el.dataset.trackKind ?? 'position'),
      bottom: r(q('[data-testid="bottom-workspace"]')), canvas: r(q('[data-testid="project-canvas-viewport"]')),
      scrollHeight: media.scrollHeight, clientHeight: media.clientHeight, overflow: getComputedStyle(media).overflowY,
      selected: q('[data-testid="standalone-audio-clip"][data-selected="true"]')?.dataset.audioClipId,
      rulers: document.querySelectorAll('[data-testid="timeline-ruler"]').length,
      playhead: Number(q('[data-testid="timeline-playhead"]').dataset.currentTime),
      clips: [...document.querySelectorAll('[data-testid="standalone-audio-clip"]')].map(el => ({ ...el.dataset })),
    };
  })()`);
}
async function capture(name) { writeFileSync(path.join(root, `${name}.png`), (await win.webContents.capturePage()).toPNG()); }
async function toolbarState() {
  return js(`(() => {
    const q = s => document.querySelector(s), r = el => el.getBoundingClientRect().toJSON();
    const controls = q('[data-testid="standalone-audio-controls"]'), header = q('[data-testid="timeline-toolbar"]');
    const identity = q('[data-testid="standalone-audio-identity"]'), zoom = q('.timeline-zoom');
    return {
      inline: controls?.parentElement === header,
      identity: identity?.textContent,
      ellipsis: identity ? getComputedStyle(identity).textOverflow : null,
      nameTruncated: identity ? identity.scrollWidth > identity.clientWidth : false,
      position: controls ? getComputedStyle(controls).position : null,
      header: r(header), controls: controls ? r(controls) : null, zoom: r(zoom),
      ruler: r(q('[data-testid="timeline-ruler"]')),
      beforeZoom: controls?.nextElementSibling === zoom,
    };
  })()`);
}
async function changeVolume(value) {
  await js(`(() => {
    const input = document.querySelector('[aria-label="音频片段音量"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(String(value))});
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await pause(60);
}
async function commitVolume() {
  await js(`document.querySelector('[aria-label="音频片段音量"]').dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }))`);
  await pause(180);
}
async function drop(role, time) {
  await js(`(() => {
    const content = document.querySelector('[data-testid="timeline-${role}-track"] .timeline-lane-content');
    const rect = content.getBoundingClientRect();
    const transfer = new DataTransfer(); transfer.setData('application/x-panda-stage-asset', ${JSON.stringify(JSON.stringify({ version: 2, type: 'audio', assetId: audioAsset.id }))});
    content.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.left + ${time} * rect.width / ${shot.durationMs} }));
  })()`);
  await pause(180);
}
async function point(selector) {
  return js(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect(); return { x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2) };
  })()`);
}
async function gesture(selector, dx, end = 'mouseUp') {
  const start = await point(selector);
  win.webContents.sendInputEvent({ type: 'mouseMove', ...start }); await pause(50);
  win.webContents.sendInputEvent({ type: 'mouseDown', ...start, button: 'left', clickCount: 1 });
  await pause(50);
  win.webContents.sendInputEvent({ type: 'mouseMove', x: start.x + dx, y: start.y }); await pause(80);
  const draft = await state();
  if (end === 'escape') { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); await pause(50); }
  win.webContents.sendInputEvent({ type: 'mouseUp', x: start.x + dx, y: start.y, button: 'left', clickCount: 1 });
  await pause(140);
  return draft;
}
async function run() {
  await app.whenReady();
  win = await createMainWindow({ show: false }); win.setContentSize(1280, 800); win.show(); win.focus(); win.webContents.focus();
  const result = { issue: 658, passed: false, states: {} };
  try {
    await wait(`document.querySelector('[data-task4-core="recent-open"]')`); await click('[data-task4-core="recent-open"]');
    await wait(`document.querySelector('[data-testid="timeline-bgm-track"]')`);
    await wait(`document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.backgroundReady === 'true'`);
    await pause(250);
    result.states.initial = await state(); const initial = result.states.initial;
    assert(initial.order.join(',') === 'subtitle,audio,sfx,bgm', 'Incorrect lane order without Position');
    assert(initial.rulers === 1 && initial.overflow === 'auto' && initial.scrollHeight > initial.clientHeight, 'Missing single ruler / vertical media viewport');
    const layerPoint = await js(`(() => { const v = document.querySelector('[data-testid="project-canvas-viewport"]'), r = v.getBoundingClientRect(), s = Number(v.dataset.displayScale); return { x: Math.round(r.left+Number(v.dataset.offsetX)+${layer.x}*s), y: Math.round(r.top+Number(v.dataset.offsetY)+${layer.y}*s) }; })()`);
    win.webContents.sendInputEvent({ type: 'mouseMove', ...layerPoint });
    win.webContents.sendInputEvent({ type: 'mouseDown', ...layerPoint, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', ...layerPoint, button: 'left', clickCount: 1 });
    await wait(`document.querySelector('[data-testid="position-lane"]')`);
    result.states.position = await state();
    assert(result.states.position.order.join(',') === 'position,subtitle,audio,sfx,bgm', 'Incorrect Position lane order');
    await capture('position-media-stack');
    await drop('audio', 1000);
    assert((await state()).revision === 0, 'Dialogue lane accepted generic audio drop');
    await drop('sfx', 1000);
    result.states.sfx = await state();
    result.states.sfxToolbar = await toolbarState();
    assert(result.states.sfxToolbar.inline && result.states.sfxToolbar.identity.startsWith('音效 · '), 'SFX identity / controls not inside Timeline Header');
    assert(result.states.sfx.revision === 1 && result.states.sfx.undo === 1 && result.states.sfx.selected, 'Drop did not select / commit once');
    let clip = authored.shots[0].audioClips.find(candidate => candidate.role === 'sfx');
    assert(Math.abs(clip.startMs - 1000) <= 1, 'Drop time disagrees with existing Timeline geometry');
    const selected = '[data-testid="standalone-audio-clip"][data-selected="true"]';
    const movedDraft = await gesture(selected, 60);
    assert(movedDraft.revision === 1 && movedDraft.undo === 1, 'Pointer draft created Project/History writes');
    assert((await state()).revision === 2 && (await state()).undo === 2, 'Move did not commit once');
    const beforeCancel = JSON.stringify(authored);
    await gesture(selected, -30, 'escape');
    assert(JSON.stringify(authored) === beforeCancel && (await state()).revision === 2, 'Escape did not discard draft');
    const startDraft = await gesture('[data-testid="standalone-audio-trim-start"]', 25);
    assert(startDraft.revision === 2 && (await state()).revision === 3, 'Trim-start commit count incorrect');
    clip = authored.shots[0].audioClips.find(candidate => candidate.role === 'sfx');
    assert(clip.offsetMs > 0, 'Trim-start did not advance source offset');
    const endDraft = await gesture('[data-testid="standalone-audio-trim-end"]', -25);
    assert(endDraft.revision === 3 && (await state()).revision === 4, 'Trim-end commit count incorrect');
    const beforeVolume = await state();
    await changeVolume(1.8);
    assert((await state()).revision === beforeVolume.revision, 'Volume draft committed before the interaction ended');
    await commitVolume();
    assert((await state()).undo === beforeVolume.undo + 1, 'One volume interaction did not create exactly one History command');
    assert(authored.shots[0].audioClips.find(candidate => candidate.role === 'sfx').volume === 1.8, 'Volume capped or did not commit');
    await capture('selected-sfx-controls');
    for (const [keyCode, expected] of [['Home', 0], ['End', 2]]) {
      const before = await state();
      await js(`document.querySelector('[aria-label="音频片段音量"]').focus()`);
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode }); await pause(180);
      assert(authored.shots[0].audioClips.find(candidate => candidate.role === 'sfx').volume === expected, `Volume endpoint ${expected} inaccessible`);
      assert((await state()).undo === before.undo + 1, 'Volume key edit did not create exactly one command');
    }
    for (const cancel of ['pointercancel', 'Escape']) {
      const before = await state();
      const oldVolume = authored.shots[0].audioClips.find(candidate => candidate.role === 'sfx').volume;
      await changeVolume(1.2);
      await js(`(() => {
        const input = document.querySelector('[aria-label="音频片段音量"]');
        input.dispatchEvent(${cancel === 'pointercancel'
          ? "new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })"
          : "new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })"});
      })()`); await pause(80);
      assert((await state()).revision === before.revision && authored.shots[0].audioClips.find(candidate => candidate.role === 'sfx').volume === oldVolume, `${cancel} committed the volume draft`);
      await js(`document.querySelector(${JSON.stringify(selected)}).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`); await pause(180);
      assert((await state()).revision === before.revision + 1, 'Fixture edit did not change revision after volume cancel');
      const nextVolume = cancel === 'pointercancel' ? 1.6 : 1.7;
      await changeVolume(nextVolume); await commitVolume();
      assert(authored.shots[0].audioClips.find(candidate => candidate.role === 'sfx').volume === nextVolume, `${cancel} retained volumeOrigin and swallowed the next edit`);
      assert((await state()).undo === before.undo + 2, `${cancel}: next volume edit did not commit exactly once`);
      result.states[cancel] = await state();
    }
    await drop('bgm', 4000);
    result.states.bgm = await state();
    result.states.bgmToolbar = await toolbarState();
    const bar = result.states.bgmToolbar;
    assert(bar.inline && bar.beforeZoom && bar.position === 'static', 'Selected audio controls remain a portal/fixed overlay or follow zoom');
    assert(bar.identity.startsWith('BGM · ') && bar.nameTruncated && bar.ellipsis === 'ellipsis', 'BGM identity did not update or long filename did not truncate');
    assert(bar.controls.top >= bar.header.top && bar.controls.bottom <= bar.header.bottom && bar.controls.left >= bar.header.left && bar.controls.right <= bar.zoom.left, 'Inline controls escaped / overlapped their Timeline Header');
    assert(bar.zoom.right <= bar.header.right && bar.header.right - bar.zoom.right <= 14, 'Zoom is no longer the far-right toolbar owner');
    assert(bar.controls.top >= initial.canvas.bottom && bar.controls.bottom <= bar.ruler.top, 'Audio controls overlap Canvas or ruler');
    assert(authored.shots[0].audioClips.some(candidate => candidate.role === 'bgm'), 'BGM drop missing');
    assert(result.states.bgm.bottom.height === initial.bottom.height && result.states.bgm.canvas.height === initial.canvas.height, 'New lanes / controls grew Timeline budget');
    await js(`document.querySelector('.timeline-media-lanes').scrollTop = 999`); await pause(100); await capture('bgm-vertical-access');
    await capture('selected-bgm-inline-header');
    const access = await js(`(() => { const q = s => document.querySelector(s), m = q('.timeline-media-lanes').getBoundingClientRect(), b = q('[data-testid="timeline-bgm-track"]').getBoundingClientRect(); return b.bottom <= m.bottom+1 && b.top >= m.top; })()`);
    assert(access, 'BGM lane is not vertically reachable');
    await click('[data-testid="timeline-zoom-in"]');
    await js(`(() => { const s = document.querySelector('[data-testid="timeline-ruler-scroll"]'); s.scrollLeft = 300; s.dispatchEvent(new Event('scroll', { bubbles: true })); })()`); await pause(180);
    const labels = await js(`(() => {
      const left = document.querySelector('[data-testid="timeline-ruler-scroll"]').getBoundingClientRect().left;
      return [...document.querySelectorAll('.timeline-media-lanes .timeline-lane-label')].every(el => Math.abs(el.getBoundingClientRect().left - left) < 2);
    })()`);
    assert(labels, 'Role labels did not follow the unique horizontal scroll owner');
    assert((await state()).playhead === initial.playhead, 'Clip gestures moved ruler playhead');
    await click('[aria-label="删除音频片段"]');
    assert(!authored.shots[0].audioClips.some(candidate => candidate.role === 'bgm'), 'Delete did not use standalone authoring');
    assert(await js(`!document.querySelector('[data-testid="standalone-audio-controls"]')`), 'Delete retained stale contextual controls');
    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))`); await pause(180);
    assert(authored.shots[0].audioClips.some(candidate => candidate.role === 'bgm'), 'Undo did not restore deleted clip');
    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }))`); await pause(180);
    assert(!authored.shots[0].audioClips.some(candidate => candidate.role === 'bgm'), 'Redo did not repeat deletion');
    assert(isDeepStrictEqual(authored.shots[0].dialogues, shot.dialogues), 'Dialogue workflow changed');
    assert(isDeepStrictEqual(authored.shots[0].audioClips.find(candidate => candidate.role === 'dialogue'), shot.audioClips[0]), 'Standalone editing changed Dialogue audio');
    result.states.final = await state(); result.passed = true;
    console.log(JSON.stringify(result));
  } catch (error) { result.failure = String(error); await capture('failure'); throw error; }
  finally { writeFileSync(path.join(root, 'results.json'), JSON.stringify(result, null, 2)); win.destroy(); }
}
run().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });

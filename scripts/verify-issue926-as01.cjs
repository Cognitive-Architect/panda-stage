const { app, clipboard, ipcMain } = require('electron');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const path = require('node:path');
const { createMainWindow } = require('../dist-electron/main/windows/main-window.js');
const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');
const { migrateProject } = require('../dist-electron/domain/migrations/index.js');
const { ProjectSchema } = require('../dist-electron/domain/models/project.js');

// Real sandboxed React + Preload UI flow with isolated fixture IPC and media.
// It verifies draft-only state in Electron but does not replace human Windows
// input-device acceptance.
const acceptanceRoot = 'D:\\PandaStage-Acceptance\\issue-926-as01-evidence';
const runId = new Date().toISOString().replace(/[:.]/gu, '-');
const root = path.join(acceptanceRoot, runId);
mkdirSync(root, { recursive: true });
app.setPath('userData', path.join(root, 'user-data'));
process.env.VITE_DEV_SERVER_URL = '';
app.on('window-all-closed', () => {});

const projectRoot = path.join(root, 'fixture.pandastage');
const project = migrateProject(require('../demo-project/project-v1.example.json'));
project.name = 'Issue 926 AS-01 acceptance fixture';
project.shots = [project.shots[0]];
const shot = project.shots[0];
shot.durationMs = 10_000;
shot.dialogues = [];
shot.audioClips = [];
shot.timelineEvents = [];
project.assets = project.assets.filter((asset) => asset.kind !== 'audio');

const panda = project.characters[0];
const tigerId = '20000000-0000-4000-8000-000000000901';
const tigerVoiceId = '30000000-0000-4000-8000-000000000901';
const tiger = {
  ...structuredClone(panda),
  id: tigerId,
  name: 'Tiger',
  defaultVoiceProfileId: tigerVoiceId,
  expressions: panda.expressions.map((expression, index) => ({
    ...expression,
    id: `21000000-0000-4000-8000-00000000090${index + 1}`,
  })),
};
tiger.defaultExpressionId = tiger.expressions[0].id;
project.characters.push(tiger);
project.voiceProfiles.push({
  ...structuredClone(project.voiceProfiles[0]),
  id: tigerVoiceId,
  name: 'Tiger Mandarin',
  characterId: tigerId,
});

const png = readFileSync(path.join(__dirname, '../public/probe/panda-character.png'));
const waves = new Map();
function wave(durationMs, frequency) {
  const rate = 8000;
  const samples = durationMs * (rate / 1000);
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    bytes.writeInt16LE(
      Math.round(1000 * Math.sin((2 * Math.PI * frequency * index) / rate)),
      44 + index * 2,
    );
  }
  return bytes;
}

mkdirSync(path.join(projectRoot, 'assets'), { recursive: true });
const sequenceAssets = [];
for (let sequence = 1; sequence <= 10; sequence += 1) {
  const role = sequence % 2 === 1 ? 'Panda' : 'Tiger';
  const durationMs = 1_000 + sequence * 113;
  const bytes = wave(durationMs, 180 + sequence * 17);
  const asset = {
    id: `11000000-0000-4000-8000-0000000009${String(sequence).padStart(2, '0')}`,
    kind: 'audio',
    name: `Sequence ${sequence} ${role}`,
    relativePath: `assets/${String(sequence).padStart(3, '0')}_${role}.wav`,
    mimeType: 'audio/wav',
    durationMs,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    metadata: { status: 'ready', warnings: [] },
  };
  project.assets.push(asset);
  sequenceAssets.push(asset);
  waves.set(asset.id, bytes);
  writeFileSync(path.join(projectRoot, asset.relativePath), bytes);
}
const manualAsset = {
  id: '11000000-0000-4000-8000-000000000999',
  kind: 'audio',
  name: 'Manual take',
  relativePath: 'assets/manual-take.wav',
  mimeType: 'audio/wav',
  durationMs: 2_500,
  metadata: { status: 'ready', warnings: [] },
};
const manualBytes = wave(manualAsset.durationMs, 523);
manualAsset.sha256 = createHash('sha256').update(manualBytes).digest('hex');
project.assets.push(manualAsset);
waves.set(manualAsset.id, manualBytes);
writeFileSync(path.join(projectRoot, manualAsset.relativePath), manualBytes);

for (const asset of project.assets) {
  if (asset.kind !== 'image') continue;
  asset.width = png.readUInt32BE(16);
  asset.height = png.readUInt32BE(20);
  asset.sha256 = createHash('sha256').update(png).digest('hex');
  const target = path.join(projectRoot, asset.relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, png);
}

ProjectSchema.parse(project);
writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2));
const documentFor = () => ({
  projectRoot,
  projectFilePath: path.join(projectRoot, 'project.json'),
  project,
  migrated: false,
  sourceVersion: project.schemaVersion,
});
let authored = project;
let autosaveUpdates = 0;
const register = (channel, handler) => ipcMain.handle(IPC_CHANNELS[channel], handler);
register('PROJECT_OPEN', () => ({ ok: true, value: documentFor() }));
register('RECENT_PROJECTS_LIST', () => ({
  ok: true,
  entries: [{
    projectId: project.id,
    projectName: project.name,
    projectRoot,
    lastOpenedAt: new Date().toISOString(),
    status: 'available',
  }],
}));
register('RECENT_PROJECTS_OPEN', () => ({ ok: true, document: documentFor() }));
for (const channel of ['AUTOSAVE_TRACK', 'AUTOSAVE_UPDATE']) {
  register(channel, (_event, request) => {
    if (channel === 'AUTOSAVE_UPDATE') autosaveUpdates += 1;
    authored = request.project;
    return { ok: true };
  });
}
register('AUTOSAVE_STOP', () => ({ ok: true }));
register('RECOVERY_DETECT', () => ({ ok: true, candidate: null }));
register('ASSET_THUMBNAIL_READ', (_event, request) => ({
  ok: true,
  status: 'ready',
  assetId: request.assetId,
  dataUrl: `data:image/png;base64,${png.toString('base64')}`,
}));
register('ASSET_CANVAS_IMAGE_READ', (_event, request) => {
  const asset = project.assets.find((candidate) => candidate.id === request.assetId);
  return {
    ok: true,
    status: 'ready',
    assetId: asset.id,
    mimeType: 'image/png',
    width: asset.width,
    height: asset.height,
    byteLength: png.length,
    bytes: new Uint8Array(png),
  };
});

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
let win;
const js = (code) => win.webContents.executeJavaScript(code, true);
async function wait(expression, timeoutMs = 15_000) {
  await js(`(async () => {
    const end = Date.now() + ${timeoutMs};
    while (Date.now() < end) {
      if (${expression}) return;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(${JSON.stringify(expression)});
  })()`);
}
async function activate(selector) {
  const point = await js(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Missing control: ' + ${JSON.stringify(selector)});
    element.scrollIntoView({ block: 'nearest' });
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  await pause(180);
}
async function inspect() {
  return js('window.__pandaStageIssue816Acceptance.inspect()');
}
async function useManualAudioAndDuration() {
  await js(`(() => {
    const select = document.querySelector('[data-testid="dialogue-batch-audio-1"]');
    if (!select) throw new Error('Missing first row audio selector');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, ${JSON.stringify(manualAsset.id)});
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait(`document.querySelector('[data-testid="dialogue-batch-line"]')?.dataset.audioAssetId === ${JSON.stringify(manualAsset.id)}`);
  await js(`(() => {
    const input = document.querySelector('[data-testid="dialogue-batch-duration-1"]');
    if (!input) throw new Error('Missing first row duration input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '0.5');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait(`document.querySelector('[data-testid="dialogue-batch-line"]')?.dataset.clipDurationMs === '500'`);
  await wait(`document.querySelector('[data-testid="dialogue-batch-duration-1"]')?.value === '0.5'`);
  await wait(`document.querySelector('.dialogue-batch-recognition-duration')?.textContent.includes('15.602')`);
  await pause(300);
}

async function run() {
  await app.whenReady();
  win = await createMainWindow({ show: false, issue816Acceptance: true });
  win.setContentSize(1360, 920);
  win.setAlwaysOnTop(true);
  win.show();
  win.focus();

  const result = {
    issue: 926,
    acceptance: 'AS-01 batch subtitle draft preview',
    runId,
    projectRoot,
    passed: false,
    evidence: [],
  };
  try {
    await wait(`document.querySelector('[data-task4-core="recent-open"]')`);
    await activate('[data-task4-core="recent-open"]');
    await wait(`document.querySelector('[data-testid="history-controls"]')`);
    await activate('[data-testid="right-activity-rail-subtitles"]');
    await wait(`document.querySelector('[data-testid="subtitle-workspace-empty-action"]')`);
    await activate('[data-testid="subtitle-workspace-empty-action"]');
    await wait(`document.querySelector('[data-testid="dialogue-authoring-tab-batch"]')`);
    await activate('[data-testid="dialogue-authoring-tab-batch"]');

    const baseline = await inspect();
    assert(baseline?.project?.shots?.[0]?.dialogues?.length === 0, 'Fixture must begin with an empty dialogue list');
    assert(baseline?.project?.shots?.[0]?.audioClips?.length === 0, 'Fixture must begin without audio clips');
    const baselineFingerprint = JSON.stringify(baseline.project);
    const baselineAutosaveUpdates = autosaveUpdates;

    const sourceText = sequenceAssets.map((asset, index) => {
      const role = index % 2 === 0 ? 'Panda' : 'Tiger';
      return `${role}: AS-01 dialogue row ${index + 1}`;
    }).join('\n');
    clipboard.writeText(sourceText);
    await activate('[data-testid="dialogue-batch-input"]');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'V', modifiers: ['control'] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'V', modifiers: ['control'] });
    await wait(`document.querySelectorAll('[data-testid="dialogue-batch-line"]').length === 10`);
    await wait(`document.querySelector('[data-testid="dialogue-batch-generation-state"]')?.textContent.includes('10')`);

    const previewRows = await js(`([...document.querySelectorAll('[data-testid="dialogue-batch-line"]')].map((element) => ({
      sourceLineNumber: Number(element.querySelector('.dialogue-batch-row-number')?.textContent.match(/\\d+/)?.[0]),
      audioAssetId: element.dataset.audioAssetId,
      sourceDurationMs: Number(element.dataset.sourceDurationMs),
      clipDurationMs: Number(element.dataset.clipDurationMs),
      status: element.dataset.status,
      selectValue: element.querySelector('select')?.value,
    })))`);
    assert(previewRows.length === sequenceAssets.length, 'Preview row count/order does not match the source');
    previewRows.forEach((row, index) => {
      const expected = sequenceAssets[index];
      assert(row.sourceLineNumber === index + 1, `Source order mismatch on row ${index + 1}`);
      assert(row.audioAssetId === expected.id, `Wrong real AudioAsset ID on row ${index + 1}`);
      assert(row.sourceDurationMs === expected.durationMs, `Wrong source duration on row ${index + 1}`);
      assert(row.clipDurationMs === expected.durationMs, `Default clip duration mismatch on row ${index + 1}`);
      assert(row.status === 'valid', `Row ${index + 1} is not ready: ${row.status}`);
      assert(row.selectValue === '__automatic__', `Row ${index + 1} is not displaying the automatic match`);
    });
    assert(await js(`document.querySelector('.dialogue-batch-recognition-ready')?.textContent.includes('10')`), 'Ready count did not report ten rows');
    const autoImage = path.join(root, 'automatic-preview.png');
    writeFileSync(autoImage, (await win.webContents.capturePage()).toPNG());
    result.evidence.push(autoImage);

    await useManualAudioAndDuration();
    const editedRows = await js(`([...document.querySelectorAll('[data-testid="dialogue-batch-line"]')].map((element) => ({
      audioAssetId: element.dataset.audioAssetId,
      sourceDurationMs: Number(element.dataset.sourceDurationMs),
      clipDurationMs: Number(element.dataset.clipDurationMs),
      status: element.dataset.status,
    })))`);
    assert(editedRows[0].audioAssetId === manualAsset.id, 'Manual audio selection did not update the preview plan');
    assert(editedRows[0].sourceDurationMs === manualAsset.durationMs, 'Manual audio source duration is wrong');
    assert(editedRows[0].clipDurationMs === 500, 'Edited clip duration is not 500 ms');
    assert(editedRows[0].status === 'valid', 'Shortened manual clip should remain ready');
    const manualImage = path.join(root, 'manual-audio-duration-preview.png');
    writeFileSync(manualImage, (await win.webContents.capturePage()).toPNG());
    result.evidence.push(manualImage);

    const afterPreview = await inspect();
    assert(afterPreview.revision === baseline.revision, 'Draft preview changed the Project revision');
    assert(afterPreview.dirty === baseline.dirty, 'Draft preview changed Project dirty state');
    assert(afterPreview.undoCount === baseline.undoCount, 'Draft preview created a History entry');
    assert(afterPreview.redoCount === baseline.redoCount, 'Draft preview changed redo history');
    assert(JSON.stringify(afterPreview.project) === baselineFingerprint, 'Draft preview mutated the Project snapshot');
    assert(isDeepStrictEqual(authored, project), 'Draft preview reached Main autosave state');
    assert(autosaveUpdates === baselineAutosaveUpdates, 'Draft preview sent an autosave update');
    result.preview = {
      rows: previewRows,
      manualSelection: { audioAssetId: manualAsset.id, sourceDurationMs: manualAsset.durationMs, clipDurationMs: 500 },
      projectRevision: afterPreview.revision,
      dirty: afterPreview.dirty,
      undoCount: afterPreview.undoCount,
      redoCount: afterPreview.redoCount,
      autosaveUpdates: autosaveUpdates - baselineAutosaveUpdates,
      projectUnchanged: true,
    };

    await activate('[data-testid="dialogue-authoring-back"]');
    await wait(`!document.querySelector('[data-testid="dialogue-batch-input"]')`);
    await activate('[data-testid="subtitle-workspace-empty-action"]');
    await wait(`document.querySelector('[data-testid="dialogue-authoring-tab-batch"]')`);
    await activate('[data-testid="dialogue-authoring-tab-batch"]');
    await wait(`document.querySelector('[data-testid="dialogue-batch-input"]')?.value === ''`);
    assert(await js(`document.querySelectorAll('[data-testid="dialogue-batch-line"]').length === 0`), 'Cancel left batch preview rows behind');
    const afterCancel = await inspect();
    assert(afterCancel.revision === baseline.revision, 'Cancel changed the Project revision');
    assert(afterCancel.undoCount === baseline.undoCount && afterCancel.redoCount === baseline.redoCount, 'Cancel changed History');
    assert(JSON.stringify(afterCancel.project) === baselineFingerprint, 'Cancel changed the Project snapshot');
    assert(autosaveUpdates === baselineAutosaveUpdates, 'Cancel sent an autosave update');
    result.cancel = { draftCleared: true, projectUnchanged: true, historyUnchanged: true };
    result.passed = true;
    const resultPath = path.join(root, 'results.json');
    writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf8');
    result.evidence.push(resultPath);
    console.log(`PASS #926 AS-01 batch preview, exact AudioAsset matching, duration edit, draft-only state and cancel: ${root}`);
    win.destroy();
    app.exit(0);
  } catch (error) {
    result.error = String(error.stack ?? error);
    const resultPath = path.join(root, 'results.json');
    writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf8');
    if (win && !win.isDestroyed()) {
      const failurePath = path.join(root, 'failure.png');
      writeFileSync(failurePath, (await win.webContents.capturePage()).toPNG());
      result.evidence.push(failurePath);
    }
    console.error(result.error);
    if (win && !win.isDestroyed()) win.destroy();
    app.exit(1);
  }
}

run().catch((error) => {
  console.error(error);
  app.exit(1);
});

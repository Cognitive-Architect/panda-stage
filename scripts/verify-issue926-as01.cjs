const { app, ipcMain } = require('electron');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const path = require('node:path');
const { createMainWindow } = require('../dist-electron/main/windows/main-window.js');
const { registerProjectIpcHandlers } = require('../dist-electron/main/ipc/register-project-ipc-handlers.js');
const { ProjectService } = require('../dist-electron/main/services/ProjectService.js');
const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');
const { migrateProject } = require('../dist-electron/domain/migrations/index.js');
const { ProjectSchema } = require('../dist-electron/domain/models/project.js');

// Real sandboxed React + Preload UI flow with isolated fixture IPC and media.
// It verifies draft-only state in Electron but does not replace human Windows
// input-device acceptance.
const acceptanceRoot = 'D:\\PandaStage-Acceptance\\issue-949-as02-phase-a-evidence';
const runId = new Date().toISOString().replace(/[:.]/gu, '-');
const root = path.join(acceptanceRoot, runId);
mkdirSync(root, { recursive: true });
app.setPath('userData', path.join(root, 'user-data'));
process.env.VITE_DEV_SERVER_URL = '';
app.on('window-all-closed', () => {});

const projectRoot = path.join(root, 'fixture.pandastage');
const project = migrateProject(require('../demo-project/project-v1.example.json'));
project.name = 'Issue 949 AS-02 Phase A acceptance fixture';
project.shots = [project.shots[0]];
const shot = project.shots[0];
shot.durationMs = 10_000;
shot.dialogues = [];
shot.audioClips = [];
shot.timelineEvents = [];
const secondShot = structuredClone(shot);
secondShot.id = '50000000-0000-4000-8000-000000000002';
secondShot.name = 'Second shot';
secondShot.layers = secondShot.layers.map((layer, index) => ({
  ...layer,
  id: `51000000-0000-4000-8000-00000000000${index + 1}`,
}));
secondShot.backgroundLayerId = secondShot.layers[0].id;
project.shots.push(secondShot);
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
  const sourceStem = `${String(sequence).padStart(3, '0')}_${role}`;
  const conflictedPath = sequence === 4;
  const asset = {
    id: `11000000-0000-4000-8000-0000000009${String(sequence).padStart(2, '0')}`,
    kind: 'audio',
    name: conflictedPath ? sourceStem : `Sequence ${sequence} ${role}`,
    relativePath: `assets/${sourceStem}${conflictedPath ? '-a1b2c3d4' : ''}.wav`,
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
  relativePath: 'assets/manual-voice-recording-for-auto-subtitle-narrow-landscape.wav',
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
const projectFilePath = path.join(projectRoot, 'project.json');
writeFileSync(projectFilePath, JSON.stringify(project, null, 2));
let win = null;
let unregisterProjectIpcHandlers = null;
const projectService = new ProjectService();
let authored = project;
let autosaveUpdates = 0;
const register = (channel, handler) => ipcMain.handle(IPC_CHANNELS[channel], handler);
unregisterProjectIpcHandlers = registerProjectIpcHandlers({
  getMainWindow: () => win,
  projectService,
});
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
register('RECENT_PROJECTS_OPEN', async () => ({
  ok: true,
  document: await projectService.open(projectRoot),
}));
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
register('ASSET_PREVIEW_AUDIO_READ', (_event, request) => {
  const asset = project.assets.find((candidate) => candidate.id === request.assetId);
  const bytes = waves.get(request.assetId);
  if (!asset || asset.kind !== 'audio' || !bytes || asset.sha256 !== request.sha256) {
    return {
      ok: false,
      error: {
        code: 'ASSET_PREVIEW_AUDIO_ASSET_NOT_FOUND',
        message: 'Unable to read this audio asset.',
        assetId: request.assetId,
      },
    };
  }
  return {
    ok: true,
    status: 'ready',
    assetId: asset.id,
    mimeType: 'audio/wav',
    byteLength: bytes.length,
    bytes: new Uint8Array(bytes),
  };
});

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
let activeStep = 'launch';
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
async function chooseBatchCharacter(lineNumber, characterId) {
  const picker = `[data-testid="dialogue-batch-map-${lineNumber}"]`;
  await activate(`${picker} summary`);
  await wait(`document.querySelector(${JSON.stringify(`${picker} [role="radio"][data-character-id="${characterId}"]`)})`);
  await activate(`${picker} [role="radio"][data-character-id="${characterId}"]`);
}
async function ensureAutoRowExpanded(lineNumber) {
  const selector = `[data-testid="auto-subtitle-row-edit-${lineNumber}"]`;
  const expanded = await js(`document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-expanded') === 'true'`);
  if (!expanded) await activate(selector);
}
async function setBatchText(value) {
  await js(`(() => {
    const input = document.querySelector('[data-testid="dialogue-batch-input"]');
    if (!input) throw new Error('Missing batch dialogue input');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait(`document.querySelector('[data-testid="dialogue-batch-input"]')?.value === ${JSON.stringify(value)}`);
}
async function inspect() {
  return js('window.__pandaStageIssue816Acceptance.inspect()');
}
async function useManualAudioAndDuration() {
  await ensureAutoRowExpanded(1);
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

async function loadAndPlayAudioPreview() {
  await activate('[data-testid="dialogue-batch-audio-preview-load"]');
  await wait(`document.querySelector('[data-testid="dialogue-batch-audio-player"]')?.readyState >= 1`);
  const duration = await js(`document.querySelector('[data-testid="dialogue-batch-audio-player"]')?.duration`);
  assert(Math.abs(duration - 2.5) < 0.01, 'Audio audition loaded the wrong source duration');
  await js(`document.querySelector('[data-testid="dialogue-batch-audio-player"]')?.play()`);
  await wait(`document.querySelector('[data-testid="dialogue-batch-audio-player"]')?.paused === false`);
  await pause(180);
  const currentTime = await js(`document.querySelector('[data-testid="dialogue-batch-audio-player"]')?.currentTime`);
  assert(currentTime > 0, 'Audio audition playback did not advance');
  await js(`document.querySelector('[data-testid="dialogue-batch-audio-player"]')?.pause()`);
  return { durationSeconds: duration, playbackAdvanced: true };
}

async function run() {
  activeStep = 'open-project';
  await app.whenReady();
  win = await createMainWindow({ show: false, issue816Acceptance: true });
  win.setContentSize(1360, 920);
  win.setAlwaysOnTop(true);
  win.show();
  win.focus();

  const result = {
    issue: 949,
    acceptance: 'AS-02 Phase A: Auto Subtitles surface and audio-free Subtitle batch path',
    runId,
    projectRoot,
    passed: false,
    evidence: [],
  };
  try {
    await wait(`document.querySelector('[data-task4-core="recent-open"]')`);
    await activate('[data-task4-core="recent-open"]');
    await wait(`document.querySelector('[data-testid="history-controls"]')`);
    await activate('[data-testid="right-activity-rail-tools"]');
    await wait(`document.querySelector('[data-testid="project-tools-auto-subtitles"]')`);
    await pause(500);
    assert(await js(`Boolean(document.querySelector('[data-testid="project-tools-action-presets"]'))`), 'Auto Subtitles displaced Action Presets');
    const entryImage = path.join(root, 'tools-home-auto-subtitles-entry.png');
    writeFileSync(entryImage, (await win.webContents.capturePage()).toPNG());
    result.evidence.push(entryImage);

    activeStep = 'open-auto-subtitles';
    await activate('[data-testid="project-tools-auto-subtitles"]');
    await wait(`document.querySelector('[data-testid="auto-subtitle-batch"]')`);
    assert(await js(`Boolean(document.querySelector('[data-testid="project-tools-auto-subtitles-back"]'))`), 'Auto Subtitles back control is missing');
    assert(await js(`Boolean(document.querySelector('[data-testid="project-tools-close"]'))`), 'Auto Subtitles close control is missing');

    const baseline = await inspect();
    assert(baseline?.project?.shots?.[0]?.dialogues?.length === 0, 'Fixture must begin with an empty dialogue list');
    assert(baseline?.project?.shots?.[0]?.audioClips?.length === 0, 'Fixture must begin without audio clips');
    assert(baseline?.project?.shots?.[1]?.dialogues?.length === 0, 'Second fixture Shot must begin with no dialogues');
    const baselineFingerprint = JSON.stringify(baseline.project);
    const baselineAutosaveUpdates = autosaveUpdates;

    activeStep = 'ten-row-auto-preview';
    const sourceLines = sequenceAssets.map((asset, index) => {
      const role = index % 2 === 0 ? 'Panda' : 'Tiger';
      return `${role}: AS-02 dialogue row ${index + 1}`;
    });
    const sourceLineNumbers = [1, 2, 3, 5, 6, 7, 8, 10, 11, 12];
    const sourceText = sourceLines.flatMap((line, index) =>
      index === 2 || index === 6 ? [line, ''] : [line],
    ).join('\n');
    await setBatchText(sourceText);
    await wait(`document.querySelectorAll('[data-testid="dialogue-batch-line"]').length === 10`);
    await wait(`document.querySelector('[data-testid="auto-subtitle-phase-a-status"]')`);
    await wait(`document.querySelector('.dialogue-batch-recognition-ready')?.textContent.includes('10')`);
    const autoControls = await js(`(() => ({
      presentation: document.querySelector('[data-testid="auto-subtitle-batch"]')?.dataset.presentation,
      status: document.querySelector('[data-testid="auto-subtitle-phase-a-status"]')?.textContent,
      addAction: Boolean(document.querySelector('[data-testid="dialogue-batch-add-subtitles"]')),
      audioEditors: document.querySelectorAll('[data-testid="auto-subtitle-batch"] .dialogue-batch-audio-row').length,
      parsedRows: document.querySelectorAll('[data-testid="dialogue-batch-line"]').length,
    }))()`);
    assert(autoControls.presentation === 'auto-subtitle', 'The Tools launcher did not open Auto Subtitles');
    assert(autoControls.status?.trim().length > 0, 'Phase A readiness status is missing');
    assert(!autoControls.addAction, 'Auto Subtitles exposed a subtitle creation action');
    assert(autoControls.audioEditors === 0, 'Per-row audio editors should start collapsed');
    assert(autoControls.parsedRows === 10, 'Auto preview did not preserve ten source rows');

    const previewRows = await js(`([...document.querySelectorAll('[data-testid="dialogue-batch-line"]')].map((element) => ({
      sourceLineNumber: Number(element.querySelector('.dialogue-batch-row-number')?.textContent.match(/\\d+/)?.[0]),
      audioAssetId: element.dataset.audioAssetId,
      sourceDurationMs: Number(element.dataset.sourceDurationMs),
      clipDurationMs: Number(element.dataset.clipDurationMs),
      status: element.dataset.status,
    })))`);
    assert(previewRows.length === sequenceAssets.length, 'Preview row count/order does not match the source');
    previewRows.forEach((row, index) => {
      const expected = sequenceAssets[index];
      assert(row.sourceLineNumber === sourceLineNumbers[index], `Physical source line mismatch on row ${index + 1}`);
      assert(row.audioAssetId === expected.id, `Wrong AudioAsset ID on row ${index + 1}`);
      assert(row.sourceDurationMs === expected.durationMs, `Wrong source duration on row ${index + 1}`);
      assert(row.clipDurationMs === expected.durationMs, `Wrong default clip duration on row ${index + 1}`);
      assert(row.status === 'valid', `Row ${index + 1} is not ready: ${row.status}`);
    });
    assert(sequenceAssets[3].relativePath.endsWith('004_Tiger-a1b2c3d4.wav'), 'Conflict fixture is missing its import hash suffix');
    await activate('[data-testid="auto-subtitle-input-toggle"]');
    await wait(`document.querySelector('.dialogue-batch-input-section')?.hidden === true`);
    const autoImage = path.join(root, 'automatic-preview-wide.png');
    writeFileSync(autoImage, (await win.webContents.capturePage()).toPNG());
    result.evidence.push(autoImage);

    activeStep = 'manual-audio-audition';
    await activate('[data-testid="resource-activity-rail-assets"]');
    await wait(`document.querySelector('[data-testid="resource-activity-panel"]')?.dataset.activeActivity === 'assets'`);
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
    const filenameTitle = await js(`document.querySelector('.auto-subtitle-row-audio-name')?.title ?? ''`);
    assert(filenameTitle === path.basename(manualAsset.relativePath), 'Full manual source filename is not available as a title');
    const audition = await loadAndPlayAudioPreview();
    const manualImage = path.join(root, 'manual-audio-duration-audition.png');
    writeFileSync(manualImage, (await win.webContents.capturePage()).toPNG());
    result.evidence.push(manualImage);

    activeStep = 'role-change-revalidation';
    await activate('[data-testid="dialogue-batch-role-edit-1"]');
    await chooseBatchCharacter(1, tigerId);
    await wait(`document.querySelector('[data-testid="dialogue-batch-line"] .dialogue-batch-row-copy strong')?.textContent === 'Tiger'`);
    await wait(`document.querySelector('[data-testid="dialogue-batch-line"]')?.dataset.audioAssetId === ''`);
    const changedRoleRow = await js(`(() => {
      const row = document.querySelector('[data-testid="dialogue-batch-line"]');
      return {
        character: row.querySelector('.dialogue-batch-row-copy strong')?.textContent,
        audioAssetId: row.dataset.audioAssetId,
        clipDurationMs: row.dataset.clipDurationMs,
        durationInput: row.querySelector('[data-testid="dialogue-batch-duration-1"]')?.value ?? null,
        issue: document.querySelector('[data-testid="dialogue-batch-issue-1"]')?.textContent ?? '',
      };
    })()`);
    assert(changedRoleRow.character === 'Tiger', 'Role mapping did not change to Tiger');
    assert(changedRoleRow.audioAssetId === '' && changedRoleRow.clipDurationMs === '', 'Role change kept the previous audio or duration');
    assert(changedRoleRow.durationInput === null, 'Role change kept the prior duration editor');
    assert(changedRoleRow.issue.length > 0, 'Changed role did not expose its audio revalidation issue');
    await activate('[data-testid="dialogue-batch-role-edit-1"]');
    await chooseBatchCharacter(1, panda.id);
    await wait(`document.querySelector('[data-testid="dialogue-batch-line"]')?.dataset.audioAssetId === ${JSON.stringify(sequenceAssets[0].id)}`);
    await wait(`document.querySelector('[data-testid="dialogue-batch-line"]')?.dataset.clipDurationMs === '${sequenceAssets[0].durationMs}'`);
    await useManualAudioAndDuration();
    await activate('[data-testid="auto-subtitle-input-toggle"]');
    await wait(`document.querySelector('.dialogue-batch-input-section')?.hidden === false`);

    activeStep = 'draft-isolation-and-persistence';
    await activate('[data-testid="right-activity-rail-subtitles"]');
    await wait(`document.querySelector('[data-testid="dialogue-sheet"]')`);
    await activate('[data-testid="right-activity-rail-tools"]');
    await wait(`document.querySelector('[data-testid="project-tools-auto-subtitles"]')`);
    await activate('[data-testid="project-tools-auto-subtitles"]');
    await wait(`document.querySelector('[data-testid="dialogue-batch-input"]')?.value === ${JSON.stringify(sourceText)}`);
    const persistedDraft = await js(`(() => {
      const row = document.querySelector('[data-testid="dialogue-batch-line"]');
      return {
        audioAssetId: row?.dataset.audioAssetId,
        durationMs: row?.dataset.clipDurationMs,
        fileName: row?.querySelector('.auto-subtitle-row-audio-name')?.title ?? '',
        input: document.querySelector('[data-testid="dialogue-batch-input"]')?.value ?? '',
      };
    })()`);
    assert(persistedDraft.audioAssetId === manualAsset.id, 'Manual audio selection did not survive activity navigation');
    assert(persistedDraft.durationMs === '500', 'Manual clip duration did not survive activity navigation');
    assert(persistedDraft.fileName === path.basename(manualAsset.relativePath), 'Manual audio filename did not survive activity navigation');
    assert(persistedDraft.input === sourceText, 'Auto subtitle input did not survive activity navigation');

    await activate('[data-testid="project-tools-auto-subtitles-back"]');
    await wait(`document.querySelector('[data-testid="project-tools-home"]')`);
    await activate('[data-testid="project-tools-auto-subtitles"]');
    await wait(`document.querySelector('[data-testid="dialogue-batch-input"]')?.value === ${JSON.stringify(sourceText)}`);
    await activate('[data-testid="project-tools-close"]');
    await wait(`!document.querySelector('[data-testid="project-tools-drawer"]')`);
    await activate('[data-testid="right-activity-rail-tools"]');
    await wait(`document.querySelector('[data-testid="project-tools-auto-subtitles"]')`);
    await activate('[data-testid="project-tools-auto-subtitles"]');
    await wait(`document.querySelector('[data-testid="dialogue-batch-input"]')?.value === ${JSON.stringify(sourceText)}`);

    activeStep = 'narrow-landscape-layout';
    win.setContentSize(1000, 920);
    await wait(`document.querySelector('[data-testid="auto-subtitle-batch"]')`);
    await pause(400);
    const narrowLayout = await js(`(() => {
      const drawer = document.querySelector('[data-testid="right-workspace-surface"]');
      const header = document.querySelector('.project-tools-auto-subtitles-header');
      const back = header?.querySelector('[data-testid="project-tools-auto-subtitles-back"]');
      const title = header?.querySelector('h2');
      const close = header?.querySelector('[data-testid="project-tools-close"]');
      const fileName = document.querySelector('.auto-subtitle-row-audio-name');
      const rect = (element) => element ? element.getBoundingClientRect() : null;
      const dr = rect(drawer);
      const br = rect(back);
      const tr = rect(title);
      const cr = rect(close);
      return {
        viewportWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
        drawerWidth: dr?.width ?? 0,
        controlsShareRow: Boolean(br && tr && cr && Math.max(br.top, tr.top, cr.top) - Math.min(br.top, tr.top, cr.top) < 8),
        fileTitle: fileName?.title ?? '',
        fileTruncates: Boolean(fileName && getComputedStyle(fileName).textOverflow === 'ellipsis' && fileName.scrollWidth > fileName.clientWidth),
      };
    })()`);
    assert(narrowLayout.drawerWidth >= 220 && narrowLayout.drawerWidth <= 420, `Auto Subtitles drawer width is unsuitable at 1000px: ${narrowLayout.drawerWidth}`);
    assert(narrowLayout.documentWidth <= narrowLayout.viewportWidth + 1, 'Narrow landscape layout introduced page-level horizontal overflow');
    assert(narrowLayout.controlsShareRow, 'Back, title, and close do not share one compact row');
    assert(narrowLayout.fileTitle === path.basename(manualAsset.relativePath), 'Narrow layout lost the full audio filename');
    const narrowImage = path.join(root, 'auto-subtitles-narrow-landscape.png');
    writeFileSync(narrowImage, (await win.webContents.capturePage()).toPNG());
    result.evidence.push(narrowImage);

    activeStep = 'shot-identity-clears-auto-draft';
    await activate('[data-testid="resource-activity-rail-shots"]');
    await wait(`document.querySelector('[data-testid="shot-list-view"]')`);
    await activate(`li[data-shot-id="${secondShot.id}"] button`);
    await wait(`document.querySelector('.shot-list-item-selected')?.dataset.shotId === ${JSON.stringify(secondShot.id)}`);
    await wait(`document.querySelector('[data-testid="dialogue-batch-input"]')?.value === ''`);
    await wait(`document.querySelectorAll('[data-testid="dialogue-batch-line"]').length === 0`);
    await wait(`document.querySelector('[data-testid="auto-subtitle-draft-reset-notice"]')?.textContent.includes('镜头已切换')`);
    const shotSwitchImage = path.join(root, 'shot-switch-draft-reset.png');
    writeFileSync(shotSwitchImage, (await win.webContents.capturePage()).toPNG());
    result.evidence.push(shotSwitchImage);
    await activate('[data-testid="auto-subtitle-draft-reset-notice-dismiss"]');
    await wait(`!document.querySelector('[data-testid="auto-subtitle-draft-reset-notice"]')`);
    await activate(`li[data-shot-id="${shot.id}"] button`);
    await wait(`document.querySelector('.shot-list-item-selected')?.dataset.shotId === ${JSON.stringify(shot.id)}`);
    await wait(`document.querySelector('[data-testid="dialogue-batch-input"]')?.value === ''`);
    assert(await js(`document.querySelectorAll('[data-testid="dialogue-batch-line"]').length === 0`), 'Returning to the original Shot resurrected its old draft');
    const afterPreview = await inspect();
    assert(afterPreview.revision === baseline.revision, 'Draft preview and Shot selection changed Project revision');
    assert(afterPreview.dirty === baseline.dirty, 'Draft preview and Shot selection changed dirty state');
    assert(afterPreview.undoCount === baseline.undoCount, 'Draft preview created a History entry');
    assert(afterPreview.redoCount === baseline.redoCount, 'Draft preview changed redo history');
    assert(JSON.stringify(afterPreview.project) === baselineFingerprint, 'Draft preview or Shot selection mutated Project data');
    assert(isDeepStrictEqual(authored, project), 'Draft preview reached Main autosave state');
    assert(autosaveUpdates === baselineAutosaveUpdates, 'Draft preview sent an autosave update');
    const previewAutosaveUpdates = autosaveUpdates - baselineAutosaveUpdates;

    activeStep = 'ordinary-subtitle-batch-is-audio-free';
    await activate('[data-testid="right-activity-rail-subtitles"]');
    await wait(`document.querySelector('[data-testid="subtitle-workspace-empty-action"]')`);
    await activate('[data-testid="subtitle-workspace-empty-action"]');
    await wait(`document.querySelector('[data-testid="dialogue-authoring-tab-batch"]')`);
    await activate('[data-testid="dialogue-authoring-tab-batch"]');
    await wait(`document.querySelector('[data-testid="dialogue-batch"]')`);
    const regularBatch = await js(`(() => ({
      presentation: document.querySelector('[data-testid="dialogue-batch"]')?.dataset.presentation,
      audioRows: document.querySelectorAll('[data-testid="dialogue-batch"] .dialogue-batch-audio-row').length,
      audioPreview: document.querySelectorAll('[data-testid="dialogue-batch"] [data-testid="dialogue-batch-audio-preview-load"]').length,
      automaticStatus: Boolean(document.querySelector('[data-testid="auto-subtitle-phase-a-status"]')),
    }))()`);
    assert(regularBatch.presentation === 'subtitle-only', 'Ordinary Subtitle batch is not in subtitle-only presentation');
    assert(regularBatch.audioRows === 0 && regularBatch.audioPreview === 0, 'Ordinary Subtitle batch exposes audio matching or audition controls');
    assert(!regularBatch.automaticStatus, 'Ordinary Subtitle batch shows Auto Subtitles status');

    await setBatchText('Unknown: mapped subtitle without audio');
    await wait(`document.querySelector('[data-testid="dialogue-batch-map-1"]')`);
    await chooseBatchCharacter(1, panda.id);
    await wait(`document.querySelector('[data-testid="dialogue-batch-line"] .dialogue-batch-row-copy strong')?.textContent === 'Panda'`);
    await activate('[data-testid="dialogue-batch-role-edit-1"]');
    await chooseBatchCharacter(1, tigerId);
    await wait(`document.querySelector('[data-testid="dialogue-batch-line"] .dialogue-batch-row-copy strong')?.textContent === 'Tiger'`);
    const subtitleOnlyButton = await js(`(() => {
      const button = document.querySelector('[data-testid="dialogue-batch-add-subtitles"]');
      return { exists: Boolean(button), disabled: button?.disabled ?? true, text: button?.textContent ?? '' };
    })()`);
    assert(subtitleOnlyButton.exists && !subtitleOnlyButton.disabled, 'Mapped subtitle action is not enabled');
    assert(subtitleOnlyButton.text.trim().length > 0, 'Subtitle action label is missing');

    activeStep = 'create-untimed-subtitle';
    await activate('[data-testid="dialogue-batch-add-subtitles"]');
    await wait(`!document.querySelector('[data-testid="dialogue-batch-input"]')`);
    const afterAdd = await inspect();
    const createdShot = afterAdd.project.shots.find((candidate) => candidate.id === shot.id);
    const createdDialogue = createdShot?.dialogues?.[0];
    assert(createdShot?.dialogues.length === 1, 'Audio-free batch action did not create exactly one Dialogue');
    assert(createdDialogue.characterId === tigerId && createdDialogue.text === 'mapped subtitle without audio', 'Subtitle action committed the wrong mapped line');
    assert(createdDialogue.startMs === 0 && createdDialogue.endMs === 0, 'Subtitle action created a timed Dialogue');
    assert(createdShot.audioClips.length === 0, 'Subtitle-only action created an AudioClip');
    assert(afterAdd.undoCount === baseline.undoCount + 1, 'Batch add did not create exactly one History command');
    assert(afterAdd.revision === baseline.revision + 1, 'Batch add did not create one Project revision');
    await wait(`document.querySelector('[data-testid="timeline-subtitle-queue"]') && [...document.querySelectorAll('[data-testid="dialogue-untimed-item"]')].some((item) => item.dataset.dialogueId === ${JSON.stringify(createdDialogue.id)})`);
    const pendingQueue = await js(`(() => ({
      count: Number(document.querySelector('[data-testid="timeline-subtitle-queue"]')?.dataset.pendingCount ?? 0),
      dialogueIds: [...document.querySelectorAll('[data-testid="dialogue-untimed-item"]')].map((item) => item.dataset.dialogueId),
    }))()`);
    assert(pendingQueue.count === 1 && pendingQueue.dialogueIds.includes(createdDialogue.id), 'Untimed Dialogue did not appear in the existing pending queue');

    activeStep = 'undo-batch-add';
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Z', modifiers: ['control'] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Z', modifiers: ['control'] });
    await wait(`(await window.__pandaStageIssue816Acceptance.inspect()).project.shots.every((candidate) => candidate.dialogues.length === 0)`);
    await wait(`!document.querySelector('[data-testid="timeline-subtitle-queue"]')`);
    const afterUndo = await inspect();
    assert(afterUndo.undoCount === baseline.undoCount && afterUndo.redoCount === baseline.redoCount + 1, 'Undo did not remove the one batch command');
    activeStep = 'redo-batch-add';
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Y', modifiers: ['control'] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Y', modifiers: ['control'] });
    await wait(`(await window.__pandaStageIssue816Acceptance.inspect()).project.shots.some((candidate) => candidate.dialogues.length === 1)`);
    await wait(`document.querySelector('[data-testid="timeline-subtitle-queue"]') && [...document.querySelectorAll('[data-testid="dialogue-untimed-item"]')].some((item) => item.dataset.dialogueId === ${JSON.stringify(createdDialogue.id)})`);
    const afterRedo = await inspect();
    const redoneShot = afterRedo.project.shots.find((candidate) => candidate.dialogues.length === 1);
    assert(redoneShot?.audioClips.length === 0, 'Redo added an AudioClip');
    assert(redoneShot?.dialogues[0]?.characterId === tigerId, 'Redo did not restore the mapped subtitle');
    assert(afterRedo.undoCount === baseline.undoCount + 1 && afterRedo.redoCount === baseline.redoCount, 'Redo did not restore the single batch History command');

    activeStep = 'save-and-reopen-subtitle';
    const saveResult = await js('window.__pandaStageIssue816Acceptance.saveCurrentProject()');
    assert(saveResult?.ok === true, `Saving the audio-free Dialogue failed: ${JSON.stringify(saveResult)}`);
    assert(saveResult.savedRevision === afterRedo.revision, 'Save did not acknowledge the Dialogue revision');
    const savedProject = ProjectSchema.parse(JSON.parse(readFileSync(projectFilePath, 'utf8')));
    const savedShot = savedProject.shots.find((candidate) => candidate.id === shot.id);
    assert(savedShot?.dialogues.length === 1 && savedShot.dialogues[0]?.id === createdDialogue.id, 'Saved project.json did not retain the untimed Dialogue');
    assert(savedShot.audioClips.length === 0, 'Saved project.json introduced an AudioClip');
    const reopened = await js('window.__pandaStageIssue816Acceptance.reopenSamePath()');
    await wait(`(await window.__pandaStageIssue816Acceptance.inspect()).project.shots.find((candidate) => candidate.id === ${JSON.stringify(shot.id)})?.dialogues[0]?.id === ${JSON.stringify(createdDialogue.id)}`);
    if (!await js(`Boolean(document.querySelector('[data-testid="dialogue-sheet"]'))`)) {
      await activate('[data-testid="right-activity-rail-subtitles"]');
    }
    await wait(`document.querySelector('[data-testid="dialogue-sheet"]')`);
    await wait(`document.querySelector('[data-testid="timeline-subtitle-queue"]') && [...document.querySelectorAll('[data-testid="dialogue-untimed-item"]')].some((item) => item.dataset.dialogueId === ${JSON.stringify(createdDialogue.id)})`);
    await pause(500);
    const reopenedSnapshot = await inspect();
    const reopenedShot = reopenedSnapshot.project.shots.find((candidate) => candidate.id === shot.id);
    assert(reopenedSnapshot.dirty === false, 'Reopened saved Project is unexpectedly dirty');
    assert(reopenedShot?.dialogues[0]?.id === createdDialogue.id, 'Reopen lost the untimed Dialogue');
    assert(reopenedShot?.audioClips.length === 0, 'Reopen added an AudioClip');
    assert(reopened?.project?.shots?.some((candidate) => candidate.id === shot.id && candidate.dialogues.some((dialogue) => dialogue.id === createdDialogue.id)), 'Reopen API did not return the saved Dialogue');

    const subtitleOnlyImage = path.join(root, 'subtitle-only-add-undo-redo.png');
    writeFileSync(subtitleOnlyImage, (await win.webContents.capturePage()).toPNG());
    result.evidence.push(subtitleOnlyImage);
    result.saveReopen = { saved: true, reopened: true, pendingQueueRestored: true, audioClips: 0 };

    result.preview = {
      rows: previewRows,
      manualSelection: { audioAssetId: manualAsset.id, sourceDurationMs: manualAsset.durationMs, clipDurationMs: 500 },
      audition,
      roleChange: changedRoleRow,
      persistedDraft,
      narrowLayout,
      projectRevision: afterPreview.revision,
      dirty: afterPreview.dirty,
      undoCount: afterPreview.undoCount,
      redoCount: afterPreview.redoCount,
      autosaveUpdates: previewAutosaveUpdates,
      projectUnchanged: true,
      shotSwitchClearedDraft: true,
      shotSwitchNoticeShown: true,
    };
    result.subtitleOnly = { audioFreeSurface: true, createdUntimed: true, audioClips: 0, oneHistoryCommand: true, undo: true, redo: true };
    result.fixes = { F01: 'PASS', F02: 'PASS', F03: 'PASS', F04: 'PASS', F05: 'PASS' };
    result.passed = true;
    const resultPath = path.join(root, 'results.json');
    writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf8');
    result.evidence.push(resultPath);
    console.log(`PASS #949 AS-02 Phase A Auto Subtitles, transient draft, audio-free Subtitle batch, undo/redo: ${root}`);
    unregisterProjectIpcHandlers?.();
    win.destroy();
    app.exit(0);
  } catch (error) {
    result.step = activeStep;
    result.error = String(error.stack ?? error);
    const resultPath = path.join(root, 'results.json');
    writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf8');
    if (win && !win.isDestroyed()) {
      const failurePath = path.join(root, 'failure.png');
      writeFileSync(failurePath, (await win.webContents.capturePage()).toPNG());
      result.evidence.push(failurePath);
    }
    console.error(result.error);
    unregisterProjectIpcHandlers?.();
    if (win && !win.isDestroyed()) win.destroy();
    app.exit(1);
  }
}
run().catch((error) => {
  console.error(error);
  unregisterProjectIpcHandlers?.();
  app.exit(1);
});

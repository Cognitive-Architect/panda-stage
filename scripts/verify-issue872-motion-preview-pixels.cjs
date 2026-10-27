const { app, ipcMain } = require('electron');
const { createHash, randomUUID } = require('node:crypto');
const {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} = require('node:fs');
const path = require('node:path');
const { createMainWindow } = require('../dist-electron/main/windows/main-window.js');
const { registerIpcHandlers } = require('../dist-electron/main/ipc/register-ipc-handlers.js');
const { ExportPreparationService, MainProjectAssetReader } = require('../dist-electron/main/services/ExportPreparationService.js');
const { NodeExportPreparationFileStore } = require('../dist-electron/main/services/ExportPreparationFileStore.js');
const { ExportService } = require('../dist-electron/main/services/ExportService.js');
const { FileSystemService } = require('../dist-electron/main/services/FileSystemService.js');
const { FFmpegAdapter } = require('../dist-electron/main/services/FFmpegAdapter.js');
const { resolveMediaToolPaths } = require('../dist-electron/main/services/production-resources.js');
const { HiddenWindowManager } = require('../dist-electron/main/windows/hidden-window-manager.js');
const { ProjectSchema } = require('../dist-electron/domain/index.js');
const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');

const acceptanceRoot = 'D:\\PandaStage-Acceptance';
const fixtureParent = process.env.PANDA_STAGE_ISSUE872_FIXTURE_PARENT ??
  path.join(acceptanceRoot, 'issue867-thm01');
const runRoot = mkdtempSync(path.join(acceptanceRoot, 'issue872-ac08-preview-pixels-'));
const evidenceRoot = path.join(runRoot, 'evidence');
const userDataRoot = path.join(runRoot, 'electron-user-data');
const intensities = [0, 100, 200];
const checkpoints = [
  { label: 'upper-left', timeMs: 425, elapsedMs: 125 },
  { label: 'neutral', timeMs: 550, elapsedMs: 250 },
  { label: 'lower-right', timeMs: 675, elapsedMs: 375 },
];
const dialogueBoundaryCheckpoints = [
  { label: 'dialogue-start', timeMs: 300, elapsedMs: 0 },
  { label: 'dialogue-end', timeMs: 2700, elapsedMs: 2400 },
];
const speakerSwitchCheckpoints = [
  { label: 'speaker-b-upper-left', timeMs: 1825, elapsedMs: 125 },
  { label: 'speaker-b-neutral', timeMs: 1950, elapsedMs: 250 },
  { label: 'speaker-b-lower-right', timeMs: 2075, elapsedMs: 375 },
];
const PRIMARY_CAPTURE_REGIONS = {
  head: { x: 700, y: 150, width: 520, height: 250 },
  faceMouth: { x: 780, y: 380, width: 360, height: 160 },
  bodySamples: [[920, 820], [960, 850], [1000, 880]],
  alphaSamples: [
    { name: 'head', x: 960, y: 270 },
    { name: 'face', x: 960, y: 420 },
    { name: 'mouth', x: 960, y: 480 },
    { name: 'body', x: 960, y: 850 },
  ],
};
const SPEAKER_B_CAPTURE_REGIONS = {
  head: { x: 1190, y: 150, width: 520, height: 250 },
  faceMouth: { x: 1270, y: 380, width: 360, height: 160 },
  bodySamples: [[1410, 820], [1450, 850], [1490, 880]],
};
const SURFACE_COMPARISON_FRAME_INDEX = 44;
const SURFACE_COMPARISON_TIME_MS = Math.floor(SURFACE_COMPARISON_FRAME_INDEX * 1000 / 24);
const SURFACE_COMPARISON_REGIONS = {
  speakerAHead: { x: 700, y: 150, width: 520, height: 250 },
  speakerAFaceMouth: { x: 780, y: 380, width: 360, height: 160 },
  speakerBHead: { x: 1190, y: 150, width: 520, height: 250 },
  speakerBFaceMouth: { x: 1270, y: 380, width: 360, height: 160 },
  speakerABodyPoint1: { x: 920, y: 820, width: 2, height: 2 },
  speakerABodyPoint2: { x: 960, y: 850, width: 2, height: 2 },
  speakerABodyPoint3: { x: 1000, y: 880, width: 2, height: 2 },
  speakerBBodyPoint1: { x: 1410, y: 820, width: 2, height: 2 },
  speakerBBodyPoint2: { x: 1450, y: 850, width: 2, height: 2 },
  speakerBBodyPoint3: { x: 1490, y: 880, width: 2, height: 2 },
};
const SURFACE_COMPARISON_BODY_SAMPLES = {
  speakerA: [[920, 820], [960, 850], [1000, 880]],
  speakerB: [[1410, 820], [1450, 850], [1490, 880]],
};
const SURFACE_PIXEL_TOLERANCE = {
  meanAbsoluteChannelError: 0.1,
  p95AbsoluteChannelError: 1,
  maxAbsoluteChannelError: 24,
  pixelsOver16Ratio: 0.001,
};
const MP4_PIXEL_TOLERANCE = {
  meanAbsoluteChannelError: 8,
  p95AbsoluteChannelError: 24,
  pixelsOver16Ratio: 0.03,
};
const registeredChannels = [];

app.on('window-all-closed', () => {});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function findSyntheticProjectRoot() {
  const explicitRoot = process.env.PANDA_STAGE_ISSUE872_SOURCE_PROJECT_ROOT;
  if (explicitRoot) return path.resolve(explicitRoot);
  if (!existsSync(fixtureParent)) {
    throw new Error(`Synthetic Issue 867 fixture parent is missing: ${fixtureParent}`);
  }
  const candidates = readdirSync(fixtureParent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('run-'))
    .map((entry) => path.join(fixtureParent, entry.name, 'Issue 867 diagonal dialogue.pandastage'))
    .filter((candidate) => existsSync(path.join(candidate, 'project.json')))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  if (!candidates.length) throw new Error('No generated synthetic Issue 867 project was found.');
  return candidates[0];
}

function loadAndValidateSource(projectRoot) {
  const manifestPath = path.join(projectRoot, 'project.json');
  const manifestBytes = readFileSync(manifestPath);
  const project = ProjectSchema.parse(JSON.parse(manifestBytes.toString('utf8')));
  assert(project.schemaVersion === 14, `Expected Project v14, found ${project.schemaVersion}.`);
  assert(project.name.includes('Issue 867'), 'Source project is not the synthetic Issue 867 fixture.');
  const character = project.characters.find((item) => item.mode === 'composite' && item.head);
  assert(character, 'Synthetic fixture has no composite Character with a Head Group.');
  const dialogue = project.shots.flatMap((shot) => shot.dialogues)
    .find((item) => item.characterId === character.id);
  assert(dialogue, 'Synthetic fixture has no dialogue for the Head Group Character.');
  assert(dialogue.startMs === 300, `Synthetic dialogue start changed from the calibrated 300ms checkpoint base: ${dialogue.startMs}.`);
  const safeRoot = `${path.resolve(projectRoot)}${path.sep}`.toLowerCase();
  for (const asset of project.assets) {
    const assetPath = path.resolve(projectRoot, asset.relativePath);
    assert(assetPath.toLowerCase().startsWith(safeRoot), `Asset escaped the fixture root: ${asset.id}`);
    assert(sha256(readFileSync(assetPath)) === asset.sha256, `Synthetic fixture asset integrity failed: ${asset.id}`);
  }
  return { project, dialogue, manifestSha256: sha256(manifestBytes) };
}

function appendResourceSwitchShot(project) {
  const sourceShot = project.shots[0];
  assert(sourceShot, 'Synthetic fixture has no source Shot to duplicate.');
  const character = project.characters.find((item) => item.mode === 'composite' && item.head);
  assert(character?.mouthOpenAssetId, 'Synthetic Character has no Mouth resource for the Shot-switch case.');
  const sourceCharacterLayer = sourceShot.layers.find((layer) =>
    layer.source.kind === 'character' && layer.source.characterId === character.id,
  );
  assert(sourceCharacterLayer, 'Synthetic source Shot has no Character layer.');

  const switchedExpressionId = randomUUID();
  character.expressions.push({
    id: switchedExpressionId,
    name: 'Synthetic resource switch',
    assetId: character.mouthOpenAssetId,
  });
  const layerIds = new Map(sourceShot.layers.map((layer) => [layer.id, randomUUID()]));
  const audioClipIds = new Map(sourceShot.audioClips.map((clip) => [clip.id, randomUUID()]));
  const alternateShot = {
    ...structuredClone(sourceShot),
    id: randomUUID(),
    name: `${sourceShot.name} resource switch`,
    layers: sourceShot.layers.map((layer) => {
      const source = structuredClone(layer.source);
      if (source.kind === 'character' && source.characterId === character.id) {
        source.expressionId = switchedExpressionId;
      }
      return { ...structuredClone(layer), id: layerIds.get(layer.id), source };
    }),
    backgroundLayerId: sourceShot.backgroundLayerId === null
      ? null
      : layerIds.get(sourceShot.backgroundLayerId),
    audioClips: sourceShot.audioClips.map((clip) => ({
      ...structuredClone(clip),
      id: audioClipIds.get(clip.id),
    })),
    dialogues: sourceShot.dialogues.map((dialogue) => ({
      ...structuredClone(dialogue),
      id: randomUUID(),
      audioClipId: dialogue.audioClipId === undefined
        ? undefined
        : audioClipIds.get(dialogue.audioClipId),
    })),
    timelineEvents: sourceShot.timelineEvents.map((event) => ({
      ...structuredClone(event),
      id: randomUUID(),
      layerId: layerIds.get(event.layerId),
    })),
  };
  project.shots.push(alternateShot);
  return {
    baseShotId: sourceShot.id,
    alternateShotId: alternateShot.id,
    baseCharacterLayerId: sourceCharacterLayer.id,
    alternateCharacterLayerId: layerIds.get(sourceCharacterLayer.id),
    baseFaceAssetId: character.expressions.find(
      (expression) => expression.id === sourceCharacterLayer.source.expressionId,
    )?.assetId,
    alternateFaceAssetId: character.mouthOpenAssetId,
  };
}

function appendSpeakerSwitch(project, shotId, characterLayerId) {
  const shot = project.shots.find((item) => item.id === shotId);
  const sourceCharacter = project.characters.find((item) => item.mode === 'composite' && item.head);
  const sourceLayer = shot?.layers.find((layer) => layer.id === characterLayerId);
  assert(shot && sourceCharacter && sourceLayer?.source.kind === 'character', 'Speaker-switch source Shot or Character is missing.');
  const firstDialogue = shot.dialogues.find((item) => item.characterId === sourceCharacter.id);
  assert(firstDialogue?.audioClipId, 'Speaker-switch source dialogue has no audio clip.');
  const firstClip = shot.audioClips.find((item) => item.id === firstDialogue.audioClipId);
  assert(firstClip, 'Speaker-switch source dialogue audio clip is missing.');

  const speakerBId = randomUUID();
  const expressionIds = new Map(sourceCharacter.expressions.map((expression) => [expression.id, randomUUID()]));
  const speakerB = {
    ...structuredClone(sourceCharacter),
    id: speakerBId,
    name: sourceCharacter.name + ' speaker B',
    defaultVoiceProfileId: randomUUID(),
    expressions: sourceCharacter.expressions.map((expression) => ({
      ...structuredClone(expression),
      id: expressionIds.get(expression.id),
    })),
    defaultExpressionId: expressionIds.get(sourceCharacter.defaultExpressionId),
  };
  project.characters.push(speakerB);
  const sourceVoice = project.voiceProfiles.find((item) => item.id === sourceCharacter.defaultVoiceProfileId);
  assert(sourceVoice, 'Speaker-switch source voice profile is missing.');
  project.voiceProfiles.push({
    ...structuredClone(sourceVoice),
    id: speakerB.defaultVoiceProfileId,
    name: sourceVoice.name + ' speaker B',
    characterId: speakerB.id,
  });

  firstDialogue.endMs = 1_700;
  firstClip.endMs = 1_700;
  const speakerBAudioClipId = randomUUID();
  shot.audioClips.push({
    ...structuredClone(firstClip),
    id: speakerBAudioClipId,
    name: firstClip.name + ' speaker B',
    startMs: 1_700,
    endMs: 3_100,
    offsetMs: 0,
  });
  shot.dialogues.push({
    ...structuredClone(firstDialogue),
    id: randomUUID(),
    characterId: speakerB.id,
    voiceProfileId: speakerB.defaultVoiceProfileId,
    audioClipId: speakerBAudioClipId,
    startMs: 1_700,
    endMs: 3_100,
    text: 'Synthetic speaker B dialogue',
  });
  const speakerBLayerId = randomUUID();
  shot.layers.push({
    ...structuredClone(sourceLayer),
    id: speakerBLayerId,
    name: sourceLayer.name + ' speaker B',
    source: {
      kind: 'character',
      characterId: speakerB.id,
      expressionId: speakerB.defaultExpressionId,
    },
    x: 1_450,
    zIndex: Math.max(...shot.layers.map((layer) => layer.zIndex)) + 1,
  });
  return {
    speakerAEndMs: firstDialogue.endMs,
    speakerBId,
    speakerBLayerId,
    speakerBDialogueStartMs: 1_700,
    speakerBDialogueEndMs: 3_100,
  };
}

function appendOpacityReferenceShots(project) {
  const sourceShot = project.shots[0];
  assert(sourceShot, 'Synthetic fixture has no source Shot for opacity checks.');
  const characterLayer = sourceShot.layers.find((layer) => layer.source.kind === 'character');
  const backgroundLayer = sourceShot.layers.find((layer) => layer.id === sourceShot.backgroundLayerId);
  assert(characterLayer && backgroundLayer?.source.kind === 'asset', 'Opacity reference Shot needs Character and background layers.');

  const cloneShot = (name, characterVisible) => {
    const layerIds = new Map(sourceShot.layers.map((layer) => [layer.id, randomUUID()]));
    const audioClipIds = new Map(sourceShot.audioClips.map((clip) => [clip.id, randomUUID()]));
    const shot = {
      ...structuredClone(sourceShot),
      id: randomUUID(),
      name,
      layers: sourceShot.layers.map((layer) => ({
        ...structuredClone(layer),
        id: layerIds.get(layer.id),
        ...(layer.id === characterLayer.id
          ? { opacity: characterVisible ? 0.5 : 1, visible: characterVisible }
          : {}),
      })),
      backgroundLayerId: layerIds.get(sourceShot.backgroundLayerId),
      audioClips: sourceShot.audioClips.map((clip) => ({
        ...structuredClone(clip),
        id: audioClipIds.get(clip.id),
      })),
      dialogues: sourceShot.dialogues.map((dialogue) => ({
        ...structuredClone(dialogue),
        id: randomUUID(),
        audioClipId: dialogue.audioClipId === undefined ? undefined : audioClipIds.get(dialogue.audioClipId),
      })),
      timelineEvents: sourceShot.timelineEvents.map((event) => ({
        ...structuredClone(event),
        id: randomUUID(),
        layerId: layerIds.get(event.layerId),
      })),
    };
    project.shots.push(shot);
    return {
      shotId: shot.id,
      characterLayerId: layerIds.get(characterLayer.id),
      characterOpacity: characterVisible ? 0.5 : 1,
      characterVisible,
    };
  };

  return {
    backgroundAssetId: backgroundLayer.source.assetId,
    halfOpacity: cloneShot('Synthetic 0.5 Character opacity', true),
    backgroundOnly: cloneShot('Synthetic background pixel reference', false),
  };
}

function prepareIntensityProject(sourceRoot, sourceProject, intensityPercent) {
  const projectRoot = path.join(runRoot, `intensity-${intensityPercent}.pandastage`);
  cpSync(sourceRoot, projectRoot, { recursive: true, errorOnExist: true });
  const projectPath = path.join(projectRoot, 'project.json');
  const project = ProjectSchema.parse(JSON.parse(readFileSync(projectPath, 'utf8')));
  const character = project.characters.find((item) => item.mode === 'composite' && item.head);
  assert(character, 'Copied fixture lost its Head Group Character.');
  character.talkingHeadMotionIntensityPercent = intensityPercent;
  project.id = randomUUID();
  project.name = `Issue 872 synthetic motion pixels ${intensityPercent}%`;
  project.updatedAt = new Date().toISOString();
  const resourceSwitch = appendResourceSwitchShot(project);
  const speakerSwitch = appendSpeakerSwitch(
    project,
    resourceSwitch.alternateShotId,
    resourceSwitch.alternateCharacterLayerId,
  );
  const opacityReference = appendOpacityReferenceShots(project);
  const validated = ProjectSchema.parse(project);
  writeFileSync(projectPath, JSON.stringify(validated, null, 2), 'utf8');
  return {
    projectRoot,
    projectId: validated.id,
    sourceProjectId: sourceProject.id,
    intensityPercent,
    ...resourceSwitch,
    ...speakerSwitch,
    ...opacityReference,
  };
}

function prepareExportComparisonProject(sourceVariant) {
  const projectRoot = path.join(runRoot, 'surface-comparison-100.pandastage');
  cpSync(sourceVariant.projectRoot, projectRoot, { recursive: true, errorOnExist: true });
  const projectPath = path.join(projectRoot, 'project.json');
  const project = ProjectSchema.parse(JSON.parse(readFileSync(projectPath, 'utf8')));
  const shot = project.shots.find((item) => item.id === sourceVariant.alternateShotId);
  assert(shot, 'Surface comparison source Shot is missing.');
  const speakerALayer = shot.layers.find((layer) => layer.id === sourceVariant.alternateCharacterLayerId);
  const speakerBLayer = shot.layers.find((layer) => layer.id === sourceVariant.speakerBLayerId);
  assert(speakerALayer && speakerBLayer, 'Surface comparison speaker layers are missing.');
  speakerALayer.opacity = 0.5;
  project.shots = [shot];
  project.id = randomUUID();
  project.name = 'Issue 872 synthetic editor preview export comparison';
  project.updatedAt = new Date().toISOString();
  const validated = ProjectSchema.parse(project);
  writeFileSync(projectPath, JSON.stringify(validated, null, 2), 'utf8');
  return {
    projectRoot,
    projectId: validated.id,
    sourceProjectId: sourceVariant.projectId,
    intensityPercent: 100,
    baseShotId: shot.id,
    alternateShotId: shot.id,
    baseCharacterLayerId: speakerALayer.id,
    alternateCharacterLayerId: speakerALayer.id,
    speakerBLayerId: speakerBLayer.id,
    alternateFaceAssetId: sourceVariant.alternateFaceAssetId,
    speakerALayerOpacity: speakerALayer.opacity,
    speakerBLayerOpacity: speakerBLayer.opacity ?? 1,
  };
}

function register(channel, handler) {
  ipcMain.handle(channel, handler);
  registeredChannels.push(channel);
}

function registerFixtureIpc(projectVariants) {
  const projects = new Map(projectVariants.map((variant) => {
    const projectFilePath = path.join(variant.projectRoot, 'project.json');
    const project = ProjectSchema.parse(JSON.parse(readFileSync(projectFilePath, 'utf8')));
    const assetBytes = new Map(project.assets.map((asset) => [
      asset.id,
      readFileSync(path.resolve(variant.projectRoot, asset.relativePath)),
    ]));
    return [path.resolve(variant.projectRoot), { variant, project, projectFilePath, assetBytes }];
  }));
  const getProject = (projectRoot) => projects.get(path.resolve(projectRoot));
  const documentFor = (entry) => ({
    projectRoot: entry.variant.projectRoot,
    projectFilePath: entry.projectFilePath,
    project: entry.project,
    migrated: false,
    sourceVersion: entry.project.schemaVersion,
  });

  register(IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY, () => ({ ok: true, status: 'cancelled' }));
  register(IPC_CHANNELS.PROJECT_OPEN, (_event, request) => {
    const entry = getProject(request.projectRoot);
    return entry
      ? { ok: true, value: documentFor(entry) }
      : { ok: false, error: { code: 'PROJECT_NOT_FOUND', message: 'Unknown synthetic Issue 872 fixture.', projectRoot: request.projectRoot } };
  });
  register(IPC_CHANNELS.RECENT_PROJECTS_LIST, () => ({ ok: true, entries: [] }));
  register(IPC_CHANNELS.RECENT_PROJECTS_OPEN, (_event, request) => {
    const entry = getProject(request.projectRoot);
    return entry
      ? { ok: true, document: documentFor(entry) }
      : { ok: false, error: { code: 'RECENT_PROJECT_NOT_FOUND', message: 'Unknown synthetic Issue 872 fixture.', projectRoot: request.projectRoot } };
  });
  register(IPC_CHANNELS.PROJECT_CONFIRM_SWITCH, () => ({ outcome: 'saved' }));
  register(IPC_CHANNELS.PROJECT_SAVE, (_event, request) => {
    const entry = getProject(request.projectRoot);
    if (!entry) throw new Error('Unexpected project write outside the synthetic fixture set.');
    return { ok: true, value: documentFor({ ...entry, project: request.project }) };
  });
  register(IPC_CHANNELS.AUTOSAVE_TRACK, () => ({ ok: true }));
  register(IPC_CHANNELS.AUTOSAVE_UPDATE, () => ({ ok: true }));
  register(IPC_CHANNELS.AUTOSAVE_STOP, () => ({ ok: true }));
  register(IPC_CHANNELS.RECOVERY_DETECT, () => ({ ok: true, candidate: null }));
  register(IPC_CHANNELS.RECOVERY_IGNORE, () => ({ ok: true, retained: true }));
  register(IPC_CHANNELS.ASSET_THUMBNAIL_READ, (_event, request) => {
    const entry = [...projects.values()].find((candidate) => candidate.project.assets.some((asset) => asset.id === request.assetId));
    const bytes = entry?.assetBytes.get(request.assetId);
    return {
      ok: true,
      status: 'ready',
      assetId: request.assetId,
      dataUrl: `data:${entry?.project.assets.find((asset) => asset.id === request.assetId)?.mimeType ?? 'image/png'};base64,${bytes?.toString('base64') ?? ''}`,
    };
  });
  register(IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ, (_event, request) => {
    const entry = [...projects.values()].find((candidate) => candidate.project.assets.some((asset) => asset.id === request.assetId));
    const asset = entry?.project.assets.find((candidate) => candidate.id === request.assetId);
    const bytes = entry?.assetBytes.get(request.assetId);
    if (!asset || asset.kind !== 'image' || !bytes || asset.sha256 !== request.sha256 || sha256(bytes) !== request.sha256) {
      return { ok: false, error: { code: 'ASSET_CANVAS_IMAGE_READ_FAILED', message: 'Synthetic image asset integrity check failed.', assetId: request.assetId } };
    }
    return {
      ok: true,
      status: 'ready',
      assetId: asset.id,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      byteLength: bytes.byteLength,
      bytes: new Uint8Array(bytes),
    };
  });
  register(IPC_CHANNELS.ASSET_PREVIEW_AUDIO_READ, (_event, request) => {
    const entry = [...projects.values()].find((candidate) => candidate.project.assets.some((asset) => asset.id === request.assetId));
    const asset = entry?.project.assets.find((candidate) => candidate.id === request.assetId);
    const bytes = entry?.assetBytes.get(request.assetId);
    if (!asset || asset.kind !== 'audio' || !bytes || asset.sha256 !== request.sha256 || sha256(bytes) !== request.sha256) {
      return { ok: false, error: { code: 'ASSET_PREVIEW_AUDIO_READ_FAILED', message: 'Synthetic audio asset integrity check failed.', assetId: request.assetId } };
    }
    return {
      ok: true,
      status: 'ready',
      assetId: asset.id,
      mimeType: asset.mimeType,
      byteLength: bytes.byteLength,
      bytes: new Uint8Array(bytes),
    };
  });
}

async function waitFor(window, expression, message, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(message);
}

async function evaluate(window, source) {
  return window.webContents.executeJavaScript(source);
}

async function openProject(window, projectRoot) {
  await waitFor(
    window,
    `Boolean(document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input'))`,
    'Project Center path input did not appear.',
  );
  await evaluate(window, `(() => {
    const input = document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setValue.call(input, ${JSON.stringify(projectRoot)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-testid="project-center-screen"] .recovery-open-row button').click();
  })()`);
  await waitFor(window, `Boolean(document.querySelector('[data-testid="editor-layout"]'))`, 'Synthetic project did not open.');
}

async function closeProjectAndAssertStageUnmounted(window) {
  await closePreview(window);
  const saveState = await evaluate(
    window,
    `document.querySelector('[data-testid="quick-action-drawer"]')?.dataset.saveState ?? null`,
  );
  assert(saveState !== 'dirty', `Synthetic project unexpectedly became dirty before close: ${saveState}`);
  await evaluate(window, `(() => {
    const drawer = document.querySelector('[data-testid="quick-action-drawer"]');
    if (drawer?.dataset.expanded !== 'true') {
      drawer?.querySelector('[data-testid="quick-action-drawer-handle"]')?.click();
    }
    drawer?.querySelector('[data-testid="quick-action-close"]')?.click();
  })()`);
  await waitFor(
    window,
    `Boolean(document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input'))`,
    'Editor did not return to Project Center after closing the synthetic project.',
  );
  await waitFor(
    window,
    `!document.querySelector('[data-testid="project-canvas-stage"]') &&
      !document.querySelector('[data-testid="stage-renderer"]') &&
      !document.querySelector('[data-testid="product-preview-overlay"]')`,
    'Editor Stage or Product Preview remained mounted after project close.',
  );
  return { projectCenterVisible: true, editorStageUnmounted: true };
}

async function closePreview(window) {
  await evaluate(window, `document.querySelector('[data-testid="product-preview-close"]')?.click()`);
  await waitFor(
    window,
    `!document.querySelector('[data-testid="product-preview-overlay"]')`,
    'Product Preview did not close.',
  );
}

async function selectShot(window, shotId, characterLayerId, faceAssetId) {
  await evaluate(window, `(() => {
    const dock = document.querySelector('[data-testid="resource-activity-dock"]');
    if (!dock) throw new Error('Shot selection resource dock is missing.');
    if (dock.dataset.resourceDrawerOpen !== 'true') {
      dock.querySelector('[data-testid="resource-workspace-handle"]')?.click();
    }
    if (dock.dataset.activeActivity !== 'shots') {
      dock.querySelector('[data-testid="resource-activity-tabs"] [data-activity="shots"]')?.click();
    }
    const shotButton = document.querySelector(
      '[data-testid="shot-list-view"] [data-shot-id="' + ${JSON.stringify(shotId)} + '"] button',
    );
    if (!shotButton) throw new Error('Requested synthetic Shot is not listed.');
    shotButton.click();
  })()`);
  await waitFor(
    window,
    `(() => {
      const selected = document.querySelector(
        '[data-testid="shot-list-view"] [data-shot-id="' + ${JSON.stringify(shotId)} + '"] button[aria-current="true"]',
      );
      const canvas = document.querySelector('[data-testid="project-canvas-stage"]');
      const layers = JSON.parse(canvas?.dataset.layerJson ?? '[]');
      const readyAssets = JSON.parse(canvas?.dataset.renderedAssetIds ?? '[]');
      return Boolean(selected) &&
        layers.some((layer) => layer.id === ${JSON.stringify(characterLayerId)}) &&
        readyAssets.includes(${JSON.stringify(faceAssetId)});
    })()` ,
    'Editor did not select the requested Shot and load its alternate Face resource.',
  );
}

async function openPreview(window, expectedShotId) {
  await evaluate(window, `(() => {
    const drawer = document.querySelector('[data-testid="quick-action-drawer"]');
    if (drawer?.dataset.expanded !== 'true') {
      drawer?.querySelector('[data-testid="quick-action-drawer-handle"]')?.click();
    }
  })()`);
  await waitFor(
    window,
    `document.querySelector('[data-testid="quick-action-drawer"]')?.dataset.expanded === 'true'`,
    'Quick Action Drawer did not open.',
  );
  await evaluate(window, `document.querySelector('[data-testid="quick-action-play"]')?.click()`);
  await waitFor(
    window,
    `Boolean(document.querySelector('[data-testid="product-preview-overlay"]'))`,
    'Product Preview overlay did not mount.',
  );
  await evaluate(window, `document.querySelectorAll('[data-testid="product-preview-range"] [role="tab"]')[1]?.click()`);
  await waitFor(
    window,
    `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewRange === 'shot'`,
    'Current Shot Preview range did not activate.',
  );
  await waitFor(
    window,
    `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewSurface === 'active' &&
      document.querySelector('.product-preview-stage [data-testid="stage-renderer"]')?.dataset.stageReady === 'true' &&
      document.querySelector('.product-preview-stage [data-testid="stage-renderer"]')?.dataset.stageDisplayReady === 'true' &&
      document.querySelector('.product-preview-stage [data-testid="stage-renderer"]')?.dataset.stageShotId === ${JSON.stringify(expectedShotId)}`,
    'Product Preview did not mount a display-ready Stage.',
  );
  await evaluate(window, `(() => {
    const overlay = document.querySelector('[data-testid="product-preview-overlay"]');
    if (overlay?.dataset.previewPlaying === 'true') {
      document.querySelector('[data-testid="product-preview-play-pause"]')?.click();
    }
    document.querySelector('[data-testid="product-preview-stop"]')?.click();
    window.__pandaPreviewDiagnostics = {
      scenePixelRatio: 1,
      forceCompositeCacheRebuild: false,
      events: [],
      record(event, atMs, detail) {
        if (this.events.length < 20000) this.events.push({ event, atMs, ...detail });
      },
      reset() { this.events.length = 0; },
      read() { return this.events.slice(); },
    };
  })()`);
  await waitFor(
    window,
    `Number(document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewTime ?? -1) === 0 &&
      Number(document.querySelector('.product-preview-stage [data-testid="stage-renderer"]')?.dataset.stageTime ?? -1) === 0`,
    'Product Preview did not stop at the initial frame.',
  );
}

async function seekAndCapture(
  window,
  intensityPercent,
  checkpoint,
  ownerLayerId,
  target = 'primary',
  captureRegions = PRIMARY_CAPTURE_REGIONS,
) {
  await evaluate(window, `(() => {
    const input = document.querySelector('[data-testid="product-preview-scrubber"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('Preview scrubber missing.');
    input.step = '1';
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setValue.call(input, ${JSON.stringify(String(checkpoint.timeMs))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  try {
    await waitFor(
      window,
      `(() => {
      const stage = document.querySelector('.product-preview-stage [data-testid="stage-renderer"]');
      return stage?.dataset.stageReady === 'true' &&
        Math.abs(Number(stage.dataset.stageTime ?? -1) - ${checkpoint.timeMs}) <= 5;
      })()`,
      `Stage did not reach exact time ${checkpoint.timeMs}ms at ${intensityPercent}%.`,
    );
  } catch (error) {
    const state = await evaluate(window, `(() => {
      const overlay = document.querySelector('[data-testid="product-preview-overlay"]');
      const stage = document.querySelector('.product-preview-stage [data-testid="stage-renderer"]');
      const input = document.querySelector('[data-testid="product-preview-scrubber"]');
      return {
        previewTime: overlay?.dataset.previewTime ?? null,
        playing: overlay?.dataset.previewPlaying ?? null,
        stageTime: stage?.dataset.stageTime ?? null,
        stageReady: stage?.dataset.stageReady ?? null,
        stageDisplayReady: stage?.dataset.stageDisplayReady ?? null,
        scrubberValue: input?.value ?? null,
        scrubberMax: input?.max ?? null,
      };
    })()`);
    throw new Error(`${error instanceof Error ? error.message : String(error)} state=${JSON.stringify(state)}`, { cause: error });
  }
  await evaluate(window, `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  const capture = await evaluate(window, `(() => {
    const stage = document.querySelector('.product-preview-stage [data-testid="stage-renderer"]');
    const canvas = stage?.querySelector('canvas');
    if (!stage || !(canvas instanceof HTMLCanvasElement)) throw new Error('Product Preview Stage canvas is missing.');
    const logicalWidth = Number(stage.dataset.logicalWidth ?? 1920);
    const logicalHeight = Number(stage.dataset.logicalHeight ?? 1080);
    const scaleX = canvas.width / logicalWidth;
    const scaleY = canvas.height / logicalHeight;
    const regions = ${JSON.stringify(captureRegions)};
    const region = regions.head;
    const faceMouthRegion = regions.faceMouth;
    const sourceX = Math.round(region.x * scaleX);
    const sourceY = Math.round(region.y * scaleY);
    const sourceWidth = Math.round(region.width * scaleX);
    const sourceHeight = Math.round(region.height * scaleY);
    const crop = document.createElement('canvas');
    crop.width = sourceWidth;
    crop.height = sourceHeight;
    const cropContext = crop.getContext('2d');
    if (!cropContext) throw new Error('Unable to read the Head Group pixel crop.');
    cropContext.drawImage(canvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
    const faceMouthCanvas = document.createElement('canvas');
    faceMouthCanvas.width = Math.round(faceMouthRegion.width * scaleX);
    faceMouthCanvas.height = Math.round(faceMouthRegion.height * scaleY);
    const faceMouthContext = faceMouthCanvas.getContext('2d');
    if (!faceMouthContext) throw new Error('Unable to read the Face/Mouth pixel crop.');
    faceMouthContext.drawImage(
      canvas,
      Math.round(faceMouthRegion.x * scaleX),
      Math.round(faceMouthRegion.y * scaleY),
      faceMouthCanvas.width,
      faceMouthCanvas.height,
      0,
      0,
      faceMouthCanvas.width,
      faceMouthCanvas.height,
    );
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to read Stage pixels.');
    const readPixel = (x, y) => {
      const px = Math.max(0, Math.min(canvas.width - 1, Math.round(x * scaleX)));
      const py = Math.max(0, Math.min(canvas.height - 1, Math.round(y * scaleY)));
      return [...context.getImageData(px, py, 1, 1).data];
    };
    return {
      stageTimeMs: Number(stage.dataset.stageTime ?? -1),
      stageReady: stage.dataset.stageReady === 'true',
      stageDisplayReady: stage.dataset.stageDisplayReady === 'true',
      canvas: { width: canvas.width, height: canvas.height, logicalWidth, logicalHeight },
      headCropPngBase64: crop.toDataURL('image/png').split(',')[1],
      faceMouthCropPngBase64: faceMouthCanvas.toDataURL('image/png').split(',')[1],
      backgroundPixel: readPixel(100, 100),
      bodyPixels: regions.bodySamples.map(([x, y]) => readPixel(x, y)),
      alphaSamples: (regions.alphaSamples ?? []).map(({ name, x, y }) => ({ name, rgba: readPixel(x, y) })),
      cacheEvents: window.__pandaPreviewDiagnostics?.read?.() ?? [],
    };
  })()`);
  const cacheEvents = capture.cacheEvents;
  const lastCacheEvent = [...cacheEvents].reverse().find((event) =>
    (event.event === 'composite-cache-rebuild' || event.event === 'composite-cache-reuse') &&
      event.ownerLayerId === ownerLayerId,
  );
  const visualSignature = lastCacheEvent?.visualSignature
    ? JSON.parse(lastCacheEvent.visualSignature)
    : null;
  const { headCropPngBase64, faceMouthCropPngBase64 } = capture;
  const captureMetadata = {
    stageTimeMs: capture.stageTimeMs,
    stageReady: capture.stageReady,
    stageDisplayReady: capture.stageDisplayReady,
    canvas: capture.canvas,
    backgroundPixel: capture.backgroundPixel,
    bodyPixels: capture.bodyPixels,
    alphaSamples: capture.alphaSamples,
  };
  assert(capture.stageReady && capture.stageDisplayReady, `Preview Stage was not exact and drawable: ${JSON.stringify(captureMetadata)}`);
  assert(capture.stageTimeMs === checkpoint.timeMs, `Preview Stage time drifted: ${JSON.stringify(captureMetadata)}`);
  if (ownerLayerId) {
    assert(visualSignature?.headGroup?.transform, `Composite cache diagnostic omitted the Head Group transform for ${ownerLayerId}.`);
  }
  const png = Buffer.from(headCropPngBase64, 'base64');
  const faceMouthPng = Buffer.from(faceMouthCropPngBase64, 'base64');
  const filename = `head-${target}-${intensityPercent}-${checkpoint.label}.png`;
  const faceMouthFilename = `face-mouth-${target}-${intensityPercent}-${checkpoint.label}.png`;
  writeFileSync(path.join(evidenceRoot, filename), png);
  writeFileSync(path.join(evidenceRoot, faceMouthFilename), faceMouthPng);
  return {
    target,
    intensityPercent,
    checkpoint: checkpoint.label,
    requestedTimeMs: checkpoint.timeMs,
    elapsedFromDialogueStartMs: checkpoint.elapsedMs,
    ...captureMetadata,
    headGroupTransform: visualSignature?.headGroup?.transform ?? null,
    cacheEventCounts: {
      rebuild: cacheEvents.filter((event) => event.event === 'composite-cache-rebuild').length,
      reuse: cacheEvents.filter((event) => event.event === 'composite-cache-reuse').length,
    },
    headCropPath: path.join(evidenceRoot, filename),
    headCropSha256: sha256(png),
    faceMouthCropPath: path.join(evidenceRoot, faceMouthFilename),
    faceMouthCropSha256: sha256(faceMouthPng),
  };
}

async function seekEditorFrame(window, timeMs) {
  await evaluate(window, `(() => {
    const dock = document.querySelector('[data-testid="timeline-dock"]');
    if (dock?.dataset.expanded !== 'true') {
      dock?.querySelector('[data-testid="timeline-collapse"]')?.click();
    }
  })()`);
  await waitFor(
    window,
    `document.querySelector('[data-testid="timeline-dock"]')?.dataset.expanded === 'true' &&
      Boolean(document.querySelector('[data-testid="timeline-ruler-track"]'))`,
    'Editor Timeline ruler did not expand for the surface comparison.',
  );
  const seek = await evaluate(window, `(() => {
    const dock = document.querySelector('[data-testid="timeline-dock"]');
    const track = document.querySelector('[data-testid="timeline-ruler-track"]');
    if (!dock || !track) throw new Error('Editor Timeline ruler is missing.');
    const durationMs = Number(track.dataset.duration ?? 0);
    const laneLabelWidth = Number(dock.dataset.laneLabelWidth ?? 0);
    const contentWidth = Number.parseFloat(track.style.width) - laneLabelWidth;
    if (!(durationMs > 0) || !(contentWidth > 0)) throw new Error('Editor Timeline ruler dimensions are invalid.');
    const pixelsPerMs = contentWidth / durationMs;
    const rect = track.getBoundingClientRect();
    const clientX = rect.left + ${timeMs} * pixelsPerMs;
    const clientY = rect.top + Math.max(1, Math.min(rect.height - 1, 4));
    Object.defineProperties(track, {
      setPointerCapture: { configurable: true, value() {} },
      hasPointerCapture: { configurable: true, value() { return false; } },
      releasePointerCapture: { configurable: true, value() {} },
    });
    const eventOptions = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', clientX, clientY, buttons: 1 };
    track.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
    track.dispatchEvent(new PointerEvent('pointerup', { ...eventOptions, buttons: 0 }));
    return {
      requestedTimeMs: ${timeMs},
      durationMs,
      laneLabelWidth,
      contentWidth,
      currentTimeMs: Number(document.querySelector('[data-testid="timeline-timecode"]')?.dataset.currentTime ?? -1),
    };
  })()`);
  assert(seek.durationMs >= timeMs, `Editor Shot duration ${seek.durationMs}ms is shorter than the requested frame time.`);
  try {
    await waitFor(
      window,
      `(() => {
        const stage = document.querySelector('[data-testid="project-canvas-stage"]');
        const renderer = stage?.querySelector('.stage-renderer');
        const assetsReady = stage?.dataset.renderedAssetIds !== undefined &&
          JSON.parse(stage.dataset.incompleteVisualLayerIds ?? '[]').length === 0;
        return Math.abs(Number(stage?.dataset.currentTimeMs ?? -1) - ${timeMs}) < 0.01 &&
          (renderer?.dataset.stageReady === 'true' && renderer?.dataset.stageDisplayReady === 'true' || assetsReady);
      })()`,
      `Editor Stage did not render the formal frame time ${timeMs}ms.`,
    );
  } catch (error) {
    const state = await evaluate(window, `(() => {
      const stage = document.querySelector('[data-testid="project-canvas-stage"]');
      const renderer = stage?.querySelector('.stage-renderer');
      const dock = document.querySelector('[data-testid="timeline-dock"]');
      const track = document.querySelector('[data-testid="timeline-ruler-track"]');
      return {
        requestedTimeMs: ${timeMs},
        seek: ${JSON.stringify(seek)},
        stageTimeMs: stage?.dataset.currentTimeMs ?? null,
        stageReady: renderer?.dataset.stageReady ?? null,
        stageDisplayReady: renderer?.dataset.stageDisplayReady ?? null,
        rendererTimeMs: renderer?.dataset.stageTime ?? null,
        incompleteVisualLayerIds: stage?.dataset.incompleteVisualLayerIds ?? null,
        renderedAssetIds: stage?.dataset.renderedAssetIds ?? null,
        timelineTimeMs: document.querySelector('[data-testid="timeline-timecode"]')?.dataset.currentTime ?? null,
        dockExpanded: dock?.dataset.expanded ?? null,
        trackWidth: track?.style.width ?? null,
        laneLabelWidth: dock?.dataset.laneLabelWidth ?? null,
      };
    })()`);
    throw new Error(`${error instanceof Error ? error.message : String(error)} state=${JSON.stringify(state)}`, { cause: error });
  }
  await evaluate(window, `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  return seek;
}

async function seekPreviewFrame(window, timeMs) {
  await evaluate(window, `(() => {
    const input = document.querySelector('[data-testid="product-preview-scrubber"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('Preview scrubber is missing for the surface comparison.');
    input.step = 'any';
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setValue.call(input, ${JSON.stringify(String(timeMs))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor(
    window,
    `(() => {
      const stage = document.querySelector('.product-preview-stage [data-testid="stage-renderer"]');
      return Math.abs(Number(stage?.dataset.stageTime ?? -1) - ${timeMs}) < 0.01 &&
        stage?.dataset.stageReady === 'true' && stage?.dataset.stageDisplayReady === 'true';
    })()`,
    `Product Preview did not render the formal frame time ${timeMs}ms.`,
  );
  await evaluate(window, `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
}

async function captureSurfacePixels(window, stageSelector, label, expectedTimeMs) {
  const capture = await evaluate(window, `(() => {
    const container = document.querySelector(${JSON.stringify(stageSelector)});
    const renderer = container?.matches('.stage-renderer') ? container : container?.querySelector('.stage-renderer');
    const stageRoot = renderer ?? container;
    const canvas = stageRoot?.querySelector('canvas');
    if (!container || !stageRoot || !(canvas instanceof HTMLCanvasElement)) {
      throw new Error('Requested ' + ${JSON.stringify(label)} + ' Stage canvas is missing.');
    }
    const viewport = container.closest('[data-testid="project-canvas-viewport"]');
    const logicalWidth = Number(stageRoot.dataset.logicalWidth ?? container.dataset.logicalWidth ?? viewport?.dataset.logicalWidth ?? canvas.width);
    const logicalHeight = Number(stageRoot.dataset.logicalHeight ?? container.dataset.logicalHeight ?? viewport?.dataset.logicalHeight ?? canvas.height);
    const scaleX = canvas.width / logicalWidth;
    const scaleY = canvas.height / logicalHeight;
    const source = canvas.getContext('2d');
    if (!source) throw new Error('Requested Stage canvas has no readable 2D context.');
    const encodeBase64 = (bytes) => {
      let binary = '';
      const chunkSize = 0x8000;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
      }
      return btoa(binary);
    };
    const regions = ${JSON.stringify(SURFACE_COMPARISON_REGIONS)};
    const crops = Object.fromEntries(Object.entries(regions).map(([name, region]) => {
      const crop = document.createElement('canvas');
      crop.width = region.width;
      crop.height = region.height;
      const context = crop.getContext('2d');
      if (!context) throw new Error('Unable to allocate the ' + name + ' comparison crop.');
      context.drawImage(canvas,
        Math.round(region.x * scaleX), Math.round(region.y * scaleY),
        Math.round(region.width * scaleX), Math.round(region.height * scaleY),
        0, 0, region.width, region.height);
      const image = context.getImageData(0, 0, region.width, region.height);
      return [name, {
        width: region.width,
        height: region.height,
        rgbaBase64: encodeBase64(image.data),
        pngBase64: crop.toDataURL('image/png').split(',')[1],
      }];
    }));
    const bodySamples = Object.fromEntries(Object.entries(${JSON.stringify(SURFACE_COMPARISON_BODY_SAMPLES)}).map(([name, points]) => [
      name,
      points.map(([x, y]) => {
        const pixel = source.getImageData(Math.round(x * scaleX), Math.round(y * scaleY), 1, 1).data;
        return [...pixel];
      }),
    ]));
    const editorVisualReady = container.dataset.renderedAssetIds !== undefined &&
      JSON.parse(container.dataset.incompleteVisualLayerIds ?? '[]').length === 0;
    return {
      stageTimeMs: Number(container.dataset.currentTimeMs ?? stageRoot.dataset.stageTime ?? -1),
      stageReady: stageRoot.dataset.stageReady === 'true' || editorVisualReady,
      stageDisplayReady: stageRoot.dataset.stageDisplayReady === 'true' || editorVisualReady,
      logicalSize: { width: logicalWidth, height: logicalHeight },
      canvasSize: { width: canvas.width, height: canvas.height },
      crops,
      bodySamples,
      cacheEvents: window.__pandaPreviewDiagnostics?.read?.() ?? [],
    };
  })()`);
  assert(capture.stageReady && capture.stageDisplayReady, `${label} Stage was not drawable at capture: ${JSON.stringify(capture)}`);
  assert(Math.abs(capture.stageTimeMs - expectedTimeMs) < 0.01, `${label} Stage time differs from the selected formal frame: ${capture.stageTimeMs}ms.`);
  const crops = {};
  for (const [name, crop] of Object.entries(capture.crops)) {
    const png = Buffer.from(crop.pngBase64, 'base64');
    const rgba = Buffer.from(crop.rgbaBase64, 'base64');
    const cropPath = path.join(evidenceRoot, `surface-${label}-${name}.png`);
    writeFileSync(cropPath, png);
    crops[name] = {
      width: crop.width,
      height: crop.height,
      path: cropPath,
      sha256: sha256(png),
      rgbaSha256: sha256(rgba),
      rgba,
    };
  }
  return {
    metadata: {
      stageTimeMs: capture.stageTimeMs,
      stageReady: capture.stageReady,
      stageDisplayReady: capture.stageDisplayReady,
      logicalSize: capture.logicalSize,
      canvasSize: capture.canvasSize,
    },
    crops,
    bodySamples: capture.bodySamples,
    cacheEvents: capture.cacheEvents,
  };
}

function registerFormalExportIpc(window, hiddenWindowManager, exportService) {
  return registerIpcHandlers({
    getMainWindow: () => window,
    getHiddenWindow: () => hiddenWindowManager.getWindow(),
    markHiddenReady: (senderId) => hiddenWindowManager.markReady(senderId),
    markProbeLoaded: (senderId, payload) => hiddenWindowManager.markProbeLoaded(senderId, payload),
    markFormalLoaded: (senderId, payload) => hiddenWindowManager.markFormalLoaded(senderId, payload),
    markFrameReady: (senderId, payload) => hiddenWindowManager.markFrameReady(senderId, payload),
    markFrameFailed: (senderId, payload) => hiddenWindowManager.markFrameFailed(senderId, payload),
    startFullProbe: () => {
      throw new Error('Probe export is not part of the Issue 872 surface comparison.');
    },
    startFormalExport: async () => {
      throw new Error('The Issue 872 surface comparison starts its formal Job through the production service directly.');
    },
    cancelExport: (jobId) => {
      const accepted = exportService.cancelJob(jobId);
      return { jobId, accepted, status: exportService.getJob(jobId)?.status ?? 'cancelled' };
    },
  });
}

async function runFormalExport(variant, window) {
  const projectPath = path.join(variant.projectRoot, 'project.json');
  const project = ProjectSchema.parse(JSON.parse(readFileSync(projectPath, 'utf8')));
  const projectRoot = path.resolve(variant.projectRoot);
  const openInstanceId = 1;
  const revision = 0;
  const dirty = false;
  const outputPath = path.join(runRoot, 'issue872-surface-comparison-100.mp4');
  const capturedFramePath = path.join(evidenceRoot, `formal-frame-${SURFACE_COMPARISON_FRAME_INDEX}.png`);
  const frameOutputRoot = path.join(runRoot, 'surface-comparison-frames');
  const exportFileSystem = new class extends FileSystemService {
    async writeFrame(jobDirectory, fileName, bytes) {
      await super.writeFrame(jobDirectory, fileName, bytes);
      if (fileName === `frame_${String(SURFACE_COMPARISON_FRAME_INDEX).padStart(6, '0')}.png`) {
        writeFileSync(capturedFramePath, bytes);
      }
    }
  }(frameOutputRoot);
  const hiddenWindowManager = new HiddenWindowManager({
    formalDrawMode: 'explicit-sync',
    formalPngMode: 'worker-png',
  });
  const mediaTools = resolveMediaToolPaths({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  });
  const mediaAdapter = new FFmpegAdapter({
    ffmpegPath: mediaTools.ffmpegPath,
    ffprobePath: mediaTools.ffprobePath,
  });
  const exportService = new ExportService(hiddenWindowManager, exportFileSystem, mediaAdapter);
  const fileStore = new NodeExportPreparationFileStore(path.join(runRoot, 'surface-comparison-preparation'));
  const preparationService = new ExportPreparationService({
    getCurrentProjectSnapshot: (requestedRoot) => path.resolve(requestedRoot) === projectRoot
      ? { project, revision, dirty, openInstanceId }
      : null,
    assertFormalOutputLocation: (selectedPath) => exportFileSystem.assertFormalOutputLocation(selectedPath),
    fileStore,
    mediaReader: new MainProjectAssetReader(),
  });
  const removeIpcHandlers = registerFormalExportIpc(window, hiddenWindowManager, exportService);
  let snapshotId = null;
  try {
    const selected = await preparationService.selectOutput({
      projectRoot,
      projectId: project.id,
      projectName: project.name,
      openInstanceId,
    }, outputPath);
    assert(selected.status === 'selected', `Formal export output selection failed: ${JSON.stringify(selected)}.`);
    const prepared = await preparationService.prepare({
      selectionId: selected.selectionId,
      attemptId: randomUUID(),
      projectRoot,
      projectId: project.id,
      openInstanceId,
      revision,
      dirty,
      cameraMode: 'static',
      project,
    });
    assert(prepared.status === 'PREPARATION_READY', `Formal export media preparation failed: ${JSON.stringify(prepared)}.`);
    snapshotId = prepared.candidate.snapshotId;
    const frozenInput = await preparationService.acquireCandidateForExport(snapshotId);
    const handle = exportService.startFormalExport(
      frozenInput,
      () => preparationService.assertOutputTargetUnchanged(snapshotId),
    );
    const result = await handle.completion;
    await preparationService.finalizeCandidateExport(snapshotId);
    snapshotId = null;
    assert(result.status === 'completed', `Formal export did not complete: ${JSON.stringify(result)}.`);
    assert(result.totalFrames === 77, `Formal export frame count changed: ${result.totalFrames}.`);
    assert(existsSync(capturedFramePath), `Formal hidden renderer did not write frame ${SURFACE_COMPARISON_FRAME_INDEX}.`);
    assert(existsSync(outputPath), 'Formal MP4 output is missing after the completed Job.');
    return {
      result,
      outputPath,
      outputSha256: sha256(readFileSync(outputPath)),
      outputByteLength: statSync(outputPath).size,
      capturedFramePath,
      capturedFrameSha256: sha256(readFileSync(capturedFramePath)),
      ffmpegPath: mediaTools.ffmpegPath,
      ffprobePath: mediaTools.ffprobePath,
      mediaAdapter,
    };
  } finally {
    if (snapshotId) {
      await preparationService.finalizeCandidateExport(snapshotId).catch(() => undefined);
    }
    removeIpcHandlers();
    hiddenWindowManager.releaseJob();
    preparationService.disposeSync();
  }
}

async function extractRgbaCrop(mediaAdapter, inputPath, outputPath, region, frameIndex = null) {
  const filters = [];
  if (frameIndex !== null) filters.push(`select=eq(n\\,${frameIndex})`);
  filters.push(`crop=${region.width}:${region.height}:${region.x}:${region.y}`, 'format=rgba');
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', inputPath,
    '-vf', filters.join(','),
  ];
  if (frameIndex !== null) args.push('-vsync', '0');
  args.push('-frames:v', '1', '-f', 'rawvideo', outputPath);
  const processResult = await mediaAdapter.runProcess(mediaAdapter.ffmpegPath, args);
  assert(processResult.code === 0, `FFmpeg could not decode crop ${outputPath}: ${processResult.stderr}`);
  assert(existsSync(outputPath), `FFmpeg did not write decoded crop ${outputPath}.`);
  const rgba = readFileSync(outputPath);
  const expectedBytes = region.width * region.height * 4;
  assert(rgba.byteLength === expectedBytes, `Decoded crop has ${rgba.byteLength} bytes; expected ${expectedBytes}.`);
  return { path: outputPath, rgba, sha256: sha256(rgba), byteLength: rgba.byteLength };
}

function measurePixelDifference(reference, actual) {
  assert(reference.byteLength === actual.byteLength, 'Pixel crops have different raw RGBA byte lengths.');
  const errors = new Uint8Array(reference.byteLength);
  let totalError = 0;
  let maxPixelError = 0;
  let pixelsOver16 = 0;
  let exactChannels = 0;
  let pixelsWithAnyDifference = 0;
  const pixelCount = reference.byteLength / 4;
  for (let index = 0; index < reference.byteLength; index += 4) {
    let pixelMax = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      const error = Math.abs(reference[index + channel] - actual[index + channel]);
      errors[index + channel] = error;
      totalError += error;
      if (error === 0) exactChannels += 1;
      pixelMax = Math.max(pixelMax, error);
    }
    maxPixelError = Math.max(maxPixelError, pixelMax);
    if (pixelMax > 0) pixelsWithAnyDifference += 1;
    if (pixelMax > 16) pixelsOver16 += 1;
  }
  errors.sort();
  return {
    meanAbsoluteChannelError: totalError / reference.byteLength,
    p95AbsoluteChannelError: errors[Math.floor(errors.length * 0.95)] ?? 0,
    maxAbsoluteChannelError: maxPixelError,
    exactChannelRatio: exactChannels / reference.byteLength,
    pixelsWithAnyDifference,
    pixelsWithAnyDifferenceRatio: pixelCount ? pixelsWithAnyDifference / pixelCount : 0,
    pixelsOver16ChannelLevels: pixelsOver16,
    pixelsOver16Ratio: pixelCount ? pixelsOver16 / pixelCount : 0,
  };
}

async function verifyPauseAndSeek(window, intensityPercent, ownerLayerId, neutralCapture) {
  await evaluate(window, `document.querySelector('[data-testid="product-preview-play-pause"]')?.click()`);
  await waitFor(
    window,
    `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'true'`,
    'Product Preview did not enter playback before the pause check.',
  );
  await new Promise((resolve) => setTimeout(resolve, 120));
  await evaluate(window, `document.querySelector('[data-testid="product-preview-play-pause"]')?.click()`);
  await waitFor(
    window,
    `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'false'`,
    'Product Preview did not pause.',
  );
  const pauseTimeBeforeWait = Number(await evaluate(
    window,
    `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewTime ?? -1`,
  ));
  await new Promise((resolve) => setTimeout(resolve, 120));
  const pauseTimeAfterWait = Number(await evaluate(
    window,
    `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewTime ?? -1`,
  ));
  const pausedTimeStayedFixed = pauseTimeBeforeWait >= 0 && pauseTimeBeforeWait === pauseTimeAfterWait;
  assert(pausedTimeStayedFixed, `Preview time advanced after pause: ${pauseTimeBeforeWait} -> ${pauseTimeAfterWait}.`);

  const checkpoint = checkpoints.find(({ label }) => label === 'neutral');
  assert(checkpoint, 'Pause/seek check requires the calibrated neutral checkpoint.');
  const seekAfterPause = await seekAndCapture(
    window,
    intensityPercent,
    checkpoint,
    ownerLayerId,
    'pause-seek',
  );
  return {
    intensityPercent,
    pauseTimeMs: pauseTimeBeforeWait,
    pausedTimeStayedFixed,
    seekTimeMs: seekAfterPause.stageTimeMs,
    seekRestoredHeadPixels: seekAfterPause.headCropSha256 === neutralCapture.headCropSha256,
    seekRestoredFacePixels: seekAfterPause.faceMouthCropSha256 === neutralCapture.faceMouthCropSha256,
  };
}

async function configureElectronPaths() {
  for (const [name, location] of [
    ['userData', userDataRoot],
    ['sessionData', path.join(userDataRoot, 'session-data')],
    ['temp', path.join(runRoot, 'temp')],
    ['logs', path.join(runRoot, 'logs')],
    ['crashDumps', path.join(runRoot, 'crash-dumps')],
  ]) {
    mkdirSync(location, { recursive: true });
    try { app.setPath(name, location); } catch { /* Electron may have fixed a path before readiness. */ }
  }
}

async function run() {
  mkdirSync(evidenceRoot, { recursive: true });
  const sourceRoot = findSyntheticProjectRoot();
  const { project: sourceProject, dialogue, manifestSha256 } = loadAndValidateSource(sourceRoot);
  const projectVariants = intensities.map((intensity) =>
    prepareIntensityProject(sourceRoot, sourceProject, intensity),
  );
  const comparisonSource = projectVariants.find((variant) => variant.intensityPercent === 100);
  assert(comparisonSource, 'The 100% motion copy required for surface comparison is missing.');
  const exportVariant = prepareExportComparisonProject(comparisonSource);
  registerFixtureIpc([...projectVariants, exportVariant]);
  await app.whenReady();
  await configureElectronPaths();
  const results = [];
  const boundaryResults = [];
  const pauseSeekResults = [];
  const shotSwitchResults = [];
  const speakerSwitchResults = [];
  const alphaResults = [];
  let surfaceComparison;
  const lifecycle = { openedProjectIds: [], closeTransitions: [] };
  let window = null;
  try {
    window = await createMainWindow({ show: true });
    window.setSize(1600, 1000);
    window.show();
    window.focus();
    window.webContents.focus();
    for (const variant of projectVariants) {
      await openProject(window, variant.projectRoot);
      lifecycle.openedProjectIds.push(variant.projectId);
      await openPreview(window, variant.baseShotId);
      const { intensityPercent } = variant;
      for (const checkpoint of checkpoints) {
        results.push(await seekAndCapture(
          window,
          intensityPercent,
          checkpoint,
          variant.baseCharacterLayerId,
        ));
      }
      const originalNeutralCapture = results.find((item) =>
        item.intensityPercent === intensityPercent && item.checkpoint === 'neutral' && item.target === 'primary',
      );
      assert(originalNeutralCapture, `Initial neutral sample missing at ${intensityPercent}%.`);
      pauseSeekResults.push(await verifyPauseAndSeek(
        window,
        intensityPercent,
        variant.baseCharacterLayerId,
        originalNeutralCapture,
      ));
      for (const checkpoint of dialogueBoundaryCheckpoints) {
        boundaryResults.push(await seekAndCapture(
          window,
          intensityPercent,
          checkpoint,
          variant.baseCharacterLayerId,
          'dialogue-boundary',
        ));
      }
      if (intensityPercent === 100) {
        await closePreview(window);
        await selectShot(
          window,
          variant.halfOpacity.shotId,
          variant.halfOpacity.characterLayerId,
          variant.baseFaceAssetId,
        );
        await openPreview(window, variant.halfOpacity.shotId);
        const alphaHalfCapture = await seekAndCapture(
          window,
          intensityPercent,
          checkpoints.find(({ label }) => label === 'neutral'),
          variant.halfOpacity.characterLayerId,
          'opacity-half',
        );
        await closePreview(window);
        await selectShot(
          window,
          variant.backgroundOnly.shotId,
          variant.backgroundOnly.characterLayerId,
          variant.backgroundAssetId,
        );
        await openPreview(window, variant.backgroundOnly.shotId);
        const backgroundCapture = await seekAndCapture(
          window,
          intensityPercent,
          checkpoints.find(({ label }) => label === 'neutral'),
          null,
          'opacity-background',
        );
        alphaResults.push({
          intensityPercent,
          fullOpacityLayerOpacity: 1,
          halfOpacityLayerOpacity: variant.halfOpacity.characterOpacity,
          backgroundReferenceCharacterVisible: variant.backgroundOnly.characterVisible,
          fullOpacity: originalNeutralCapture.alphaSamples,
          halfOpacity: alphaHalfCapture.alphaSamples,
          backgroundOnly: backgroundCapture.alphaSamples,
          backgroundOnlyShotId: variant.backgroundOnly.shotId,
          halfOpacityShotId: variant.halfOpacity.shotId,
        });
        await closePreview(window);
        await selectShot(
          window,
          variant.baseShotId,
          variant.baseCharacterLayerId,
          variant.baseFaceAssetId,
        );
        await openPreview(window, variant.baseShotId);
      }
      await closePreview(window);
      await selectShot(
        window,
        variant.alternateShotId,
        variant.alternateCharacterLayerId,
        variant.alternateFaceAssetId,
      );
      await openPreview(window, variant.alternateShotId);
      const neutralCheckpoint = checkpoints.find(({ label }) => label === 'neutral');
      assert(neutralCheckpoint, 'Synthetic phase matrix omitted its neutral checkpoint.');
      const alternateShotCapture = await seekAndCapture(
        window,
        intensityPercent,
        neutralCheckpoint,
        variant.alternateCharacterLayerId,
        'alternate-shot',
      );
      for (const checkpoint of speakerSwitchCheckpoints) {
        const speakerACapture = await seekAndCapture(
          window,
          intensityPercent,
          checkpoint,
          variant.alternateCharacterLayerId,
          'speaker-a',
          PRIMARY_CAPTURE_REGIONS,
        );
        const speakerBCapture = await seekAndCapture(
          window,
          intensityPercent,
          checkpoint,
          variant.speakerBLayerId,
          'speaker-b',
          SPEAKER_B_CAPTURE_REGIONS,
        );
        speakerSwitchResults.push({
          intensityPercent,
          checkpoint: checkpoint.label,
          speakerALayerId: variant.alternateCharacterLayerId,
          speakerBLayerId: variant.speakerBLayerId,
          speakerATransform: speakerACapture.headGroupTransform,
          speakerBTransform: speakerBCapture.headGroupTransform,
          speakerAHeadCropSha256: speakerACapture.headCropSha256,
          speakerBHeadCropSha256: speakerBCapture.headCropSha256,
          speakerAFaceMouthCropSha256: speakerACapture.faceMouthCropSha256,
          speakerBFaceMouthCropSha256: speakerBCapture.faceMouthCropSha256,
          speakerABodyPixels: speakerACapture.bodyPixels,
          speakerBBodyPixels: speakerBCapture.bodyPixels,
          speakerBBackgroundPixel: speakerBCapture.backgroundPixel,
        });
      }
      await closePreview(window);
      await selectShot(
        window,
        variant.baseShotId,
        variant.baseCharacterLayerId,
        variant.baseFaceAssetId,
      );
      await openPreview(window, variant.baseShotId);
      const returnedShotCapture = await seekAndCapture(
        window,
        intensityPercent,
        neutralCheckpoint,
        variant.baseCharacterLayerId,
        'returned-shot',
      );
      shotSwitchResults.push({
        intensityPercent,
        baseShotId: variant.baseShotId,
        alternateShotId: variant.alternateShotId,
        baseFaceCropSha256: originalNeutralCapture.faceMouthCropSha256,
        alternateFaceCropSha256: alternateShotCapture.faceMouthCropSha256,
        returnedFaceCropSha256: returnedShotCapture.faceMouthCropSha256,
        baseBodyPixels: originalNeutralCapture.bodyPixels,
        alternateBodyPixels: alternateShotCapture.bodyPixels,
        returnedBodyPixels: returnedShotCapture.bodyPixels,
        alternateHeadGroupTransform: alternateShotCapture.headGroupTransform,
        returnedHeadGroupTransform: returnedShotCapture.headGroupTransform,
      });
      lifecycle.closeTransitions.push({
        projectId: variant.projectId,
        ...await closeProjectAndAssertStageUnmounted(window),
      });
    }

    await openProject(window, exportVariant.projectRoot);
    lifecycle.openedProjectIds.push(exportVariant.projectId);
    await selectShot(
      window,
      exportVariant.baseShotId,
      exportVariant.baseCharacterLayerId,
      exportVariant.alternateFaceAssetId,
    );
    const editorSeek = await seekEditorFrame(window, SURFACE_COMPARISON_TIME_MS);
    const editorCapture = await captureSurfacePixels(
      window,
      '[data-testid="project-canvas-stage"]',
      'editor',
      SURFACE_COMPARISON_TIME_MS,
    );
    await openPreview(window, exportVariant.baseShotId);
    await seekPreviewFrame(window, SURFACE_COMPARISON_TIME_MS);
    const previewCapture = await captureSurfacePixels(
      window,
      '.product-preview-stage [data-testid="stage-renderer"]',
      'product-preview',
      SURFACE_COMPARISON_TIME_MS,
    );
    await closePreview(window);

    const formalExport = await runFormalExport(exportVariant, window);
    const formalCrops = {};
    const mp4Crops = {};
    const mp4PixelDiffs = {};
    for (const [name, region] of Object.entries(SURFACE_COMPARISON_REGIONS)) {
      formalCrops[name] = await extractRgbaCrop(
        formalExport.mediaAdapter,
        formalExport.capturedFramePath,
        path.join(evidenceRoot, `formal-frame-${SURFACE_COMPARISON_FRAME_INDEX}-${name}.rgba`),
        region,
      );
      mp4Crops[name] = await extractRgbaCrop(
        formalExport.mediaAdapter,
        formalExport.outputPath,
        path.join(evidenceRoot, `mp4-frame-${SURFACE_COMPARISON_FRAME_INDEX}-${name}.rgba`),
        region,
        SURFACE_COMPARISON_FRAME_INDEX,
      );
      mp4PixelDiffs[name] = measurePixelDifference(
        previewCapture.crops[name].rgba,
        mp4Crops[name].rgba,
      );
    }
    const cropNames = Object.keys(SURFACE_COMPARISON_REGIONS);
    const editorPreviewPixelDiffs = Object.fromEntries(cropNames.map((name) => [name,
      measurePixelDifference(editorCapture.crops[name].rgba, previewCapture.crops[name].rgba),
    ]));
    const previewFormalPixelDiffs = Object.fromEntries(cropNames.map((name) => [name,
      measurePixelDifference(previewCapture.crops[name].rgba, formalCrops[name].rgba),
    ]));
    const editorFormalPixelDiffs = Object.fromEntries(cropNames.map((name) => [name,
      measurePixelDifference(editorCapture.crops[name].rgba, formalCrops[name].rgba),
    ]));
    const withinSurfaceTolerance = (diffs) => Object.values(diffs).every((metrics) =>
      metrics.meanAbsoluteChannelError <= SURFACE_PIXEL_TOLERANCE.meanAbsoluteChannelError &&
      metrics.p95AbsoluteChannelError <= SURFACE_PIXEL_TOLERANCE.p95AbsoluteChannelError &&
      metrics.maxAbsoluteChannelError <= SURFACE_PIXEL_TOLERANCE.maxAbsoluteChannelError &&
      metrics.pixelsOver16Ratio <= SURFACE_PIXEL_TOLERANCE.pixelsOver16Ratio,
    );
    const editorPreviewPixelsExact = cropNames.every((name) =>
      editorCapture.crops[name].rgba.equals(previewCapture.crops[name].rgba),
    );
    const previewFormalPixelsExact = cropNames.every((name) =>
      previewCapture.crops[name].rgba.equals(formalCrops[name].rgba),
    );
    const editorFormalPixelsExact = cropNames.every((name) =>
      editorCapture.crops[name].rgba.equals(formalCrops[name].rgba),
    );
    const editorPreviewPixelsMatch = withinSurfaceTolerance(editorPreviewPixelDiffs);
    const previewFormalPixelsMatch = withinSurfaceTolerance(previewFormalPixelDiffs);
    const editorFormalPixelsMatch = withinSurfaceTolerance(editorFormalPixelDiffs);
    const mp4PixelQualityWithinThreshold = Object.values(mp4PixelDiffs).every((metrics) =>
      metrics.meanAbsoluteChannelError <= MP4_PIXEL_TOLERANCE.meanAbsoluteChannelError &&
      metrics.p95AbsoluteChannelError <= MP4_PIXEL_TOLERANCE.p95AbsoluteChannelError &&
      metrics.pixelsOver16Ratio <= MP4_PIXEL_TOLERANCE.pixelsOver16Ratio,
    );
    const previewCacheEvent = [...(previewCapture.cacheEvents ?? [])].reverse().find((event) =>
      (event.event === 'composite-cache-rebuild' || event.event === 'composite-cache-reuse') &&
      event.ownerLayerId === exportVariant.speakerBLayerId,
    );
    const previewVisualSignature = previewCacheEvent?.visualSignature
      ? JSON.parse(previewCacheEvent.visualSignature)
      : null;
    const speakerBPreviewTransform = previewVisualSignature?.headGroup?.transform ?? null;
    surfaceComparison = {
      editorSeek,
      projectRoot: exportVariant.projectRoot,
      projectId: exportVariant.projectId,
      shotId: exportVariant.baseShotId,
      speakerALayerId: exportVariant.baseCharacterLayerId,
      speakerBLayerId: exportVariant.speakerBLayerId,
      speakerALayerOpacity: exportVariant.speakerALayerOpacity,
      speakerBLayerOpacity: exportVariant.speakerBLayerOpacity,
      frameIndex: SURFACE_COMPARISON_FRAME_INDEX,
      timeMs: SURFACE_COMPARISON_TIME_MS,
      pixelTolerance: SURFACE_PIXEL_TOLERANCE,
      mp4PixelTolerance: MP4_PIXEL_TOLERANCE,
      editor: {
        ...editorCapture.metadata,
        crops: Object.fromEntries(cropNames.map((name) => [name, {
          width: editorCapture.crops[name].width,
          height: editorCapture.crops[name].height,
          path: editorCapture.crops[name].path,
          pngSha256: editorCapture.crops[name].sha256,
          rgbaSha256: editorCapture.crops[name].rgbaSha256,
        }])),
        bodySamples: editorCapture.bodySamples,
      },
      productPreview: {
        ...previewCapture.metadata,
        crops: Object.fromEntries(cropNames.map((name) => [name, {
          width: previewCapture.crops[name].width,
          height: previewCapture.crops[name].height,
          path: previewCapture.crops[name].path,
          pngSha256: previewCapture.crops[name].sha256,
          rgbaSha256: previewCapture.crops[name].rgbaSha256,
        }])),
        bodySamples: previewCapture.bodySamples,
        speakerBHeadTransform: speakerBPreviewTransform,
      },
      formalExport: {
        status: formalExport.result.status,
        jobId: formalExport.result.jobId,
        totalFrames: formalExport.result.totalFrames,
        elapsedMs: formalExport.result.elapsedMs,
        outputPath: formalExport.outputPath,
        outputSha256: formalExport.outputSha256,
        outputByteLength: formalExport.outputByteLength,
        probe: formalExport.result.probe,
        hiddenFramePath: formalExport.capturedFramePath,
        hiddenFrameSha256: formalExport.capturedFrameSha256,
        crops: Object.fromEntries(cropNames.map((name) => [name, {
          path: formalCrops[name].path,
          rgbaSha256: formalCrops[name].sha256,
          byteLength: formalCrops[name].byteLength,
        }])),
        mp4DecodedCrops: Object.fromEntries(cropNames.map((name) => [name, {
          path: mp4Crops[name].path,
          rgbaSha256: mp4Crops[name].sha256,
          byteLength: mp4Crops[name].byteLength,
        }])),
        ffmpegPath: formalExport.ffmpegPath,
        ffprobePath: formalExport.ffprobePath,
      },
      editorPreviewPixelDiffs,
      previewFormalPixelDiffs,
      editorFormalPixelDiffs,
      mp4PixelDiffs,
      assertions: {
        editorPreviewPixelsMatch,
        previewFormalPixelsMatch,
        editorFormalPixelsMatch,
        editorPreviewPixelsExact,
        previewFormalPixelsExact,
        editorFormalPixelsExact,
        mp4PixelQualityWithinThreshold,
      },
    };
    lifecycle.closeTransitions.push({
      projectId: exportVariant.projectId,
      ...await closeProjectAndAssertStageUnmounted(window),
    });
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    for (const channel of registeredChannels) ipcMain.removeHandler(channel);
  }

  const byIntensity = new Map(intensities.map((value) => [
    value,
    Object.fromEntries(results.filter((item) => item.intensityPercent === value).map((item) => [item.checkpoint, item])),
  ]));
  const bodyPixelVariants = results.flatMap((item) => item.bodyPixels.map((pixel) => JSON.stringify(pixel)));
  const bodyPixelsStable = new Set(bodyPixelVariants).size === 1;
  const bodyPixelVisible = results.every((item) =>
    JSON.stringify(item.bodyPixels[1]) !== JSON.stringify(item.backgroundPixel),
  );
  const zeroMotion = byIntensity.get(0);
  const hundredMotion = byIntensity.get(100);
  const twoHundredMotion = byIntensity.get(200);
  const transformSamplesMatch = intensities.every((intensityPercent) => {
    const samples = byIntensity.get(intensityPercent);
    return [
      ['upper-left', -4 * intensityPercent / 100],
      ['neutral', 0],
      ['lower-right', 4 * intensityPercent / 100],
    ].every(([label, expectedOffset]) => {
      const transform = samples[label].headGroupTransform;
      return Math.abs(transform.translateX - expectedOffset) <= 0.01 &&
        Math.abs(transform.translateY - expectedOffset) <= 0.01;
    });
  });
  const zeroMotionStable = new Set(checkpoints.map((item) => zeroMotion[item.label].headCropSha256)).size === 1;
  const upperLeftDistinct =
    hundredMotion['upper-left'].headCropSha256 !== zeroMotion['upper-left'].headCropSha256 &&
    twoHundredMotion['upper-left'].headCropSha256 !== hundredMotion['upper-left'].headCropSha256;
  const lowerRightDistinct =
    hundredMotion['lower-right'].headCropSha256 !== zeroMotion['lower-right'].headCropSha256 &&
    twoHundredMotion['lower-right'].headCropSha256 !== hundredMotion['lower-right'].headCropSha256;
  const neutralStable = new Set(intensities.map((value) => byIntensity.get(value).neutral.headCropSha256)).size === 1;
  const neutralFaceMouthStable = new Set(intensities.map((value) => byIntensity.get(value).neutral.faceMouthCropSha256)).size === 1;
  const shotSwitchPixelChanged = shotSwitchResults.every((item) =>
    item.baseFaceCropSha256 !== item.alternateFaceCropSha256,
  );
  const shotSwitchRoundTripStable = shotSwitchResults.every((item) =>
    item.baseFaceCropSha256 === item.returnedFaceCropSha256,
  );
  const shotSwitchBodyPixelsStable = shotSwitchResults.every((item) =>
    JSON.stringify(item.baseBodyPixels) === JSON.stringify(item.alternateBodyPixels) &&
    JSON.stringify(item.baseBodyPixels) === JSON.stringify(item.returnedBodyPixels),
  );
  const shotSwitchHeadGroupStayedNeutral = shotSwitchResults.every((item) =>
    item.alternateHeadGroupTransform.translateX === 0 &&
    item.alternateHeadGroupTransform.translateY === 0 &&
    item.returnedHeadGroupTransform.translateX === 0 &&
    item.returnedHeadGroupTransform.translateY === 0,
  );
  const dialogueBoundaryTransformNeutral = boundaryResults.every((item) =>
    item.headGroupTransform.translateX === 0 && item.headGroupTransform.translateY === 0,
  );
  const dialogueBoundaryPixelsStableAcrossIntensities = dialogueBoundaryCheckpoints.every(({ label }) =>
    new Set(boundaryResults.filter((item) => item.checkpoint === label).map((item) => item.headCropSha256)).size === 1,
  );
  const pauseTimeStayedFixed = pauseSeekResults.every((item) => item.pausedTimeStayedFixed);
  const pauseSeekRestoredPixels = pauseSeekResults.every((item) =>
    item.seekTimeMs === 550 && item.seekRestoredHeadPixels && item.seekRestoredFacePixels,
  );
  const speakerSwitchATransformNeutral = speakerSwitchResults.every((item) =>
    item.speakerATransform.translateX === 0 && item.speakerATransform.translateY === 0,
  );
  const speakerSwitchBTransformsMatch = speakerSwitchResults.every((item) => {
    const checkpoint = speakerSwitchCheckpoints.find(({ label }) => label === item.checkpoint);
    const expectedOffset = checkpoint.elapsedMs === 250 ? 0 :
      (checkpoint.elapsedMs < 250 ? -4 : 4) * item.intensityPercent / 100;
    return Math.abs(item.speakerBTransform.translateX - expectedOffset) <= 0.01 &&
      Math.abs(item.speakerBTransform.translateY - expectedOffset) <= 0.01;
  });
  const speakerSwitchBodyPixelsStable = new Set(speakerSwitchResults.flatMap((item) => [
    JSON.stringify(item.speakerABodyPixels),
    JSON.stringify(item.speakerBBodyPixels),
  ])).size === 1;
  const speakerBVisible = speakerSwitchResults.every((item) =>
    JSON.stringify(item.speakerBBodyPixels[1]) !== JSON.stringify(item.speakerBBackgroundPixel),
  );
  const speakerAHeadPixelsStable = new Set(speakerSwitchResults.map((item) => item.speakerAHeadCropSha256)).size === 1;
  const speakerBZeroMotionPhaseStable = new Set(speakerSwitchResults
    .filter((item) => item.intensityPercent === 0)
    .map((item) => item.speakerBHeadCropSha256)).size === 1;
  const speakerBNeutralPixelsStable = new Set(speakerSwitchResults
    .filter((item) => item.checkpoint === 'speaker-b-neutral')
    .map((item) => item.speakerBHeadCropSha256)).size === 1;
  const speakerBMotionPixelsDistinct = ['speaker-b-upper-left', 'speaker-b-lower-right'].every((label) => {
    const samples = Object.fromEntries(speakerSwitchResults
      .filter((item) => item.checkpoint === label)
      .map((item) => [item.intensityPercent, item.speakerBHeadCropSha256]));
    return samples[0] !== samples[100] && samples[100] !== samples[200];
  });
  const speakerBOpenMouthStable = (() => {
    const samples = speakerSwitchResults.filter((item) => item.intensityPercent === 0);
    const upperLeft = samples.find((item) => item.checkpoint === 'speaker-b-upper-left');
    const neutral = samples.find((item) => item.checkpoint === 'speaker-b-neutral');
    const lowerRight = samples.find((item) => item.checkpoint === 'speaker-b-lower-right');
    return upperLeft?.speakerBFaceMouthCropSha256 === lowerRight?.speakerBFaceMouthCropSha256 &&
      upperLeft?.speakerBFaceMouthCropSha256 !== neutral?.speakerBFaceMouthCropSha256;
  })();
  const alphaHalfOverlayMatches = alphaResults.length === 1 && alphaResults.every((item) => {
    const full = new Map(item.fullOpacity.map(({ name, rgba }) => [name, rgba]));
    const half = new Map(item.halfOpacity.map(({ name, rgba }) => [name, rgba]));
    const background = new Map(item.backgroundOnly.map(({ name, rgba }) => [name, rgba]));
    return ['head', 'face', 'mouth', 'body'].every((name) => {
      const fullPixel = full.get(name);
      const halfPixel = half.get(name);
      const backgroundPixel = background.get(name);
      return fullPixel && halfPixel && backgroundPixel && fullPixel[3] === 255 &&
        halfPixel.every((channel, index) => Math.abs(channel - Math.round((fullPixel[index] + backgroundPixel[index]) / 2)) <= 2);
    });
  });
  const fullOpacityLayerVisible = alphaResults.length === 1 && alphaResults.every((item) =>
    ['head', 'face', 'mouth', 'body'].every((name) => {
      const fullPixel = item.fullOpacity.find((sample) => sample.name === name)?.rgba;
      const backgroundPixel = item.backgroundOnly.find((sample) => sample.name === name)?.rgba;
      return fullPixel && backgroundPixel && JSON.stringify(fullPixel) !== JSON.stringify(backgroundPixel);
    }),
  );
  const zeroMotionOpenMouthStable = zeroMotion['upper-left'].faceMouthCropSha256 === zeroMotion['lower-right'].faceMouthCropSha256;
  const zeroMotionClosedMouthDistinct = zeroMotion.neutral.faceMouthCropSha256 !== zeroMotion['upper-left'].faceMouthCropSha256;
  assert(bodyPixelVisible, 'The selected Body pixel matched the background; adjust the pixel probe region.');
  assert(bodyPixelsStable, 'Body sample pixels changed with Head Group intensity or phase.');
  assert(transformSamplesMatch, 'Rendered Head Group transforms did not match the 0/100/200% expected phase values.');
  assert(zeroMotionStable, 'The upper Head Group crop changed across phases at 0% intensity.');
  assert(upperLeftDistinct && lowerRightDistinct, 'Rendered Head Group pixels did not distinguish 0/100/200% motion at both endpoints.');
  assert(neutralStable, 'Rendered Head Group pixels differed at the neutral phase across intensities.');
  assert(neutralFaceMouthStable, 'Rendered Face/Mouth pixels differed at the neutral phase across intensities.');
  assert(zeroMotionOpenMouthStable, 'Face/Mouth pixels differed between the two open-mouth phases at 0% motion.');
  assert(zeroMotionClosedMouthDistinct, 'Face/Mouth pixels did not distinguish the closed-mouth phase at 0% motion.');
  assert(shotSwitchPixelChanged, 'The alternate Shot did not display its changed Face resource.');
  assert(shotSwitchRoundTripStable, 'Returning to the original Shot did not restore its original Face pixels.');
  assert(shotSwitchBodyPixelsStable, 'Body pixels changed while switching the Shot Face resource.');
  assert(shotSwitchHeadGroupStayedNeutral, 'The selected neutral Shot checkpoint unexpectedly moved its Head Group.');
  assert(dialogueBoundaryTransformNeutral, 'Head Group motion did not return to neutral at the dialogue start/end boundary.');
  assert(dialogueBoundaryPixelsStableAcrossIntensities, 'Dialogue boundary Head pixels differed across motion intensities.');
  assert(pauseTimeStayedFixed, 'Product Preview time did not remain fixed after pause.');
  assert(pauseSeekRestoredPixels, 'Seeking to the neutral checkpoint after pause did not restore its exact pixels.');
  assert(speakerSwitchATransformNeutral && speakerAHeadPixelsStable, 'Speaker A did not return to a stable neutral image after its dialogue ended.');
  assert(speakerSwitchBTransformsMatch, 'Speaker B Head Group pixels were sampled at unexpected motion phases.');
  assert(speakerSwitchBodyPixelsStable && speakerBVisible, 'Speaker Body pixels changed or Speaker B was not visible.');
  assert(speakerBZeroMotionPhaseStable && speakerBNeutralPixelsStable && speakerBMotionPixelsDistinct, 'Speaker B Head pixels did not distinguish the expected 0/100/200% phases.');
  assert(speakerBOpenMouthStable, 'Speaker B Face/Mouth pixels did not preserve the open/closed phase pattern.');
  assert(fullOpacityLayerVisible, 'The full-opacity Character was not visible at the selected Head/Face/Mouth/Body pixels.');
  assert(alphaHalfOverlayMatches, 'The 0.5 Character opacity pixels did not match a 50% blend over the same Shot background.');
  assert(surfaceComparison, 'The Editor/Product Preview/formal MP4 surface comparison did not run.');
  assert(surfaceComparison.assertions.editorPreviewPixelsMatch, `Editor and Product Preview crops exceeded the measured surface tolerance: ${JSON.stringify(surfaceComparison.editorPreviewPixelDiffs)}.`);
  assert(surfaceComparison.assertions.previewFormalPixelsMatch, `Product Preview and formal hidden-renderer PNG crops exceeded the measured surface tolerance: ${JSON.stringify(surfaceComparison.previewFormalPixelDiffs)}.`);
  assert(surfaceComparison.assertions.editorFormalPixelsMatch, `Editor and formal hidden-renderer PNG crops exceeded the measured surface tolerance: ${JSON.stringify(surfaceComparison.editorFormalPixelDiffs)}.`);
  assert(surfaceComparison.assertions.mp4PixelQualityWithinThreshold, `Decoded MP4 pixels exceeded the measured lossy-encode threshold: ${JSON.stringify(surfaceComparison.mp4PixelDiffs)}.`);
  assert(surfaceComparison.productPreview.speakerBHeadTransform &&
    (Math.abs(surfaceComparison.productPreview.speakerBHeadTransform.translateX) > 2 ||
      Math.abs(surfaceComparison.productPreview.speakerBHeadTransform.translateY) > 2),
  'The cross-surface MP4 checkpoint did not capture visible Speaker B motion.');
  assert(lifecycle.openedProjectIds.length === projectVariants.length + 1, 'The single Editor window did not open every intensity and surface-comparison project copy.');
  assert(lifecycle.closeTransitions.length === projectVariants.length + 1 && lifecycle.closeTransitions.every((item) => item.editorStageUnmounted), 'A project close did not unmount the Editor Stage.');

  const receipt = {
    issue: 872,
    check: 'AC08 synthetic rendered-pixel matrix and Editor/Product Preview/formal MP4 comparison',
    passed: true,
    generatedAt: new Date().toISOString(),
    sourceProjectRoot: sourceRoot,
    sourceProjectId: sourceProject.id,
    sourceManifestSha256: manifestSha256,
    sourceIsSyntheticIssue867V14: true,
    dialogueWindowMs: { startMs: dialogue.startMs, endMs: dialogue.endMs },
    projectVariants: projectVariants.map(({ projectRoot, projectId }) => ({ projectRoot, projectId })),
    lifecycle: {
      editorWindowCount: 1,
      openedProjectIds: lifecycle.openedProjectIds,
      projectCloseCount: lifecycle.closeTransitions.length,
      stageUnmountsVerified: lifecycle.closeTransitions.every((transition) => transition.editorStageUnmounted),
      closeTransitions: lifecycle.closeTransitions,
    },
    checkpoints,
    results,
    dialogueBoundaryCheckpoints,
    boundaryResults,
    pauseSeekResults,
    shotSwitchResults,
    speakerSwitchCheckpoints,
    speakerSwitchResults,
    alphaResults,
    surfaceComparison,
    assertions: {
      bodyPixelsStable,
      bodyPixelVisible,
      transformSamplesMatch,
      zeroMotionStable,
      upperLeftDistinct,
      lowerRightDistinct,
      neutralStable,
      neutralFaceMouthStable,
      zeroMotionOpenMouthStable,
      zeroMotionClosedMouthDistinct,
      shotSwitchPixelChanged,
      shotSwitchRoundTripStable,
      shotSwitchBodyPixelsStable,
      shotSwitchHeadGroupStayedNeutral,
      dialogueBoundaryTransformNeutral,
      dialogueBoundaryPixelsStableAcrossIntensities,
      pauseTimeStayedFixed,
      pauseSeekRestoredPixels,
      speakerSwitchATransformNeutral,
      speakerAHeadPixelsStable,
      speakerSwitchBTransformsMatch,
      speakerSwitchBodyPixelsStable,
      speakerBVisible,
      speakerBZeroMotionPhaseStable,
      speakerBNeutralPixelsStable,
      speakerBMotionPixelsDistinct,
      speakerBOpenMouthStable,
      fullOpacityLayerVisible,
      alphaHalfOverlayMatches,
      editorPreviewPixelsMatch: surfaceComparison.assertions.editorPreviewPixelsMatch,
      previewFormalPixelsMatch: surfaceComparison.assertions.previewFormalPixelsMatch,
      editorFormalPixelsMatch: surfaceComparison.assertions.editorFormalPixelsMatch,
      editorPreviewPixelsExact: surfaceComparison.assertions.editorPreviewPixelsExact,
      previewFormalPixelsExact: surfaceComparison.assertions.previewFormalPixelsExact,
      editorFormalPixelsExact: surfaceComparison.assertions.editorFormalPixelsExact,
      mp4PixelQualityWithinThreshold: surfaceComparison.assertions.mp4PixelQualityWithinThreshold,
      projectCloseUnmountsStage: lifecycle.closeTransitions.length === projectVariants.length + 1 && lifecycle.closeTransitions.every((item) => item.editorStageUnmounted),
    },
    speakerSwitch: projectVariants.map(({ intensityPercent, speakerAEndMs, speakerBId, speakerBDialogueStartMs, speakerBDialogueEndMs }) => ({
      intensityPercent,
      speakerAEndMs,
      speakerBId,
      dialogueStartMs: speakerBDialogueStartMs,
      dialogueEndMs: speakerBDialogueEndMs,
    })),
    scope: 'Synthetic Product Preview pixels at 0/100/200% intensity, selected phases, dialogue edges, pause/seek, A-to-B dialogue speaker switching, 0.5/1.0 Character opacity over a multi-part composite, Shot selection with a changed Face resource and pixel round trip; plus an Editor/Product Preview/formal hidden-renderer/decoded-MP4 pixel comparison at formal frame 44 (1833.333ms) with A at 0.5 opacity after dialogue end and active moving Speaker B. Four same-window project close/reopen cycles assert Editor Stage unmounting. Does not cover AN01 real-material acceptance.',
  };
  const resultPath = path.join(runRoot, 'receipt.json');
  writeFileSync(resultPath, JSON.stringify(receipt, null, 2), 'utf8');
  console.log(`RESULT_PATH=${resultPath}`);
  console.log(JSON.stringify(receipt.assertions));
  app.exit(0);
}

run().catch((error) => {
  console.error(error);
  app.exit(1);
});

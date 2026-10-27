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
  const validated = ProjectSchema.parse(project);
  writeFileSync(projectPath, JSON.stringify(validated, null, 2), 'utf8');
  return {
    projectRoot,
    projectId: validated.id,
    sourceProjectId: sourceProject.id,
    intensityPercent,
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

async function openPreview(window) {
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
      document.querySelector('.product-preview-stage [data-testid="stage-renderer"]')?.dataset.stageDisplayReady === 'true'`,
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

async function seekAndCapture(window, intensityPercent, checkpoint) {
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
    const region = { x: 700, y: 150, width: 520, height: 250 };
    const faceMouthRegion = { x: 780, y: 380, width: 360, height: 160 };
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
      bodyPixels: [readPixel(920, 820), readPixel(960, 850), readPixel(1000, 880)],
      cacheEvents: window.__pandaPreviewDiagnostics?.read?.() ?? [],
    };
  })()`);
  const cacheEvents = capture.cacheEvents;
  const lastCacheEvent = [...cacheEvents].reverse().find((event) =>
    event.event === 'composite-cache-rebuild' || event.event === 'composite-cache-reuse',
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
  };
  assert(capture.stageReady && capture.stageDisplayReady, `Preview Stage was not exact and drawable: ${JSON.stringify(captureMetadata)}`);
  assert(capture.stageTimeMs === checkpoint.timeMs, `Preview Stage time drifted: ${JSON.stringify(captureMetadata)}`);
  assert(visualSignature?.headGroup?.transform, 'Composite cache diagnostic omitted the Head Group transform.');
  const png = Buffer.from(headCropPngBase64, 'base64');
  const faceMouthPng = Buffer.from(faceMouthCropPngBase64, 'base64');
  const filename = `head-${intensityPercent}-${checkpoint.label}.png`;
  const faceMouthFilename = `face-mouth-${intensityPercent}-${checkpoint.label}.png`;
  writeFileSync(path.join(evidenceRoot, filename), png);
  writeFileSync(path.join(evidenceRoot, faceMouthFilename), faceMouthPng);
  return {
    intensityPercent,
    checkpoint: checkpoint.label,
    requestedTimeMs: checkpoint.timeMs,
    elapsedFromDialogueStartMs: checkpoint.elapsedMs,
    ...captureMetadata,
    headGroupTransform: visualSignature.headGroup.transform,
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
  registerFixtureIpc(projectVariants);
  await app.whenReady();
  await configureElectronPaths();
  const results = [];
  let window = null;
  try {
    for (const variant of projectVariants) {
      window = await createMainWindow({ show: true });
      window.setSize(1600, 1000);
      window.show();
      window.focus();
      window.webContents.focus();
      await openProject(window, variant.projectRoot);
      await openPreview(window);
      const { intensityPercent } = variant;
      for (const checkpoint of checkpoints) {
        results.push(await seekAndCapture(window, intensityPercent, checkpoint));
      }
      await evaluate(window, `document.querySelector('[data-testid="product-preview-close"]')?.click()`);
      await waitFor(window, `!document.querySelector('[data-testid="product-preview-overlay"]')`, 'Preview did not unmount.');
      window.destroy();
      window = null;
    }
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

  const receipt = {
    issue: 872,
    check: 'AC08 synthetic Product Preview Head Group pixel phases/intensities',
    passed: true,
    generatedAt: new Date().toISOString(),
    sourceProjectRoot: sourceRoot,
    sourceProjectId: sourceProject.id,
    sourceManifestSha256: manifestSha256,
    sourceIsSyntheticIssue867V14: true,
    dialogueWindowMs: { startMs: dialogue.startMs, endMs: dialogue.endMs },
    projectVariants: projectVariants.map(({ projectRoot, projectId }) => ({ projectRoot, projectId })),
    checkpoints,
    results,
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
    },
    scope: 'Product Preview canvas pixels only. Does not cover dialogue switching, alpha overlays, editor/export pixel equivalence, or AN01 real-material acceptance.',
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

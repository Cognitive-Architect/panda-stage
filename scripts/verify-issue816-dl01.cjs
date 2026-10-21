const { app, dialog, ipcMain } = require('electron');
const { createHash, randomUUID } = require('node:crypto');
const { existsSync, readFileSync } = require('node:fs');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { createMainWindow } = require('../dist-electron/main/windows/main-window.js');
const { registerProjectIpcHandlers } = require('../dist-electron/main/ipc/register-project-ipc-handlers.js');
const { ProjectService } = require('../dist-electron/main/services/ProjectService.js');
const { registerExportPreparationIpcHandlers } = require('../dist-electron/main/ipc/register-export-preparation-ipc-handlers.js');
const { ExportPreparationService, MainProjectAssetReader } = require('../dist-electron/main/services/ExportPreparationService.js');
const { NodeExportPreparationFileStore } = require('../dist-electron/main/services/ExportPreparationFileStore.js');
const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');
const { ProjectSchema } = require('../dist-electron/domain/models/project.js');
const { collectExportPreparationMedia } = require('../dist-electron/domain/export-preparation.js');
const { listShotRuntimeImageAssets } = require('../dist-electron/domain/selectors/temporalRender.js');
const { generateIssue816Fixtures, loadIssue816Fixtures } = require('./issue816-fixtures.cjs');

const baseDirectory =
  process.env.PANDA_STAGE_ISSUE816_ROOT ??
  'D:\\PandaStage-Acceptance\\issue816-dl01';
process.env.VITE_DEV_SERVER_URL = '';
app.setPath('userData', path.join(baseDirectory, 'electron-user-data'));
app.on('window-all-closed', () => {});

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const registerMock = (name, handler) => ipcMain.handle(IPC_CHANNELS[name], handler);
let mainWindow = null;
let trackedSnapshot = null;
let exportPreparationService = null;
let removeExportPreparationHandlers = null;
let removeProjectIpcHandlers = null;
let nextMediaReadGate = null;
let fixtureProject = null;
let fixtureProjectRoot = null;
let fixtureImageBytes = null;
let fixtureThumbnailDataUrl = null;

function defaultExportFileName(projectName) {
  let baseName = Array.from(projectName.trim(), (character) =>
    /[<>:"/\\|?*]/u.test(character) || character.charCodeAt(0) <= 0x1f
      ? '_'
      : character,
  )
    .join('')
    .replace(/[. ]+$/gu, '')
    .trim();
  baseName = Array.from(baseName).slice(0, 240).join('').replace(/[. ]+$/gu, '');
  if (!baseName || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(baseName)) {
    baseName = '未命名工程';
  }
  return baseName + '.mp4';
}

function installProjectFixtureIpc() {
  const projectService = new ProjectService({
    getCurrentProjectSnapshot: (projectRoot) => {
      if (!trackedSnapshot || path.resolve(projectRoot) !== path.resolve(fixtureProjectRoot)) return null;
      return {
        project: trackedSnapshot.project,
        revision: trackedSnapshot.revision,
      };
    },
    onProjectSaved: (projectRoot, project, revision) => {
      if (
        trackedSnapshot &&
        path.resolve(projectRoot) === path.resolve(fixtureProjectRoot) &&
        trackedSnapshot.revision === revision
      ) {
        trackedSnapshot = {
          ...trackedSnapshot,
          project: structuredClone(project),
          dirty: false,
        };
      }
    },
  });
  removeProjectIpcHandlers = registerProjectIpcHandlers({
    getMainWindow: () => mainWindow,
    projectService,
  });
  ipcMain.removeHandler(IPC_CHANNELS.PROJECT_OPEN);

  const document = () => ({
    projectRoot: fixtureProjectRoot,
    projectFilePath: path.join(fixtureProjectRoot, 'project.json'),
    project: fixtureProject,
    migrated: false,
    sourceVersion: fixtureProject.schemaVersion,
  });
  registerMock('PROJECT_OPEN', async () => ({ ok: true, value: document() }));
  registerMock('RECENT_PROJECTS_LIST', async () => ({
    ok: true,
    entries: [
      {
        projectId: fixtureProject.id,
        projectName: fixtureProject.name,
        projectRoot: fixtureProjectRoot,
        lastOpenedAt: new Date().toISOString(),
        status: 'available',
      },
    ],
  }));
  registerMock('RECENT_PROJECTS_OPEN', async () => ({
    ok: true,
    document: document(),
  }));
  registerMock('AUTOSAVE_TRACK', async (_event, request) => {
    trackedSnapshot = structuredClone(request);
    return { ok: true };
  });
  registerMock('AUTOSAVE_UPDATE', async (_event, request) => {
    trackedSnapshot = structuredClone(request);
    return { ok: true };
  });
  registerMock('AUTOSAVE_STOP', async () => {
    trackedSnapshot = null;
    return { ok: true };
  });
  registerMock('RECOVERY_DETECT', async () => ({ ok: true, candidate: null }));
  registerMock('ASSET_THUMBNAIL_READ', async (_event, request) => ({
    ok: true,
    status: 'ready',
    assetId: request.assetId,
    dataUrl: fixtureThumbnailDataUrl,
  }));
  registerMock('ASSET_CANVAS_IMAGE_READ', async (_event, request) => {
    const asset = fixtureProject.assets.find((candidate) => candidate.id === request.assetId);
    if (!asset) return { ok: false, error: { code: 'ASSET_NOT_FOUND', message: 'Unknown fixture image.' } };
    return {
      ok: true,
      status: 'ready',
      assetId: asset.id,
      mimeType: 'image/png',
      width: asset.width,
      height: asset.height,
      byteLength: fixtureImageBytes.length,
      bytes: new Uint8Array(fixtureImageBytes),
    };
  });
}

function createRendererService() {
  const verifiedReader = new MainProjectAssetReader();
  const mediaReader = {
    getByteLength: (...args) => verifiedReader.getByteLength(...args),
    async read(...args) {
      await pause(500);
      const gate = nextMediaReadGate;
      if (gate) {
        nextMediaReadGate = null;
        gate.markStarted();
        await gate.promise;
      }
      return verifiedReader.read(...args);
    },
  };
  const fileStore = new NodeExportPreparationFileStore();
  exportPreparationService = new ExportPreparationService({
    getCurrentProjectSnapshot: (projectRoot) => {
      if (!trackedSnapshot || path.resolve(projectRoot) !== path.resolve(fixtureProjectRoot)) return null;
      return {
        project: trackedSnapshot.project,
        revision: trackedSnapshot.revision,
        dirty: trackedSnapshot.dirty,
        openInstanceId: trackedSnapshot.openInstanceId ?? null,
      };
    },
    confirmOverwrite: async ({ fileName }) => {
      if (!mainWindow || mainWindow.isDestroyed()) return false;
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: '确认覆盖现有视频',
        message: `“${fileName}”已存在。允许后续导出替换这个文件吗？`,
        detail:
          '本次只准备并校验素材，不会写入 MP4。正式导出提交前会再次核对目标文件身份。',
        buttons: ['确认允许覆盖', '取消'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      return result.response === 0;
    },
    fileStore,
    mediaReader,
  });
  removeExportPreparationHandlers = registerExportPreparationIpcHandlers({
    getMainWindow: () => mainWindow,
    service: exportPreparationService,
    selectOutputPath: async (window, request) => {
      const selected = await dialog.showSaveDialog(window, {
        title: '选择导出视频位置',
        buttonLabel: '选择输出位置',
        defaultPath: path.join(request.projectRoot, defaultExportFileName(request.projectName)),
        filters: [{ name: 'MP4 视频', extensions: ['mp4'] }],
        properties: [],
      });
      return selected.canceled ? null : (selected.filePath ?? null);
    },
  });
}

function rendererJs(code) {
  return mainWindow.webContents.executeJavaScript(code, true);
}

async function waitForRenderer(expression, timeoutMs = 20_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await rendererJs(`(async () => Boolean(${expression}))()`)) return;
    await pause(50);
  }
  throw new Error(`Timed out waiting for renderer condition: ${expression}`);
}

async function waitForTrackedOpenInstance(openInstanceId, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (trackedSnapshot?.openInstanceId === openInstanceId) return;
    await pause(20);
  }
  throw new Error(`Timed out waiting for Main to track open Project instance ${openInstanceId}.`);
}

async function waitForActivePreparation(timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const snapshotId = exportPreparationService?.activePreparation?.snapshotId;
    if (snapshotId) return snapshotId;
    await pause(20);
  }
  const response = await rendererJs('window.__pandaStageIssue816Acceptance.lastMainResponse');
  throw new Error(
    `Timed out waiting for Main preparation to become active: ${JSON.stringify(response)}`,
  );
}

async function clickSelector(selector) {
  const point = await rendererJs(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Missing selector ' + ${JSON.stringify(selector)});
    element.scrollIntoView({ block: 'nearest' });
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  mainWindow.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
  mainWindow.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  await pause(150);
}

function clickNativeSaveDialog(
  action,
  screenshotPath,
  createTargetPath = '',
  createTargetContent = '',
  overwritePromptScreenshotPath = '',
) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      path.join(__dirname, 'issue816-native-dialog.ps1'),
      action,
      screenshotPath,
      createTargetPath,
      createTargetContent,
      overwritePromptScreenshotPath,
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => code === 0
      ? resolve(stdout.trim())
      : reject(new Error(`Native Save As ${action} failed (${code}): ${stderr.trim() || stdout.trim()}`)));
  });
}

function clickNativeOverwriteConfirmation(action, screenshotPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      path.join(__dirname, 'issue816-native-dialog.ps1'),
      action,
      screenshotPath,
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => code === 0
      ? resolve(stdout.trim())
      : reject(new Error(`Native overwrite confirmation ${action} failed (${code}): ${stderr.trim() || stdout.trim()}`)));
  });
}

async function copyCandidateEvidence(candidate, evidenceRoot) {
  const mediaRoot = path.join(
    new NodeExportPreparationFileStore().rootDirectory,
    candidate.snapshotId,
  );
  const destination = path.join(evidenceRoot, 'F01', 'candidate', candidate.snapshotId);
  await fsp.mkdir(destination, { recursive: true });
  await fsp.cp(mediaRoot, path.join(destination, 'frozen-media'), { recursive: true });
  await fsp.writeFile(path.join(destination, 'candidate.json'), JSON.stringify(candidate, null, 2), 'utf8');
  await fsp.writeFile(path.join(destination, 'project.json'), JSON.stringify(candidate.project, null, 2), 'utf8');
  await fsp.writeFile(path.join(destination, 'media-manifest.json'), JSON.stringify(candidate.mediaManifest, null, 2), 'utf8');
  await fsp.writeFile(path.join(destination, 'support-profile.json'), JSON.stringify(candidate.supportProfile, null, 2), 'utf8');

  for (const entry of candidate.mediaManifest) {
    const frozenPath = path.join(mediaRoot, entry.contentRelativePath);
    const frozenBytes = await fsp.readFile(frozenPath);
    assert(hash(frozenBytes) === entry.sha256, `Frozen media hash mismatch for ${entry.assetId}.`);
    assert(frozenBytes.byteLength === entry.byteLength, `Frozen media length mismatch for ${entry.assetId}.`);
  }
  return destination;
}

async function runPreparationCase({ name, projectRoot, project, trackedProject = project, targetPath, beforePrepare }) {
  let current = { project: trackedProject, revision: 5, dirty: true, openInstanceId: 11 };
  const service = new ExportPreparationService({
    getCurrentProjectSnapshot: (requestedRoot) =>
      path.resolve(requestedRoot) === path.resolve(projectRoot) ? current : null,
    fileStore: new NodeExportPreparationFileStore(path.join(fixtureRoot, 'F05', 'temp', name)),
  });
  const selectionRequest = {
    projectRoot,
    projectId: trackedProject.id,
    projectName: trackedProject.name,
    openInstanceId: 11,
  };
  const selection = await service.selectOutput(selectionRequest, targetPath);
  assert(selection.status === 'selected', `${name}: output selection failed: ${JSON.stringify(selection)}`);
  if (beforePrepare) await beforePrepare();
  const request = {
    selectionId: selection.selectionId,
    attemptId: randomUUID(),
    projectRoot,
    projectId: project.id,
    openInstanceId: 11,
    revision: 5,
    dirty: true,
    cameraMode: 'static',
    project,
  };
  const result = await service.prepare(request);
  const details = result.status === 'BLOCK' ? service.getDiagnostics(result.diagnosticId) : [];
  if (result.status === 'PREPARATION_READY') {
    await service.discard(undefined, result.candidate.snapshotId);
  }
  const tempEntries = existsSync(service['fileStore'].rootDirectory)
    ? await fsp.readdir(service['fileStore'].rootDirectory)
    : [];
  await service.dispose();
  return { result, details, tempEntries, setCurrent: (next) => { current = next; }, service };
}

async function runF05(fixture, evidenceRoot) {
  const f05Results = {};
  const cases = fixture.f05Cases;
  const baselineProject = ProjectSchema.parse(JSON.parse(await fsp.readFile(path.join(fixture.f01Root, 'project.json'), 'utf8')));
  const baselineAsset = baselineProject.assets.find((asset) => asset.id === cases.replaced.assetId);
  assert(baselineAsset, 'Replacement fixture cannot find its baseline media asset.');
  const baselineBytes = await fsp.readFile(path.join(fixture.f01Root, baselineAsset.relativePath));
  const outputRoot = path.join(fixture.root, 'F05', 'preflight-output');
  await fsp.mkdir(outputRoot, { recursive: true });

  for (const name of ['missing', 'missingExpression', 'missingAudio', 'corrupt', 'replaced']) {
    const projectRoot = cases[name].projectRoot;
    const project = ProjectSchema.parse(JSON.parse(await fsp.readFile(path.join(projectRoot, 'project.json'), 'utf8')));
    const targetPath = path.join(outputRoot, `${name}.mp4`);
    const selectedAsset = project.assets.find((asset) => asset.id === cases[name].assetId);
    if (name === 'replaced') {
      assert(selectedAsset, 'Replacement fixture cannot find its project media asset.');
      await fsp.writeFile(path.join(projectRoot, selectedAsset.relativePath), baselineBytes);
    }
    const testCase = await runPreparationCase({
      name,
      projectRoot,
      project,
      targetPath,
      beforePrepare: name === 'replaced'
        ? async () => {
            const sourcePath = path.join(projectRoot, selectedAsset.relativePath);
            const original = await fsp.readFile(sourcePath);
            const replacement = Buffer.from(original);
            replacement[replacement.length - 1] ^= 0xff;
            await fsp.writeFile(sourcePath, replacement);
            cases[name].replacementSha256 = hash(replacement);
          }
        : null,
    });
    assert(testCase.result.status === 'BLOCK', `${name} fixture unexpectedly prepared.`);
    assert(testCase.result.issues.some((item) => item.code === 'REQUIRED_MEDIA_UNAVAILABLE'), `${name} did not classify unavailable media.`);
    assert(testCase.result.issues.some((item) => item.code === 'REQUIRED_MEDIA_UNAVAILABLE' && item.location === cases[name].expectedLocation), `${name} did not locate the unavailable media.`);
    if (name === 'missingAudio') {
      assert(testCase.result.issues.some((item) => item.code === 'UNSUPPORTED_IN_CURRENT_EXPORT_SLICE'), 'Missing audio did not preserve the unsupported-slice classification.');
    }
    f05Results[name] = {
      status: testCase.result.status,
      issueCodes: testCase.result.issues.map((item) => item.code),
      issues: testCase.result.issues,
      diagnosticId: testCase.result.diagnosticId,
      technicalDetails: testCase.details,
      tempEntriesAfter: testCase.tempEntries,
      sourceSha256After: name === 'replaced'
        ? cases[name].replacementSha256
        : null,
    };
  }

  const invalidReferenceCase = cases.invalidReference;
  const invalidReferenceProject = JSON.parse(
    await fsp.readFile(path.join(invalidReferenceCase.projectRoot, 'project.json'), 'utf8'),
  );
  const invalidReferenceResult = await runPreparationCase({
    name: 'invalid-reference',
    projectRoot: invalidReferenceCase.projectRoot,
    project: invalidReferenceProject,
    trackedProject: baselineProject,
    targetPath: path.join(outputRoot, 'invalid-reference.mp4'),
  });
  assert(invalidReferenceResult.result.status === 'BLOCK', 'Invalid-reference fixture unexpectedly prepared.');
  const invalidReferenceIssue = invalidReferenceResult.result.issues.find((item) => item.code === 'INVALID_PROJECT');
  assert(invalidReferenceIssue, 'Invalid-reference fixture did not classify as INVALID_PROJECT.');
  assert(invalidReferenceIssue.location.includes(invalidReferenceCase.layerName), 'Invalid-reference fixture did not locate the faulty character layer.');
  f05Results.invalidReference = {
    status: invalidReferenceResult.result.status,
    issueCodes: invalidReferenceResult.result.issues.map((item) => item.code),
    issues: invalidReferenceResult.result.issues,
    diagnosticId: invalidReferenceResult.result.diagnosticId,
    technicalDetails: invalidReferenceResult.details,
    tempEntriesAfter: invalidReferenceResult.tempEntries,
  };

  const sessionFixture = cases.sessionMismatch;
  const sessionProject = ProjectSchema.parse(JSON.parse(await fsp.readFile(path.join(sessionFixture.projectRoot, 'project.json'), 'utf8')));
  let currentOpenInstanceId = sessionFixture.selectedOpenInstanceId;
  const mismatchService = new ExportPreparationService({
    getCurrentProjectSnapshot: (requestedRoot) =>
      path.resolve(requestedRoot) === path.resolve(sessionFixture.projectRoot)
        ? { project: sessionProject, revision: 5, dirty: true, openInstanceId: currentOpenInstanceId }
        : null,
    fileStore: new NodeExportPreparationFileStore(path.join(fixture.root, 'F05', 'temp', 'open-instance-mismatch')),
  });
  const mismatchSelection = await mismatchService.selectOutput({
    projectRoot: sessionFixture.projectRoot,
    projectId: sessionProject.id,
    projectName: sessionProject.name,
    openInstanceId: sessionFixture.selectedOpenInstanceId,
  }, path.join(outputRoot, 'open-instance-mismatch.mp4'));
  assert(mismatchSelection.status === 'selected', 'Could not create open-instance mismatch selection.');
  currentOpenInstanceId = sessionFixture.currentOpenInstanceId;
  const mismatch = await mismatchService.prepare({
    selectionId: mismatchSelection.selectionId,
    attemptId: randomUUID(),
    projectRoot: sessionFixture.projectRoot,
    projectId: sessionProject.id,
    openInstanceId: sessionFixture.requestOpenInstanceId,
    revision: 5,
    dirty: true,
    cameraMode: 'static',
    project: sessionProject,
  });
  assert(mismatch.status === 'BLOCK' && mismatch.issues[0].code === 'PROJECT_SESSION_CHANGED', 'Open-instance mismatch did not block safely.');
  f05Results.sessionMismatch = {
    status: mismatch.status,
    issueCodes: mismatch.issues.map((item) => item.code),
    issues: mismatch.issues,
  };
  await mismatchService.dispose();

  const conflict = cases.outputConflict;
  const conflictProject = ProjectSchema.parse(JSON.parse(await fsp.readFile(path.join(conflict.projectRoot, 'project.json'), 'utf8')));
  const conflictFile = conflict.targetPath;
  const initialContent = conflict.initialContent ?? 'OWNER EXISTING OUTPUT v1';
  await fsp.writeFile(conflictFile, Buffer.from(initialContent, 'utf8'));
  const conflictInitial = await fsp.readFile(conflictFile);
  assert(hash(conflictInitial) === conflict.initialSha256, 'Output conflict fixture did not reset to its recorded baseline.');
  const conflictService = new ExportPreparationService({
    getCurrentProjectSnapshot: (requestedRoot) =>
      path.resolve(requestedRoot) === path.resolve(conflict.projectRoot)
        ? { project: conflictProject, revision: 5, dirty: true, openInstanceId: 11 }
        : null,
    confirmOverwrite: async () => true,
    fileStore: new NodeExportPreparationFileStore(path.join(fixture.root, 'F05', 'temp', 'output-conflict')),
  });
  const conflictSelection = await conflictService.selectOutput({
    projectRoot: conflict.projectRoot,
    projectId: conflictProject.id,
    projectName: conflictProject.name,
    openInstanceId: 11,
  }, conflictFile);
  assert(conflictSelection.status === 'selected', 'Could not select existing conflict target.');
  const replacement = Buffer.from('OWNER REPLACEMENT OUTPUT v2 with a different identity and length');
  await fsp.writeFile(conflictFile, replacement);
  const conflictResult = await conflictService.prepare({
    selectionId: conflictSelection.selectionId,
    attemptId: randomUUID(),
    projectRoot: conflict.projectRoot,
    projectId: conflictProject.id,
    openInstanceId: 11,
    revision: 5,
    dirty: true,
    cameraMode: 'static',
    project: conflictProject,
  });
  const conflictAfter = await fsp.readFile(conflictFile);
  assert(conflictResult.status === 'BLOCK' && conflictResult.issues[0].code === 'OUTPUT_TARGET_CHANGED', 'Changed output target was not blocked.');
  assert(hash(conflictAfter) === hash(replacement), 'Target guard changed the user output.');
  cases.outputConflict.replacementSha256 = hash(replacement);
  f05Results.outputConflict = {
    status: conflictResult.status,
    issueCodes: conflictResult.issues.map((item) => item.code),
    initialSha256: hash(conflictInitial),
    replacementSha256: hash(conflictAfter),
    targetUnchangedByPreparation: hash(conflictAfter) === hash(replacement),
  };
  await conflictService.dispose();

  const fixtureFilePath = path.join(fixture.root, 'F05', 'fixtures.json');
  await fsp.writeFile(fixtureFilePath, JSON.stringify({ generatedAt: new Date().toISOString(), cases }, null, 2), 'utf8');
  await fsp.writeFile(path.join(evidenceRoot, 'F05', 'results.json'), JSON.stringify(f05Results, null, 2), 'utf8');
  return f05Results;
}

async function runF06(fixture, evidenceRoot) {
  const sample = JSON.parse(await fsp.readFile(path.join(fixture.root, 'F06', 'budget-results.json'), 'utf8'));
  const within = sample.within;
  const boundary = sample.boundary;
  const aggregateOver = sample.aggregateOver;
  const singleOver = sample.singleOver;
  assert(within.issueCodes.length === 0, 'F06 within-budget sample was rejected.');
  assert(boundary.actualTotalBytes === 256 * 1024 * 1024, 'F06 boundary bytes were not measured at 256 MiB.');
  assert(boundary.issueCodes.length === 0, 'F06 exact aggregate boundary was rejected.');
  assert(aggregateOver.actualTotalBytes > 256 * 1024 * 1024, 'F06 aggregate-over sample did not exceed its measured cap.');
  assert(aggregateOver.issueCodes.includes('PREPARATION_BUDGET_EXCEEDED'), 'F06 aggregate-over sample was not rejected.');
  assert(singleOver.actualAssetSizes.some((entry) => entry.byteLength === 64 * 1024 * 1024 + 1), 'F06 single-file sample did not measure 64 MiB + 1 byte.');
  assert(singleOver.issueCodes.includes('PREPARATION_BUDGET_EXCEEDED'), 'F06 single-file sample was not rejected.');
  await fsp.mkdir(path.join(evidenceRoot, 'F06'), { recursive: true });
  await fsp.copyFile(path.join(fixture.root, 'F06', 'budget-results.json'), path.join(evidenceRoot, 'F06', 'budget-results.json'));
  return sample;
}

async function run() {
  const existingFixtureRoot = process.env.PANDA_STAGE_ISSUE816_FIXTURE_ROOT;
  const fixture = existingFixtureRoot
    ? await loadIssue816Fixtures(path.resolve(existingFixtureRoot))
    : await generateIssue816Fixtures(path.resolve(baseDirectory));
  fixtureRoot = fixture.root;
  fixtureProjectRoot = fixture.f01Root;
  fixtureProject = ProjectSchema.parse(JSON.parse(await fsp.readFile(path.join(fixtureProjectRoot, 'project.json'), 'utf8')));
  fixtureImageBytes = readFileSync(path.join(fixtureProjectRoot, collectExportPreparationMedia(fixtureProject)[0].asset.relativePath));
  fixtureThumbnailDataUrl = `data:image/png;base64,${fixtureImageBytes.toString('base64')}`;
  const evidenceRoot = path.join(fixture.root, 'evidence');
  await fsp.mkdir(evidenceRoot, { recursive: true });
  installProjectFixtureIpc();
  createRendererService();
  await app.whenReady();
  mainWindow = await createMainWindow({ show: false, issue816Acceptance: true });
  mainWindow.setContentSize(1280, 800);
  mainWindow.setAlwaysOnTop(true);
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.focus();

  const result = {
    issue: 816,
    title: 'DL-01 controlled Electron preparation acceptance',
    fixtureRoot: fixture.root,
    platform: process.platform,
    electronVersion: process.versions.electron,
    startedAt: new Date().toISOString(),
    passed: false,
    autoPass: 'PARTIAL',
    owner: 'NOT_ATTESTED',
  };

  try {
    await waitForRenderer("document.querySelector(\"[data-task4-core='recent-open']\")");
    await clickSelector('[data-task4-core="recent-open"]');
    await waitForRenderer("window.__pandaStageIssue816Acceptance && (await window.__pandaStageIssue816Acceptance.inspect())?.project");

    const beforeEdit = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
    await waitForTrackedOpenInstance(beforeEdit.openInstanceId);
    const edited = await rendererJs('window.__pandaStageIssue816Acceptance.editUnsavedFixture()');
    assert(edited.dirty === true && edited.revision === beforeEdit.revision + 1, 'Acceptance edit did not enter the dirty EditorProjectStore revision.');
    assert(edited.undoCount === beforeEdit.undoCount + 1, 'Acceptance edit did not create its expected single History entry.');
    const persistedProject = ProjectSchema.parse(JSON.parse(await fsp.readFile(path.join(fixtureProjectRoot, 'project.json'), 'utf8')));
    assert(persistedProject.shots[0].dialogues[0]?.text !== 'DL-01 未保存字幕验收', 'Fixture edit unexpectedly reached project.json.');

    const beforeCancel = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
    const pendingCancel = rendererJs('window.__pandaStageIssue816Acceptance.prepare()');
    await clickNativeSaveDialog('cancel', path.join(evidenceRoot, 'F01', 'native-save-as-cancel.png'));
    const canceled = await pendingCancel;
    const afterCancel = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
    assert(canceled.status === 'cancelled', 'Native Save As cancellation did not return cancelled.');
    assert(afterCancel.revision === beforeCancel.revision && afterCancel.dirty === beforeCancel.dirty && afterCancel.undoCount === beforeCancel.undoCount, 'Cancel Save As changed revision, dirty, or History.');
    await fsp.mkdir(path.join(evidenceRoot, 'F01'), { recursive: true });
    await fsp.writeFile(path.join(evidenceRoot, 'F01', 'native-cancel-state.json'), JSON.stringify({
      status: canceled.status,
      before: {
        projectId: beforeCancel.project.id,
        openInstanceId: beforeCancel.openInstanceId,
        revision: beforeCancel.revision,
        dirty: beforeCancel.dirty,
        undoCount: beforeCancel.undoCount,
      },
      after: {
        projectId: afterCancel.project.id,
        openInstanceId: afterCancel.openInstanceId,
        revision: afterCancel.revision,
        dirty: afterCancel.dirty,
        undoCount: afterCancel.undoCount,
      },
      stateUnchanged:
        afterCancel.revision === beforeCancel.revision &&
        afterCancel.dirty === beforeCancel.dirty &&
        afterCancel.undoCount === beforeCancel.undoCount,
    }, null, 2), 'utf8');

    const overwriteOutputPath = path.join(
      fixtureProjectRoot,
      defaultExportFileName(fixtureProject.name),
    );
    const overwriteSentinelText = `Issue #818 overwrite target ${randomUUID()}`;
    const overwriteSentinel = Buffer.from(overwriteSentinelText, 'utf8');
    assert(!existsSync(overwriteOutputPath), 'The controlled overwrite target already exists before the F01 overwrite check.');
    let confirmedOverwriteCandidateId = null;
    try {
      const beforeOverwriteCancel = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
      const pendingOverwriteCancel = rendererJs('window.__pandaStageIssue816Acceptance.prepare()');
      await clickNativeSaveDialog(
        'save',
        path.join(evidenceRoot, 'F01', 'native-save-as-output-appears.png'),
        overwriteOutputPath,
        overwriteSentinelText,
        path.join(evidenceRoot, 'F01', 'native-system-overwrite-cancel-case.png'),
      );
      await clickNativeOverwriteConfirmation(
        'overwrite-cancel',
        path.join(evidenceRoot, 'F01', 'native-overwrite-cancel.png'),
      );
      const overwriteCanceled = await pendingOverwriteCancel;
      const afterOverwriteCancel = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
      const targetAfterOverwriteCancel = await fsp.readFile(overwriteOutputPath);
      assert(overwriteCanceled.status === 'cancelled', 'Native overwrite cancellation did not return cancelled.');
      assert(targetAfterOverwriteCancel.equals(overwriteSentinel), 'Native overwrite cancellation changed the selected target.');
      assert(
        afterOverwriteCancel.revision === beforeOverwriteCancel.revision &&
        afterOverwriteCancel.dirty === beforeOverwriteCancel.dirty &&
        afterOverwriteCancel.undoCount === beforeOverwriteCancel.undoCount,
        'Overwrite cancellation changed revision, dirty, or History.',
      );

      const pendingOverwriteConfirm = rendererJs('window.__pandaStageIssue816Acceptance.prepare()');
      await clickNativeSaveDialog(
        'save',
        path.join(evidenceRoot, 'F01', 'native-save-as-existing-output.png'),
        '',
        '',
        path.join(evidenceRoot, 'F01', 'native-system-overwrite-confirm-case.png'),
      );
      await clickNativeOverwriteConfirmation(
        'overwrite-confirm',
        path.join(evidenceRoot, 'F01', 'native-overwrite-confirm.png'),
      );
      const overwritePrepared = await pendingOverwriteConfirm;
      assert(overwritePrepared.status === 'PREPARATION_READY', `Explicit overwrite confirmation did not produce a prepared candidate: ${JSON.stringify(overwritePrepared)}`);
      const overwriteCandidate = overwritePrepared.candidate;
      confirmedOverwriteCandidateId = overwriteCandidate.snapshotId;
      const outputIntent = overwriteCandidate.outputIntent;
      const targetAfterPreparation = await fsp.readFile(overwriteOutputPath);
      const afterOverwritePreparation = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
      assert(outputIntent.overwriteApproved === true, 'Confirmed overwrite was not recorded in outputIntent.');
      assert(outputIntent.targetIdentity !== null, 'Confirmed overwrite candidate omitted target identity.');
      assert(path.resolve(outputIntent.targetIdentity.canonicalPath) === path.resolve(overwriteOutputPath), 'Confirmed overwrite target identity points to a different file.');
      assert(path.resolve(outputIntent.targetPath) === path.resolve(overwriteOutputPath), 'Confirmed overwrite candidate points to a different output path.');
      assert(targetAfterPreparation.equals(overwriteSentinel), 'Preparation wrote to the explicitly confirmed target.');
      assert(
        afterOverwritePreparation.revision === beforeOverwriteCancel.revision &&
        afterOverwritePreparation.dirty === beforeOverwriteCancel.dirty &&
        afterOverwritePreparation.undoCount === beforeOverwriteCancel.undoCount,
        'Overwrite confirmation changed revision, dirty, or History.',
      );
      await fsp.writeFile(path.join(evidenceRoot, 'F01', 'overwrite-confirmation.json'), JSON.stringify({
        targetPath: outputIntent.targetPath,
        targetIdentity: outputIntent.targetIdentity,
        overwriteApproved: outputIntent.overwriteApproved,
        targetSha256Before: hash(overwriteSentinel),
        targetSha256AfterCancel: hash(targetAfterOverwriteCancel),
        targetSha256AfterPrepare: hash(targetAfterPreparation),
        cancelStatus: overwriteCanceled.status,
        confirmStatus: overwritePrepared.status,
        editorStateUnchanged: true,
        preparationWroteOutput: false,
      }, null, 2), 'utf8');
      await exportPreparationService.discard(undefined, overwriteCandidate.snapshotId);
      confirmedOverwriteCandidateId = null;
    } finally {
      if (confirmedOverwriteCandidateId) {
        await exportPreparationService.discard(undefined, confirmedOverwriteCandidateId).catch(() => undefined);
      }
      await fsp.rm(overwriteOutputPath, { force: true });
    }

    const beforePreparation = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
    const pendingPreparation = rendererJs('window.__pandaStageIssue816Acceptance.prepare()');
    await clickNativeSaveDialog('save', path.join(evidenceRoot, 'F01', 'native-save-as-select.png'));
    const prepared = await pendingPreparation;
    assert(prepared.status === 'PREPARATION_READY', `F01 did not return PREPARATION_READY: ${JSON.stringify(prepared)}`);
    const candidate = prepared.candidate;
    const afterPreparation = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
    assert(candidate.projectId === fixtureProject.id, 'Candidate project identity differs from the opened editor Project.');
    assert(candidate.openInstanceId === beforePreparation.openInstanceId, 'Candidate captured a different EditorProjectStore instance.');
    assert(candidate.revision === beforePreparation.revision && candidate.dirtyAtCapture === true, 'Candidate did not capture the real dirty revision.');
    assert(candidate.project.shots[0].dialogues[0]?.text === 'DL-01 未保存字幕验收', 'Candidate omitted the unsaved subtitle.');
    const candidateCharacter = candidate.project.shots[0].layers.find((layer) => layer.source.kind === 'character');
    const editedCharacter = beforePreparation.project.shots[0].layers.find((layer) => layer.source.kind === 'character');
    assert(candidateCharacter?.x === editedCharacter?.x && candidateCharacter?.y === editedCharacter?.y, 'Candidate omitted unsaved character position.');
    assert(afterPreparation.revision === beforePreparation.revision && afterPreparation.dirty === beforePreparation.dirty && afterPreparation.undoCount === beforePreparation.undoCount, 'Preparation changed EditorProjectStore revision, dirty, or History.');
    assert(candidate.supportProfileVersion === candidate.supportProfile.version, 'Candidate support profile version is inconsistent.');
    assert(candidate.renderSettings.width === 1920 && candidate.renderSettings.height === 1080 && candidate.renderSettings.fps === 24, 'Candidate render settings differ from DL-01 contract.');
    assert(candidate.mediaManifest.length > 0 && candidate.mediaManifest.every((entry) => entry.sha256), 'Candidate media manifest is incomplete.');
    const manifestAssetIds = new Set(candidate.mediaManifest.map((entry) => entry.assetId));
    const previewPreloadAssetIds = listShotRuntimeImageAssets(
      candidate.project,
      candidate.project.shots[0],
    ).map((asset) => asset.id);
    const unusedPreviewPreloadAssetIds = previewPreloadAssetIds.filter(
      (assetId) => !manifestAssetIds.has(assetId),
    );
    assert(unusedPreviewPreloadAssetIds.length > 0, 'F01 did not contain an unused alternate expression to distinguish Preview preloading from export requirements.');
    assert(unusedPreviewPreloadAssetIds.every((assetId) => !manifestAssetIds.has(assetId)), 'F01 export candidate unexpectedly included a Preview-only alternate expression.');

    const outputPath = candidate.outputIntent.targetPath;
    assert(path.resolve(outputPath) === path.resolve(fixtureProjectRoot, defaultExportFileName(fixtureProject.name)), `Native Save As chose unexpected path: ${outputPath}`);
    assert(!existsSync(outputPath), 'DL-01 wrote an MP4 during preparation.');
    const candidateEvidence = await copyCandidateEvidence(candidate, evidenceRoot);
    const frozenMedia = candidate.mediaManifest[0];
    assert(frozenMedia, 'F01 candidate has no frozen media to verify.');
    const sourcePath = path.join(fixtureProjectRoot, frozenMedia.sourceRelativePath);
    const originalSourceBytes = await fsp.readFile(sourcePath);
    const replacementSourceBytes = Buffer.from(originalSourceBytes);
    replacementSourceBytes[replacementSourceBytes.length - 1] ^= 0xff;
    const frozenCopyPath = path.join(
      new NodeExportPreparationFileStore().rootDirectory,
      candidate.snapshotId,
      frozenMedia.contentRelativePath,
    );
    let frozenBytesAfterSourceReplacement;
    let frozenBytesAfterSourceDeletion;
    let sourceDeletedAfterPreparation = false;
    try {
      await fsp.writeFile(sourcePath, replacementSourceBytes);
      frozenBytesAfterSourceReplacement = await fsp.readFile(frozenCopyPath);
      await fsp.unlink(sourcePath);
      sourceDeletedAfterPreparation = true;
      assert(!existsSync(sourcePath), 'F01 source file still existed after post-preparation deletion.');
      frozenBytesAfterSourceDeletion = await fsp.readFile(frozenCopyPath);
    } finally {
      await fsp.writeFile(sourcePath, originalSourceBytes);
    }
    assert(hash(originalSourceBytes) === frozenMedia.sha256, 'F01 source did not match the validated manifest before replacement.');
    assert(hash(replacementSourceBytes) !== frozenMedia.sha256, 'F01 replacement source unexpectedly retained the validated hash.');
    assert(hash(frozenBytesAfterSourceReplacement) === frozenMedia.sha256, 'F01 frozen candidate bytes changed when the source was replaced after preparation.');
    assert(sourceDeletedAfterPreparation, 'F01 source was not deleted after successful preparation.');
    assert(hash(frozenBytesAfterSourceDeletion) === frozenMedia.sha256, 'F01 frozen candidate bytes changed when the source was deleted after preparation.');
    await fsp.writeFile(path.join(evidenceRoot, 'F01', 'candidate-after-source-replacement.json'), JSON.stringify({
      sourceRelativePath: frozenMedia.sourceRelativePath,
      contentRelativePath: frozenMedia.contentRelativePath,
      validatedSha256: frozenMedia.sha256,
      sourceReplacementSha256: hash(replacementSourceBytes),
      frozenCopySha256AfterSourceReplacement: hash(frozenBytesAfterSourceReplacement),
      sourceDeletedAfterPreparation,
      frozenCopySha256AfterSourceDeletion: hash(frozenBytesAfterSourceDeletion),
      frozenCopyMatchesValidatedBytesAfterDeletion: frozenBytesAfterSourceDeletion.equals(originalSourceBytes),
      frozenCopyMatchesValidatedBytes: frozenBytesAfterSourceReplacement.equals(originalSourceBytes),
      sourceRestored: hash(await fsp.readFile(sourcePath)) === frozenMedia.sha256,
    }, null, 2), 'utf8');
    assert(frozenBytesAfterSourceReplacement.equals(originalSourceBytes), 'F01 frozen candidate bytes differ from the validated source bytes.');
    assert(frozenBytesAfterSourceDeletion.equals(originalSourceBytes), 'F01 frozen candidate bytes differ from the validated source after source deletion.');
    await fsp.writeFile(path.join(evidenceRoot, 'F01', 'editor-before-capture.json'), JSON.stringify(beforePreparation, null, 2), 'utf8');
    await fsp.writeFile(path.join(evidenceRoot, 'F01', 'editor-after-capture.json'), JSON.stringify(afterPreparation, null, 2), 'utf8');
    await fsp.writeFile(path.join(evidenceRoot, 'F01', 'native-save-as.png'), (await mainWindow.webContents.capturePage()).toPNG());
    await fsp.writeFile(path.join(evidenceRoot, 'F01', 'electron-success.json'), JSON.stringify({
      nativeSaveAsSelected: true,
      canceledFirstDialog: true,
      outputPath,
      outputCreated: false,
      candidateSnapshotId: candidate.snapshotId,
      candidateEvidence,
      mediaCount: candidate.mediaManifest.length,
      mediaManifest: candidate.mediaManifest.map((entry) => ({ assetId: entry.assetId, sha256: entry.sha256, byteLength: entry.byteLength, usages: entry.usages })),
    }, null, 2), 'utf8');

    const candidateProjectEvidencePath = path.join(candidateEvidence, 'project.json');
    const candidateProjectEvidenceBeforeSave = await fsp.readFile(candidateProjectEvidencePath);
    const candidateProjectHashBeforeSave = hash(Buffer.from(JSON.stringify(candidate.project)));
    const saveAfterCapture = await rendererJs('window.__pandaStageIssue816Acceptance.saveCurrentProject()');
    assert(saveAfterCapture.ok === true, `The original Project could not be saved after candidate capture: ${JSON.stringify(saveAfterCapture)}`);
    assert(saveAfterCapture.acknowledgement === 'current', 'Saving after capture did not acknowledge the current Project revision.');
    const editorAfterSave = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
    assert(editorAfterSave.revision === candidate.revision && editorAfterSave.dirty === false, 'Saving after capture changed the Project revision or left it dirty.');
    assert(editorAfterSave.undoCount === afterPreparation.undoCount, 'Saving after capture changed History.');
    const persistedAfterSave = ProjectSchema.parse(JSON.parse(await fsp.readFile(path.join(fixtureProjectRoot, 'project.json'), 'utf8')));
    assert(persistedAfterSave.shots[0].dialogues[0]?.text === candidate.project.shots[0].dialogues[0]?.text, 'Saving after capture did not persist the captured unsaved subtitle to the original Project.');
    const persistedCharacter = persistedAfterSave.shots[0].layers.find((layer) => layer.id === candidateCharacter?.id);
    assert(persistedCharacter?.x === candidateCharacter?.x && persistedCharacter?.y === candidateCharacter?.y, 'Saving after capture did not persist the captured unsaved character position.');
    assert(candidate.project.shots[0].dialogues[0]?.text === 'DL-01 未保存字幕验收', 'Saving the original Project changed the candidate subtitle.');
    assert(hash(Buffer.from(JSON.stringify(candidate.project))) === candidateProjectHashBeforeSave, 'Saving the original Project changed the in-memory candidate.');
    const candidateProjectEvidenceAfterSave = await fsp.readFile(candidateProjectEvidencePath);
    assert(candidateProjectEvidenceAfterSave.equals(candidateProjectEvidenceBeforeSave), 'Saving the original Project changed the frozen candidate evidence file.');
    await fsp.writeFile(path.join(evidenceRoot, 'F01', 'post-capture-save.json'), JSON.stringify({
      candidateSnapshotId: candidate.snapshotId,
      candidateRevision: candidate.revision,
      savedRevision: saveAfterCapture.savedRevision,
      acknowledgement: saveAfterCapture.acknowledgement,
      dirtyAfterSave: editorAfterSave.dirty,
      undoCountBeforeSave: afterPreparation.undoCount,
      undoCountAfterSave: editorAfterSave.undoCount,
      savedProjectSha256: hash(Buffer.from(JSON.stringify(persistedAfterSave))),
      candidateProjectSha256BeforeSave: candidateProjectHashBeforeSave,
      candidateProjectSha256AfterSave: hash(Buffer.from(JSON.stringify(candidate.project))),
      candidateEvidenceFileUnchanged: candidateProjectEvidenceAfterSave.equals(candidateProjectEvidenceBeforeSave),
      persistedUnsavedSubtitleAndPosition: true,
    }, null, 2), 'utf8');
    await exportPreparationService.discard(undefined, candidate.snapshotId);

    const editAfterCapture = await rendererJs('window.__pandaStageIssue816Acceptance.editUnsavedFixture()');
    assert(editAfterCapture.revision === candidate.revision + 1, 'Could not create the post-capture edit.');
    assert(candidate.project.shots[0].dialogues[0]?.text === 'DL-01 未保存字幕验收', 'Post-capture edits changed the frozen candidate subtitle.');
    assert(candidateCharacter?.x === editedCharacter?.x && candidateCharacter?.y === editedCharacter?.y, 'Post-capture edits changed the frozen candidate position.');

    const previousAttemptId = await rendererJs('window.__pandaStageIssue816Acceptance.lastAttemptId');
    await rendererJs('window.__pandaStageIssue816Acceptance.lastMainResponse = null');
    let releaseStaleRead;
    let markStaleReadStarted;
    const staleReadGatePromise = new Promise((resolve) => {
      releaseStaleRead = resolve;
    });
    const staleReadStarted = new Promise((resolve) => {
      markStaleReadStarted = resolve;
    });
    nextMediaReadGate = {
      promise: staleReadGatePromise,
      markStarted: markStaleReadStarted,
    };
    const pendingStalePreparation = rendererJs('window.__pandaStageIssue816Acceptance.prepare()');
    let activeSnapshotId;
    let reopened;
    try {
      await clickNativeSaveDialog('save', path.join(evidenceRoot, 'F05', 'native-save-as-session-change.png'));
      await waitForRenderer(`window.__pandaStageIssue816Acceptance.lastAttemptId && window.__pandaStageIssue816Acceptance.lastAttemptId !== ${JSON.stringify(previousAttemptId)}`);
      activeSnapshotId = await waitForActivePreparation();
      await staleReadStarted;
      reopened = await rendererJs('window.__pandaStageIssue816Acceptance.reopenSamePath()');
    } finally {
      releaseStaleRead();
      nextMediaReadGate = null;
    }
    assert(reopened.projectRoot === fixtureProjectRoot && reopened.project.id === fixtureProject.id, 'Same-path test did not reopen the same Project identity.');
    assert(reopened.openInstanceId !== candidate.openInstanceId, 'Same-path reopen retained the prior open instance ID.');
    await waitForTrackedOpenInstance(reopened.openInstanceId);
    const staleResult = await pendingStalePreparation;
    assert(staleResult.status === 'BLOCK' && staleResult.issues.some((item) => item.code === 'PROJECT_SESSION_CHANGED'), 'Late preflight result was not rejected after same-path reopen.');
    const mainResponse = await rendererJs('window.__pandaStageIssue816Acceptance.lastMainResponse');
    assert(mainResponse?.status === 'BLOCK' && mainResponse.issues.some((item) => item.code === 'PROJECT_SESSION_CHANGED'), 'Main did not reject the stale same-path request.');
    const mainSessionDiagnostic = exportPreparationService.getDiagnostics(mainResponse.diagnosticId);
    assert(mainSessionDiagnostic.some((item) => item.includes('open instance changed')), 'Main did not record a technical diagnostic for the stale same-path request.');
    assert(!existsSync(path.join(new NodeExportPreparationFileStore().rootDirectory, activeSnapshotId)), 'Stale asynchronous preparation left a frozen media directory.');
    await fsp.mkdir(path.join(evidenceRoot, 'F05'), { recursive: true });
    await fsp.writeFile(path.join(evidenceRoot, 'F05', 'same-path-reopen.json'), JSON.stringify({
      staleResult,
      mainResponse,
      mainSessionDiagnostic,
      priorInstanceId: candidate.openInstanceId,
      reopenedInstanceId: reopened.openInstanceId,
      staleSnapshotId: activeSnapshotId,
      staleSnapshotCleaned: !existsSync(path.join(new NodeExportPreparationFileStore().rootDirectory, activeSnapshotId)),
    }, null, 2), 'utf8');

    const f05 = await runF05(fixture, evidenceRoot);
    const f06 = await runF06(fixture, evidenceRoot);
    result.f01 = {
      status: prepared.status,
      revision: candidate.revision,
      dirtyAtCapture: candidate.dirtyAtCapture,
      projectSha256: hash(Buffer.from(JSON.stringify(candidate.project))),
      savedRevision: saveAfterCapture.savedRevision,
      saveAcknowledgement: saveAfterCapture.acknowledgement,
      dirtyAfterSave: editorAfterSave.dirty,
      projectSavedSha256: hash(Buffer.from(JSON.stringify(persistedAfterSave))),
      mediaCount: candidate.mediaManifest.length,
      outputPath,
      outputCreated: existsSync(outputPath),
      historyUndoCountBefore: beforePreparation.undoCount,
      historyUndoCountAfter: afterPreparation.undoCount,
      candidateEvidence,
    };
    result.f05 = Object.fromEntries(Object.entries(f05).map(([name, item]) => [name, item.issueCodes ?? item.status]));
    result.f06 = {
      withinBytes: f06.within.actualTotalBytes,
      boundaryBytes: f06.boundary.actualTotalBytes,
      aggregateOverBytes: f06.aggregateOver.actualTotalBytes,
      singleOverBytes: f06.singleOver.actualAssetSizes.find((entry) => entry.byteLength > 64 * 1024 * 1024)?.byteLength,
    };
    result.passed = true;
    result.autoPass = 'PARTIAL';
    result.completedAt = new Date().toISOString();
    await fsp.writeFile(path.join(evidenceRoot, 'electron-results.json'), JSON.stringify(result, null, 2), 'utf8');
    await fsp.writeFile(path.join(fixture.root, 'electron-results.json'), JSON.stringify(result, null, 2), 'utf8');
    console.log('PASS #816 DL-01 controlled Electron preparation acceptance:', fixture.root);
    mainWindow.destroy();
    app.exit(0);
  } catch (error) {
    result.error = String(error.stack ?? error);
    result.completedAt = new Date().toISOString();
    await fsp.writeFile(path.join(evidenceRoot, 'electron-failure.json'), JSON.stringify(result, null, 2), 'utf8');
    if (mainWindow && !mainWindow.isDestroyed()) {
      const failureImage = await mainWindow.webContents.capturePage().catch(() => null);
      if (failureImage) {
        await fsp.writeFile(path.join(evidenceRoot, 'electron-failure.png'), failureImage.toPNG());
      }
      mainWindow.destroy();
    }
    console.error(result.error);
    app.exit(1);
  } finally {
    removeExportPreparationHandlers?.();
    removeProjectIpcHandlers?.();
    exportPreparationService?.disposeSync();
  }
}

let fixtureRoot = null;
run().catch((error) => {
  console.error(error.stack ?? error);
  app.exit(1);
});

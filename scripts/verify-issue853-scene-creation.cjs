const { app, BrowserWindow } = require('electron');
const { execFileSync } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { AssetImportService } = require('../dist-electron/main/services/AssetImportService.js');
const { ProjectService } = require('../dist-electron/main/services/ProjectService.js');
const { CharacterService } = require('../dist-electron/domain/services/CharacterService.js');
const { ShotService } = require('../dist-electron/domain/services/ShotService.js');
const {
  updateImageAssetAuthorMetadata,
} = require('../dist-electron/domain/services/AssetService.js');

process.env.VITE_DEV_SERVER_URL = '';

const repositoryRoot = path.resolve(__dirname, '..');
const fixtureAssetRoot = path.join(repositoryRoot, 'tests/fixtures/assets');
const fixtureCharacterRoot = path.join(repositoryRoot, 'tests/fixtures/characters');
const acceptanceRoot = 'D:\\PandaStage-Acceptance\\issue853-scene-creation';
const runId = new Date().toISOString().replace(/[:.]/gu, '-');
const runRoot = path.join(acceptanceRoot, `run-${runId}`);
const evidenceRoot = path.join(runRoot, 'evidence');
const projectRoot = path.join(runRoot, 'structured-scene.pandastage');
const userDataRoot = path.join(runRoot, 'electron-user-data');
const receiptPath = path.join(runRoot, 'issue853-ac02-ui-receipt.json');
let windowRef = null;

function configureElectronPaths() {
  for (const [name, directory] of [
    ['userData', userDataRoot],
    ['sessionData', path.join(userDataRoot, 'session-data')],
    ['temp', path.join(runRoot, 'temp')],
    ['logs', path.join(runRoot, 'logs')],
    ['crashDumps', path.join(runRoot, 'crash-dumps')],
  ]) {
    mkdirSync(directory, { recursive: true });
    try {
      app.setPath(name, directory);
    } catch {
      // Some Electron path keys are immutable after readiness.
    }
  }
}

mkdirSync(runRoot, { recursive: true });
configureElectronPaths();
require('../dist-electron/main/index.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function browserWait(expression, message, timeout = 25_000) {
  return `(async () => {
    const deadline = Date.now() + ${timeout};
    while (Date.now() < deadline) {
      try {
        if (${expression}) return true;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(${JSON.stringify(message)});
  })()`;
}

async function waitForDom(window, expression, message, timeout) {
  await window.webContents.executeJavaScript(
    browserWait(expression, message, timeout),
  );
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function click(window, selector) {
  await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) {
      throw new Error('Element not found: ' + ${JSON.stringify(selector)});
    }
    if (element instanceof HTMLButtonElement && element.disabled) {
      throw new Error('Element is disabled: ' + ${JSON.stringify(selector)});
    }
    element.click();
  })()`);
}

async function capture(window, fileName) {
  await delay(220);
  const image = await window.webContents.capturePage();
  const filePath = path.join(evidenceRoot, fileName);
  writeFileSync(filePath, image.toPNG());
  return path.relative(runRoot, filePath).replaceAll('\\', '/');
}

function closeWindow(window) {
  if (window && !window.isDestroyed()) window.destroy();
}

async function waitForMainWindow() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const window = BrowserWindow.getAllWindows().find(
      (candidate) => !candidate.isDestroyed(),
    );
    if (window) return window;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('The production Electron window did not open.');
}

async function createSampleProject() {
  const mainSnapshot = { current: null };
  const projectService = new ProjectService({
    onProjectSaved: (_root, project, revision) => {
      if (revision !== undefined) mainSnapshot.current = { project, revision };
    },
  });
  const created = await projectService.create(projectRoot, {
    name: 'Issue 853 structured scene sample',
  });
  mainSnapshot.current = { project: created.project, revision: 0 };
  const importService = new AssetImportService({
    projectService,
    getCurrentProjectSnapshot: () => mainSnapshot.current,
  });
  const imported = await importService.importCandidates({
    projectRoot,
    project: created.project,
    baseRevision: 0,
    candidates: [
      {
        sourcePath: path.join(fixtureAssetRoot, '另一张 图片.png'),
        declaredMimeType: 'image/png',
      },
      {
        sourcePath: path.join(fixtureCharacterRoot, '熊猫 normal.png'),
        declaredMimeType: 'image/png',
      },
      {
        sourcePath: path.join(fixtureAssetRoot, '熊猫 图片.png'),
        declaredMimeType: 'image/png',
      },
      {
        sourcePath: path.join(fixtureAssetRoot, '熊猫 照片.jpg'),
        declaredMimeType: 'image/jpeg',
      },
    ],
  });
  const assets = imported.results.map((result) => {
    if (!result.asset || !['imported', 'duplicate'].includes(result.status)) {
      throw new Error(
        `Could not prepare a verifier image (${result.code ?? result.status}).`,
      );
    }
    return result.asset;
  });
  const [background, face, body, secondBackground] = assets;
  if (
    !background || background.kind !== 'image' ||
    !face || face.kind !== 'image' ||
    !body || body.kind !== 'image' ||
    !secondBackground || secondBackground.kind !== 'image' ||
    background.id === secondBackground.id
  ) {
    throw new Error('The verifier did not create two distinct background candidates.');
  }

  let project = imported.project;
  project = updateImageAssetAuthorMetadata(project, background.id, {
    name: '花园',
    usage: 'background',
    keywords: ['issue853'],
  });
  project = updateImageAssetAuthorMetadata(project, secondBackground.id, {
    name: '花园',
    usage: 'background',
    keywords: ['issue853', 'alternate'],
  });
  project = updateImageAssetAuthorMetadata(project, face.id, {
    name: '默认表情',
    usage: 'character',
    keywords: ['issue853'],
  });
  project = updateImageAssetAuthorMetadata(project, body.id, {
    name: '熊猫身体',
    usage: 'character',
    keywords: ['issue853'],
  });
  project = new CharacterService().createComposite(project, {
    name: '熊猫试装角色',
    expressions: [{ name: '默认', assetId: face.id }],
    defaultExpressionIndex: 0,
    bodyAssetId: body.id,
    bodyPlacement: { offsetX: 0, offsetY: 0, scale: 1 },
    facePlacement: {
      offsetX: 0,
      offsetY: -420,
      scale: 1,
      rotationDeg: 0,
      flipX: false,
    },
    defaultScale: 0.72,
    defaultFlipX: false,
  });
  project = new ShotService().create(project, {
    name: '既有镜头',
    durationMs: 3_000,
  });
  await projectService.save(projectRoot, project);
  return {
    project,
    backgroundAssetIds: [background.id, secondBackground.id],
    characterId: project.characters.find(
      (character) => character.name === '熊猫试装角色',
    )?.id,
  };
}

async function openProject(window) {
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input')`,
    'Project Center did not render its open-project input.',
  );
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(projectRoot)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-testid="project-center-screen"] .recovery-open-row button').click();
  })()`);
  await waitForDom(
    window,
    `document.querySelector('[data-testid="editor-layout"]')`,
    'The sample project did not open in the editor.',
  );
  await window.webContents.executeJavaScript(`(() => {
    const dock = document.querySelector('[data-testid="resource-activity-dock"]');
    if (dock?.dataset.activeActivity !== 'shots' || dock?.dataset.resourceDrawerOpen !== 'true') {
      const button = document.querySelector('[data-testid="resource-activity-rail-shots"]')
        ?? document.querySelector('[data-testid="resource-activity-tabs"] [data-activity="shots"]');
      button?.click();
    }
  })()`);
  await waitForDom(
    window,
    `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.activeActivity === 'shots' && document.querySelector('[data-testid="shot-manager"]')`,
    'The production Shots workspace did not open.',
  );
}

async function run() {
  mkdirSync(evidenceRoot, { recursive: true });
  const sample = await createSampleProject();
  assert(sample.characterId, 'The sample composite Character was not persisted.');
  windowRef = await waitForMainWindow();
  windowRef.setSize(1600, 1050);
  windowRef.show();
  windowRef.focus();
  await openProject(windowRef);

  await click(windowRef, '[data-testid="resource-primary-action"]');
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="shot-create-view"]')`,
    'Shot creation did not open.',
  );
  await click(windowRef, '[data-testid="shot-create-structured-input"]');
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="scene-creation-panel"]')`,
    'The structured scene panel did not open from Shot creation.',
  );
  await windowRef.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('[data-testid="scene-creation-input"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(input, '镜头：花园相遇\\n背景：花园\\n出场：熊猫试装角色');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await click(windowRef, '[data-testid="scene-creation-inspect"]');
  await waitForDom(
    windowRef,
    `document.querySelectorAll('[data-testid="scene-creation-background-candidate"]').length === 2 && document.querySelector('[data-testid="scene-creation-character-candidate"]')`,
    'Exact-name background and Character candidates did not render.',
  );
  await waitForDom(
    windowRef,
    `![...document.querySelectorAll('[data-testid="scene-creation-background-candidate"], [data-testid="scene-creation-character-candidate"]')].some((button) => button.disabled)`,
    'Candidate thumbnails did not become ready.',
  );
  const beforeSelection = await windowRef.webContents.executeJavaScript(`(() => ({
    revision: Number(document.querySelector('[data-testid="shot-manager"] [data-project-revision]')?.getAttribute('data-project-revision')),
    backgroundIds: [...document.querySelectorAll('[data-testid="scene-creation-background-candidate"]')].map((button) => button.dataset.candidateId),
    previewDisabled: document.querySelector('[data-testid="scene-creation-preview-action"]')?.disabled,
  }))()`);
  assert(beforeSelection.revision === 0, 'Candidate inspection changed the project revision.');
  assert(
    JSON.stringify(beforeSelection.backgroundIds) ===
      JSON.stringify(sample.backgroundAssetIds),
    'The UI did not show both exact-name background candidates in project order.',
  );
  assert(beforeSelection.previewDisabled, 'An ambiguous background was silently selected.');
  await click(
    windowRef,
    `[data-testid="scene-creation-background-candidate"][data-candidate-id="${sample.backgroundAssetIds[0]}"]`,
  );
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="scene-creation-preview-action"]')?.disabled === false`,
    'The explicit background choice did not enable preview.',
  );
  const inputScreenshot = await capture(windowRef, 'candidate-selection.png');
  await click(windowRef, '[data-testid="scene-creation-preview-action"]');
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="scene-creation-preview"]')?.dataset.previewStatus === 'ready' && document.querySelector('[data-testid="scene-creation-preview-image"]')?.naturalWidth > 0`,
    'The composed preview did not become ready.',
  );
  await windowRef.webContents.executeJavaScript(
    `document.querySelector('[data-testid="scene-creation-preview"]')?.scrollIntoView({ block: 'end', behavior: 'instant' })`,
  );
  const beforeConfirm = await windowRef.webContents.executeJavaScript(`(() => ({
    revision: Number(document.querySelector('[data-testid="shot-manager"] [data-project-revision]')?.getAttribute('data-project-revision')),
    previewStatus: document.querySelector('[data-testid="scene-creation-preview"]')?.dataset.previewStatus,
  }))()`);
  assert(beforeConfirm.revision === 0, 'Preparing the composed preview changed the project revision.');
  const previewScreenshot = await capture(windowRef, 'read-only-preview.png');
  await click(windowRef, '[data-testid="scene-creation-confirm"]');
  await waitForDom(
    windowRef,
    `!document.querySelector('[data-testid="scene-creation-panel"]') && document.querySelectorAll('.shot-list-item').length === 2 && document.querySelector('.shot-list-item-selected strong')?.textContent?.trim() === '花园相遇'`,
    'Explicit confirmation did not create and select the new Shot.',
  );
  const afterConfirm = await windowRef.webContents.executeJavaScript(`(() => ({
    revision: Number(document.querySelector('[data-testid="shot-manager"] [data-project-revision]')?.getAttribute('data-project-revision')),
    shotCount: document.querySelectorAll('.shot-list-item').length,
    selectedShot: document.querySelector('.shot-list-item-selected strong')?.textContent?.trim(),
  }))()`);
  assert(afterConfirm.revision === 1, 'Confirmation did not create exactly one project revision.');
  assert(afterConfirm.shotCount === 2, 'Confirmation created an unexpected number of Shots.');
  const committedScreenshot = await capture(windowRef, 'generated-shot.png');

  return {
    issue: 853,
    acceptance: 'AC02_ELECTRON_CANDIDATE_PREVIEW_CONFIRM',
    passed: true,
    codeHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    generatedAt: new Date().toISOString(),
    syntheticFixture: true,
    sourcePathsOmitted: true,
    project: {
      id: sample.project.id,
      root: '<isolated acceptance project>',
      initialRevision: beforeSelection.revision,
      previewRevision: beforeConfirm.revision,
      committedRevision: afterConfirm.revision,
      initialShotCount: sample.project.shots.length,
      committedShotCount: afterConfirm.shotCount,
      selectedShot: afterConfirm.selectedShot,
      ambiguousBackgroundCandidateIds: beforeSelection.backgroundIds,
      explicitBackgroundSelectionRequired: beforeSelection.previewDisabled,
      previewStatus: beforeConfirm.previewStatus,
    },
    screenshots: {
      inputAndCandidates: inputScreenshot,
      readOnlyPreview: previewScreenshot,
      generatedShot: committedScreenshot,
    },
    humanAcceptance: false,
    receiptPath: '<isolated acceptance receipt>',
  };
}

async function main() {
  mkdirSync(runRoot, { recursive: true });
  let output;
  try {
    await app.whenReady();
    output = await run();
  } catch (error) {
    output = {
      issue: 853,
      acceptance: 'AC02_ELECTRON_CANDIDATE_PREVIEW_CONFIRM',
      passed: false,
      codeHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      error: error instanceof Error ? error.stack ?? error.message : String(error),
      humanAcceptance: false,
    };
    throw error;
  } finally {
    closeWindow(windowRef);
    writeFileSync(receiptPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  }
}

main()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(`[issue853] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    app.exit(1);
  });

import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const corepackScript = join(
  dirname(process.execPath),
  'node_modules/corepack/dist/corepack.js',
);
const corepackShims = join(
  dirname(process.execPath),
  'node_modules/corepack/shims',
);
const electronCli = join(repositoryRoot, 'node_modules/electron/cli.js');

interface Issue81Evidence {
  aAsset: {
    activity: string | null;
    assetCategory: number;
    assetResultCount: number;
    assetSelectedCount: number;
    dirty: boolean;
    revision: number;
  };
  bAfterA: {
    activity: string | null;
    assetResultCount: number;
    assetSelectedCount: number;
    dirty: boolean;
    managerCount: number;
    revision: number;
    selectedLayerId: string;
    shotId: string | null;
  };
  bAssetsClean: {
    assetCategory: number;
    assetResultCount: number;
    assetSelectedCount: number;
  };
  aAfterB: {
    activity: string | null;
    charCreateDraft: string | null;
    charEditorDraft: string | null;
    dirty: boolean;
    revision: number;
  };
  bCharacterAfterA: {
    activity: string | null;
    charCreateDraft: string | null;
    charEditorDraft: string | null;
    dirty: boolean;
    revision: number;
  };
  aFinal: {
    activity: string | null;
    charCreateDraft: string | null;
    charEditorDraft: string | null;
    dirty: boolean;
    managerCount: number;
    revision: number;
    redo: number;
    selectedLayerId: string;
    shotId: string | null;
    undo: number;
  };
  cancelledSwitch: {
    dirty: boolean;
    root: string | null;
  };
  discardedSwitch: {
    dirty: boolean;
    root: string | null;
  };
  savedSwitch: {
    dirty: boolean;
    root: string | null;
  };
  guardOutcomes: string[];
}

function electronGateSource(root: string): string {
  const rootLiteral = JSON.stringify(root);
  return `
const { app, ipcMain } = require('electron');
const path = require('node:path');

const repositoryRoot = ${rootLiteral};
const { createMainWindow } = require(path.join(
  repositoryRoot,
  'dist-electron/main/windows/main-window.js',
));
const { IPC_CHANNELS } = require(path.join(
  repositoryRoot,
  'dist-electron/shared/ipc/channels.js',
));
const exampleProject = require(path.join(
  repositoryRoot,
  'demo-project/project-v1.example.json',
));

const projectARoot = 'D:\\\\Projects\\\\Issue 81 A.pandastage';
const projectBRoot = 'D:\\\\Projects\\\\Issue 81 B.pandastage';
const projectA = JSON.parse(JSON.stringify(exampleProject));
projectA.name = 'Issue 81 project A';
projectA.assets = projectA.assets.map((asset) => ({
  ...asset,
  name: 'A ' + asset.name,
}));
projectA.characters = projectA.characters.map((character) => ({
  ...character,
  name: 'A ' + character.name,
}));

const projectB = JSON.parse(JSON.stringify(projectA));
projectB.id = '10000000-0000-4000-8000-000000000099';
projectB.name = 'Issue 81 project B';
projectB.assets = projectB.assets.map((asset) => ({
  ...asset,
  name: asset.name.replace(/^A /u, 'B '),
}));
projectB.characters = projectB.characters.map((character) => ({
  ...character,
  name: character.name.replace(/^A /u, 'B '),
}));
projectB.shots = projectB.shots.map((shot) => ({
  ...shot,
  id: '50000000-0000-4000-8000-000000000099',
}));

const projects = new Map([
  [projectARoot, projectA],
  [projectBRoot, projectB],
]);
const guardOutcomes = ['cancelled', 'discarded', 'saved'];
const observedGuardOutcomes = [];
const registeredChannels = [];

function register(channel, handler) {
  ipcMain.handle(channel, handler);
  registeredChannels.push(channel);
}

function documentFor(projectRoot, project) {
  return {
    projectRoot,
    projectFilePath: projectRoot + '\\\\project.json',
    project,
    migrated: false,
    sourceVersion: 5,
  };
}

function waitFor(window, expression, message) {
  const script =
    'new Promise((resolve, reject) => {' +
    'const deadline = Date.now() + 15000;' +
    'const poll = () => {' +
    'let matched = false;' +
    'try { matched = Boolean(' + expression + '); } catch {}' +
    'if (matched) return resolve(true);' +
    'if (Date.now() >= deadline) return reject(new Error(' +
    JSON.stringify(message) +
    '));' +
    'setTimeout(poll, 25);' +
    '};' +
    'poll();' +
    '})';
  return window.webContents.executeJavaScript(script);
}

async function setInput(window, selector, value) {
  await window.webContents.executeJavaScript(
    '(() => {' +
      'const input = document.querySelector(' +
        JSON.stringify(selector) +
      ');' +
      'if (!(input instanceof HTMLInputElement)) {' +
        'throw new Error("Input not found: " + ' +
          JSON.stringify(selector) +
        ');' +
      '}' +
      'Object.getOwnPropertyDescriptor(' +
        'HTMLInputElement.prototype, "value"' +
      ').set.call(input, ' +
        JSON.stringify(value) +
      ');' +
      'input.dispatchEvent(new Event("input", { bubbles: true }));' +
      'input.dispatchEvent(new Event("change", { bubbles: true }));' +
    '})()',
  );
}

async function click(window, selector) {
  await window.webContents.executeJavaScript(
    '(() => {' +
      'const element = document.querySelector(' +
        JSON.stringify(selector) +
      ');' +
      'if (!(element instanceof HTMLElement)) {' +
        'throw new Error("Element not found: " + ' +
          JSON.stringify(selector) +
        ');' +
      '}' +
      'element.click();' +
    '})()',
  );
}

async function snapshot(window) {
  const script =
    '(() => ({' +
    'root: document.querySelector(' +
    JSON.stringify('[data-testid="active-project-path"] code') +
    ')?.textContent ?? null,' +
    'activity: document.querySelector(' +
    JSON.stringify('[data-testid="resource-activity-panel"]') +
    ')?.getAttribute("data-active-activity") ?? null,' +
    'assetCategory: [...document.querySelectorAll(' +
    JSON.stringify('.asset-category-tabs button') +
    ')].findIndex((button) => button.getAttribute("aria-pressed") === "true"),' +
    'assetResultCount: document.querySelectorAll(' +
    JSON.stringify('.asset-import-results li') +
    ').length,' +
    'assetSelectedCount: document.querySelectorAll(' +
    JSON.stringify('.asset-card-selected') +
    ').length,' +
    'charCreateDraft: document.querySelector(' +
    JSON.stringify('.character-create-form input') +
    ')?.value ?? null,' +
    'charEditorDraft: document.querySelector(' +
    JSON.stringify('.character-settings input') +
    ')?.value ?? null,' +
    'shotId: document.querySelector(' +
    JSON.stringify('.shot-list-item-selected') +
    ')?.getAttribute("data-shot-id") ?? null,' +
    'selectedLayerId: document.querySelector(' +
    JSON.stringify('[data-testid="project-canvas-stage"]') +
    ')?.getAttribute("data-selected-layer-id") ?? "",' +
    'revision: Number(document.querySelector(' +
    JSON.stringify('[data-testid="project-canvas-stage"]') +
    ')?.getAttribute("data-project-revision") ?? NaN),' +
    'dirty: Boolean(document.querySelector(".dirty-state")),' +
    'undo: Number(document.querySelector(' +
    JSON.stringify('[data-testid="history-controls"]') +
    ')?.getAttribute("data-undo-count") ?? NaN),' +
    'redo: Number(document.querySelector(' +
    JSON.stringify('[data-testid="history-controls"]') +
    ')?.getAttribute("data-redo-count") ?? NaN),' +
    'managerCount: document.querySelectorAll(' +
    JSON.stringify('.resource-activity-panel > section') +
    ').length' +
    '}))()';
  return window.webContents.executeJavaScript(script);
}

async function waitForRoot(window, projectRoot) {
  await waitFor(
    window,
    'document.querySelector(' +
      JSON.stringify('[data-testid="active-project-path"] code') +
    ')?.textContent === ' +
      JSON.stringify(projectRoot),
    'Project did not become active: ' + projectRoot,
  );
}

async function waitForActivity(window, activity) {
  await waitFor(
    window,
    'document.querySelector(' +
      JSON.stringify('[data-testid="resource-activity-panel"]') +
    ')?.getAttribute("data-active-activity") === ' +
      JSON.stringify(activity),
    'Resource activity did not become active: ' + activity,
  );
}

async function openProject(window, projectRoot) {
  await setInput(
    window,
    '.recovery-open-row input',
    projectRoot,
  );
  await waitFor(
    window,
    'document.querySelector(".recovery-open-row button")?.disabled === false',
    'Project open button did not become enabled.',
  );
  await click(
    window,
    '.recovery-open-row button',
  );
  await waitForRoot(window, projectRoot);
}

async function requestProjectSwitch(window, projectRoot) {
  await setInput(
    window,
    '.recovery-open-row input',
    projectRoot,
  );
  await waitFor(
    window,
    'document.querySelector(".recovery-open-row button")?.disabled === false',
    'Project switch button did not become enabled.',
  );
  await click(
    window,
    '.recovery-open-row button',
  );
}

async function switchActivity(window, activity) {
  await click(
    window,
    '[data-testid="resource-activity-tabs"] button[data-activity="' +
      activity +
      '"]',
  );
  await waitForActivity(window, activity);
}

async function applyShotName(window, name) {
  await setInput(
    window,
    '.shot-fields label:nth-of-type(1) input',
    name,
  );
  await click(window, '.shot-fields label:nth-of-type(1) button');
  await waitFor(
    window,
    'Boolean(document.querySelector(".dirty-state"))',
    'Applying a shot name did not mark the project dirty.',
  );
}

async function verifyIssue81() {
  register(IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY, () => ({
    ok: true,
    status: 'cancelled',
  }));
  register(IPC_CHANNELS.PROJECT_OPEN, (_event, request) => {
    const project = projects.get(request.projectRoot);
    if (!project) throw new Error('Unknown project root: ' + request.projectRoot);
    return {
      ok: true,
      value: documentFor(request.projectRoot, project),
    };
  });
  register(IPC_CHANNELS.PROJECT_SAVE, (_event, request) => ({
    ok: true,
    value: documentFor(request.projectRoot, request.project),
  }));
  register(IPC_CHANNELS.PROJECT_CONFIRM_SWITCH, () => {
    const outcome = guardOutcomes.shift() || 'saved';
    observedGuardOutcomes.push(outcome);
    return { outcome };
  });
  register(IPC_CHANNELS.RECENT_PROJECTS_LIST, () => ({
    ok: true,
    entries: [
      {
        projectId: projectA.id,
        projectName: projectA.name,
        projectRoot: projectARoot,
        lastOpenedAt: '2026-08-01T00:00:00.000Z',
        status: 'available',
      },
      {
        projectId: projectB.id,
        projectName: projectB.name,
        projectRoot: projectBRoot,
        lastOpenedAt: '2026-08-01T00:01:00.000Z',
        status: 'available',
      },
    ],
  }));
  register(IPC_CHANNELS.RECENT_PROJECTS_OPEN, (_event, request) => ({
    ok: true,
    document: documentFor(
      request.projectRoot,
      projects.get(request.projectRoot),
    ),
  }));
  register(IPC_CHANNELS.AUTOSAVE_TRACK, () => ({ ok: true }));
  register(IPC_CHANNELS.AUTOSAVE_UPDATE, () => ({ ok: true }));
  register(IPC_CHANNELS.AUTOSAVE_STOP, () => ({ ok: true }));
  register(IPC_CHANNELS.RECOVERY_DETECT, () => ({
    ok: true,
    candidate: null,
  }));
  register(IPC_CHANNELS.RECOVERY_IGNORE, () => ({
    ok: true,
    retained: true,
  }));
  register(IPC_CHANNELS.ASSET_IMPORT_CHOOSE, (_event, request) => ({
    ok: true,
    status: 'completed',
    project: request.project,
    baseRevision: request.baseRevision,
    savedRevision: request.baseRevision + 1,
    projectChanged: false,
    results: [
      {
        sourceName: request.projectRoot === projectARoot
          ? 'A temporary import.png'
          : 'B temporary import.png',
        status: 'rejected',
        sha256: null,
        asset: null,
        duplicateOfAssetId: null,
        code: 'ASSET_IMPORT_INVALID_CONTENT',
        message: 'Issue 81 temporary result; no project write.',
      },
    ],
  }));

  const window = await createMainWindow({ show: false });
  try {
    await waitFor(
      window,
      'document.querySelector(' +
        JSON.stringify('[data-testid="start-screen"]') +
      ')',
      'Start screen did not render.',
    );
    await openProject(window, projectARoot);
    await waitForActivity(window, 'shots');

    // T1: leave local asset state and import results in A, then switch to B.
    await switchActivity(window, 'assets');
    await click(window, '.asset-category-tabs button:nth-of-type(3)');
    await waitFor(
      window,
      'document.querySelectorAll(".asset-category-tabs button")[2]?.getAttribute("aria-pressed") === "true"',
      'A audio category did not activate.',
    );
    await click(window, '.asset-card');
    await click(window, '.asset-import-panel button');
    await waitFor(
      window,
      'document.querySelectorAll(".asset-import-results li").length === 1',
      'A import result did not render.',
    );
    const aAsset = await snapshot(window);
    await openProject(window, projectBRoot);
    await waitForActivity(window, 'shots');
    const bAfterA = await snapshot(window);

    // The resource owner must be clean after A -> B, even though the old
    // activity was assets and the old result was still mounted at switch time.
    await switchActivity(window, 'assets');
    const bAssetsClean = await snapshot(window);

    // T2/T3: exercise both character forms with the same character id across
    // distinct projects, so a stale child key cannot hide the bug.
    await switchActivity(window, 'characters');
    await setInput(
      window,
      '.character-create-form input',
      'B create draft must not return',
    );
    await setInput(
      window,
      '.character-settings input',
      'B editor draft must not return',
    );
    await openProject(window, projectARoot);
    await waitForActivity(window, 'shots');
    await switchActivity(window, 'characters');
    const aAfterB = await snapshot(window);

    await setInput(
      window,
      '.character-create-form input',
      'A create draft must not enter B',
    );
    await setInput(
      window,
      '.character-settings input',
      'A editor draft must not enter B',
    );
    await openProject(window, projectBRoot);
    await waitForActivity(window, 'shots');
    await switchActivity(window, 'characters');
    const bAfterACharacters = await snapshot(window);
    await setInput(
      window,
      '.character-create-form input',
      'B second draft must not enter A',
    );
    await setInput(
      window,
      '.character-settings input',
      'B second editor draft must not enter A',
    );
    await openProject(window, projectARoot);
    await waitForActivity(window, 'shots');
    await switchActivity(window, 'characters');
    const aFinal = await snapshot(window);

    // T4/T5/T6: resource UI transitions do not touch Store state, selection
    // comes from the existing stores, and the active panel stays singular.
    await switchActivity(window, 'shots');
    const aFinalAfterTabs = await snapshot(window);

    // T7: the existing Dirty Guard still has cancel, discard, and save paths.
    await applyShotName(window, 'A dirty cancel branch');
    await requestProjectSwitch(window, projectBRoot);
    await waitFor(
      window,
      'document.querySelector(' +
        JSON.stringify('[data-testid="active-project-path"] code') +
        ')?.textContent === ' +
        JSON.stringify(projectARoot) +
        ' && Boolean(document.querySelector(".dirty-state"))',
      'Dirty Guard cancel branch did not keep A open.',
    );
    const cancelledSwitch = await snapshot(window);

    await openProject(window, projectBRoot);
    const discardedSwitch = await snapshot(window);
    await openProject(window, projectARoot);
    await applyShotName(window, 'A dirty save branch');
    await openProject(window, projectBRoot);
    const savedSwitch = await snapshot(window);

    const evidence = {
      aAsset,
      bAfterA,
      bAssetsClean,
      aAfterB,
      bCharacterAfterA: bAfterACharacters,
      aFinal: {
        ...aFinal,
        activity: aFinalAfterTabs.activity,
        managerCount: aFinalAfterTabs.managerCount,
        revision: aFinalAfterTabs.revision,
        dirty: aFinalAfterTabs.dirty,
        undo: aFinalAfterTabs.undo,
        redo: aFinalAfterTabs.redo,
        shotId: aFinalAfterTabs.shotId,
        selectedLayerId: aFinalAfterTabs.selectedLayerId,
      },
      cancelledSwitch,
      discardedSwitch,
      savedSwitch,
      guardOutcomes: observedGuardOutcomes,
    };

    const failures = [];
    if (
      aAsset.activity !== 'assets' ||
      aAsset.assetCategory !== 2 ||
      aAsset.assetResultCount !== 1 ||
      aAsset.assetSelectedCount !== 1 ||
      aAsset.dirty ||
      aAsset.revision !== 0
    ) {
      failures.push('A local asset state was not established cleanly.');
    }
    if (
      bAfterA.activity !== 'shots' ||
      bAfterA.assetResultCount !== 0 ||
      bAfterA.assetSelectedCount !== 0 ||
      bAfterA.managerCount !== 1 ||
      bAfterA.dirty ||
      bAfterA.revision !== 0 ||
      bAfterA.shotId !== projectB.shots[0].id ||
      bAfterA.selectedLayerId !== ''
    ) {
      failures.push('A local asset state leaked into B.');
    }
    if (
      bAssetsClean.assetCategory !== 1 ||
      bAssetsClean.assetResultCount !== 0 ||
      bAssetsClean.assetSelectedCount !== 0
    ) {
      failures.push('B did not start with a clean asset workspace.');
    }
    if (
      aAfterB.activity !== 'characters' ||
      aAfterB.charCreateDraft === 'B create draft must not return' ||
      aAfterB.charEditorDraft !== projectA.characters[0].name ||
      aAfterB.dirty ||
      aAfterB.revision !== 0
    ) {
      failures.push('B character state leaked into A.');
    }
    if (
      bAfterACharacters.activity !== 'characters' ||
      bAfterACharacters.charCreateDraft === 'A create draft must not enter B' ||
      bAfterACharacters.charEditorDraft !== projectB.characters[0].name
    ) {
      failures.push('A character state leaked into B.');
    }
    if (
      aFinal.charCreateDraft === 'B second draft must not enter A' ||
      aFinal.charEditorDraft !== projectA.characters[0].name
    ) {
      failures.push('B character state leaked back into A.');
    }
    if (
      aFinalAfterTabs.activity !== 'shots' ||
      aFinalAfterTabs.managerCount !== 1 ||
      aFinalAfterTabs.dirty ||
      aFinalAfterTabs.revision !== 0 ||
      aFinalAfterTabs.undo !== 0 ||
      aFinalAfterTabs.redo !== 0 ||
      aFinalAfterTabs.shotId !== projectA.shots[0].id ||
      aFinalAfterTabs.selectedLayerId !== ''
    ) {
      failures.push(
        'Resource UI reset changed Store or selection state: ' +
          JSON.stringify({
            actual: aFinalAfterTabs,
            expectedShotId: projectA.shots[0].id,
          }),
      );
    }
    if (
      cancelledSwitch.root !== projectARoot ||
      !cancelledSwitch.dirty ||
      discardedSwitch.root !== projectBRoot ||
      discardedSwitch.dirty ||
      savedSwitch.root !== projectBRoot ||
      savedSwitch.dirty ||
      observedGuardOutcomes.join(',') !== 'cancelled,discarded,saved'
    ) {
      failures.push('Dirty Guard cancel/discard/save behavior regressed.');
    }
    if (failures.length > 0) {
      throw new Error(
        'Issue #81 Electron verification failed: ' +
          JSON.stringify({ failures, evidence }, null, 2),
      );
    }
    console.log('ISSUE_81_EVIDENCE_START');
    console.log(JSON.stringify(evidence));
    console.log('ISSUE_81_EVIDENCE_END');
  } finally {
    window.destroy();
    for (const channel of registeredChannels) {
      ipcMain.removeHandler(channel);
    }
  }
}

app.on('window-all-closed', () => {});
app.whenReady()
  .then(verifyIssue81)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
`;
}

describe('Issue #81 resource workspace isolation', () => {
  it(
    'drives real React resources through A -> B -> A without local-state leakage',
    () => {
      const buildEnvironment = {
        ...process.env,
        PATH:
          corepackShims +
          (process.platform === 'win32' ? ';' : ':') +
          (process.env.PATH ?? process.env.Path ?? ''),
      };
      execFileSync(process.execPath, [corepackScript, 'pnpm', 'build'], {
        cwd: repositoryRoot,
        env: buildEnvironment,
        stdio: 'inherit',
      });

      const temporaryDirectory = mkdtempSync(
        join(tmpdir(), 'panda-stage-issue81-'),
      );
      const gatePath = join(temporaryDirectory, 'verify-issue81.cjs');
      writeFileSync(
        gatePath,
        electronGateSource(repositoryRoot),
        'utf8',
      );
      try {
        const output = execFileSync(
          process.execPath,
          [electronCli, gatePath],
          {
            cwd: repositoryRoot,
            encoding: 'utf8',
            maxBuffer: 20 * 1024 * 1024,
            timeout: 120_000,
          },
        );
        const match = output.match(
          /ISSUE_81_EVIDENCE_START\r?\n([\s\S]*?)\r?\nISSUE_81_EVIDENCE_END/u,
        );
        expect(match).not.toBeNull();
        const evidenceJson = match?.[1];
        if (!evidenceJson) throw new Error('Issue #81 evidence was empty.');
        const evidence = JSON.parse(evidenceJson) as Issue81Evidence;
        expect(evidence.guardOutcomes).toEqual([
          'cancelled',
          'discarded',
          'saved',
        ]);
        expect(evidence.bAfterA.activity).toBe('shots');
        expect(evidence.bAfterA.assetResultCount).toBe(0);
        expect(evidence.aAfterB.charEditorDraft).toBe(
          'A Panda',
        );
        expect(evidence.aFinal.undo).toBe(0);
        expect(evidence.aFinal.redo).toBe(0);
      } finally {
        rmSync(temporaryDirectory, { force: true, recursive: true });
      }
    },
    180_000,
  );
});

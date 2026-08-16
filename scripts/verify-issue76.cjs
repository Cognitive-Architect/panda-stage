const { app, ipcMain } = require('electron');
const {
  createMainWindow,
} = require('../dist-electron/main/windows/main-window.js');
const {
  IPC_CHANNELS,
} = require('../dist-electron/shared/ipc/channels.js');
const exampleProject = require('../demo-project/project-v1.example.json');
const { migrateProject, detectSchemaVersion } = require(
  '../dist-electron/domain/migrations/index.js',
);

// Issue 76 / Stage 1B renderer gate.
//
// Covers the three shipped surfaces end-to-end inside a real Electron window:
//   1. project.createAt          - the Renderer only submits
//                                  parentDirectory + projectName + metadata.
//   2. ProductPreviewOverlay     - read-only playback that never dirties the
//                                  project.
//   3. CloseConfirmDialog        - the in-app three-branch close that keeps
//                                  the recovery record and leaves the native
//                                  window guard untouched.

const parentDirectory = 'D:\\Projects\\Issue 76';
const projectName = 'Issue 76 新项目';
const createdRoot = `${parentDirectory}\\${projectName}.pandastage`;
const RECOVERY_NOTICE =
  '不保存关闭会保留恢复记录，下次打开该项目可能出现恢复候选。';

// Locates the inline validation hint that belongs to the project-name field,
// rather than the dialog-wide status line used for Main-side failures.
const NAME_HINT_EXPRESSION =
  `document.querySelector('[data-testid="new-project-name"]')` +
  `?.closest('label')?.querySelector('.new-project-hint')`;

const baseProject = {
  ...exampleProject,
  name: 'Issue 76 project',
  shots: exampleProject.shots.map((shot) => ({
    ...shot,
    name: 'Issue 76 真实镜头',
    durationMs: 4_000,
  })),
};

app.on('window-all-closed', () => {});

function waitFor(expression, message) {
  return `new Promise((resolve, reject) => {
    const deadline = Date.now() + 10000;
    const poll = () => {
      if (${expression}) return resolve();
      if (Date.now() >= deadline) {
        return reject(new Error(${JSON.stringify(message)}));
      }
      setTimeout(poll, 25);
    };
    poll();
  })`;
}

async function setInput(window, selector, value) {
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('Input not found: ' + ${JSON.stringify(selector)});
    }
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    ).set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}

async function click(window, selector) {
  await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) {
      throw new Error('Element not found: ' + ${JSON.stringify(selector)});
    }
    element.click();
  })()`);
}

async function openProjectMenu(window) {
  await click(window, '[data-testid="compact-project-more"]');
  await window.webContents.executeJavaScript(
    waitFor(
      `document.querySelector('[data-testid="compact-project-menu"]')`,
      'Compact project menu did not open.',
    ),
  );
}

async function clickProjectMenuAction(window, selector) {
  await openProjectMenu(window);
  await click(window, selector);
}

async function readText(window, selector) {
  return window.webContents.executeJavaScript(
    `document.querySelector(${JSON.stringify(selector)})` +
      `?.textContent?.trim() ?? null`,
  );
}

async function snapshot(window) {
  return window.webContents.executeJavaScript(`(() => ({
    shellState: document.querySelector('.editor-shell')
      ?.getAttribute('data-editor-shell-state') ?? null,
    activeRoot: document.querySelector(
      '[data-testid="active-project-path"] code'
    )?.textContent ?? null,
    dirty: Boolean(document.querySelector('.dirty-state')),
    topStatus: document.querySelector(
      '.recovery-status-row output'
    )?.textContent?.trim() ?? '',
    startStatus: document.querySelector(
      '[data-testid="start-screen"] output'
    )?.textContent?.trim() ?? '',
    previewOpen: Boolean(
      document.querySelector('[data-testid="product-preview-overlay"]')
    ),
    closeDialogOpen: Boolean(
      document.querySelector('[data-testid="close-confirm-dialog"]')
    ),
    revision: Number(
      document.querySelector('[data-testid="project-canvas-stage"]')
        ?.getAttribute('data-project-revision') ?? 0
    ),
    undoCount: Number(
      document.querySelector('[data-testid="history-controls"]')
        ?.getAttribute('data-undo-count') ?? 0
    ),
    selectedLayerId: document.querySelector(
      '[data-testid="project-canvas-stage"]'
    )?.getAttribute('data-selected-layer-id') || null,
    nameDraft: document.querySelector(
      '.shot-fields label:nth-of-type(1) input'
    )?.value ?? null
  }))()`);
}

async function applyShotName(window, name) {
  await setInput(window, '.shot-fields label:nth-of-type(1) input', name);
  await click(window, '.shot-fields label:nth-of-type(1) button');
  await window.webContents.executeJavaScript(
    waitFor(
      `Boolean(document.querySelector('.dirty-state'))`,
      'Applying a shot name did not mark the project dirty.',
    ),
  );
}

function documentFor(projectRoot, project) {
  const sourceVersion = detectSchemaVersion(project);
  return {
    projectRoot,
    projectFilePath: `${projectRoot}\\project.json`,
    project: migrateProject(project),
    migrated: sourceVersion !== 6,
    sourceVersion,
  };
}

async function verifyIssue76() {
  // The Main Process is the only side that joins the final project root.
  const createRequests = [];
  const saveRequests = [];
  const autosaveUpdates = [];
  const recoveryDetectRequests = [];
  const stopRequests = [];
  const discardRequests = [];
  const chooserResponses = [];
  const liveProjects = new Map([[createdRoot, baseProject]]);
  const existingRoots = new Set();
  let nextSaveFails = false;

  ipcMain.handle(IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY, () => {
    return chooserResponses.shift() ?? { ok: true, status: 'cancelled' };
  });
  ipcMain.handle(IPC_CHANNELS.PROJECT_CREATE_AT, (_event, request) => {
    createRequests.push({
      keys: Object.keys(request).sort(),
      parentDirectory: request.parentDirectory,
      projectName: request.projectName,
      metadataName: request.metadata?.name ?? null,
    });
    // Path join happens here, in the Main Process, never in the Renderer.
    const projectRoot =
      `${request.parentDirectory}\\${request.projectName}.pandastage`;
    if (existingRoots.has(projectRoot)) {
      return {
        ok: false,
        error: {
          code: 'PROJECT_ALREADY_EXISTS',
          message: '目标位置已存在同名项目。',
          projectRoot,
        },
      };
    }
    existingRoots.add(projectRoot);
    const project = { ...baseProject, name: request.metadata.name };
    liveProjects.set(projectRoot, project);
    return { ok: true, value: documentFor(projectRoot, project) };
  });
  ipcMain.handle(IPC_CHANNELS.PROJECT_OPEN, (_event, request) => ({
    ok: true,
    value: documentFor(
      request.projectRoot,
      liveProjects.get(request.projectRoot) ?? baseProject,
    ),
  }));
  ipcMain.handle(IPC_CHANNELS.PROJECT_SAVE, (_event, request) => {
    saveRequests.push(request);
    if (nextSaveFails) {
      return {
        ok: false,
        error: {
          code: 'SAVE_FAILED',
          message: '磁盘写入被拒绝。',
          projectRoot: request.projectRoot,
        },
      };
    }
    liveProjects.set(request.projectRoot, request.project);
    return {
      ok: true,
      value: {
        ...documentFor(request.projectRoot, request.project),
      },
    };
  });
  ipcMain.handle(IPC_CHANNELS.PROJECT_CONFIRM_SWITCH, () => ({
    outcome: 'saved',
  }));
  ipcMain.handle(IPC_CHANNELS.RECENT_PROJECTS_LIST, () => ({
    ok: true,
    entries: [
      {
        projectId: baseProject.id,
        projectName: baseProject.name,
        projectRoot: createdRoot,
        lastOpenedAt: '2026-08-07T00:00:00.000Z',
        status: 'available',
      },
    ],
  }));
  ipcMain.handle(IPC_CHANNELS.RECENT_PROJECTS_OPEN, (_event, request) => ({
    ok: true,
    document: documentFor(
      request.projectRoot,
      liveProjects.get(request.projectRoot) ?? baseProject,
    ),
  }));
  ipcMain.handle(IPC_CHANNELS.AUTOSAVE_TRACK, () => ({ ok: true }));
  ipcMain.handle(IPC_CHANNELS.AUTOSAVE_UPDATE, (_event, request) => {
    autosaveUpdates.push(request);
    return { ok: true };
  });
  ipcMain.handle(IPC_CHANNELS.AUTOSAVE_STOP, (_event, request) => {
    stopRequests.push(
      typeof request === 'string' ? request : request?.projectRoot ?? null,
    );
    return { ok: true };
  });
  ipcMain.handle(IPC_CHANNELS.RECOVERY_DETECT, (_event, request) => {
    recoveryDetectRequests.push(request);
    return { ok: true, candidate: null };
  });
  ipcMain.handle(IPC_CHANNELS.RECOVERY_IGNORE, (_event, request) => {
    // Ruling 4: the in-app close must not touch the recovery record at all,
    // so this handler is expected to stay unused for the whole gate.
    discardRequests.push(request);
    return { ok: true, retained: true };
  });
  ipcMain.handle(IPC_CHANNELS.ASSET_THUMBNAIL_READ, () => ({
    ok: false,
    error: {
      code: 'ASSET_THUMBNAIL_UNAVAILABLE',
      message: 'Issue 76 gate does not stage binary assets.',
    },
  }));

  const window = await createMainWindow({ show: false });
  try {
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="new-project-button"]')`,
        'Start screen did not render the new-project entry.',
      ),
    );

    // ---- 1. Secure creation: cancel branch -------------------------------
    await click(window, '[data-testid="new-project-button"]');
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="new-project-dialog"]')`,
        'New-project dialog did not open.',
      ),
    );
    await click(window, '[data-testid="new-project-cancel"]');
    await window.webContents.executeJavaScript(
      waitFor(
        `!document.querySelector('[data-testid="new-project-dialog"]')`,
        'New-project dialog did not close on cancel.',
      ),
    );
    const cancelledCreateRequests = createRequests.length;

    // ---- 2. Secure creation: illegal project name ------------------------
    await click(window, '[data-testid="new-project-button"]');
    chooserResponses.push({
      ok: true,
      status: 'selected',
      projectRoot: parentDirectory,
    });
    await click(window, '[data-testid="new-project-choose-directory"]');
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="new-project-parent-directory"]')` +
          `?.value === ${JSON.stringify(parentDirectory)}`,
        'Chosen parent directory did not fill the creation form.',
      ),
    );
    await setInput(window, '[data-testid="new-project-name"]', 'bad/name');
    // An illegal name is rejected inline, next to the offending field, and the
    // submit button is disabled. Clicking it must therefore stay a no-op: the
    // separator can never reach the Main-side path join.
    await window.webContents.executeJavaScript(
      waitFor(
        `${NAME_HINT_EXPRESSION}?.textContent?.includes('不能包含')`,
        'Illegal project name was not rejected in the Renderer.',
      ),
    );
    const illegalNameHint = await window.webContents.executeJavaScript(
      `${NAME_HINT_EXPRESSION}?.textContent?.trim() ?? null`,
    );
    const illegalConfirmDisabled = await window.webContents.executeJavaScript(
      `document.querySelector('[data-testid="new-project-confirm"]')` +
        `?.disabled === true`,
    );
    await click(window, '[data-testid="new-project-confirm"]');
    const illegalCreateRequests = createRequests.length;

    // ---- 3. Secure creation: success -------------------------------------
    await setInput(window, '[data-testid="new-project-name"]', projectName);
    await click(window, '[data-testid="new-project-confirm"]');
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="active-project-path"] code')` +
          `?.textContent === ${JSON.stringify(createdRoot)}`,
        'Created project did not open in the editor.',
      ),
    );
    const created = await snapshot(window);
    const stopsAfterCreate = stopRequests.length;
    const updatesBeforeCleanClose = autosaveUpdates.length;
    const detectsBeforeCleanClose = recoveryDetectRequests.length;

    // ---- 4. Secure creation: duplicate name ------------------------------
    await window.webContents.executeJavaScript(`(() => {
      window.__issue125CleanDialogSeen = false;
      window.__issue125CleanDialogObserver = new MutationObserver(() => {
        if (document.querySelector('[data-testid="close-confirm-dialog"]')) {
          window.__issue125CleanDialogSeen = true;
        }
      });
      window.__issue125CleanDialogObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    })()`);
    await clickProjectMenuAction(
      window,
      '[data-testid="menu-close-project"]',
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="start-screen"]')`,
        'Clean close did not return the shell to the start screen.',
      ),
    );
    const cleanCloseDialogSeen = await window.webContents.executeJavaScript(
      `(() => {
        window.__issue125CleanDialogObserver?.disconnect();
        return window.__issue125CleanDialogSeen === true;
      })()`,
    );
    const cleanClosed = await snapshot(window);
    const savesAfterCleanClose = saveRequests.length;
    const dirtyUpdatesDuringCleanClose = autosaveUpdates
      .slice(updatesBeforeCleanClose)
      .filter((request) => request?.dirty === true).length;
    const detectsAfterCleanClose = recoveryDetectRequests.length;
    await click(window, '[data-testid="new-project-button"]');
    chooserResponses.push({
      ok: true,
      status: 'selected',
      projectRoot: parentDirectory,
    });
    await click(window, '[data-testid="new-project-choose-directory"]');
    await setInput(window, '[data-testid="new-project-name"]', projectName);
    await click(window, '[data-testid="new-project-confirm"]');
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="new-project-dialog"] output')` +
          `?.textContent?.includes('已存在')`,
        'Duplicate project creation was not reported.',
      ),
    );
    const duplicateStatus = await readText(
      window,
      '[data-testid="new-project-dialog"] output',
    );
    await click(window, '[data-testid="new-project-cancel"]');

    // Reopen the cleanly closed project through the real recent-project path.
    await click(
      window,
      '[data-testid="recent-projects-list"] [data-task4-core="recent-open"]',
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="active-project-path"] code')` +
          `?.textContent === ${JSON.stringify(createdRoot)}`,
        'Created project could not be reopened.',
      ),
    );
    const cleanRecentReopen = await snapshot(window);

    // ---- 5. Product preview is read-only ---------------------------------
    await applyShotName(window, 'Issue 76 预览前草稿');
    const beforePreview = await snapshot(window);
    await openProjectMenu(window);
    await click(window, '[data-testid="menu-open-product-preview"]');
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="product-preview-overlay"]')`,
        'Product preview overlay did not mount.',
      ),
    );
    await openProjectMenu(window);
    const previewEntryDisabled =
      await window.webContents.executeJavaScript(
        `document.querySelector('[data-testid="menu-open-product-preview"]')` +
          `?.disabled === true`,
      );
    await click(window, '[data-testid="compact-project-more"]');
    await click(window, '[data-testid="product-preview-play"]');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await click(window, '[data-testid="product-preview-pause"]');
    const previewTimecode = await readText(
      window,
      '[data-testid="product-preview-timecode"]',
    );
    const duringPreview = await snapshot(window);
    await click(window, '[data-testid="product-preview-close"]');
    await window.webContents.executeJavaScript(
      waitFor(
        `!document.querySelector('[data-testid="product-preview-overlay"]')`,
        'Product preview overlay did not unmount.',
      ),
    );
    const afterPreview = await snapshot(window);
    const stopsBeforeClose = stopRequests.length;

    // ---- 6. In-app close: cancel branch ----------------------------------
    await clickProjectMenuAction(
      window,
      '[data-testid="menu-close-project"]',
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="close-confirm-dialog"]')`,
        'Close confirmation did not open.',
      ),
    );
    const recoveryNotice = await readText(
      window,
      '[data-testid="close-confirm-recovery-notice"]',
    );
    await click(window, '[data-testid="close-confirm-cancel"]');
    await window.webContents.executeJavaScript(
      waitFor(
        `!document.querySelector('[data-testid="close-confirm-dialog"]')`,
        'Close confirmation did not close on cancel.',
      ),
    );
    const cancelledClose = await snapshot(window);
    const stopsAfterCancel = stopRequests.length;

    // ---- 7. In-app close: save failure keeps the project open ------------
    nextSaveFails = true;
    await clickProjectMenuAction(
      window,
      '[data-testid="menu-close-project"]',
    );
    await click(window, '[data-testid="close-confirm-save"]');
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="close-confirm-status"]')` +
          `?.textContent?.includes('保存失败，项目未关闭')`,
        'Save failure during close was not reported.',
      ),
    );
    const saveFailedStatus = await readText(
      window,
      '[data-testid="close-confirm-status"]',
    );
    const saveFailedClose = await snapshot(window);
    const stopsAfterSaveFailure = stopRequests.length;

    // ---- 8. In-app close: save and close ---------------------------------
    nextSaveFails = false;
    await click(window, '[data-testid="close-confirm-save"]');
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="start-screen"]')`,
        'Save-and-close did not return to the start screen.',
      ),
    );
    const savedClose = await snapshot(window);

    // ---- 9. In-app close: close without saving keeps recovery ------------
    await setInput(
      window,
      '[data-testid="start-screen"] .recovery-open-row input',
      createdRoot,
    );
    await click(
      window,
      '[data-testid="start-screen"] .recovery-open-row button',
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="active-project-path"] code')` +
          `?.textContent === ${JSON.stringify(createdRoot)}`,
        'Project could not be reopened before the unsaved close.',
      ),
    );
    await applyShotName(window, 'Issue 76 不保存关闭草稿');
    await clickProjectMenuAction(
      window,
      '[data-testid="menu-close-project"]',
    );
    await click(window, '[data-testid="close-confirm-discard"]');
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="start-screen"]')`,
        'Close-without-saving did not return to the start screen.',
      ),
    );
    const discardedClose = await snapshot(window);

    const evidence = {
      createRequests,
      cancelledCreateRequests,
      illegalCreateRequests,
      illegalNameHint,
      illegalConfirmDisabled,
      duplicateStatus,
      created,
      cleanCloseDialogSeen,
      cleanClosed,
      savesAfterCleanClose,
      dirtyUpdatesDuringCleanClose,
      detectsBeforeCleanClose,
      detectsAfterCleanClose,
      cleanRecentReopen,
      beforePreview,
      duringPreview,
      afterPreview,
      previewEntryDisabled,
      previewTimecode,
      recoveryNotice,
      cancelledClose,
      stopsAfterCreate,
      stopsBeforeClose,
      stopsAfterCancel,
      saveFailedStatus,
      saveFailedClose,
      stopsAfterSaveFailure,
      savedClose,
      discardedClose,
      stopRequests,
      discardRequests,
    };

    const failures = [];
    // Secure creation.
    if (cancelledCreateRequests !== 0) {
      failures.push('Cancelling the dialog still issued project.createAt.');
    }
    if (illegalCreateRequests !== 0) {
      failures.push('An illegal project name reached project.createAt.');
    }
    if (!illegalNameHint || !illegalNameHint.includes('不能包含')) {
      failures.push('Illegal-name feedback is missing.');
    }
    if (!illegalConfirmDisabled) {
      failures.push('An illegal project name left the submit button enabled.');
    }
    if (!duplicateStatus || !duplicateStatus.includes('已存在')) {
      failures.push('Duplicate-project feedback is missing.');
    }
    if (createRequests.length !== 2) {
      failures.push(
        `Expected exactly 2 create requests, saw ${createRequests.length}.`,
      );
    }
    for (const request of createRequests) {
      if (
        request.keys.join(',') !==
        'metadata,parentDirectory,projectName'
      ) {
        failures.push(
          `project.createAt payload must stay minimal, saw ${request.keys.join(',')}.`,
        );
      }
      if (request.parentDirectory !== parentDirectory) {
        failures.push('project.createAt lost the chosen parent directory.');
      }
      if (request.projectName !== projectName) {
        failures.push('project.createAt lost the submitted project name.');
      }
    }
    if (created.activeRoot !== createdRoot || created.dirty) {
      failures.push('The created project did not open clean.');
    }
    if (created.revision !== 0 || created.undoCount !== 0) {
      failures.push('The clean project did not start at revision/history zero.');
    }
    if (cleanCloseDialogSeen) {
      failures.push('A clean project mounted the dirty close confirmation.');
    }
    if (savesAfterCleanClose !== 0) {
      failures.push('Clean close wrote the project before closing.');
    }
    if (dirtyUpdatesDuringCleanClose !== 0) {
      failures.push('Clean close emitted a new dirty autosave update.');
    }
    if (detectsAfterCleanClose !== detectsBeforeCleanClose) {
      failures.push('Clean close ran recovery detection instead of only stopping tracking.');
    }
    if (
      cleanClosed.shellState !== 'no-project' ||
      cleanClosed.closeDialogOpen ||
      cleanClosed.startStatus.includes('不保存') ||
      cleanClosed.startStatus.includes('恢复记录')
    ) {
      failures.push('Clean close did not return directly to a neutral project center.');
    }
    if (
      cleanRecentReopen.shellState !== 'editor' ||
      cleanRecentReopen.activeRoot !== createdRoot ||
      cleanRecentReopen.dirty ||
      cleanRecentReopen.revision !== 0 ||
      cleanRecentReopen.undoCount !== 0 ||
      cleanRecentReopen.selectedLayerId !== null
    ) {
      failures.push('Recent-project reopen after clean close leaked project session state.');
    }
    if (stopsAfterCreate !== 0) {
      failures.push('Creating a project stopped autosave tracking.');
    }
    // Product preview read-only.
    if (!previewEntryDisabled) {
      failures.push('The preview entry stayed enabled while open.');
    }
    if (!duringPreview.previewOpen) {
      failures.push('The preview overlay was not visible during playback.');
    }
    if (
      beforePreview.nameDraft !== duringPreview.nameDraft ||
      beforePreview.nameDraft !== afterPreview.nameDraft ||
      duringPreview.activeRoot !== beforePreview.activeRoot ||
      afterPreview.activeRoot !== beforePreview.activeRoot ||
      duringPreview.dirty !== beforePreview.dirty ||
      afterPreview.dirty !== beforePreview.dirty
    ) {
      failures.push('The product preview mutated project state.');
    }
    if (afterPreview.previewOpen) {
      failures.push('The preview overlay stayed mounted after closing.');
    }
    // In-app close.
    if (recoveryNotice !== RECOVERY_NOTICE) {
      failures.push(
        `The close dialog must state the recovery retention contract, saw ${JSON.stringify(recoveryNotice)}.`,
      );
    }
    if (
      cancelledClose.shellState !== 'editor' ||
      cancelledClose.activeRoot !== createdRoot ||
      !cancelledClose.dirty ||
      cancelledClose.closeDialogOpen
    ) {
      failures.push('Cancelling the close did not keep the project open.');
    }
    // Section 4 already performed one legitimate close to reach the start
    // screen, so these branches are measured as deltas: neither cancelling nor
    // a failed save may stop autosave tracking.
    if (stopsAfterCancel !== stopsBeforeClose) {
      failures.push('Cancelling the close still stopped autosave.');
    }
    if (
      !saveFailedStatus ||
      !saveFailedStatus.includes('保存失败，项目未关闭')
    ) {
      failures.push('The save-failure branch did not explain itself.');
    }
    if (
      saveFailedClose.shellState !== 'editor' ||
      !saveFailedClose.dirty ||
      !saveFailedClose.closeDialogOpen ||
      stopsAfterSaveFailure !== stopsBeforeClose
    ) {
      failures.push('A failed save must leave the project open and tracked.');
    }
    if (
      savedClose.shellState !== 'no-project' ||
      savedClose.activeRoot !== null ||
      savedClose.previewOpen ||
      savedClose.closeDialogOpen ||
      !savedClose.startStatus.includes('项目已保存并关闭')
    ) {
      failures.push('Save-and-close did not finish cleanly.');
    }
    if (
      discardedClose.shellState !== 'no-project' ||
      !discardedClose.startStatus.includes('恢复记录仍保留')
    ) {
      failures.push('Close-without-saving did not report recovery retention.');
    }
    // Ruling 4: the in-app close never discards the recovery record.
    // There is no recovery-discard channel at all, and the close flow must
    // not even reach for the "ignore" channel.
    if (
      Object.values(IPC_CHANNELS).some((channel) =>
        channel.includes('discard'),
      )
    ) {
      failures.push('A recovery-discard IPC channel was introduced.');
    }
    if (discardRequests.length !== 0) {
      failures.push(
        'The in-app close must never touch the recovery record IPC.',
      );
    }
    if (stopRequests.length !== 3) {
      failures.push(
        `Expected 3 autosave stops (one per completed close), saw ${stopRequests.length}.`,
      );
    }
    for (const stopped of stopRequests) {
      if (stopped !== createdRoot) {
        failures.push(`Autosave stop targeted an unexpected root: ${stopped}.`);
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `Issue 76 Electron verification failed: ${JSON.stringify(
          { failures, evidence },
          null,
          2,
        )}`,
      );
    }
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    window.destroy();
    for (const channel of [
      IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY,
      IPC_CHANNELS.PROJECT_CREATE_AT,
      IPC_CHANNELS.PROJECT_OPEN,
      IPC_CHANNELS.PROJECT_SAVE,
      IPC_CHANNELS.PROJECT_CONFIRM_SWITCH,
      IPC_CHANNELS.RECENT_PROJECTS_LIST,
      IPC_CHANNELS.RECENT_PROJECTS_OPEN,
      IPC_CHANNELS.AUTOSAVE_TRACK,
      IPC_CHANNELS.AUTOSAVE_UPDATE,
      IPC_CHANNELS.AUTOSAVE_STOP,
      IPC_CHANNELS.RECOVERY_DETECT,
      IPC_CHANNELS.RECOVERY_IGNORE,
      IPC_CHANNELS.ASSET_THUMBNAIL_READ,
    ]) {
      ipcMain.removeHandler(channel);
    }
  }
}

app
  .whenReady()
  .then(verifyIssue76)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

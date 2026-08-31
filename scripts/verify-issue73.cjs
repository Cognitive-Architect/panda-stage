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

const projectARoot = 'D:\\Projects\\Issue 73 A.pandastage';
const projectBRoot = 'D:\\Projects\\Issue 73 B.pandastage';
const projectA = {
  ...exampleProject,
  name: 'Issue 73 project A',
  shots: exampleProject.shots.map((shot) => ({
    ...shot,
    name: 'A 真实镜头',
    durationMs: 3_000,
  })),
};
const projectB = {
  ...exampleProject,
  id: '73000000-0000-4000-8000-000000000002',
  name: 'Issue 73 project B',
  shots: exampleProject.shots.map((shot) => ({
    ...shot,
    name: 'B 真实镜头',
    durationMs: 4_321,
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
      throw new Error('Input not found: ${selector}');
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
      throw new Error('Element not found: ${selector}');
    }
    element.click();
  })()`);
}

async function clickRecent(window, projectRoot) {
  await ensureProjectCenter(window);
  await window.webContents.executeJavaScript(`(() => {
    const item = [...document.querySelectorAll('.recent-projects-list li')]
      .find((candidate) =>
        candidate.querySelector('.recent-project-path')
          ?.textContent === ${JSON.stringify(projectRoot)}
      );
    const button = item?.querySelector('.recent-project-actions button');
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('Recent project action not found.');
    }
    button.click();
  })()`);
}

async function ensureProjectCenter(window) {
  const editorOpen = await window.webContents.executeJavaScript(
    `Boolean(document.querySelector('[data-editor-page="editor"]'))`,
  );
  if (editorOpen) {
    await click(window, '[data-testid="compact-project-more"]');
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="menu-open-project-center"]')`,
        'Project More menu did not expose the Project Center entry.',
      ),
    );
    await click(window, '[data-testid="menu-open-project-center"]');
  }
  await window.webContents.executeJavaScript(
    waitFor(
      `document.querySelector('[data-editor-page="project-center"]')`,
      'Project Center did not open for a path-based project switch.',
    ),
  );
}

async function openFromPath(window, projectRoot) {
  await ensureProjectCenter(window);
  await setInput(
    window,
    '[data-testid="project-center-screen"] .recovery-open-row input',
    projectRoot,
  );
  await click(
    window,
    '[data-testid="project-center-screen"] .recovery-open-row button',
  );
  await window.webContents.executeJavaScript(
    waitFor(
      `document.querySelector('[data-testid="active-project-path"] code')` +
        `?.textContent === ${JSON.stringify(projectRoot)}`,
      `Project did not become active: ${projectRoot}`,
    ),
  );
}

async function snapshot(window) {
  return window.webContents.executeJavaScript(`(() => ({
    activeRoot: document.querySelector(
      '[data-testid="active-project-path"] code'
    )?.textContent ?? null,
    dirty: Boolean(document.querySelector('.dirty-state')),
    nameDraft: document.querySelector(
      '.shot-fields label:nth-of-type(1) input'
    )?.value ?? null,
    durationDraft: Math.round(Number(document.querySelector(
      '.shot-duration-input input'
    )?.value ?? NaN) * 1000),
    topStatus: document.querySelector(
      '[data-testid="editor-action-status"]'
    )?.textContent?.trim() ?? '',
    recentStatus: document.querySelector(
      '.recent-projects-status'
    )?.textContent?.trim() ?? '',
    openCandidate: document.querySelector(
      '[data-testid="project-center-screen"] .recovery-open-row input'
    )?.value ?? '',
    recoverySummary: document.querySelector(
      '.recovery-prompt-summary strong'
    )?.textContent?.trim() ?? null,
    recoveryDetails: document.querySelector(
      '.recovery-details summary'
    )?.textContent?.trim() ?? null
  }))()`);
}

async function applyShotName(window, name) {
  await setInput(
    window,
    '.shot-fields label:nth-of-type(1) input',
    name,
  );
  await click(
    window,
    '.shot-fields label:nth-of-type(1) button',
  );
  await window.webContents.executeJavaScript(
    waitFor(
      `Boolean(document.querySelector('.dirty-state'))`,
      'Applying a shot name did not mark the project dirty.',
    ),
  );
}

function documentFor(projectRoot) {
  const project = projectRoot === projectBRoot ? projectB : projectA;
  const sourceVersion = detectSchemaVersion(project);
  return {
    projectRoot,
    projectFilePath: `${projectRoot}\\project.json`,
    project: migrateProject(project),
    migrated: sourceVersion !== 6,
    sourceVersion,
  };
}

async function verifyIssue73() {
  const guardRequests = [];
  const chooserResponses = [];
  let nextGuardOutcome = 'cancelled';
  let recoveryCandidateRoot = null;

  ipcMain.handle(IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY, () => {
    return chooserResponses.shift() ?? { ok: true, status: 'cancelled' };
  });
  ipcMain.handle(IPC_CHANNELS.PROJECT_CONFIRM_SWITCH, (_event, request) => {
    guardRequests.push({
      projectRoot: request.projectRoot,
      projectName: request.project.name,
      revision: request.revision,
      outcome: nextGuardOutcome,
    });
    return { outcome: nextGuardOutcome };
  });
  ipcMain.handle(IPC_CHANNELS.PROJECT_OPEN, (_event, request) => ({
    ok: true,
    value: documentFor(request.projectRoot),
  }));
  ipcMain.handle(IPC_CHANNELS.PROJECT_SAVE, (_event, request) => ({
    ok: true,
    value: {
      ...documentFor(request.projectRoot),
      project: request.project,
      migrated: false,
      sourceVersion: 6,
    },
  }));
  ipcMain.handle(IPC_CHANNELS.RECENT_PROJECTS_OPEN, (_event, request) => ({
    ok: true,
    document: documentFor(request.projectRoot),
  }));
  ipcMain.handle(IPC_CHANNELS.RECENT_PROJECTS_LIST, () => ({
    ok: true,
    entries: [
      {
        projectId: projectA.id,
        projectName: projectA.name,
        projectRoot: projectARoot,
        lastOpenedAt: '2026-07-30T00:00:00.000Z',
        status: 'available',
      },
      {
        projectId: projectB.id,
        projectName: projectB.name,
        projectRoot: projectBRoot,
        lastOpenedAt: '2026-07-30T00:01:00.000Z',
        status: 'available',
      },
    ],
  }));
  ipcMain.handle(IPC_CHANNELS.AUTOSAVE_TRACK, () => ({ ok: true }));
  ipcMain.handle(IPC_CHANNELS.AUTOSAVE_UPDATE, () => ({ ok: true }));
  ipcMain.handle(IPC_CHANNELS.AUTOSAVE_STOP, () => ({ ok: true }));
  ipcMain.handle(IPC_CHANNELS.RECOVERY_DETECT, (_event, request) => ({
    ok: true,
    candidate:
      request.projectRoot === recoveryCandidateRoot
        ? {
            projectRoot: request.projectRoot,
            recoveryFilePath:
              `${request.projectRoot}\\recovery\\issue-73.recovery.json`,
            projectId: documentFor(request.projectRoot).project.id,
            savedAtMs: 4_102_444_800_000,
            project: documentFor(request.projectRoot).project,
          }
        : null,
  }));
  ipcMain.handle(IPC_CHANNELS.RECOVERY_IGNORE, () => ({
    ok: true,
    retained: true,
  }));

  const window = await createMainWindow({ show: false });
  try {
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="choose-project-directory"]')`,
        'Start screen did not render the directory chooser.',
      ),
    );

    chooserResponses.push({ ok: true, status: 'cancelled' });
    await click(window, '[data-testid="choose-project-directory"]');
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('.recovery-panel output')` +
          `?.textContent?.includes('已取消选择')`,
        'Directory chooser cancellation was not reported.',
      ),
    );
    const chooserCancelled = await window.webContents.executeJavaScript(
      `document.querySelector('.recovery-open-row input').value`,
    );

    chooserResponses.push({
      ok: true,
      status: 'selected',
      projectRoot: projectARoot,
    });
    await click(window, '[data-testid="choose-project-directory"]');
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('.recovery-open-row input')` +
          `?.value === ${JSON.stringify(projectARoot)}`,
        'Selected directory did not fill the path input.',
      ),
    );
    await click(window, '.recovery-open-row button');
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="active-project-path"] code')` +
          `?.textContent === ${JSON.stringify(projectARoot)}`,
        'Project A did not open.',
      ),
    );
    const openedA = await snapshot(window);

    await setInput(
      window,
      '.shot-fields label:nth-of-type(1) input',
      'A 未应用草稿',
    );
    await clickRecent(window, projectBRoot);
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="active-project-path"] code')` +
          `?.textContent === ${JSON.stringify(projectBRoot)}`,
        'Clean recent-project switch to B failed.',
      ),
    );
    const switchedB = await snapshot(window);
    await openFromPath(window, projectARoot);
    const returnedA = await snapshot(window);

    await applyShotName(window, 'A 取消切换草稿');
    nextGuardOutcome = 'cancelled';
    await clickRecent(window, projectBRoot);
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('.recent-projects-status')` +
          `?.textContent?.includes('已取消项目切换')`,
        'Recent-project cancel outcome was not reported.',
      ),
    );
    await click(window, '[data-testid="return-to-editor"]');
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-editor-page="editor"]') && ` +
          `document.querySelector('[data-testid="active-project-path"] code')` +
          `?.textContent === ${JSON.stringify(projectARoot)}`,
        'Cancelled switch did not retain project A in the editor.',
      ),
    );
    const cancelledSwitch = await snapshot(window);

    nextGuardOutcome = 'discarded';
    await clickRecent(window, projectBRoot);
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="active-project-path"] code')` +
          `?.textContent === ${JSON.stringify(projectBRoot)}`,
        'Recent-project discard switch failed.',
      ),
    );
    const discardedSwitch = await snapshot(window);

    await applyShotName(window, 'B 保存后切换');
    nextGuardOutcome = 'saved';
    await openFromPath(window, projectARoot);
    const savedSwitch = await snapshot(window);

    await applyShotName(window, 'A 保存失败保留');
    nextGuardOutcome = 'save-failed';
    await ensureProjectCenter(window);
    await setInput(
      window,
      '[data-testid="project-center-screen"] .recovery-open-row input',
      projectBRoot,
    );
    await click(
      window,
      '[data-testid="project-center-screen"] .recovery-open-row button',
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="editor-action-status"], ` +
          `[data-testid="project-center-screen"] .recovery-panel output')` +
          `?.textContent?.includes('保存当前项目失败')`,
        'Save-failed switch outcome was not reported.',
      ),
    );
    await click(window, '[data-testid="return-to-editor"]');
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-editor-page="editor"]') && ` +
          `document.querySelector('[data-testid="active-project-path"] code')` +
          `?.textContent === ${JSON.stringify(projectARoot)}`,
        'Returning to the editor after a save-failed switch did not retain A.',
      ),
    );
    const failedSwitch = await snapshot(window);

    nextGuardOutcome = 'saved';
    recoveryCandidateRoot = projectBRoot;
    await openFromPath(window, projectBRoot);
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="recovery-candidate-banner"]')`,
        'Recovery banner did not render after the guarded switch.',
      ),
    );
    const recovery = await snapshot(window);
    await click(
      window,
      '[data-testid="recovery-candidate-banner"] button:nth-of-type(2)',
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `!document.querySelector('[data-testid="recovery-candidate-banner"]')`,
        'Recovery ignore did not clear the compact banner.',
      ),
    );

    const evidence = {
      chooserCancelled,
      openedA,
      switchedB,
      returnedA,
      cancelledSwitch,
      discardedSwitch,
      savedSwitch,
      failedSwitch,
      recovery,
      guardRequests,
    };
    if (
      chooserCancelled !== '' ||
      openedA.nameDraft !== projectA.shots[0].name ||
      openedA.durationDraft !== projectA.shots[0].durationMs ||
      switchedB.nameDraft !== projectB.shots[0].name ||
      switchedB.durationDraft !== projectB.shots[0].durationMs ||
      returnedA.nameDraft !== projectA.shots[0].name ||
      returnedA.durationDraft !== projectA.shots[0].durationMs ||
      cancelledSwitch.activeRoot !== projectARoot ||
      !cancelledSwitch.dirty ||
      cancelledSwitch.nameDraft !== 'A 取消切换草稿' ||
      discardedSwitch.activeRoot !== projectBRoot ||
      discardedSwitch.dirty ||
      savedSwitch.activeRoot !== projectARoot ||
      savedSwitch.dirty ||
      failedSwitch.activeRoot !== projectARoot ||
      !failedSwitch.dirty ||
      failedSwitch.nameDraft !== 'A 保存失败保留' ||
      recovery.recoverySummary !== '检测到未保存的恢复内容' ||
      recovery.recoveryDetails !== '查看详情' ||
      guardRequests.map(({ outcome }) => outcome).join(',') !==
        'cancelled,discarded,saved,save-failed,saved'
    ) {
      throw new Error(
        `Issue 73 Electron verification failed: ${JSON.stringify(evidence)}`,
      );
    }
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    window.destroy();
    for (const channel of [
      IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY,
      IPC_CHANNELS.PROJECT_CONFIRM_SWITCH,
      IPC_CHANNELS.PROJECT_OPEN,
      IPC_CHANNELS.PROJECT_SAVE,
      IPC_CHANNELS.RECENT_PROJECTS_OPEN,
      IPC_CHANNELS.RECENT_PROJECTS_LIST,
      IPC_CHANNELS.AUTOSAVE_TRACK,
      IPC_CHANNELS.AUTOSAVE_UPDATE,
      IPC_CHANNELS.AUTOSAVE_STOP,
      IPC_CHANNELS.RECOVERY_DETECT,
      IPC_CHANNELS.RECOVERY_IGNORE,
    ]) {
      ipcMain.removeHandler(channel);
    }
  }
}

app
  .whenReady()
  .then(verifyIssue73)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

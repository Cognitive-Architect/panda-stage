const { app, ipcMain } = require('electron');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const {
  createMainWindow,
} = require('../dist-electron/main/windows/main-window.js');
const {
  createUnsavedCloseDialogOptions,
} = require('../dist-electron/main/services/UnsavedCloseController.js');
const {
  IPC_CHANNELS,
} = require('../dist-electron/shared/ipc/channels.js');
const exampleProject = require('../demo-project/project-v1.example.json');

const evidenceDirectory = path.join(
  __dirname,
  '../docs/evidence/day-14',
);

app.on('window-all-closed', () => {});

async function verifyDay14Ui() {
  const availableRoot = 'D:\\项目\\可用 熊猫.pandastage';
  const missingRoot = 'D:\\项目\\已移动 熊猫.pandastage';
  const entries = [
    {
      projectId: exampleProject.id,
      projectName: '可用的熊猫项目',
      projectRoot: availableRoot,
      lastOpenedAt: '2026-07-24T06:00:00.000Z',
      status: 'available',
    },
    {
      projectId: 'f1000000-0000-4000-8000-000000000001',
      projectName: '等待重新定位的项目',
      projectRoot: missingRoot,
      lastOpenedAt: '2026-07-24T05:00:00.000Z',
      status: 'missing',
    },
  ];
  let openedRecentRoot = null;
  ipcMain.handle(IPC_CHANNELS.PROJECT_OPEN, (_event, request) => {
    openedRecentRoot = request.projectRoot;
    return {
      ok: true,
      value: {
        projectRoot: availableRoot,
        projectFilePath: `${availableRoot}\\project.json`,
        project: exampleProject,
        migrated: false,
        sourceVersion: 1,
      },
    };
  });
  ipcMain.handle(IPC_CHANNELS.AUTOSAVE_TRACK, () => ({ ok: true }));
  ipcMain.handle(IPC_CHANNELS.RECOVERY_DETECT, () => ({
    ok: true,
    candidate: null,
  }));
  ipcMain.handle(IPC_CHANNELS.RECENT_PROJECTS_LIST, () => ({
    ok: true,
    entries,
  }));
  ipcMain.handle(IPC_CHANNELS.RECENT_PROJECTS_REMOVE, () => ({
    ok: true,
    entries: entries.slice(0, 1),
  }));
  ipcMain.handle(IPC_CHANNELS.RECENT_PROJECTS_RELOCATE, () => ({
    ok: true,
    status: 'cancelled',
  }));
  ipcMain.handle(IPC_CHANNELS.AUTOSAVE_UPDATE, () => ({ ok: true }));
  ipcMain.handle(IPC_CHANNELS.AUTOSAVE_STOP, () => ({ ok: true }));

  const window = await createMainWindow({ show: false });
  try {
    await window.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const deadline = Date.now() + 10000;
        const poll = () => {
          if (document.querySelectorAll('.recent-projects-list li').length === 2) {
            return resolve();
          }
          if (Date.now() >= deadline) {
            return reject(new Error('Recent projects panel did not render.'));
          }
          setTimeout(poll, 25);
        };
        poll();
      })
    `);
    await window.webContents.executeJavaScript(`
      (() => {
        document.querySelector(
          '.recent-projects-list li:first-child button'
        ).click();
        return new Promise((resolve, reject) => {
          const deadline = Date.now() + 10000;
          const poll = () => {
            const status = document.querySelector(
              '.recovery-status-row output'
            )?.textContent;
            if (status?.includes('Project opened')) return resolve();
            if (Date.now() >= deadline) {
              return reject(new Error('Recent project did not reopen.'));
            }
            setTimeout(poll, 25);
          };
          poll();
        });
      })()
    `);
    const result = await window.webContents.executeJavaScript(`(() => {
      const panel = document.querySelector('.recent-projects-panel');
      const rows = [...panel.querySelectorAll('.recent-projects-list li')];
      return {
        heading: panel.querySelector('h2')?.textContent?.trim(),
        count: panel.querySelector('.recent-projects-heading > span')
          ?.textContent?.trim(),
        projects: rows.map((row) => ({
          name: row.querySelector('strong')?.textContent?.trim(),
          path: row.querySelector('.recent-project-path')?.textContent?.trim(),
          state: row.querySelector('div:first-child span:last-child')
            ?.textContent?.trim(),
          actions: [...row.querySelectorAll('button')].map((button) => ({
            label: button.textContent?.trim(),
            disabled: button.disabled,
          }))
        })),
        recentProjectsApi: Object.keys(window.pandaStage.recentProjects).sort(),
        recoveryStatus: document.querySelector(
          '.recovery-status-row output'
        )?.textContent?.trim(),
        rendererHasNodeRequire: typeof window.require !== 'undefined'
      };
    })()`);
    const closeOptions =
      createUnsavedCloseDialogOptions('等待保存的项目');
    const evidence = {
      ...result,
      openedRecentRoot,
      recentProjectsConfigPath: path.join(
        app.getPath('userData'),
        'recent-projects.json',
      ),
      configOutsideProject: !path
        .join(app.getPath('userData'), 'recent-projects.json')
        .startsWith('D:\\项目\\'),
      closeActions: closeOptions.buttons,
      closeCancelId: closeOptions.cancelId,
    };

    if (
      result.heading !== '最近项目' ||
      result.count !== '2/12' ||
      result.projects[0]?.name !== '可用的熊猫项目' ||
      result.projects[0]?.actions[0]?.label !== '打开' ||
      result.projects[0]?.actions[0]?.disabled ||
      result.projects[1]?.name !== '等待重新定位的项目' ||
      !result.projects[1]?.state?.startsWith('路径已失效') ||
      result.projects[1]?.actions[0]?.label !== '打开' ||
      !result.projects[1]?.actions[0]?.disabled ||
      result.projects[1]?.actions[1]?.label !== '重新定位' ||
      result.recentProjectsApi.join(',') !== 'list,relocate,remove' ||
      openedRecentRoot !== availableRoot ||
      !result.recoveryStatus?.includes('Project opened') ||
      !evidence.configOutsideProject ||
      result.rendererHasNodeRequire ||
      closeOptions.buttons.join(',') !== '保存并退出,不保存,取消' ||
      closeOptions.cancelId !== 2
    ) {
      throw new Error(
        `Day 14 UI verification failed: ${JSON.stringify(evidence)}`,
      );
    }

    await window.webContents.executeJavaScript(`
      document.fonts.ready.then(
        () => new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
      )
    `);
    await mkdir(evidenceDirectory, { recursive: true });
    const screenshot = await window.webContents.capturePage();
    await Promise.all([
      writeFile(
        path.join(evidenceDirectory, 'recent-projects.png'),
        screenshot.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'ui-results.json'),
        `${JSON.stringify(evidence, null, 2)}\n`,
        'utf8',
      ),
    ]);
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    window.destroy();
    ipcMain.removeHandler(IPC_CHANNELS.RECENT_PROJECTS_LIST);
    ipcMain.removeHandler(IPC_CHANNELS.RECENT_PROJECTS_REMOVE);
    ipcMain.removeHandler(IPC_CHANNELS.RECENT_PROJECTS_RELOCATE);
    ipcMain.removeHandler(IPC_CHANNELS.AUTOSAVE_UPDATE);
    ipcMain.removeHandler(IPC_CHANNELS.AUTOSAVE_STOP);
    ipcMain.removeHandler(IPC_CHANNELS.PROJECT_OPEN);
    ipcMain.removeHandler(IPC_CHANNELS.AUTOSAVE_TRACK);
    ipcMain.removeHandler(IPC_CHANNELS.RECOVERY_DETECT);
  }
}

app
  .whenReady()
  .then(verifyDay14Ui)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

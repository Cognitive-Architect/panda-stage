const { app, ipcMain } = require('electron');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const {
  createMainWindow,
} = require('../dist-electron/main/windows/main-window.js');
const {
  IPC_CHANNELS,
} = require('../dist-electron/shared/ipc/channels.js');
const exampleProject = require('../demo-project/project-v1.example.json');

const evidenceDirectory = path.join(
  __dirname,
  '../docs/evidence/day-13',
);

app.on('window-all-closed', () => {});

async function verifyDay13Ui() {
  const projectRoot = 'D:\\Evidence\\crash-demo.pandastage';
  const recoveryFilePath = `${projectRoot}\\recovery\\${exampleProject.id}.4102444800000.recovery.json`;
  ipcMain.handle(IPC_CHANNELS.PROJECT_OPEN, () => ({
    ok: true,
    value: {
      projectRoot,
      projectFilePath: `${projectRoot}\\project.json`,
      project: exampleProject,
      migrated: false,
      sourceVersion: 1,
    },
  }));
  ipcMain.handle(IPC_CHANNELS.AUTOSAVE_TRACK, () => ({ ok: true }));
  ipcMain.handle(IPC_CHANNELS.AUTOSAVE_UPDATE, () => ({ ok: true }));
  ipcMain.handle(IPC_CHANNELS.AUTOSAVE_STOP, () => ({ ok: true }));
  ipcMain.handle(IPC_CHANNELS.RECOVERY_DETECT, () => ({
    ok: true,
    candidate: {
      projectRoot,
      recoveryFilePath,
      projectId: exampleProject.id,
      savedAtMs: 4_102_444_800_000,
      project: {
        ...exampleProject,
        name: 'Recovered crash draft',
      },
    },
  }));
  const window = await createMainWindow({ show: false });
  try {
    await window.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const deadline = Date.now() + 10000;
        const poll = () => {
          const heading = document.querySelector('#recovery-heading');
          if (heading) return resolve();
          if (Date.now() >= deadline) {
            return reject(new Error('Recovery panel did not render.'));
          }
          setTimeout(poll, 25);
        };
        poll();
      })
    `);
    await window.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('.recovery-panel input');
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      ).set;
      setter.call(input, ${JSON.stringify(projectRoot)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('.recovery-open-row button').click();
      return new Promise((resolve, reject) => {
        const deadline = Date.now() + 10000;
        const poll = () => {
          if (document.querySelector('.recovery-prompt')) return resolve();
          if (Date.now() >= deadline) {
            return reject(new Error('Recovery prompt did not render.'));
          }
          setTimeout(poll, 25);
        };
        poll();
      });
    })()`);
    const result = await window.webContents.executeJavaScript(`(() => {
      const heading = document.querySelector('#recovery-heading');
      const panel = document.querySelector('.recovery-panel');
      const input = panel?.querySelector('input');
      const buttons = [...(panel?.querySelectorAll('button') ?? [])]
        .map((button) => button.textContent?.trim());
      return {
        heading: heading?.textContent?.trim(),
        defaultState: panel?.querySelector('.clean-state')?.textContent?.trim(),
        inputPlaceholder: input?.getAttribute('placeholder'),
        actions: buttons,
        candidateProject: panel?.querySelector('.recovery-prompt strong')
          ?.textContent?.trim(),
        candidateTime: panel?.querySelector('.recovery-prompt span')
          ?.textContent?.trim(),
        candidateActions: [...(panel?.querySelectorAll(
          '.recovery-prompt button'
        ) ?? [])].map((button) => button.textContent?.trim()),
        autosaveApi: Object.keys(window.pandaStage.autosave).sort(),
        recoveryApi: Object.keys(window.pandaStage.recovery).sort(),
        rendererHasNodeRequire: typeof window.require !== 'undefined'
      };
    })()`);
    await window.webContents.executeJavaScript(`
      document.fonts.ready.then(
        () => new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
      )
    `);

    if (
      result.heading !== 'Crash recovery' ||
      result.defaultState !== 'Clean' ||
      !result.actions.includes('Open and check recovery') ||
      !result.actions.includes('Save recovered project') ||
      result.candidateProject !== 'Recovered crash draft' ||
      !result.candidateTime?.startsWith('Recovery from ') ||
      result.candidateActions.join(',') !==
        'Restore in memory,Ignore and retain file' ||
      result.rendererHasNodeRequire ||
      result.autosaveApi.join(',') !== 'onError,stop,track,update' ||
      result.recoveryApi.join(',') !== 'detect,ignore,restore'
    ) {
      throw new Error(`Day 13 UI verification failed: ${JSON.stringify(result)}`);
    }

    await mkdir(evidenceDirectory, { recursive: true });
    const screenshot = await window.webContents.capturePage();
    await Promise.all([
      writeFile(
        path.join(evidenceDirectory, 'recovery-panel.png'),
        screenshot.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'ui-results.json'),
        `${JSON.stringify(result, null, 2)}\n`,
        'utf8',
      ),
    ]);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    window.destroy();
    ipcMain.removeHandler(IPC_CHANNELS.PROJECT_OPEN);
    ipcMain.removeHandler(IPC_CHANNELS.AUTOSAVE_TRACK);
    ipcMain.removeHandler(IPC_CHANNELS.AUTOSAVE_UPDATE);
    ipcMain.removeHandler(IPC_CHANNELS.AUTOSAVE_STOP);
    ipcMain.removeHandler(IPC_CHANNELS.RECOVERY_DETECT);
  }
}

app
  .whenReady()
  .then(verifyDay13Ui)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

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
// ProjectService.open migrates any persisted project to the current schema
// version before the document leaves Main, so the preload (which validates
// the response as v5) only ever sees v5. Seed the same migrated shape here.
const { migrateProject } = require('../dist-electron/domain/migrations/index.js');

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
      project: migrateProject(exampleProject),
      migrated: true,
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
      project: migrateProject({
        ...exampleProject,
        name: 'Recovered crash draft',
      }),
    },
  }));
  ipcMain.handle(IPC_CHANNELS.RECENT_PROJECTS_LIST, () => ({
    ok: true,
    entries: [],
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
    const invalidCandidate = await window.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('.recovery-panel input');
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      ).set;
      setter.call(input, 'D:\\\\Evidence\\\\invalid?.pandastage');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const button = document.querySelector('.recovery-open-row button');
      return new Promise((resolve) => requestAnimationFrame(() => resolve({
        disabled: button.disabled,
        hint: document.querySelector('.open-path-hint')?.textContent?.trim()
      })));
    })()`);
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
      const drawer = document.querySelector('[data-testid="quick-action-drawer"]');
      const banner = document.querySelector('.recovery-prompt');
      const actionIds = [
        ...(drawer?.querySelectorAll('.quick-action-drawer-actions > [data-testid]') ?? [])
      ].map((element) => element.getAttribute('data-testid'));
      return {
        hasQuickActionDrawer: Boolean(drawer),
        projectName: document.title,
        defaultState: drawer?.dataset.saveState,
        hasEditorPathInput: Boolean(drawer?.querySelector('input')),
        actions: actionIds,
        candidateSummary: banner?.querySelector(
          '.recovery-prompt-summary strong'
        )
          ?.textContent?.trim(),
        candidateTime: banner?.querySelector(
          '.recovery-prompt-summary span'
        )
          ?.textContent?.trim(),
        candidateProject: banner?.querySelector(
          '.recovery-details span'
        )?.textContent?.trim(),
        candidateDetails: banner?.querySelector(
          '.recovery-details summary'
        )?.textContent?.trim(),
        candidateActions: [...(banner?.querySelectorAll(
          '.recovery-prompt button'
        ) ?? [])].map((button) => button.textContent?.trim()),
        autosaveApi: Object.keys(window.pandaStage.autosave).sort(),
        recoveryApi: Object.keys(window.pandaStage.recovery).sort(),
        rendererHasNodeRequire: typeof window.require !== 'undefined'
      };
    })()`);
    result.invalidCandidate = invalidCandidate;
    result.quickActionIds = await window.webContents.executeJavaScript(`(() => {
      const drawer = document.querySelector('[data-testid="quick-action-drawer"]');
      const handle = drawer?.querySelector('[data-testid="quick-action-drawer-handle"]');
      if (!(drawer instanceof HTMLElement) || !(handle instanceof HTMLElement)) {
        throw new Error('Quick Action Drawer did not render.');
      }
      handle.click();
      return new Promise((resolve) => requestAnimationFrame(() => {
        resolve({
          expanded: drawer.dataset.expanded === 'true',
          actions: [
            ...(drawer.querySelectorAll('.quick-action-drawer-actions > [data-testid]') ?? [])
          ].map((element) => element.getAttribute('data-testid')),
        });
      }));
    })()`);
    await window.webContents.executeJavaScript(`
      document.fonts.ready.then(
        () => new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
      )
    `);

    if (
      !result.hasQuickActionDrawer ||
      !result.projectName.includes(exampleProject.name) ||
      result.defaultState !== 'saved' ||
      result.hasEditorPathInput ||
      !result.actions.includes('quick-action-home') ||
      !result.actions.includes('quick-action-save') ||
      !result.actions.includes('quick-action-play') ||
      !result.actions.includes('quick-action-close') ||
      !result.quickActionIds.expanded ||
      !result.quickActionIds.actions.includes('quick-action-home') ||
      !result.quickActionIds.actions.includes('quick-action-folder') ||
      !result.quickActionIds.actions.includes('quick-action-save') ||
      !result.quickActionIds.actions.includes('quick-action-play') ||
      !result.quickActionIds.actions.includes('quick-action-history') ||
      !result.quickActionIds.actions.includes('quick-action-close') ||
      !result.invalidCandidate.disabled ||
      result.invalidCandidate.hint !==
        '项目文件夹路径包含 Windows 不允许的字符。' ||
      result.candidateSummary !== '检测到未保存的恢复内容' ||
      result.candidateProject !== 'Recovered crash draft' ||
      result.candidateDetails !== '查看详情' ||
      !result.candidateTime ||
      result.candidateActions.join(',') !==
        '恢复,忽略' ||
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
    ipcMain.removeHandler(IPC_CHANNELS.RECENT_PROJECTS_LIST);
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

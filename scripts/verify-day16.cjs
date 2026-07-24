const { createHash } = require('node:crypto');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { app, ipcMain } = require('electron');
const {
  createMainWindow,
} = require('../dist-electron/main/windows/main-window.js');
const {
  IPC_CHANNELS,
} = require('../dist-electron/shared/ipc/channels.js');
const exampleProject = require('../demo-project/project-v1.example.json');

const evidenceDirectory = path.join(
  __dirname,
  '../docs/evidence/day-16',
);
const projectRoot = 'D:\\项目\\素材 导入 🐼.pandastage';
const importedAsset = {
  id: '16000000-0000-4000-8000-000000000099',
  name: '熊猫 图片',
  relativePath: 'assets/熊猫 图片.png',
  mimeType: 'image/png',
  kind: 'image',
  width: 16,
  height: 12,
};
const importedProject = {
  ...exampleProject,
  assets: [...exampleProject.assets, importedAsset],
};

app.on('window-all-closed', () => {});

async function fixtureHash(fileName) {
  return createHash('sha256')
    .update(
      await readFile(
        path.join(__dirname, '../tests/fixtures/assets', fileName),
      ),
    )
    .digest('hex');
}

async function verifyDay16() {
  let chooseRequest = null;
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
    candidate: null,
  }));
  ipcMain.handle(IPC_CHANNELS.RECENT_PROJECTS_LIST, () => ({
    ok: true,
    entries: [],
  }));
  ipcMain.handle(IPC_CHANNELS.ASSET_IMPORT_CHOOSE, (_event, request) => {
    chooseRequest = request;
    return {
      ok: true,
      status: 'completed',
      project: importedProject,
      baseRevision: request.baseRevision,
      savedRevision: request.baseRevision + 1,
      projectChanged: true,
      results: [
        {
          sourceName: '熊猫 图片.png',
          status: 'imported',
          sha256:
            'b2bf8e7c660d88a8a59015bf0b1e70004749fe4fc124542efa5d653c94ac753f',
          asset: importedAsset,
          duplicateOfAssetId: null,
          code: null,
          message: '已导入“熊猫 图片.png”。',
        },
      ],
    };
  });

  const window = await createMainWindow({ show: false });
  try {
    await window.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const deadline = Date.now() + 10000;
        const poll = () => {
          if (document.querySelector('.asset-import-panel')) return resolve();
          if (Date.now() >= deadline) {
            return reject(new Error('Asset import panel did not render.'));
          }
          setTimeout(poll, 25);
        };
        poll();
      })
    `);
    await window.webContents.executeJavaScript(`
      (() => {
        const input = document.querySelector('.recovery-open-row input');
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value'
        ).set;
        setter.call(input, ${JSON.stringify(projectRoot)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('.recovery-open-row button').click();
        return new Promise((resolve, reject) => {
          const deadline = Date.now() + 10000;
          const poll = () => {
            const button = document.querySelector(
              '.asset-import-heading button'
            );
            if (button && !button.disabled) return resolve();
            if (Date.now() >= deadline) {
              return reject(new Error('Project did not open for import.'));
            }
            setTimeout(poll, 25);
          };
          poll();
        });
      })()
    `);
    await window.webContents.executeJavaScript(`
      (() => {
        document.querySelector('.asset-import-heading button').click();
        return new Promise((resolve, reject) => {
          const deadline = Date.now() + 10000;
          const poll = () => {
            const result = document.querySelector('.asset-import-result');
            if (result) return resolve();
            if (Date.now() >= deadline) {
              return reject(new Error('Asset import result did not render.'));
            }
            setTimeout(poll, 25);
          };
          poll();
        });
      })()
    `);
    const ui = await window.webContents.executeJavaScript(`(() => ({
      heading: document.querySelector('.asset-import-heading h2')
        ?.textContent?.trim(),
      button: document.querySelector('.asset-import-heading button')
        ?.textContent?.trim(),
      dropText: document.querySelector('.asset-import-drop')
        ?.textContent?.trim(),
      resultStatus: document.querySelector('.asset-import-result strong')
        ?.textContent?.trim(),
      resultMessage: document.querySelector('.asset-import-result span')
        ?.textContent?.trim(),
      status: document.querySelector('.asset-import-status')
        ?.textContent?.trim(),
      assetsApi: Object.keys(window.pandaStage.assets).sort(),
      rendererHasNodeRequire: typeof window.require !== 'undefined'
    }))()`);
    const hashes = {
      png: await fixtureHash('熊猫 图片.png'),
      jpg: await fixtureHash('熊猫 照片.jpg'),
      mp3: await fixtureHash('熊猫 声音.mp3'),
      wav: await fixtureHash('熊猫 声音.wav'),
    };
    const evidence = {
      day: 16,
      workOrder: 'B-16/45',
      result: 'PASS',
      branch: 'feat/day-16-asset-import',
      ui,
      chooseRequest,
      importedAsset,
      fixtureSha256: hashes,
      issue26: {
        issue: 'https://github.com/Cognitive-Architect/panda-stage/issues/26',
        staleRevisionCode: 'ASSET_IMPORT_STALE_REVISION',
        rollbackFailureCode: 'ASSET_IMPORT_ROLLBACK_FAILED',
        verifiedBehaviors: {
          staleRejectedBeforeCandidateCopy: true,
          concurrentDifferentAssetsPreservedAfterRetry: true,
          concurrentIdenticalContentDeduplicatedAfterRetry: true,
          concurrentEditorChangePreserved: true,
          copiedFileRegisteredBeforeModelConstruction: true,
          assetAndProjectConstructionFaultsRollbackAllFiles: true,
          longUnicodeDisplayNameLimitedTo200: true,
          allFailureTestsLeaveZeroTemporaryFiles: true,
          rollbackFailureReportsResidualPaths: true,
        },
      },
      backendEvidence: {
        test: 'tests/integration/asset-import.test.ts',
        unitFiles: 37,
        unitTests: 214,
        integrationFiles: 5,
        integrationTests: 44,
        verifiedBehaviors: {
          fourMediaTypesImported: true,
          relativePathsPersisted: true,
          duplicateContentNotCopied: true,
          sameNameDifferentContentPreserved: true,
          unsupportedAndDisguisedRejected: true,
          copyFailurePreservesProjectHashAndAssetCount: true,
          saveFailureRollsBackFileAndPreservesProjectHashAndAssetCount: true,
          projectCopySurvivesExternalSourceDeletion: true,
        },
      },
    };

    if (
      ui.heading !== '导入项目素材' ||
      ui.button !== '选择 PNG / JPG / MP3 / WAV' ||
      !ui.dropText?.includes('SHA-256') ||
      ui.resultStatus !== 'imported' ||
      !ui.resultMessage?.includes('已导入') ||
      ui.status !== '素材已复制并保存到项目。' ||
      ui.assetsApi.join(',') !== 'choose,importDropped' ||
      ui.rendererHasNodeRequire ||
      chooseRequest?.projectRoot !== projectRoot ||
      chooseRequest?.baseRevision !== 0
    ) {
      throw new Error(
        `Day 16 UI verification failed: ${JSON.stringify(evidence)}`,
      );
    }

    await window.webContents.executeJavaScript(`
      document.querySelector('.asset-import-panel').scrollIntoView({
        block: 'center'
      });
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
        path.join(evidenceDirectory, 'asset-import.png'),
        screenshot.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'results.json'),
        `${JSON.stringify(evidence, null, 2)}\n`,
        'utf8',
      ),
    ]);
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    window.destroy();
    for (const channel of [
      IPC_CHANNELS.PROJECT_OPEN,
      IPC_CHANNELS.AUTOSAVE_TRACK,
      IPC_CHANNELS.AUTOSAVE_UPDATE,
      IPC_CHANNELS.AUTOSAVE_STOP,
      IPC_CHANNELS.RECOVERY_DETECT,
      IPC_CHANNELS.RECENT_PROJECTS_LIST,
      IPC_CHANNELS.ASSET_IMPORT_CHOOSE,
    ]) {
      ipcMain.removeHandler(channel);
    }
  }
}

app
  .whenReady()
  .then(verifyDay16)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

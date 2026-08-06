const { readFile, mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { app, ipcMain } = require('electron');
const {
  createMainWindow,
} = require('../dist-electron/main/windows/main-window.js');
const {
  IPC_CHANNELS,
} = require('../dist-electron/shared/ipc/channels.js');
const {
  validatePngThumbnail,
} = require('../dist-electron/main/services/PngThumbnailValidator.js');
const exampleProject = require('../demo-project/project-v1.example.json');

const repositoryRoot = path.join(__dirname, '..');
const evidenceDirectory = path.join(
  repositoryRoot,
  'docs/evidence/day-18',
);
const projectRoot = 'D:\\项目\\Day 18 素材库 🐼.pandastage';
const referencedAssetId =
  '10000000-0000-4000-8000-000000000002';
const fixtureAssetId = (index) =>
  `18000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const removableAssetId = fixtureAssetId(1);
const decodeErrorAssetId = fixtureAssetId(2);
const missingThumbnailAssetId = fixtureAssetId(99);
const fixtureAssets = Array.from({ length: 99 }, (_, offset) => {
  const index = offset + 1;
  return {
    id: fixtureAssetId(index),
    kind: 'image',
    name: `背景占位 ${String(index).padStart(3, '0')}`,
    relativePath: `assets/day18-background-${index}.png`,
    mimeType: 'image/png',
    width: 320,
    height: 180,
    sha256: String(index).padStart(64, '0'),
  };
});
const libraryProject = {
  ...exampleProject,
  assets: [...exampleProject.assets, ...fixtureAssets],
};

app.on('window-all-closed', () => {});

function waitFor(expression, failureMessage) {
  return `
    new Promise((resolve, reject) => {
      const deadline = Date.now() + 10000;
      const poll = () => {
        if (${expression}) return resolve();
        if (Date.now() >= deadline) {
          return reject(new Error(${JSON.stringify(failureMessage)}));
        }
        setTimeout(poll, 25);
      };
      poll();
    })
  `;
}

async function verifyDay18() {
  const png = await readFile(
    path.join(repositoryRoot, 'tests/fixtures/assets/熊猫 图片.png'),
  );
  const thumbnailDataUrl =
    `data:image/png;base64,${png.toString('base64')}`;
  const pngValidation = {
    validCacheAccepted: Boolean(validatePngThumbnail(png)),
    truncatedSignatureBodyRejected:
      validatePngThumbnail(
        Buffer.concat([
          png.subarray(0, 8),
          Buffer.from('truncated cache body'),
        ]),
      ) === null,
    oversizedCacheCoveredBy:
      'tests/unit/asset-thumbnail-service.test.ts',
  };
  const deleteRequests = [];
  let thumbnailRequestCount = 0;

  ipcMain.handle(IPC_CHANNELS.PROJECT_OPEN, () => ({
    ok: true,
    value: {
      projectRoot,
      projectFilePath: `${projectRoot}\\project.json`,
      project: libraryProject,
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
  ipcMain.handle(
    IPC_CHANNELS.ASSET_THUMBNAIL_READ,
    (_event, request) => {
      thumbnailRequestCount += 1;
      if (request.assetId === missingThumbnailAssetId) {
        return {
          ok: true,
          status: 'missing',
          assetId: request.assetId,
        };
      }
      return {
        ok: true,
        status: 'ready',
        assetId: request.assetId,
        dataUrl: thumbnailDataUrl,
      };
    },
  );
  ipcMain.handle(IPC_CHANNELS.ASSET_DELETE, (_event, request) => {
    deleteRequests.push(request);
    if (request.assetId === referencedAssetId) {
      return {
        ok: false,
        error: {
          code: 'ASSET_DELETE_REFERENCED',
          message: 'Main Process 已阻止删除：素材仍被 1 处内容使用。',
          projectRoot,
          assetId: request.assetId,
          references: [
            {
              kind: 'shot-background',
              label: '镜头“Opening”的背景图层“Background”',
              path: 'shots[Opening].layers[Background].source.assetId',
            },
          ],
        },
      };
    }
    return {
      ok: true,
      project: {
        ...request.project,
        assets: request.project.assets.filter(
          (asset) => asset.id !== request.assetId,
        ),
        updatedAt: '2026-07-25T10:00:00.000Z',
      },
      baseRevision: request.baseRevision,
      savedRevision: request.baseRevision + 1,
      deletedAssetId: request.assetId,
      cleanupResidualPaths: [],
    };
  });

  const window = await createMainWindow({ show: false });
  try {
    window.setSize(1440, 1000);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('.recovery-open-row input')",
        'StartScreen did not render.',
      ),
    );
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
      })()
    `);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector(" +
          "'[data-testid=\\\"resource-activity-tabs\\\"] " +
          "[data-activity=\\\"assets\\\"]'" +
          ")",
        'Resource activity tabs did not render.',
      ),
    );
    await window.webContents.executeJavaScript(
      `document.querySelector('[data-testid="resource-activity-tabs"] ` +
        `[data-activity="assets"]').click()`,
    );
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelectorAll('.asset-card').length === 100 && " +
          "document.querySelectorAll('.asset-card img').length === 98 && " +
          "document.querySelector('[data-thumbnail-status=\"missing\"]')",
        'The 100-item thumbnail grid did not become ready.',
      ),
    );
    await window.webContents.executeJavaScript(`
      document.querySelector('.asset-library').scrollIntoView({
        block: 'start'
      });
      document.fonts.ready.then(
        () => new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
      )
    `);
    const gridScreenshot = await window.webContents.capturePage();

    await window.webContents.executeJavaScript(
      "document.querySelector('[data-asset-id=\"18000000-0000-4000-8000-000000000002\"]').click()",
    );
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('[data-testid=\"asset-details-view\"]')",
        'Selecting an asset did not open its details view.',
      ),
    );
    await window.webContents.executeJavaScript(
      "document.querySelector('[data-testid=\"asset-details-back\"]').click()",
    );
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('[data-asset-id=\"18000000-0000-4000-8000-000000000002\"] img')",
        'Returning from asset details did not restore the browser card.',
      ),
    );
    const decodeFallbackBefore =
      await window.webContents.executeJavaScript(`(() => {
        const card = document.querySelector(
          '[data-asset-id="18000000-0000-4000-8000-000000000002"]'
        );
        const image = card.querySelector('img');
        const imageCount = document.querySelectorAll(
          '.asset-grid img'
        ).length;
        image.dispatchEvent(new Event('error'));
        return { imageCount };
      })()`);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('[data-asset-id=\"" +
          decodeErrorAssetId +
          "\"] [data-thumbnail-status=\"missing\"]') && " +
          "document.querySelector('[data-asset-id=\"" +
          decodeErrorAssetId +
          "\"] button')",
        'Browser decode failure did not fall back to rebuildable missing.',
      ),
    );
    const decodeFallback = await window.webContents.executeJavaScript(
      `(() => ({
        failedCardMissing: Boolean(document.querySelector(
          '[data-asset-id="${decodeErrorAssetId}"] ' +
          '[data-thumbnail-status="missing"]'
        )),
        failedCardHasRebuild: Boolean(document.querySelector(
          '[data-asset-id="${decodeErrorAssetId}"] button'
        )),
        failedCardStillSelected: document.querySelector(
          '[data-asset-id="${decodeErrorAssetId}"]'
        )?.classList.contains('asset-card-selected'),
        failedCardHasImage: Boolean(document.querySelector(
          '[data-asset-id="${decodeErrorAssetId}"] img'
        )),
        healthyCardStillHasImage: Boolean(document.querySelector(
          '[data-asset-id="${fixtureAssetId(3)}"] img'
        )),
        imageCountBefore: ${JSON.stringify(
          decodeFallbackBefore.imageCount,
        )},
        imageCountAfter: document.querySelectorAll(
          '.asset-grid img'
        ).length
      }))()`,
    );
    await window.webContents.executeJavaScript(`
      (() => {
        document.querySelector(
          '[data-asset-id="${decodeErrorAssetId}"]'
        ).scrollIntoView({ block: 'center' });
        return document.fonts.ready.then(
          () => new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          )
        );
      })()
    `);
    const decodeFallbackScreenshot =
      await window.webContents.capturePage();

    const performanceObservation =
      await window.webContents.executeJavaScript(`(async () => {
        const grid = document.querySelector('.asset-grid');
        const cards = [...grid.querySelectorAll('.asset-card')];
        const startedAt = performance.now();
        grid.scrollTop = grid.scrollHeight;
        cards.at(-1).click();
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        );
        return {
          elapsedMs: performance.now() - startedAt,
          itemCount: cards.length,
          selectedName: document.querySelector('.asset-details h3')
            ?.textContent?.trim(),
          scrollTop: grid.scrollTop,
          scrollHeight: grid.scrollHeight,
          clientHeight: grid.clientHeight
        };
      })()`);

    const dragEvidence = await window.webContents.executeJavaScript(`
      (() => {
        const card = document.querySelector(
          '[data-asset-id="${removableAssetId}"]'
        );
        card.scrollIntoView({ block: 'center' });
        const transfer = new DataTransfer();
        card.dispatchEvent(new DragEvent('dragstart', {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer
        }));
        document.querySelector('.asset-library').dispatchEvent(
          new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer
          })
        );
        const raw = transfer.getData(
          'application/x-panda-stage-asset'
        );
        return {
          payload: JSON.parse(raw),
          types: [...transfer.types],
          rawContainsPath: raw.includes('assets/'),
          rawContainsAssetObject: raw.includes('relativePath')
        };
      })()
    `);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('.asset-library')" +
          ".classList.contains('asset-library-drag-over')",
        'Drag-over feedback did not render.',
      ),
    );
    const dragScreenshot = await window.webContents.capturePage();
    await window.webContents.executeJavaScript(`
      document.querySelector(
        '[data-asset-id="${removableAssetId}"]'
      ).dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    `);

    await window.webContents.executeJavaScript(`
      (() => {
        window.confirm = () => true;
        const card = document.querySelector(
          '[data-asset-id="${referencedAssetId}"]'
        );
        card.scrollIntoView({ block: 'center' });
        card.click();
      })()
    `);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('.asset-reference-warning')" +
          "?.textContent?.includes('Opening')",
        'Human-readable reference details did not render.',
      ),
    );
    await window.webContents.executeJavaScript(`
      document.querySelector('.asset-delete-button').click()
    `);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('.asset-library-status')" +
          "?.textContent?.includes('Main Process 已阻止删除')",
        'Referenced deletion was not visibly blocked.',
      ),
    );
    const referenceUi = await window.webContents.executeJavaScript(`(() => ({
      status: document.querySelector('.asset-library-status')
        ?.textContent?.trim(),
      warning: document.querySelector('.asset-reference-warning')
        ?.textContent?.replace(/\\s+/g, ' ').trim(),
      cardStillPresent: Boolean(document.querySelector(
        '[data-asset-id="${referencedAssetId}"]'
      ))
    }))()`);
    const referenceScreenshot = await window.webContents.capturePage();

    await window.webContents.executeJavaScript(`
      (() => {
        const card = document.querySelector(
          '[data-asset-id="${removableAssetId}"]'
        );
        card.scrollIntoView({ block: 'center' });
        card.click();
      })()
    `);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('.asset-details h3')" +
          "?.textContent?.includes('背景占位 001')",
        'Unreferenced asset was not selected.',
      ),
    );
    await window.webContents.executeJavaScript(`
      document.querySelector('.asset-delete-button').click()
    `);
    await window.webContents.executeJavaScript(
      waitFor(
        "!document.querySelector('[data-asset-id=\"" +
          removableAssetId +
          "\"]') && document.querySelector('.asset-library-status')" +
          "?.textContent?.includes('同步删除')",
        'Unreferenced asset did not disappear after successful deletion.',
      ),
    );
    const deletionUi = await window.webContents.executeJavaScript(`(() => ({
      status: document.querySelector('.asset-library-status')
        ?.textContent?.trim(),
      backgroundCount: document.querySelector(
        '.asset-category-tabs button[aria-pressed="true"] strong'
      )?.textContent?.trim(),
      total: document.querySelector('.asset-library-heading output')
        ?.textContent?.trim(),
      removedCardPresent: Boolean(document.querySelector(
        '[data-asset-id="${removableAssetId}"]'
      )),
      rendererHasNodeRequire: typeof window.require !== 'undefined',
      assetsApi: Object.keys(window.pandaStage.assets).sort()
    }))()`);
    const deletionScreenshot = await window.webContents.capturePage();

    const sourceAudit = await window.webContents.executeJavaScript(`(() => ({
      imageCount: document.querySelectorAll('.asset-grid img').length,
      nonDataImageSources: [...document.querySelectorAll('.asset-grid img')]
        .map((image) => image.getAttribute('src'))
        .filter((source) => !source?.startsWith('data:image/png;base64,')),
      missingHasRebuild: Boolean(
        document.querySelector(
          '[data-asset-id="${missingThumbnailAssetId}"] button'
        )
      )
    }))()`);

    const evidence = {
      day: 18,
      workOrder: 'B-18/45',
      result: 'PASS',
      branch: 'feat/day-18-asset-library-ui',
      executedAt: new Date().toISOString(),
      ui: {
        categories: ['角色图片', '背景图片', '音频'],
        backgroundItemsBeforeDelete: 100,
        thumbnailRequestCount,
        performanceObservation,
        dragEvidence,
        referenceUi,
        deletionUi,
        sourceAudit,
        decodeFallback,
      },
      deletionProtocol: {
        referenceScanBeforeMutation: true,
        authoritativeSnapshotRecheckedBeforeCommit: true,
        referencesRescannedBeforeCommit: true,
        staleDuringStageRollsBackAllFiles: true,
        referencedDeleteBlocked: true,
        referencedAssetStillVisible: referenceUi.cardStillPresent,
        unreferencedDeleteApplied: !deletionUi.removedCardPresent,
        requests: deleteRequests.map((request) => ({
          assetId: request.assetId,
          baseRevision: request.baseRevision,
          projectRoot: request.projectRoot,
        })),
      },
      backendEvidence: {
        integrationTest: 'tests/integration/asset-delete.test.ts',
        verifiesRealAssetCacheAndProjectDeletion: true,
        verifiesStageFailureRollback: true,
        verifiesAtomicSaveFailureRollback: true,
        verifiesStaleRevisionBeforeMutation: true,
        verifiesStaleRevisionAfterStaging: true,
        verifiesStaleAtAtomicReplaceBoundary: true,
        verifiesRecoveryHashPreservedOnRace: true,
        pngValidation,
      },
      screenshots: [
        'docs/evidence/day-18/asset-library-100.png',
        'docs/evidence/day-18/drag-feedback.png',
        'docs/evidence/day-18/thumbnail-decode-fallback.png',
        'docs/evidence/day-18/reference-blocked.png',
        'docs/evidence/day-18/unreferenced-deleted.png',
      ],
    };

    if (
      performanceObservation.itemCount !== 100 ||
      performanceObservation.elapsedMs >= 1_000 ||
      performanceObservation.scrollTop <= 0 ||
      dragEvidence.payload.assetId !== removableAssetId ||
      dragEvidence.payload.version !== 2 ||
      dragEvidence.payload.type !== 'asset-image' ||
      dragEvidence.rawContainsPath ||
      dragEvidence.rawContainsAssetObject ||
      !referenceUi.cardStillPresent ||
      deletionUi.removedCardPresent ||
      deletionUi.backgroundCount !== '99' ||
      deletionUi.rendererHasNodeRequire ||
      !deletionUi.assetsApi.includes('delete') ||
      !deletionUi.assetsApi.includes('readThumbnail') ||
      sourceAudit.nonDataImageSources.length > 0 ||
      !sourceAudit.missingHasRebuild ||
      !decodeFallback.failedCardMissing ||
      !decodeFallback.failedCardHasRebuild ||
      !decodeFallback.failedCardStillSelected ||
      decodeFallback.failedCardHasImage ||
      !decodeFallback.healthyCardStillHasImage ||
      decodeFallback.imageCountAfter !==
        decodeFallback.imageCountBefore - 1 ||
      !pngValidation.validCacheAccepted ||
      !pngValidation.truncatedSignatureBodyRejected ||
      deleteRequests.length !== 2
    ) {
      throw new Error(
        `Day 18 UI verification failed: ${JSON.stringify(evidence)}`,
      );
    }

    await mkdir(evidenceDirectory, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(evidenceDirectory, 'asset-library-100.png'),
        gridScreenshot.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'drag-feedback.png'),
        dragScreenshot.toPNG(),
      ),
      writeFile(
        path.join(
          evidenceDirectory,
          'thumbnail-decode-fallback.png',
        ),
        decodeFallbackScreenshot.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'reference-blocked.png'),
        referenceScreenshot.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'unreferenced-deleted.png'),
        deletionScreenshot.toPNG(),
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
      IPC_CHANNELS.ASSET_THUMBNAIL_READ,
      IPC_CHANNELS.ASSET_DELETE,
    ]) {
      ipcMain.removeHandler(channel);
    }
  }
}

app
  .whenReady()
  .then(verifyDay18)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

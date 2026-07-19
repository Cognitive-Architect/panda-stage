const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const {
  evaluateShotAtTime,
} = require('../dist-electron/shared/domain/index.js');
const {
  PROBE_BACKGROUND_ASSET_ID,
  PROBE_PROJECT,
  PROBE_SHOT,
} = require('../dist-electron/shared/probe/probe-project.js');
const {
  buildStageRenderModel,
} = require('../dist-electron/shared/stage/render-model.js');
const {
  registerIpcHandlers,
} = require('../dist-electron/main/ipc/register-ipc-handlers.js');
const {
  HiddenWindowManager,
} = require('../dist-electron/main/windows/hidden-window-manager.js');
const {
  createMainWindow,
} = require('../dist-electron/main/windows/main-window.js');

const POLL_TIMEOUT_MS = 10_000;

app.on('window-all-closed', () => {});

async function waitForStage(window) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const ready = await window.webContents.executeJavaScript(`
      document.querySelector('[data-testid="stage-renderer"]')
        ?.dataset.stageReady === 'true'
    `);
    if (ready) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for the shared StageRenderer.');
}

async function readStageSnapshot(window) {
  return window.webContents.executeJavaScript(`(() => {
    const renderer = document.querySelector('[data-testid="stage-renderer"]');
    const viewport = document.querySelector('[data-testid="stage-viewport"]');
    const canvas = renderer?.querySelector('canvas');
    if (!renderer || !viewport || !canvas) {
      throw new Error('Stage snapshot elements are missing.');
    }
    return {
      logicalWidth: Number(renderer.dataset.logicalWidth),
      logicalHeight: Number(renderer.dataset.logicalHeight),
      timeMs: Number(renderer.dataset.stageTime),
      displayScale: Number(viewport.dataset.displayScale),
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      dataUrl: canvas.toDataURL('image/png')
    };
  })()`);
}

function hashDataUrl(dataUrl) {
  return crypto.createHash('sha256').update(dataUrl).digest('hex');
}

function saveDataUrl(dataUrl, outputPath) {
  const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1);
  fs.writeFileSync(outputPath, Buffer.from(encoded, 'base64'));
}

async function runVerification() {
  const hiddenWindowManager = new HiddenWindowManager();
  let mainWindow = null;
  const removeIpcHandlers = registerIpcHandlers({
    getMainWindow: () => mainWindow,
    getHiddenWindow: () => hiddenWindowManager.getWindow(),
    markHiddenReady: (senderId) => hiddenWindowManager.markReady(senderId),
  });

  try {
    mainWindow = await createMainWindow();
    mainWindow.once('closed', () => hiddenWindowManager.close());
    const hiddenWindow = await hiddenWindowManager.create();
    await Promise.all([waitForStage(mainWindow), waitForStage(hiddenWindow)]);

    mainWindow.setContentSize(900, 700);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const narrowSnapshot = await readStageSnapshot(mainWindow);
    mainWindow.setContentSize(1_100, 800);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const [mainSnapshot, hiddenSnapshot] = await Promise.all([
      readStageSnapshot(mainWindow),
      readStageSnapshot(hiddenWindow),
    ]);
    const mainHash = hashDataUrl(mainSnapshot.dataUrl);
    const hiddenHash = hashDataUrl(hiddenSnapshot.dataUrl);

    let missingAssetError = '';
    try {
      buildStageRenderModel(
        PROBE_PROJECT,
        evaluateShotAtTime(PROBE_SHOT, 0),
        { [PROBE_BACKGROUND_ASSET_ID]: 'probe/stage-background.svg' },
      );
    } catch (error) {
      missingAssetError = error instanceof Error ? error.message : String(error);
    }

    const png = fs.readFileSync(
      path.join(__dirname, '../public/probe/panda-character.png'),
    );
    const pngColorType = png[25];
    const evidenceDir = process.env.DAY04_EVIDENCE_DIR;
    if (evidenceDir) {
      fs.mkdirSync(evidenceDir, { recursive: true });
      saveDataUrl(
        mainSnapshot.dataUrl,
        path.join(evidenceDir, 'day-04-main-stage.png'),
      );
      saveDataUrl(
        hiddenSnapshot.dataUrl,
        path.join(evidenceDir, 'day-04-hidden-stage.png'),
      );
      const mainCapture = await mainWindow.webContents.capturePage();
      fs.writeFileSync(
        path.join(evidenceDir, 'day-04-app.png'),
        mainCapture.toPNG(),
      );
    }

    const result = {
      sharedFrameSha256: mainHash,
      hiddenFrameMatches: mainHash === hiddenHash,
      logicalSize: `${mainSnapshot.logicalWidth}x${mainSnapshot.logicalHeight}`,
      snapshotTimeMs: mainSnapshot.timeMs,
      canvasSizeStable:
        narrowSnapshot.canvasWidth === mainSnapshot.canvasWidth &&
        narrowSnapshot.canvasHeight === mainSnapshot.canvasHeight,
      responsiveScaleChanged:
        narrowSnapshot.displayScale !== mainSnapshot.displayScale,
      transparentPngColorType: pngColorType,
      missingAssetError,
    };

    if (
      !result.hiddenFrameMatches ||
      result.logicalSize !== '1920x1080' ||
      hiddenSnapshot.logicalWidth !== 1_920 ||
      hiddenSnapshot.logicalHeight !== 1_080 ||
      hiddenSnapshot.timeMs !== result.snapshotTimeMs ||
      result.snapshotTimeMs !== 1_500 ||
      !result.canvasSizeStable ||
      !result.responsiveScaleChanged ||
      result.transparentPngColorType !== 6 ||
      !result.missingAssetError.includes('透明熊猫角色')
    ) {
      throw new Error(`Day 04 verification failed: ${JSON.stringify(result)}`);
    }

    console.log(JSON.stringify(result, null, 2));

    const closed = new Promise((resolve) => mainWindow.once('closed', resolve));
    mainWindow.close();
    await closed;
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (BrowserWindow.getAllWindows().length !== 0) {
      throw new Error('Day 04 verification left BrowserWindows open.');
    }
  } finally {
    removeIpcHandlers();
    hiddenWindowManager.close();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.destroy();
    }
  }
}

app
  .whenReady()
  .then(runVerification)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

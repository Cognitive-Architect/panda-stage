const crypto = require('node:crypto');
const path = require('node:path');
const { mkdir, writeFile } = require('node:fs/promises');
const { app, nativeImage } = require('electron');
const {
  evaluateShotAtTime,
} = require('../dist-electron/domain/index.js');
const {
  PROBE_CHARACTER_LAYER_ID,
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

const repositoryRoot = path.resolve(__dirname, '..');
const evidenceDirectory = path.join(
  repositoryRoot,
  'docs/evidence/day-23',
);
const rendererPath = path.join(
  repositoryRoot,
  'dist/renderer/hidden.html',
);
const POLL_TIMEOUT_MS = 10_000;

app.on('window-all-closed', () => {});

async function waitForProductionStage(window) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const ready = await window.webContents.executeJavaScript(`(() => {
      const renderer = document.querySelector(
        '[data-testid="stage-renderer"]'
      );
      if (renderer?.dataset.stageReady !== 'true') return false;
      const layers = JSON.parse(renderer.dataset.layerRenderJson ?? '[]');
      return layers.some(
        (layer) => layer.id === ${JSON.stringify(PROBE_CHARACTER_LAYER_ID)}
      );
    })()`);
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Issue #47 production StageRenderer timed out.');
}

async function readProductionFrame(window) {
  return window.webContents.executeJavaScript(`(() => {
    const renderer = document.querySelector(
      '[data-testid="stage-renderer"]'
    );
    const canvas = renderer?.querySelector('canvas');
    if (!renderer || !canvas) {
      throw new Error('Issue #47 production frame is unavailable.');
    }
    const layers = JSON.parse(renderer.dataset.layerRenderJson ?? '[]');
    const character = layers.find(
      (layer) => layer.id === ${JSON.stringify(PROBE_CHARACTER_LAYER_ID)}
    );
    if (!character) {
      throw new Error('Issue #47 character render instruction is missing.');
    }
    return {
      width: canvas.width,
      height: canvas.height,
      renderContract: renderer.dataset.renderContract,
      character,
      dataUrl: canvas.toDataURL('image/png')
    };
  })()`);
}

async function loadFlipFrame(window, flipX) {
  await window.loadFile(rendererPath, {
    query: {
      issue47FlipEvidence: 'true',
      issue47FlipX: String(flipX),
    },
  });
  await waitForProductionStage(window);
  return readProductionFrame(window);
}

function dataUrlBytes(dataUrl) {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

function sha256(dataUrl) {
  return crypto.createHash('sha256').update(dataUrl).digest('hex');
}

function compareMirroredCharacter(unflipped, flipped) {
  const unflippedImage = nativeImage.createFromDataURL(unflipped.dataUrl);
  const flippedImage = nativeImage.createFromDataURL(flipped.dataUrl);
  const unflippedBitmap = unflippedImage.toBitmap();
  const flippedBitmap = flippedImage.toBitmap();
  const render = unflipped.character;
  const renderedWidth = render.width * Math.abs(render.scaleX);
  const renderedHeight = render.height * Math.abs(render.scaleY);
  const left = Math.floor(render.x - renderedWidth / 2);
  const right = Math.ceil(render.x + renderedWidth / 2);
  const top = Math.floor(render.y - renderedHeight / 2);
  const bottom = Math.ceil(render.y + renderedHeight / 2);
  let absoluteDelta = 0;
  let comparedChannels = 0;
  let pixelsWithinTolerance = 0;
  let comparedPixels = 0;

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const mirroredX = right - 1 - (x - left);
      const unflippedIndex = (y * unflipped.width + x) * 4;
      const flippedIndex = (y * flipped.width + mirroredX) * 4;
      let pixelWithinTolerance = true;
      for (let channel = 0; channel < 4; channel += 1) {
        const delta = Math.abs(
          unflippedBitmap[unflippedIndex + channel] -
            flippedBitmap[flippedIndex + channel],
        );
        absoluteDelta += delta;
        comparedChannels += 1;
        if (delta > 12) pixelWithinTolerance = false;
      }
      if (pixelWithinTolerance) pixelsWithinTolerance += 1;
      comparedPixels += 1;
    }
  }

  return {
    bounds: { left, right, top, bottom },
    meanAbsoluteChannelDelta: absoluteDelta / comparedChannels,
    pixelsWithinTolerance:
      pixelsWithinTolerance / comparedPixels,
  };
}

async function verifyIssue47() {
  const hiddenWindowManager = new HiddenWindowManager();
  let mainWindow = null;
  const removeIpcHandlers = registerIpcHandlers({
    getMainWindow: () => mainWindow,
    getHiddenWindow: () => hiddenWindowManager.getWindow(),
    markHiddenReady: (senderId) =>
      hiddenWindowManager.markReady(senderId),
  });

  try {
    const window = await hiddenWindowManager.create();
    const unflipped = await loadFlipFrame(window, false);
    const flipped = await loadFlipFrame(window, true);
    const characterLayer = PROBE_SHOT.layers.find(
      (layer) => layer.id === PROBE_CHARACTER_LAYER_ID,
    );
    if (!characterLayer) {
      throw new Error('Issue #47 evaluator fixture is missing.');
    }
    const evaluatedShot = evaluateShotAtTime(
      {
        ...PROBE_SHOT,
        backgroundLayerId: null,
        layers: [{ ...characterLayer, flipX: true }],
        timelineEvents: [],
      },
      0,
      PROBE_PROJECT,
    );
    const assetUrls = Object.fromEntries(
      PROBE_PROJECT.assets
        .filter((asset) => asset.kind === 'image')
        .map((asset) => [asset.id, asset.relativePath]),
    );
    const productionModel = buildStageRenderModel(
      PROBE_PROJECT,
      evaluatedShot,
      assetUrls,
    );
    const productionLayer = productionModel.layers.find(
      (layer) => layer.id === PROBE_CHARACTER_LAYER_ID,
    );
    const mirror = compareMirroredCharacter(unflipped, flipped);
    const result = {
      issue: 47,
      result: 'PASS',
      branch: 'feat/day-23-layer-transform',
      executedAt: new Date().toISOString(),
      path:
        'hidden ExportRendererApp -> evaluateShotAtTime -> ' +
        'buildStageRenderModel -> StageRenderer',
      evaluatorFlipX: evaluatedShot.layers[0]?.flipX,
      modelScaleX: productionLayer?.render.scaleX,
      unflipped: {
        hash: sha256(unflipped.dataUrl),
        render: unflipped.character,
      },
      flipped: {
        hash: sha256(flipped.dataUrl),
        render: flipped.character,
      },
      centerStable:
        unflipped.character.x === flipped.character.x &&
        unflipped.character.y === flipped.character.y,
      geometryStable:
        unflipped.character.width === flipped.character.width &&
        unflipped.character.height === flipped.character.height &&
        unflipped.character.offsetX === flipped.character.offsetX &&
        unflipped.character.offsetY === flipped.character.offsetY &&
        unflipped.character.scaleY === flipped.character.scaleY,
      mirror,
      screenshots: [
        'docs/evidence/day-23/production-unflipped.png',
        'docs/evidence/day-23/production-flipped.png',
      ],
    };

    if (
      unflipped.width !== 1_920 ||
      unflipped.height !== 1_080 ||
      flipped.width !== 1_920 ||
      flipped.height !== 1_080 ||
      unflipped.renderContract !== 'shared-stage-layer-v1' ||
      flipped.renderContract !== 'shared-stage-layer-v1' ||
      result.evaluatorFlipX !== true ||
      !(result.modelScaleX < 0) ||
      !(unflipped.character.scaleX > 0) ||
      !(flipped.character.scaleX < 0) ||
      Math.abs(unflipped.character.scaleX) !==
        Math.abs(flipped.character.scaleX) ||
      !result.centerStable ||
      !result.geometryStable ||
      result.unflipped.hash === result.flipped.hash ||
      result.mirror.pixelsWithinTolerance < 0.98 ||
      result.mirror.meanAbsoluteChannelDelta > 2
    ) {
      throw new Error(
        `Issue #47 verification failed: ${JSON.stringify(result)}`,
      );
    }

    await mkdir(evidenceDirectory, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(evidenceDirectory, 'production-unflipped.png'),
        dataUrlBytes(unflipped.dataUrl),
      ),
      writeFile(
        path.join(evidenceDirectory, 'production-flipped.png'),
        dataUrlBytes(flipped.dataUrl),
      ),
      writeFile(
        path.join(evidenceDirectory, 'issue-47-results.json'),
        `${JSON.stringify(result, null, 2)}\n`,
        'utf8',
      ),
    ]);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    removeIpcHandlers();
    hiddenWindowManager.close();
  }
}

app
  .whenReady()
  .then(verifyIssue47)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

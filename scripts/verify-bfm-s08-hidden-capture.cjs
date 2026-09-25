const { randomUUID } = require('node:crypto');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { app, nativeImage } = require('electron');
const {
  evaluateShotAtTime,
  projectShotMouth,
} = require('../dist-electron/domain/index.js');
const {
  BFM_S08_PROBE_IDS,
  BFM_S08_PROBE_PROJECT,
  BFM_S08_PROBE_SHOT,
} = require('../dist-electron/shared/probe/bfm-s08-project.js');
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
const rendererPath = path.join(repositoryRoot, 'dist/renderer/hidden.html');
const evidenceDirectory = path.join(
  repositoryRoot,
  'docs/evidence/issue-620-bfm-s08',
);
const timeoutMs = 15_000;
const facePlacement = BFM_S08_PROBE_PROJECT.characters[0].facePlacement;
// Center of the cyan marker added at SVG (230, 535), relative to the
// 640x800 Body image's centered local origin.
const flipMarkerLocalPoint = { x: -90, y: 135 };
const assetUrls = Object.fromEntries(
  BFM_S08_PROBE_PROJECT.assets
    .filter((asset) => asset.kind === 'image')
    .map((asset) => [asset.id, asset.relativePath]),
);

app.on('window-all-closed', () => {});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readStageSnapshot(window) {
  return window.webContents.executeJavaScript(`(() => {
    const stage = document.querySelector('[data-testid="stage-renderer"]');
    if (!stage) return null;
    let layers = [];
    try { layers = JSON.parse(stage.dataset.layerRenderJson ?? '[]'); } catch {}
    return {
      ready: stage.dataset.stageReady === 'true',
      error: stage.dataset.stageError === 'true',
      timeMs: Number(stage.dataset.stageTime ?? NaN),
      renderToken: stage.dataset.stageRenderToken ?? '',
      renderContract: stage.dataset.renderContract ?? '',
      layers,
    };
  })()`);
}

async function waitForInitialStage(window) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [snapshot, readyHandshake] = await Promise.all([
      readStageSnapshot(window),
      window.webContents.executeJavaScript(
        'document.documentElement.dataset.ready === "true"',
      ),
    ]);
    if (snapshot?.error) {
      throw new Error(`BFM-S08 probe failed before frame request: ${JSON.stringify(snapshot)}`);
    }
    if (snapshot?.ready && readyHandshake) return snapshot;
    await delay(40);
  }
  throw new Error('BFM-S08 hidden Stage did not become initially ready.');
}

async function loadCaptureSample(window, failurePart = null) {
  const query = { issue620BfmS08: 'true' };
  if (failurePart) query.issue620FailurePart = failurePart;
  await window.loadFile(rendererPath, { query });
  return waitForInitialStage(window);
}

function evaluateProbeFrame(timeMs) {
  const evaluated = evaluateShotAtTime(
    BFM_S08_PROBE_SHOT,
    timeMs,
    BFM_S08_PROBE_PROJECT,
  );
  const activeDialogue = BFM_S08_PROBE_SHOT.dialogues.find(
    (dialogue) =>
      evaluated.timeMs >= dialogue.startMs &&
      evaluated.timeMs < dialogue.endMs,
  );
  return projectShotMouth(
    BFM_S08_PROBE_PROJECT,
    BFM_S08_PROBE_SHOT,
    evaluated,
    activeDialogue?.id ?? null,
  );
}

function pixelAt(bitmap, width, height, x, y) {
  const pixelX = Math.round(x);
  const pixelY = Math.round(y);
  assert(
    pixelX >= 0 && pixelX < width && pixelY >= 0 && pixelY < height,
    `Pixel sample is outside the captured frame: ${pixelX},${pixelY}.`,
  );
  const offset = (pixelY * width + pixelX) * 4;
  // Electron NativeImage bitmaps use BGRA byte order.
  return [
    bitmap[offset + 2],
    bitmap[offset + 1],
    bitmap[offset],
    bitmap[offset + 3],
  ];
}

function expectColor(pixel, color, label) {
  const [red, green, blue, alpha] = pixel;
  assert(alpha > 30, `${label} is transparent: ${JSON.stringify(pixel)}`);
  if (color === 'body-red') {
    assert(red > green * 1.8 && red > blue * 1.8, `${label} is not Body red: ${JSON.stringify(pixel)}`);
  } else if (color === 'normal-blue') {
    assert(blue > red * 1.5 && blue > green * 1.2, `${label} is not normal Face blue: ${JSON.stringify(pixel)}`);
  } else if (color === 'angry-green') {
    assert(green > red * 1.5 && green > blue * 1.2, `${label} is not angry Face green: ${JSON.stringify(pixel)}`);
  } else if (color === 'flip-marker-cyan') {
    assert(blue > red * 3 && green > red * 3, `${label} is not the asymmetric cyan flip marker: ${JSON.stringify(pixel)}`);
  } else {
    assert(red > blue * 1.8 && green > blue * 1.5, `${label} is not Mouth yellow: ${JSON.stringify(pixel)}`);
  }
}

function evaluateFrameEvidence(response, request, stageSnapshot) {
  assert(response.jobId === request.jobId, 'Captured PNG belongs to another Job.');
  assert(response.frameIndex === request.frameIndex, 'Captured PNG belongs to another frame index.');
  assert(response.timeMs === request.timeMs, 'Captured PNG belongs to another requested time.');
  assert(stageSnapshot?.ready, 'Hidden Stage did not report the requested frame ready.');
  assert(!stageSnapshot.error, 'Hidden Stage reported an error for the captured frame.');
  assert(stageSnapshot.timeMs === request.timeMs, 'Hidden Stage displayed a different frame time.');
  assert(
    stageSnapshot.renderToken === `${request.jobId}:${request.frameIndex}`,
    'Hidden Stage render token does not match the current Job/frame request.',
  );
  assert(stageSnapshot.renderContract === 'shared-stage-layer-v1', 'Capture did not use Shared Stage.');

  const evaluated = evaluateProbeFrame(request.timeMs);
  const model = buildStageRenderModel(
    BFM_S08_PROBE_PROJECT,
    evaluated,
    assetUrls,
  );
  const modelLayer = model.layers.find(
    (layer) => layer.id === BFM_S08_PROBE_IDS.characterLayer,
  );
  const evaluatedLayer = evaluated.layers.find(
    (layer) => layer.id === BFM_S08_PROBE_IDS.characterLayer,
  );
  assert(modelLayer?.visual?.kind === 'composite-character', 'Production visual resolver did not return a composite Character.');
  assert(evaluatedLayer, 'Production time evaluation omitted the Character Layer.');
  assert(
    modelLayer.visual.parts.map((part) => part.slot).join(',') === 'body,face',
    'Production visual resolver did not return both Body and Face parts.',
  );
  assert(
    modelLayer.visual.parts.every(
      (part) => part.ownerLayerId === BFM_S08_PROBE_IDS.characterLayer,
    ),
    'Body and Face do not share the one logical Character Layer owner.',
  );
  assert(
    modelLayer.visual.parts[0]?.assetId === BFM_S08_PROBE_IDS.bodyAsset,
    'Captured model is missing the configured Body asset.',
  );

  const expectedFaceAssetId =
    request.timeMs >= 900
      ? BFM_S08_PROBE_IDS.mouthAsset
      : request.timeMs >= 500
        ? BFM_S08_PROBE_IDS.faceAngryAsset
        : BFM_S08_PROBE_IDS.faceNormalAsset;
  assert(
    modelLayer.visual.parts[1]?.assetId === expectedFaceAssetId,
    `Requested time ${request.timeMs} resolved the wrong Face asset.`,
  );
  assert(
    modelLayer.visual.activeFace?.source ===
      (request.timeMs >= 900 ? 'mouth' : 'expression'),
    'Active Face did not use the requested Expression/Mouth semantics.',
  );
  if (request.timeMs >= 900) {
    assert(
      evaluatedLayer.mouthOverrideAssetId === BFM_S08_PROBE_IDS.mouthAsset,
      'Speaking frame did not pass through the production Mouth projection.',
    );
  }

  const actualLayer = stageSnapshot.layers.find(
    (layer) => layer.id === BFM_S08_PROBE_IDS.characterLayer,
  );
  assert(actualLayer, 'Captured Stage did not contain the Character root instruction.');
  for (const property of ['x', 'y', 'scaleX', 'scaleY', 'opacity']) {
    assert(
      Math.abs(actualLayer[property] - modelLayer.render[property]) < 0.001,
      `Hidden Stage ${property} differs from the production render model.`,
    );
  }

  const faceCenterX =
    evaluatedLayer.x +
    (evaluatedLayer.flipX ? -1 : 1) *
      evaluatedLayer.scaleX *
      facePlacement.offsetX;
  const faceCenterY =
    evaluatedLayer.y + evaluatedLayer.scaleY * facePlacement.offsetY;
  const underFaceX =
    faceCenterX +
    (evaluatedLayer.flipX ? -1 : 1) *
      evaluatedLayer.scaleX *
      facePlacement.scale *
      110;
  const image = nativeImage.createFromBuffer(Buffer.from(response.pngBytes));
  const size = image.getSize();
  assert(size.width === 1_920 && size.height === 1_080, 'Captured PNG dimensions are not 1920x1080.');
  const bitmap = image.toBitmap();
  const pixels = {
    bodyOnly: pixelAt(bitmap, size.width, size.height, evaluatedLayer.x, evaluatedLayer.y),
    faceBodyOverlap: pixelAt(bitmap, size.width, size.height, faceCenterX, faceCenterY),
    bodyUnderTransparentFace: pixelAt(bitmap, size.width, size.height, underFaceX, faceCenterY),
  };
  const markerPoint = {
    x: modelLayer.render.x + modelLayer.render.scaleX * flipMarkerLocalPoint.x,
    y: modelLayer.render.y + modelLayer.render.scaleY * flipMarkerLocalPoint.y,
  };
  const markerOppositePoint = {
    x: modelLayer.render.x - modelLayer.render.scaleX * flipMarkerLocalPoint.x,
    y: markerPoint.y,
  };
  pixels.flipMarker = pixelAt(
    bitmap,
    size.width,
    size.height,
    markerPoint.x,
    markerPoint.y,
  );
  pixels.flipMarkerOpposite = pixelAt(
    bitmap,
    size.width,
    size.height,
    markerOppositePoint.x,
    markerOppositePoint.y,
  );
  expectColor(pixels.bodyOnly, 'body-red', 'Body-only pixel');
  expectColor(
    pixels.faceBodyOverlap,
    request.timeMs >= 900
      ? 'mouth-yellow'
      : request.timeMs >= 500
        ? 'angry-green'
        : 'normal-blue',
    'Body/Face overlap pixel',
  );
  expectColor(pixels.bodyUnderTransparentFace, 'body-red', 'Body visible through transparent Face pixels');
  expectColor(pixels.flipMarker, 'flip-marker-cyan', 'Asymmetric flip marker at its expected side');
  expectColor(pixels.flipMarkerOpposite, 'body-red', 'Opposite side of the asymmetric marker');
  assert(
    Math.max(
      ...pixels.bodyOnly.map((channel, index) =>
        Math.abs(channel - pixels.bodyUnderTransparentFace[index]),
      ),
    ) <= 8,
    'Transparent pixels in the Face did not preserve the underlying Body composite.',
  );

  return {
    request: {
      ...request,
      renderToken: `${request.jobId}:${request.frameIndex}`,
    },
    stage: {
      ready: stageSnapshot.ready,
      error: stageSnapshot.error,
      timeMs: stageSnapshot.timeMs,
      renderToken: stageSnapshot.renderToken,
      renderContract: stageSnapshot.renderContract,
    },
    root: {
      ownerLayerId: modelLayer.visual.ownerLayerId,
      x: modelLayer.render.x,
      y: modelLayer.render.y,
      scaleX: modelLayer.render.scaleX,
      scaleY: modelLayer.render.scaleY,
      opacity: modelLayer.render.opacity,
      flipX: evaluatedLayer.flipX,
    },
    visualParts: modelLayer.visual.parts.map((part) => ({
      slot: part.slot,
      ownerLayerId: part.ownerLayerId,
      assetId: part.assetId,
    })),
    activeFace: modelLayer.visual.activeFace,
    flipMarker: {
      point: markerPoint,
      oppositePoint: markerOppositePoint,
      side: markerPoint.x < modelLayer.render.x ? 'left' : 'right',
      pixel: pixels.flipMarker,
      oppositePixel: pixels.flipMarkerOpposite,
    },
    png: { width: size.width, height: size.height },
    pixels,
  };
}

async function captureFrame(manager, window, jobId, frameIndex, timeMs) {
  const request = { jobId, frameIndex, timeMs };
  const response = await manager.renderFrame(request);
  const snapshot = await readStageSnapshot(window);
  const evidence = evaluateFrameEvidence(response, request, snapshot);
  const pngPath = path.join(
    evidenceDirectory,
    `frame-${String(frameIndex).padStart(6, '0')}.png`,
  );
  await writeFile(pngPath, Buffer.from(response.pngBytes));
  return { ...evidence, pngPath: path.relative(repositoryRoot, pngPath) };
}

async function verifyRequiredPartFailure(manager, window, failurePart) {
  const initialStage = await loadCaptureSample(window, failurePart);
  const jobId = randomUUID();
  await manager.loadProbe({ jobId, durationMs: 3_000, fps: 24 });
  const mouthFailure = failurePart === 'mouth';
  const request = {
    jobId,
    frameIndex: mouthFailure ? 24 : 1,
    timeMs: mouthFailure ? 1_000 : 0,
  };
  const evaluated = evaluateProbeFrame(request.timeMs);
  const expectedLayer = buildStageRenderModel(
    BFM_S08_PROBE_PROJECT,
    evaluated,
    assetUrls,
  ).layers.find((layer) => layer.id === BFM_S08_PROBE_IDS.characterLayer);
  assert(expectedLayer?.visual?.kind === 'composite-character', 'Failure request did not resolve the formal composite Character.');
  const initialExpressionLayer = buildStageRenderModel(
    BFM_S08_PROBE_PROJECT,
    evaluateProbeFrame(0),
    assetUrls,
  ).layers.find((layer) => layer.id === BFM_S08_PROBE_IDS.characterLayer);
  if (mouthFailure) {
    assert(initialStage?.ready, 'Expression fallback was not committed before the Mouth failure request.');
    assert(
      initialExpressionLayer?.visual?.activeFace?.source === 'expression' &&
        initialExpressionLayer.visual.activeFace.assetId ===
          BFM_S08_PROBE_IDS.faceNormalAsset,
      'Initial committed frame was not the normal Expression visual.',
    );
    assert(
      request.timeMs >= BFM_S08_PROBE_SHOT.dialogues[0].startMs &&
        request.timeMs < BFM_S08_PROBE_SHOT.dialogues[0].endMs,
      'Mouth failure request is outside the active speaking interval.',
    );
    assert(
      expectedLayer.visual.activeFace?.source === 'mouth' &&
        expectedLayer.visual.activeFace.assetId === BFM_S08_PROBE_IDS.mouthAsset &&
        expectedLayer.visual.parts[1]?.assetId === BFM_S08_PROBE_IDS.mouthAsset,
      'Formal speaking projection did not require the configured Mouth asset.',
    );
  }
  let response = null;
  let failure = null;
  try {
    response = await manager.renderFrame(request);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  assert(failure, `${failurePart} decode failure incorrectly returned a successful PNG.`);
  assert(response === null, `${failurePart} decode failure resolved with a frame response.`);
  assert(
    failure.includes(`Job ${jobId} frame ${request.frameIndex} failed:`) &&
      failure.includes('Stage image failed to load') &&
      (mouthFailure
        ? failure.includes('data:image/png;base64,not-a-valid-png')
        : true),
    `${failurePart} failure was not a correlated hidden image-load failure: ${failure}`,
  );
  const snapshot = await readStageSnapshot(window);
  assert(!snapshot?.ready, `${failurePart} decode failure left Stage exact-ready.`);
  assert(snapshot?.error, `${failurePart} decode failure was not surfaced as a Stage error.`);
  assert(
    snapshot?.renderToken === `${jobId}:${request.frameIndex}`,
    `${failurePart} failure was not associated with the current request token.`,
  );
  return {
    failurePart,
    request,
    error: failure,
    successfulPngReturned: response !== null,
    exactReady: Boolean(snapshot?.ready && !snapshot.error),
    initialExpressionStage: {
      ready: initialStage?.ready ?? false,
      error: initialStage?.error ?? false,
      timeMs: initialStage?.timeMs ?? null,
      renderToken: initialStage?.renderToken ?? null,
      renderContract: initialStage?.renderContract ?? null,
      activeFace: mouthFailure
        ? initialExpressionLayer.visual.activeFace
        : null,
    },
    productionMouth: mouthFailure
      ? {
          source: expectedLayer.visual.activeFace.source,
          assetId: expectedLayer.visual.activeFace.assetId,
          configuredMouthAssetId: BFM_S08_PROBE_IDS.mouthAsset,
          speakingIntervalMs: [
            BFM_S08_PROBE_SHOT.dialogues[0].startMs,
            BFM_S08_PROBE_SHOT.dialogues[0].endMs,
          ],
        }
      : null,
    stage: snapshot,
  };
}

async function run() {
  await mkdir(evidenceDirectory, { recursive: true });
  const manager = new HiddenWindowManager();
  const removeIpcHandlers = registerIpcHandlers({
    getMainWindow: () => null,
    getHiddenWindow: () => manager.getWindow(),
    markHiddenReady: (senderId) => manager.markReady(senderId),
    markProbeLoaded: (senderId, payload) =>
      manager.markProbeLoaded(senderId, payload),
    markFrameReady: (senderId, payload) =>
      manager.markFrameReady(senderId, payload),
    markFrameFailed: (senderId, payload) =>
      manager.markFrameFailed(senderId, payload),
    startFullProbe: () => {
      throw new Error('The BFM-S08 hidden-capture verifier does not start video export.');
    },
    cancelExport: (jobId) => ({
      jobId,
      accepted: false,
      status: 'failed',
    }),
  });

  try {
    const window = await manager.create();
    await loadCaptureSample(window);
    const captureJobId = randomUUID();
    await manager.loadProbe({
      jobId: captureJobId,
      durationMs: 3_000,
      fps: 24,
    });
    const captures = [];
    captures.push(await captureFrame(manager, window, captureJobId, 0, 0));
    captures.push(await captureFrame(manager, window, captureJobId, 12, 500));
    captures.push(await captureFrame(manager, window, captureJobId, 24, 1_000));

    assert(
      captures[0].pixels.bodyOnly[3] > captures[1].pixels.bodyOnly[3] &&
        captures[1].pixels.bodyOnly[3] > captures[2].pixels.bodyOnly[3],
      'Captured Body pixels did not preserve the requested root opacity progression.',
    );
    assert(captures[0].root.scaleX > 0, 'Unflipped root scale was not positive.');
    assert(captures[1].root.scaleX < 0 && captures[2].root.scaleX < 0, 'Flipped root transform was not applied.');
    assert(captures[0].flipMarker.side === 'left', 'Unflipped PNG did not place the cyan marker on the known left side.');
    assert(captures[1].flipMarker.side === 'right', 'Flipped PNG did not mirror the cyan marker to the right side.');

    const bodyFailure = await verifyRequiredPartFailure(manager, window, 'body');
    const faceFailure = await verifyRequiredPartFailure(manager, window, 'face');
    const mouthFailure = await verifyRequiredPartFailure(manager, window, 'mouth');
    const result = {
      issue: 620,
      followUpIssue: 623,
      section: 'BFM-S08',
      result: 'PASS',
      startingSha: 'b46b8fbf9e17fbd2b77f0569856c4290d8e86b23',
      repairStartingSha: '6f950a0c081f3ff180358a9c074382cce026b583',
      evidenceBoundary: {
        sharedStageCompositeRendering: 'inherited-and-reused',
        hiddenStageExactRequestedFrameCapture: 'covered-by-this-probe',
        fullRealProjectVideoExport: 'NOT COVERED',
      },
      a20Evidence: {
        result: 'PASS',
        returnedHiddenCanvasPngs: captures.map((capture) => capture.pngPath),
        pixelComparisons: captures.map((capture) => ({
          timeMs: capture.request.timeMs,
          bodyOnly: capture.pixels.bodyOnly,
          bodyFaceOverlap: capture.pixels.faceBodyOverlap,
          bodyThroughTransparentFace: capture.pixels.bodyUnderTransparentFace,
          asymmetricFlipMarker: capture.flipMarker,
        })),
      },
      captures,
      asymmetricFlipEvidence: {
        result: 'PASS',
        unflippedCapture: captures[0].flipMarker,
        flippedCapture: captures[1].flipMarker,
        basis: 'returned hidden PNG pixel samples; root transform assertions are secondary evidence',
      },
      requiredPartFailures: [bodyFailure, faceFailure, mouthFailure],
      mouthFailureExactCapture: mouthFailure,
      fallbackAndStaleGate: 'covered by stage-export-readiness and stage-image-resource-session unit tests',
      cancellationAndLateResponse: 'covered by hidden-window-manager unit tests',
    };
    await writeFile(
      path.join(evidenceDirectory, 'results.json'),
      `${JSON.stringify(result, null, 2)}\n`,
      'utf8',
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    removeIpcHandlers();
    manager.close();
  }
}

app
  .whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error) => {
    console.error(`[bfm-s08] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    app.exit(1);
  });

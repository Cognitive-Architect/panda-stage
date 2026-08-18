/* Issue #251 Slice 1: real Electron parser-boundary smoke/acceptance probe. */
const { app, BrowserWindow } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const samplePath = 'D:\\表情合集\\文件.fla';
const evidenceRoot = 'D:\\PandaStage-Acceptance\\issue-251-slice1';
const evidencePath = path.join(evidenceRoot, 'real-sample-electron.json');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForMainWindow() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const window = BrowserWindow.getAllWindows().find(
      (candidate) => !candidate.isDestroyed() && candidate.getTitle() === 'Panda Stage',
    );
    if (window) {
      try {
        const ready = await window.webContents.executeJavaScript(
          `Boolean(window.pandaStage && window.pandaStage.fla && window.pandaStage.fla.chooseAndInspect)`,
        );
        if (ready) return window;
      } catch {
        // The renderer may still be loading.
      }
    }
    await delay(100);
  }
  throw new Error('Panda Stage main window did not expose the FLA inspection API');
}

async function run() {
  if (!fs.existsSync(samplePath)) throw new Error(`Sample is missing: ${samplePath}`);
  const sourceBefore = sha256(samplePath);
  process.env.VITE_DEV_SERVER_URL = '';
  process.env.PANDA_STAGE_FLA_ACCEPTANCE_SOURCE = samplePath;
  require('../dist-electron/main/index.js');

  const mainWindow = await waitForMainWindow();
  const requestId = crypto.randomUUID();
  const response = await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const response = await window.pandaStage.fla.chooseAndInspect(${JSON.stringify(requestId)});
      if (!response.ok) return response;
      return {
        ok: true,
        sessionId: response.sessionId,
        source: response.ir.source,
        document: response.ir.document,
        mediaCount: response.ir.media.length,
        placedInstanceCount: response.ir.summary.placedInstanceCount,
        libraryOnlyMediaCount: response.ir.summary.libraryOnlyMediaCount,
        payloadIntegrityCount: response.ir.media.filter((media) => {
          const bytes = media.payload.bytes;
          return (
            media.payload.mimeType === 'image/png' &&
            bytes.byteLength > 8 &&
            bytes[0] === 0x89 &&
            bytes[1] === 0x50 &&
            bytes[2] === 0x4e &&
            bytes[3] === 0x47 &&
            bytes[4] === 0x0d &&
            bytes[5] === 0x0a &&
            bytes[6] === 0x1a &&
            bytes[7] === 0x0a
          );
        }).length,
        mediaSamples: response.ir.media
          .filter((media) => media.payload.alpha.zeroAlphaPixels > 0 || ['jpeg', 'jpg'].includes(media.sourceFormat))
          .slice(0, 4)
          .map((media) => ({
            id: media.id,
            name: media.name,
            sourceFormat: media.sourceFormat,
            width: media.width,
            height: media.height,
            mimeType: media.payload.mimeType,
            byteLength: media.payload.bytes.byteLength,
            pngSignature: media.payload.bytes[0] === 0x89 && media.payload.bytes[1] === 0x50,
            alpha: media.payload.alpha,
          })),
        transparentMedia: response.ir.media.find((media) => media.payload.alpha.zeroAlphaPixels > 0)
          ? {
              name: response.ir.media.find((media) => media.payload.alpha.zeroAlphaPixels > 0).name,
              zeroAlphaPixels: response.ir.media.find((media) => media.payload.alpha.zeroAlphaPixels > 0).payload.alpha.zeroAlphaPixels,
            }
          : null,
        jpegOriginMedia: response.ir.media.find((media) => ['jpeg', 'jpg'].includes(media.sourceFormat))
          ? {
              name: response.ir.media.find((media) => ['jpeg', 'jpg'].includes(media.sourceFormat)).name,
              sourceFormat: response.ir.media.find((media) => ['jpeg', 'jpg'].includes(media.sourceFormat)).sourceFormat,
              byteLength: response.ir.media.find((media) => ['jpeg', 'jpg'].includes(media.sourceFormat)).payload.bytes.byteLength,
            }
          : null,
        firstMedia: response.ir.media[0]
          ? {
              id: response.ir.media[0].id,
              name: response.ir.media[0].name,
              width: response.ir.media[0].width,
              height: response.ir.media[0].height,
              mimeType: response.ir.media[0].payload.mimeType,
              byteLength: response.ir.media[0].payload.bytes.byteLength,
              alpha: response.ir.media[0].payload.alpha,
            }
          : null,
        compatibility: response.ir.compatibility,
      };
    })()
  `);
  const sourceAfter = sha256(samplePath);
  const parserWindowsAfter = BrowserWindow.getAllWindows().filter(
    (candidate) => !candidate.isDestroyed() && candidate.getURL().includes('fla-parser.html'),
  ).length;
  const result = {
    issue: 251,
    slice: 'V1 Slice 1',
    passed: Boolean(response && response.ok),
    electron: process.versions.electron,
    node: process.versions.node,
    samplePath,
    sourceBefore,
    sourceAfter,
    sourceUnchanged: sourceBefore === sourceAfter,
    response,
    parserWindowsAfter,
    projectAssetMutation: 'No project was opened and no Asset/Project API was called.',
  };
  if (!result.passed) throw new Error(JSON.stringify(result));
  if (!result.sourceUnchanged) throw new Error('The real FLA sample changed during inspection');
  if (response.mediaCount !== 158 || response.placedInstanceCount !== 156 || response.libraryOnlyMediaCount !== 2) {
    throw new Error(`Unexpected real sample counts: ${JSON.stringify(response)}`);
  }
  if (response.payloadIntegrityCount !== response.mediaCount) {
    throw new Error(`Not every media identity has a valid Panda-owned PNG payload: ${JSON.stringify(response)}`);
  }
  if (!response.transparentMedia || response.transparentMedia.zeroAlphaPixels <= 0) {
    throw new Error(`Transparent media payload was not preserved: ${JSON.stringify(response)}`);
  }
  if (!response.jpegOriginMedia || response.jpegOriginMedia.byteLength <= 0) {
    throw new Error(`JPEG-origin media payload was not preserved: ${JSON.stringify(response)}`);
  }
  if (!response.firstMedia || response.firstMedia.mimeType !== 'image/png' || response.firstMedia.byteLength <= 0) {
    throw new Error(`Panda-owned encoded image payload was not returned: ${JSON.stringify(response)}`);
  }
  const cancelRequestId = crypto.randomUUID();
  await mainWindow.webContents.executeJavaScript(`(() => {
    window.__issue251Cancellation = { status: 'running', response: null };
    void window.pandaStage.fla.chooseAndInspect(${JSON.stringify(cancelRequestId)})
      .then((response) => { window.__issue251Cancellation = { status: 'done', response }; })
      .catch((error) => { window.__issue251Cancellation = { status: 'error', response: { ok: false, error: { code: 'PARSER_CRASH', message: String(error) } } }; });
    return true;
  })()`);
  let parserWindowSeen = false;
  const parserDeadline = Date.now() + 10_000;
  while (Date.now() < parserDeadline) {
    parserWindowSeen = BrowserWindow.getAllWindows().some(
      (candidate) => !candidate.isDestroyed() && candidate.getURL().includes('fla-parser.html'),
    );
    if (parserWindowSeen) break;
    await delay(25);
  }
  if (!parserWindowSeen) throw new Error('The cancellation probe did not observe the isolated parser worker');
  const cancelResponse = await mainWindow.webContents.executeJavaScript(
    `window.pandaStage.fla.cancel(${JSON.stringify(cancelRequestId)})`,
  );
  const cancellationDeadline = Date.now() + 10_000;
  let cancelledInspection = null;
  while (Date.now() < cancellationDeadline) {
    const state = await mainWindow.webContents.executeJavaScript(
      `window.__issue251Cancellation?.status === 'done' || window.__issue251Cancellation?.status === 'error' ? window.__issue251Cancellation.response : null`,
    );
    if (state) {
      cancelledInspection = state;
      break;
    }
    await delay(50);
  }
  if (!cancelledInspection) throw new Error('Cancellation response did not settle');
  await delay(FLA_CANCEL_GRACE_WAIT_MS);
  const parserWindowsAfterCancel = BrowserWindow.getAllWindows().filter(
    (candidate) => !candidate.isDestroyed() && candidate.getURL().includes('fla-parser.html'),
  ).length;
  result.cancellation = {
    parserWindowSeen,
    cancelResponse,
    cancelledInspection,
    parserWindowsAfterCancel,
  };
  if (
    !cancelResponse.accepted ||
    cancelledInspection.ok ||
    cancelledInspection.error?.code !== 'USER_CANCELLED' ||
    parserWindowsAfterCancel !== 0
  ) {
    throw new Error(`Cancellation cleanup failed: ${JSON.stringify(result.cancellation)}`);
  }
  fs.mkdirSync(evidenceRoot, { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));
}

const FLA_CANCEL_GRACE_WAIT_MS = 2_500;

app.on('window-all-closed', () => {});

app.whenReady()
  .then(run)
  .then(() => {
    setTimeout(() => app.exit(0), 300);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    setTimeout(() => app.exit(1), 300);
  });

#!/usr/bin/env node
/**
 * Issue #309 minimum corrective acceptance.
 *
 * Runs the real Windows Electron product path against one approved recovered
 * FLA, discovers the V2-R catalog twice, selects a real target with at least
 * two frames, and invokes the production R2 frame-sequence API for frames 0
 * and 1. Private FLA bytes and rendered PNGs never enter the receipt.
 */

'use strict';

const { app, BrowserWindow } = require('electron');
const { createHash, randomUUID } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--source') args.source = argv[++index];
    else if (argv[index] === '--out') args.out = argv[++index];
    else if (argv[index] === '--user-data') args.userData = argv[++index];
  }
  return args;
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function waitForMainWindow() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const mainWindow = BrowserWindow.getAllWindows().find(
      (candidate) => !candidate.isDestroyed() && candidate.getTitle() === 'Panda Stage',
    );
    if (mainWindow) {
      try {
        const ready = await mainWindow.webContents.executeJavaScript(
          'Boolean(window.pandaStage?.fla?.chooseAndInspect && window.pandaStage?.fla?.staticSnapshotCatalog && window.pandaStage?.fla?.frameSequenceRender && window.pandaStage?.fla?.frameSequenceProgressSubscribe)',
        );
        if (ready) return mainWindow;
      } catch {
        // The production renderer may still be loading.
      }
    }
    await delay(100);
  }
  throw new Error('Panda Stage main window did not expose the Issue #309 R2 APIs');
}

async function runCorrectivePath() {
  const mainWindow = await waitForMainWindow();
  return mainWindow.webContents.executeJavaScript(`
    (async () => {
      const inspection = await window.pandaStage.fla.chooseAndInspect(${JSON.stringify(randomUUID())});
      if (!inspection.ok) {
        return {
          ok: false,
          stage: 'inspection',
          error: inspection.error,
          trace: inspection.trace,
          projectMutation: 'NONE',
        };
      }
      if (inspection.ir.media.length !== 0) {
        const release = await window.pandaStage.fla.cancel(inspection.sessionId);
        return {
          ok: false,
          stage: 'route',
          reason: 'approved source did not route to the zero-raster V2-R path',
          mediaCount: inspection.ir.media.length,
          releaseAccepted: release.accepted,
          projectMutation: 'NONE',
        };
      }

      const catalog1 = await window.pandaStage.fla.staticSnapshotCatalog({
        format: 'fla-static-snapshot-catalog',
        version: 1,
        sessionId: inspection.sessionId,
      });
      const catalog2 = await window.pandaStage.fla.staticSnapshotCatalog({
        format: 'fla-static-snapshot-catalog',
        version: 1,
        sessionId: inspection.sessionId,
      });
      if (!catalog1.ok || !catalog2.ok) {
        await window.pandaStage.fla.staticSnapshotCancel({
          format: 'fla-static-snapshot-cancel',
          version: 1,
          sessionId: inspection.sessionId,
        });
        const release = await window.pandaStage.fla.cancel(inspection.sessionId);
        return {
          ok: false,
          stage: 'catalog',
          catalog1: catalog1.ok ? { ok: true } : { ok: false, error: catalog1.error },
          catalog2: catalog2.ok ? { ok: true } : { ok: false, error: catalog2.error },
          releaseAccepted: release.accepted,
          projectMutation: 'NONE',
        };
      }

      const targetIndex = catalog1.entries.findIndex(
        (entry) => entry.previewSupported && entry.target.frameCount >= 2,
      );
      const stableIds = catalog1.entries.length === catalog2.entries.length &&
        catalog1.entries.every((entry, index) =>
          entry.target.renderTargetId === catalog2.entries[index]?.target.renderTargetId,
        );
      const target = targetIndex >= 0 ? catalog1.entries[targetIndex].target : null;
      if (!target) {
        await window.pandaStage.fla.staticSnapshotCancel({
          format: 'fla-static-snapshot-cancel',
          version: 1,
          sessionId: inspection.sessionId,
        });
        const release = await window.pandaStage.fla.cancel(inspection.sessionId);
        return {
          ok: false,
          stage: 'target-selection',
          catalogTargetCount: catalog1.entries.length,
          stableIds,
          releaseAccepted: release.accepted,
          projectMutation: 'NONE',
        };
      }

      const requestId = crypto.randomUUID();
      const progressEvents = [];
      const unsubscribe = window.pandaStage.fla.frameSequenceProgressSubscribe((progress) => {
        if (progress.requestId === requestId) {
          progressEvents.push({
            completedFrameCount: progress.completedFrameCount,
            totalFrameCount: progress.totalFrameCount,
          });
        }
      });
      let sequenceResponse;
      try {
        sequenceResponse = await window.pandaStage.fla.frameSequenceRender({
          format: 'fla-frame-sequence-render',
          version: 1,
          requestId,
          sessionId: inspection.sessionId,
          range: { renderTargetId: target.renderTargetId, startFrameIndex: 0, endFrameIndex: 1 },
        });
      } finally {
        unsubscribe();
      }

      const errorMessage = sequenceResponse.ok ? '' : sequenceResponse.error.message;
      const itemFrameIndices = sequenceResponse.ok
        ? sequenceResponse.items.map((item) => item.frameIndex)
        : [];
      const firstFrameProcessed = itemFrameIndices.includes(0) ||
        progressEvents.some((event) => event.completedFrameCount >= 1);
      const noTargetNotFoundError = !/target not found in session/iu.test(errorMessage);
      const progressBegan = progressEvents.some((event) => event.completedFrameCount >= 1);

      await window.pandaStage.fla.staticSnapshotCancel({
        format: 'fla-static-snapshot-cancel',
        version: 1,
        sessionId: inspection.sessionId,
      });
      const release = await window.pandaStage.fla.cancel(inspection.sessionId);
      return {
        ok: sequenceResponse.ok && stableIds && noTargetNotFoundError &&
          itemFrameIndices.length === 2 &&
          itemFrameIndices[0] === 0 && itemFrameIndices[1] === 1 &&
          firstFrameProcessed,
        stage: 'completed',
        sessionId: inspection.sessionId,
        recoveryApplied: inspection.trace?.recoveryApplied ?? false,
        mediaCount: inspection.ir.media.length,
        catalogTargetCount: catalog1.entries.length,
        catalogStableAcrossRebuild: stableIds,
        selectedTargetKind: target.kind,
        selectedTargetFrameCount: target.frameCount,
        selectedRange: { startFrameIndex: 0, endFrameIndex: 1 },
        expectedFrameCount: 2,
        sequenceOk: sequenceResponse.ok,
        renderedFrameIndices: itemFrameIndices,
        progressBegan,
        progressEventCount: progressEvents.length,
        firstFrameProcessed,
        targetNotFoundError: !noTargetNotFoundError,
        sequenceError: sequenceResponse.ok ? undefined : sequenceResponse.error,
        releaseAccepted: release.accepted,
        projectMutation: 'NONE: inspection/catalog/sequence render only; no commit API called',
      };
    })()
  `);
}

async function main() {
  const args = parseArgs(process.argv.slice(1));
  if (!args.source || !args.out) {
    throw new Error('Usage: electron scripts/fla-v2-r2-stable-target-identity-electron-acceptance.cjs --source "D:\\approved\\sample.fla" --out "D:\\receipt.json" --user-data "D:\\userdata"');
  }
  const sourcePath = resolve(args.source);
  const outPath = resolve(args.out);
  const userData = resolve(args.userData || `${outPath}.user-data`);
  if (!existsSync(sourcePath)) throw new Error(`FLA source is missing: ${sourcePath}`);
  mkdirSync(userData, { recursive: true });
  mkdirSync(resolve(outPath, '..'), { recursive: true });
  app.setPath('userData', userData);
  process.env.VITE_DEV_SERVER_URL = '';
  process.env.PANDA_STAGE_FLA_ACCEPTANCE_SOURCE = sourcePath;
  require('../dist-electron/main/index.js');

  const sourceSha256Before = sha256(sourcePath);
  const response = await runCorrectivePath();
  const sourceSha256After = sha256(sourcePath);
  const receipt = {
    schemaVersion: 'fla-v2-r2-stable-target-identity-electron-acceptance/1',
    source: {
      basename: sourcePath.split(/[\\/]/u).pop(),
      sha256Before: sourceSha256Before,
      sha256After: sourceSha256After,
      hashInvariant: sourceSha256Before === sourceSha256After,
    },
    parserPath: 'real Windows Electron Main -> C3/C4 inspection -> V2-R catalog -> R2 frame-sequence IPC -> sandboxed rasterizer',
    privateVisualBytesRecorded: false,
    response,
  };
  writeFileSync(outPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  if (!receipt.source.hashInvariant || !response?.ok) process.exitCode = 1;
}

app.on('window-all-closed', () => {});
app.whenReady()
  .then(main)
  .then(() => setTimeout(() => app.exit(process.exitCode || 0), 300))
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    setTimeout(() => app.exit(1), 300);
  });

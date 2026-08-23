#!/usr/bin/env node
/**
 * One-source real Windows/Electron C4 routing probe.
 *
 * The probe uses the production inspection preload API and, only for a
 * successful zero-raster inspection, the production V2-R catalog API. It
 * records bounded metadata, then backs out without calling any commit API.
 */

'use strict';

const { app, BrowserWindow } = require('electron');
const { createHash, randomUUID } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--source') {
      args.source = argv[index + 1];
      index += 1;
    } else if (value === '--original-sha256') {
      args.originalSha256 = argv[index + 1];
      index += 1;
    } else if (value === '--user-data') {
      args.userData = argv[index + 1];
      index += 1;
    }
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
          'Boolean(window.pandaStage?.fla?.chooseAndInspect && window.pandaStage?.fla?.staticSnapshotCatalog)',
        );
        if (ready) return mainWindow;
      } catch {
        // The main renderer may still be loading.
      }
    }
    await delay(100);
  }
  throw new Error('Panda Stage main window did not expose the C4 product APIs');
}

async function inspectAndRoute() {
  const mainWindow = await waitForMainWindow();
  return mainWindow.webContents.executeJavaScript(`
    (async () => {
      const response = await window.pandaStage.fla.chooseAndInspect(${JSON.stringify(randomUUID())});
      if (!response.ok) {
        return {
          ok: false,
          route: 'blocked',
          error: response.error,
          diagnostics: response.diagnostics,
          trace: response.trace,
          projectMutation: 'NONE',
        };
      }
      const route = response.ir.media.length > 0
        ? 'v1-raster-review'
        : 'v2r-target-discovery';
      let catalog = null;
      if (route === 'v2r-target-discovery') {
        const catalogResponse = await window.pandaStage.fla.staticSnapshotCatalog({
          format: 'fla-static-snapshot-catalog',
          version: 1,
          sessionId: response.sessionId,
        });
        catalog = catalogResponse.ok
          ? {
              ok: true,
              targetCount: catalogResponse.entries.length,
              targets: catalogResponse.entries.map((entry) => ({
                kind: entry.target.kind,
                frameCount: entry.target.frameCount,
                previewSupported: entry.previewSupported,
                compatibility: entry.target.compatibility,
                unsupportedReason: entry.unsupportedReason,
              })),
            }
          : { ok: false, error: catalogResponse.error };
        await window.pandaStage.fla.staticSnapshotCancel({
          format: 'fla-static-snapshot-cancel',
          version: 1,
          sessionId: response.sessionId,
        });
      }
      const release = await window.pandaStage.fla.cancel(response.sessionId);
      return {
        ok: true,
        sessionId: response.sessionId,
        route,
        source: response.ir.source,
        mediaCount: response.ir.media.length,
        structuralFrameCount: response.ir.structure?.documentFrameCount ?? null,
        trace: response.trace,
        catalog,
        releaseAccepted: release.accepted,
        projectMutation: 'NONE: inspection/catalog/back-out only; no commit API called',
      };
    })()
  `);
}

async function main() {
  const args = parseArgs(process.argv.slice(1));
  if (!args.source) throw new Error('--source is required');
  const sourcePath = resolve(args.source);
  if (!existsSync(sourcePath)) throw new Error(`FLA source is missing: ${sourcePath}`);
  const userData = resolve(args.userData || `${sourcePath}.c4-electron-user-data`);
  mkdirSync(userData, { recursive: true });
  app.setPath('userData', userData);
  process.env.VITE_DEV_SERVER_URL = '';
  process.env.PANDA_STAGE_FLA_ACCEPTANCE_SOURCE = sourcePath;
  require('../dist-electron/main/index.js');

  const sourceSha256Before = sha256(sourcePath);
  const response = await inspectAndRoute();
  const sourceSha256After = sha256(sourcePath);
  const result = {
    originalSha256: String(args.originalSha256 || sourceSha256Before).toLowerCase(),
    sourceSha256Before,
    sourceSha256After,
    sourceHashInvariance: sourceSha256Before === sourceSha256After ? 'PASS' : 'FAIL',
    sourceBasename: sourcePath.split(/[\\/]/u).pop(),
    parserPath: 'real Electron Main -> C3 strict/recovery -> isolated parser -> C4 content route -> existing V1 or V2-R catalog',
    response,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.sourceHashInvariance !== 'PASS' || !response?.ok) process.exitCode = 1;
}

app.on('window-all-closed', () => {});
app.whenReady()
  .then(main)
  .then(() => setTimeout(() => app.exit(process.exitCode || 0), 300))
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    setTimeout(() => app.exit(1), 300);
  });

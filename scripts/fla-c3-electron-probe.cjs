#!/usr/bin/env node
/**
 * One-source real Windows/Electron C3 inspection probe.
 *
 * It calls the same Panda-owned preload API used by the FLA inspection UI,
 * reports bounded metadata only, and never commits a Project or serializes
 * FLA/media bytes.
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
    } else if (value === '--help' || value === '-h') {
      args.help = true;
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
          'Boolean(window.pandaStage && window.pandaStage.fla && window.pandaStage.fla.chooseAndInspect)',
        );
        if (ready) return mainWindow;
      } catch {
        // The main renderer may still be loading.
      }
    }
    await delay(100);
  }
  throw new Error('Panda Stage main window did not expose the FLA inspection API');
}

async function inspectWithElectron() {
  const mainWindow = await waitForMainWindow();
  const requestId = randomUUID();
  return mainWindow.webContents.executeJavaScript(`
    (async () => {
      const response = await window.pandaStage.fla.chooseAndInspect(${JSON.stringify(requestId)});
      if (!response.ok) {
        return { ok: false, error: response.error, diagnostics: response.diagnostics, trace: response.trace };
      }
      return {
        ok: true,
        source: response.ir.source,
        document: response.ir.document,
        mediaCount: response.ir.media.length,
        placedInstanceCount: response.ir.summary.placedInstanceCount,
        libraryOnlyMediaCount: response.ir.summary.libraryOnlyMediaCount,
        structure: response.ir.structure,
        trace: response.trace,
      };
    })()
  `);
}

async function main() {
  const args = parseArgs(process.argv.slice(1));
  if (args.help || !args.source) {
    process.stderr.write(
      'Usage: electron scripts/fla-c3-electron-probe.cjs --source "<file.fla>" --user-data "<isolated-dir>"\n',
    );
    process.exit(args.help ? 0 : 2);
  }
  const sourcePath = resolve(args.source);
  if (!existsSync(sourcePath)) throw new Error(`FLA source is missing: ${sourcePath}`);
  const userData = resolve(args.userData || `${sourcePath}.electron-user-data`);
  mkdirSync(userData, { recursive: true });
  app.setPath('userData', userData);
  process.env.VITE_DEV_SERVER_URL = '';
  process.env.PANDA_STAGE_FLA_ACCEPTANCE_SOURCE = sourcePath;
  require('../dist-electron/main/index.js');
  const originalSha256 = sha256(sourcePath);
  const response = await inspectWithElectron();
  const sourceSha256After = sha256(sourcePath);
  const result = {
    originalSha256: String(args.originalSha256 || originalSha256).toLowerCase(),
    sourceSha256Before: originalSha256,
    sourceSha256After,
    sourceHashInvariance: originalSha256 === sourceSha256After ? 'PASS' : 'FAIL',
    sourceBasename: sourcePath.split(/[\\/]/u).pop(),
    parserPath: 'real Electron main -> Main recovery/preflight -> isolated sandbox FLA parser worker -> production adapter',
    projectMutation: 'none: inspection API was used; no Project or commit API was called',
    response,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.sourceHashInvariance !== 'PASS' || !response || response.ok !== true) {
    process.exitCode = 1;
  }
}

app.on('window-all-closed', () => {});
app.whenReady()
  .then(main)
  .then(() => setTimeout(() => app.exit(process.exitCode || 0), 300))
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    setTimeout(() => app.exit(1), 300);
  });

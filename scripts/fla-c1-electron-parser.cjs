#!/usr/bin/env node
/**
 * C1-only real Windows/Electron parser probe.
 *
 * The input must be a Panda/research-owned temporary copy. The script calls
 * the current production FLA inspection API, but it does not commit a Project
 * or alter the source corpus. It intentionally emits counts and bounded
 * metadata only; it never serializes FLA bytes or image payloads.
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
  return createHash('sha256').update(readFileSync(filePath)).digest('hex').toUpperCase();
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
  const expression = `
    (async () => {
      const response = await window.pandaStage.fla.chooseAndInspect(${JSON.stringify(requestId)});
      if (!response.ok) return response;
      const media = response.ir.media || [];
      const sourceFormats = { png: 0, jpg: 0, jpeg: 0, unknown: 0 };
      for (const item of media) {
        if (item.sourceFormat === 'png') sourceFormats.png += 1;
        else if (item.sourceFormat === 'jpg') sourceFormats.jpg += 1;
        else if (item.sourceFormat === 'jpeg') sourceFormats.jpeg += 1;
        else sourceFormats.unknown += 1;
      }
      return {
        ok: true,
        source: response.ir.source,
        document: response.ir.document,
        mediaCount: media.length,
        sourceFormats,
        placedInstanceCount: response.ir.summary.placedInstanceCount,
        libraryOnlyMediaCount: response.ir.summary.libraryOnlyMediaCount,
        structure: response.ir.structure,
        compatibility: response.ir.compatibility,
      };
    })()
  `;
  return mainWindow.webContents.executeJavaScript(expression);
}

async function main() {
  const args = parseArgs(process.argv.slice(1));
  if (args.help || !args.source) {
    process.stderr.write(
      'Usage: electron scripts/fla-c1-electron-parser.cjs --source "<research-copy.fla>" --original-sha256 <sha256> --user-data "<isolated-dir>"\n',
    );
    process.exit(args.help ? 0 : 2);
  }
  const sourcePath = resolve(args.source);
  if (!existsSync(sourcePath)) throw new Error(`Research copy is missing: ${sourcePath}`);
  const userData = resolve(args.userData || `${sourcePath}.electron-user-data`);
  mkdirSync(userData, { recursive: true });
  app.setPath('userData', userData);
  process.env.VITE_DEV_SERVER_URL = '';
  process.env.PANDA_STAGE_FLA_ACCEPTANCE_SOURCE = sourcePath;
  require('../dist-electron/main/index.js');
  const response = await inspectWithElectron();
  const result = {
    originalSha256: String(args.originalSha256 || '').toUpperCase(),
    compensatedCopySha256: sha256(sourcePath),
    sourceBasename: sourcePath.split(/[\\/]/).pop(),
    parserPath: 'real Electron main -> isolated sandbox FLA parser worker -> production adapter',
    projectMutation: 'none: no Project was opened and no commit API was called',
    response,
  };
  if (!response || response.ok !== true) {
    throw new Error(JSON.stringify(result));
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

app.on('window-all-closed', () => {});
app.whenReady()
  .then(main)
  .then(() => setTimeout(() => app.exit(0), 300))
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    setTimeout(() => app.exit(1), 300);
  });

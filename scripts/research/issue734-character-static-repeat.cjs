#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.resolve(__dirname, '..', '..');
const HASH = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--source') args.source = argv[++index];
    else if (argv[index] === '--expected-sha256') args.expectedSha256 = argv[++index];
    else if (argv[index] === '--render-target-id') args.renderTargetId = argv[++index];
    else if (argv[index] === '--frame-index') args.frameIndex = Number(argv[++index]);
    else if (argv[index] === '--expected-png-sha256') args.expectedPngSha256 = argv[++index];
    else if (argv[index] === '--expected-svg-sha256') args.expectedSvgSha256 = argv[++index];
    else if (argv[index] === '--out') args.out = argv[++index];
  }
  for (const name of ['source', 'expectedSha256', 'renderTargetId', 'frameIndex', 'expectedPngSha256', 'expectedSvgSha256', 'out']) assert.ok(args[name] !== undefined, `missing --${name}`);
  assert.ok(Number.isInteger(args.frameIndex) && args.frameIndex >= 0, '--frame-index must be a nonnegative integer');
  return { ...args, source: path.resolve(args.source), out: path.resolve(args.out) };
}

function assertExternalDirectory(directory) {
  const relative = path.relative(ROOT, directory);
  assert.ok(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative), 'Issue #734 repeat evidence must remain outside the repository');
  assert.ok(!fs.existsSync(directory), `refusing to overwrite existing repeat evidence: ${directory}`);
}

function writeVerified(filePath, bytes) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(bytes), { flag: 'wx' });
  const written = fs.readFileSync(filePath);
  return { path: path.basename(filePath), sha256: HASH(written), byteLength: written.length };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForMainWindow() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed() && candidate.getTitle() === 'Panda Stage');
    if (window) {
      try {
        const ready = await window.webContents.executeJavaScript('Boolean(window.pandaStage?.fla?.chooseAndInspect && window.pandaStage?.fla?.staticSnapshotCatalog && window.pandaStage?.fla?.staticSnapshotPreview)');
        if (ready) return window;
      } catch {
        // Wait for the renderer bridge to finish loading.
      }
    }
    await delay(100);
  }
  throw new Error('Panda Stage static snapshot APIs did not become ready');
}

function inspectExpression() {
  return `
    (async () => {
      const api = window.pandaStage.fla;
      const inspected = await api.chooseAndInspect(${JSON.stringify(crypto.randomUUID())});
      if (!inspected.ok) return { ok: false, error: inspected.error, trace: inspected.trace };
      const catalog = await api.staticSnapshotCatalog({ format: 'fla-static-snapshot-catalog', version: 1, sessionId: inspected.sessionId });
      if (!catalog.ok) return { ok: false, error: catalog.error, trace: inspected.trace };
      return {
        ok: true,
        sessionId: inspected.sessionId,
        source: inspected.ir.source,
        media: inspected.ir.media.map((item) => ({
          id: item.id, name: item.name, sourceReference: item.sourceReference,
          bitmapDataReference: item.bitmapDataReference, width: item.width, height: item.height,
          payload: { bytes: Array.from(item.payload.bytes) },
        })),
        trace: inspected.trace,
        catalog: catalog.entries,
      };
    })()
  `;
}

async function run(args) {
  assertExternalDirectory(args.out);
  fs.mkdirSync(args.out, { recursive: false });
  const sourceBytes = fs.readFileSync(args.source);
  const sourceSha256Before = HASH(sourceBytes);
  assert.equal(sourceSha256Before, args.expectedSha256.toLowerCase(), 'source differs from frozen corpus hash');
  const classifier = require(path.join(ROOT, 'dist-electron/main/services/fla-recovery-classifier.js'));
  const classification = classifier.classifyForFlaRecovery(sourceBytes);
  let normalizedBytes = sourceBytes;
  if (classification.state === 'RECOVERY_CANDIDATE') {
    const normalized = classifier.normalizeRecoveryCandidate(sourceBytes, classification);
    assert.equal(normalized.applied, true);
    assert.equal(normalized.originalBytesWritten, false);
    normalizedBytes = Buffer.from(normalized.bytes);
  } else {
    assert.equal(classification.state, 'STRICT_VALID', `source classifier failed closed: ${classification.state}`);
  }
  process.env.VITE_DEV_SERVER_URL = '';
  process.env.PANDA_STAGE_FLA_ACCEPTANCE_SOURCE = args.source;
  fs.mkdirSync(path.join(args.out, 'electron-user-data'), { recursive: true });
  app.setPath('userData', path.join(args.out, 'electron-user-data'));
  require(path.join(ROOT, 'dist-electron/main/index.js'));
  const mainWindow = await waitForMainWindow();
  const inspected = await mainWindow.webContents.executeJavaScript(inspectExpression(), true);
  assert.ok(inspected?.ok, `production inspection/catalog failed: ${JSON.stringify(inspected)}`);
  assert.equal(inspected.trace?.originalSourceSha256, sourceSha256Before, 'Main trace source hash differs');
  assert.equal(inspected.source.sha256, HASH(normalizedBytes), 'production parser inspected unexpected normalized bytes');
  const entry = inspected.catalog.find((item) => item.target.renderTargetId === args.renderTargetId);
  assert.ok(entry, 'selected candidate is no longer exposed by the production catalog');
  assert.equal(entry.previewSupported, true, 'selected candidate is not preview-supported');
  assert.ok(args.frameIndex < entry.target.frameCount, 'selected authored frame is outside the target frame count');
  const target = { ...entry.target, selectedFrameIndex: args.frameIndex };
  const response = await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const response = await window.pandaStage.fla.staticSnapshotPreview({
        format: 'fla-static-snapshot-preview', version: 1,
        requestId: ${JSON.stringify(crypto.randomUUID())},
        sessionId: ${JSON.stringify(inspected.sessionId)},
        target: ${JSON.stringify(target)},
      });
      if (!response.ok) return { ok: false, error: response.error };
      return {
        ok: true,
        targetRenderTargetId: response.targetRenderTargetId,
        targetSelectedFrameIndex: response.targetSelectedFrameIndex,
        width: response.width,
        height: response.height,
        sha256: response.sha256,
        wallClockMs: response.wallClockMs,
        bytes: Array.from(response.bytes),
      };
    })()
  `, true);
  assert.ok(response?.ok, `production static snapshot repeat failed: ${JSON.stringify(response)}`);
  assert.equal(response.targetRenderTargetId, args.renderTargetId);
  assert.equal(response.targetSelectedFrameIndex, args.frameIndex);
  const png = writeVerified(path.join(args.out, 'repeat.png'), Buffer.from(response.bytes));
  assert.equal(png.sha256, response.sha256, 'repeat PNG hash differs from preview response hash');
  const { buildSvgForRenderTarget } = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-svg-builder.js'));
  const { createFlaStaticSnapshotBitmapMediaLookup } = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-media-resolver.js'));
  const media = inspected.media.map((item) => ({ ...item, payload: { bytes: Uint8Array.from(item.payload.bytes) } }));
  const svgResult = await buildSvgForRenderTarget(normalizedBytes, target, createFlaStaticSnapshotBitmapMediaLookup(media));
  assert.ok(svgResult.ok, `production SVG repeat failed: ${JSON.stringify(svgResult)}`);
  const svg = writeVerified(path.join(args.out, 'repeat.svg'), Buffer.from(svgResult.svg, 'utf8'));
  const sourceSha256After = HASH(fs.readFileSync(args.source));
  assert.equal(sourceSha256After, sourceSha256Before, 'source changed during repeat probe');
  const receipt = {
    schemaVersion: 'issue734-character-static-repeat/1',
    source: { basename: path.basename(args.source), sha256Before: sourceSha256Before, sha256After: sourceSha256After, unchanged: true },
    candidate: { renderTargetId: args.renderTargetId, selectedFrameIndex: args.frameIndex, userLabel: entry.target.userLabel },
    expected: { pngSha256: args.expectedPngSha256, svgSha256: args.expectedSvgSha256 },
    repeat: {
      pngSha256: png.sha256,
      svgSha256: svg.sha256,
      pngMatches: png.sha256 === args.expectedPngSha256.toLowerCase(),
      svgMatches: svg.sha256 === args.expectedSvgSha256.toLowerCase(),
      width: response.width,
      height: response.height,
      wallClockMs: response.wallClockMs,
      composition: svgResult.composition,
    },
    artifacts: { png, svg },
    projectMutation: 'NONE: inspect/catalog/staticSnapshotPreview/cancel only; no commit API called',
    evidenceDirectory: args.out,
  };
  fs.writeFileSync(path.join(args.out, 'repeat-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  await mainWindow.webContents.executeJavaScript(`window.pandaStage.fla.staticSnapshotCancel({ format: 'fla-static-snapshot-cancel', version: 1, sessionId: ${JSON.stringify(inspected.sessionId)} })`, true).catch(() => {});
  await mainWindow.webContents.executeJavaScript(`window.pandaStage.fla.cancel(${JSON.stringify(inspected.sessionId)})`, true).catch(() => {});
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

app.on('window-all-closed', () => {});
const args = parseArgs(process.argv.slice(1));
run(args)
  .then(() => setTimeout(() => app.exit(0), 300))
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    app.exit(1);
  });

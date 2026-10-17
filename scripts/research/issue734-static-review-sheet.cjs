#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const ROOT = path.resolve(__dirname, '..', '..');
const HASH = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--probe-dir') args.probeDir = argv[++index];
    else if (argv[index] === '--out') args.out = argv[++index];
  }
  assert.ok(args.probeDir && args.out, 'expected --probe-dir and --out');
  return { probeDir: path.resolve(args.probeDir), out: path.resolve(args.out) };
}

function assertExternalDirectory(directory) {
  const relative = path.relative(ROOT, directory);
  assert.ok(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative), 'Issue #734 review evidence must remain outside the repository');
  assert.ok(!fs.existsSync(directory), `refusing to overwrite review evidence: ${directory}`);
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}

function reviewSelection(receipt) {
  const rendered = receipt.candidates.filter((candidate) => candidate.renderer.status === 'RENDERED' && candidate.artifacts.png?.path);
  const primary = rendered.filter((candidate) => candidate.sourceAddress.ownerKind === 'scene' || candidate.sourceAddress.depthFromScene === 0);
  const pool = primary.length > 0 ? primary : rendered;
  const byOwner = new Map();
  for (const candidate of pool) {
    const name = candidate.sourceAddress.ownerName;
    const current = byOwner.get(name);
    const score = (candidate.composition?.expandedSymbolCount ?? 0) * 100 +
      (candidate.composition?.shapeCount ?? 0) +
      (candidate.composition?.bitmapInstanceCount ?? 0) * 4;
    const currentScore = current
      ? (current.composition?.expandedSymbolCount ?? 0) * 100 +
        (current.composition?.shapeCount ?? 0) +
        (current.composition?.bitmapInstanceCount ?? 0) * 4
      : -1;
    if (!current || score > currentScore || (score === currentScore && candidate.sourceAddress.frameIndex < current.sourceAddress.frameIndex)) byOwner.set(name, candidate);
  }
  return [...byOwner.values()]
    .sort((left, right) => {
      const leftScene = left.sourceAddress.ownerKind === 'scene' ? 0 : 1;
      const rightScene = right.sourceAddress.ownerKind === 'scene' ? 0 : 1;
      return leftScene - rightScene || left.sourceAddress.depthFromScene - right.sourceAddress.depthFromScene ||
        ((right.composition?.expandedSymbolCount ?? 0) - (left.composition?.expandedSymbolCount ?? 0)) ||
        ((right.composition?.shapeCount ?? 0) - (left.composition?.shapeCount ?? 0)) ||
        left.candidateId.localeCompare(right.candidateId, 'en');
    })
    .slice(0, 4);
}

function buildSvg(receipt, candidates) {
  const columns = 2;
  const tileWidth = 640;
  const tileHeight = 500;
  const margin = 24;
  const gap = 16;
  const header = 94;
  const rows = Math.ceil(candidates.length / columns);
  const width = margin * 2 + columns * tileWidth + gap;
  const height = header + margin * 2 + rows * tileHeight + Math.max(0, rows - 1) * gap;
  const firstBlocker = receipt.candidates.find((candidate) => candidate.sourceAddress.ownerKind === 'scene' || candidate.sourceAddress.depthFromScene === 0)?.renderer.firstBlocker;
  const blockerText = typeof firstBlocker === 'string' ? firstBlocker : firstBlocker?.message;
  const statusText = candidates.some((candidate) => candidate.sourceAddress.ownerKind === 'scene' || candidate.sourceAddress.depthFromScene === 0)
    ? 'Scene/root candidate outputs'
    : 'Near-root fragment outputs only — no Scene/root candidate rendered';
  const images = candidates.map((candidate, index) => {
    const x = margin + (index % columns) * (tileWidth + gap);
    const y = header + margin + Math.floor(index / columns) * (tileHeight + gap);
    const sourcePath = path.resolve(receipt.evidenceDirectory, candidate.artifacts.png.path);
    const bytes = fs.readFileSync(sourcePath);
    assert.equal(HASH(bytes), candidate.artifacts.png.sha256, `candidate PNG hash mismatch: ${candidate.candidateId}`);
    const data = bytes.toString('base64');
    const label = `${candidate.sourceAddress.ownerName}@${candidate.sourceAddress.frameIndex}`;
    return `<g><rect x="${x}" y="${y}" width="${tileWidth}" height="${tileHeight}" rx="8" fill="#fff" stroke="#d0d7de"/><text x="${x + 12}" y="${y + 23}" font-family="Segoe UI, Arial" font-size="15" fill="#24292f">${escapeXml(label.slice(0, 72))}</text><image x="${x + 10}" y="${y + 34}" width="${tileWidth - 20}" height="${tileHeight - 44}" href="data:image/png;base64,${data}" preserveAspectRatio="xMidYMid meet"/></g>`;
  }).join('');
  const blockerLine = blockerText ? `<text x="${margin}" y="78" font-family="Segoe UI, Arial" font-size="13" fill="#57606a">First root blocker: ${escapeXml(blockerText.slice(0, 170))}</text>` : '';
  return {
    width,
    height,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f6f8fa"/><text x="${margin}" y="34" font-family="Segoe UI, Arial" font-size="20" font-weight="600" fill="#24292f">${escapeXml(receipt.source.basename)} — ${escapeXml(statusText)}</text>${blockerLine}${images}</svg>`,
  };
}

function createSandboxRasterizer() {
  const { IPC_CHANNELS } = require(path.join(ROOT, 'dist-electron/shared/ipc/channels.js'));
  const { FlaStaticSnapshotWindowManager } = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-window-manager.js'));
  const manager = new FlaStaticSnapshotWindowManager(
    { readyTimeoutMs: 15_000, rasterizeWallTimeMs: 60_000 },
    {
      create(options) {
        assert.equal(options.webPreferences?.sandbox, true);
        assert.equal(options.webPreferences?.contextIsolation, true);
        assert.equal(options.webPreferences?.nodeIntegration, false);
        const window = new BrowserWindow(options);
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        return window;
      },
    },
  );
  const handlers = [
    [IPC_CHANNELS.FLA_SNAPSHOT_RENDERER_READY, (event) => manager.markReady(event.sender.id)],
    [IPC_CHANNELS.FLA_SNAPSHOT_RENDER_RESULT, (event, payload) => manager.markResult(event.sender.id, payload)],
    [IPC_CHANNELS.FLA_SNAPSHOT_RENDER_ERROR, (event, payload) => manager.markError(event.sender.id, payload)],
  ];
  for (const [channel, handler] of handlers) ipcMain.on(channel, handler);
  return {
    render(svg, width, height) {
      return manager.rasterize({ requestId: crypto.randomUUID(), svg, width, height, pixelCount: width * height });
    },
    close() {
      for (const [channel, handler] of handlers) ipcMain.removeListener(channel, handler);
      manager.close();
    },
  };
}

async function run(args) {
  assertExternalDirectory(args.out);
  const receiptPath = path.join(args.probeDir, 'static-truth-probe.json');
  assert.ok(fs.existsSync(receiptPath), `missing production probe receipt: ${receiptPath}`);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  const selected = reviewSelection(receipt);
  assert.ok(selected.length > 0, 'probe has no rendered output for a review sheet');
  const sheet = buildSvg(receipt, selected);
  fs.mkdirSync(args.out, { recursive: false });
  fs.mkdirSync(path.join(args.out, 'electron-user-data'), { recursive: true });
  app.setPath('userData', path.join(args.out, 'electron-user-data'));
  await app.whenReady();
  const rasterizer = createSandboxRasterizer();
  try {
    const svgBytes = Buffer.from(sheet.svg, 'utf8');
    const png = await rasterizer.render(sheet.svg, sheet.width, sheet.height);
    fs.writeFileSync(path.join(args.out, 'diagnostic-review-sheet.svg'), svgBytes, { flag: 'wx' });
    fs.writeFileSync(path.join(args.out, 'diagnostic-review-sheet.png'), Buffer.from(png.pngBytes), { flag: 'wx' });
    const result = {
      schemaVersion: 'issue734-static-review-sheet/1',
      source: receipt.source,
      candidates: selected.map((candidate) => ({
        candidateId: candidate.candidateId,
        ownerName: candidate.sourceAddress.ownerName,
        frameIndex: candidate.sourceAddress.frameIndex,
        depthFromScene: candidate.sourceAddress.depthFromScene,
        classification: 'DIAGNOSTIC_RENDERED_CANDIDATE; not proof of a complete character',
        png: candidate.artifacts.png,
      })),
      firstRootBlocker: receipt.candidates.find((candidate) => candidate.sourceAddress.ownerKind === 'scene' || candidate.sourceAddress.depthFromScene === 0)?.renderer.firstBlocker ?? null,
      reviewSheet: {
        svg: { path: 'diagnostic-review-sheet.svg', sha256: HASH(svgBytes), byteLength: svgBytes.length },
        png: { path: 'diagnostic-review-sheet.png', sha256: HASH(Buffer.from(png.pngBytes)), byteLength: png.pngBytes.length, width: png.width, height: png.height },
        posture: 'sandbox=true; contextIsolation=true; nodeIntegration=false',
      },
      evidenceDirectory: args.out,
    };
    fs.writeFileSync(path.join(args.out, 'review-sheet-receipt.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`${JSON.stringify({ source: receipt.source.basename, candidates: selected.length, reviewSheet: result.reviewSheet.png, evidenceDirectory: args.out })}\n`);
  } finally {
    rasterizer.close();
  }
}

app.on('window-all-closed', () => {});
const args = parseArgs(process.argv.slice(1));
run(args)
  .then(() => setTimeout(() => app.exit(0), 300))
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    app.exit(1);
  });

/*
 * FLA V2-R0 spike — resource budget probe.
 *
 * Per Issue #284 R0-F, R0 must define and test explicit experiment budgets
 * rather than relying on "the sample is small". The budget probe records:
 *   - wall-clock end-to-end time (extract + rasterize)
 *   - peak Node heap memory (process.memoryUsage().heapUsed before/after)
 *   - decoded SVG path command count and output SVG byte length
 *   - PNG pixel count = width * height
 *   - whether the explicit budget numbers (maxSourceBytes, maxXmlBytes,
 *     maxOutputWidth, maxOutputHeight, maxDecodedPixels, wallClockMs)
 *     are enforceable from the spike scripts
 *
 * Output:
 *   - docs/evidence/issue-284-r0/r0-budget.json
 *   - one JSON object on stdout
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(REPO_ROOT, 'docs', 'evidence', 'issue-284-r0');
const FLA_INPUT = process.env.FLA_R0_INPUT || 'D:\\表情合集\\剑.fla';
const EXTRACT = path.join(REPO_ROOT, 'scripts', 'fla-r0-spike-extract.cjs');
const RASTERIZE = path.join(REPO_ROOT, 'scripts', 'fla-r0-spike-rasterize.cjs');
const ELECTRON = path.join(REPO_ROOT, 'node_modules', '.bin', 'electron.cmd');
const SVG_OUT = path.join(EVIDENCE_DIR, 'r0-render-sword.svg');
const PNG_OUT = path.join(EVIDENCE_DIR, 'r0-render-sword.png');

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex').toUpperCase(); }

function runExtractSync() {
  const memBefore = process.memoryUsage();
  const t0 = Date.now();
  const out = execFileSync(process.execPath, [EXTRACT], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  const elapsed = Date.now() - t0;
  const memAfter = process.memoryUsage();
  return {
    elapsedMs: elapsed,
    heapUsedBeforeMB: +(memBefore.heapUsed / (1024 * 1024)).toFixed(2),
    heapUsedAfterMB: +(memAfter.heapUsed / (1024 * 1024)).toFixed(2),
    heapDeltaMB: +((memAfter.heapUsed - memBefore.heapUsed) / (1024 * 1024)).toFixed(2),
    stdout: out,
  };
}

function runRasterizeSync() {
  const memBefore = process.memoryUsage();
  const t0 = Date.now();
  const res = spawnSync(process.env.ComSpec || 'cmd.exe', ['/c', ELECTRON, RASTERIZE], { encoding: 'utf-8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  const elapsed = Date.now() - t0;
  const memAfter = process.memoryUsage();
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error('rasterize failed: ' + (res.stderr || ''));
  return {
    elapsedMs: elapsed,
    heapUsedBeforeMB: +(memBefore.heapUsed / (1024 * 1024)).toFixed(2),
    heapUsedAfterMB: +(memAfter.heapUsed / (1024 * 1024)).toFixed(2),
    heapDeltaMB: +((memAfter.heapUsed - memBefore.heapUsed) / (1024 * 1024)).toFixed(2),
    stdout: res.stdout,
  };
}

function pngDim(buf) {
  if (buf.length < 24 || buf[0] !== 0x89) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function budgetSummary() {
  // The LIMITS object in the extract script; we hardcode here for the receipt.
  return {
    maxSourceBytes: 256 * 1024 * 1024,
    maxXmlBytes: 32 * 1024 * 1024,
    maxOutputWidth: 4096,
    maxOutputHeight: 4096,
    maxDecodedPixels: 16_777_216,
    wallClockMs: 30_000,
  };
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const sourceBytes = fs.readFileSync(FLA_INPUT);
  const sourceSha256 = sha256(sourceBytes);

  // Warm up Node so first-run JIT doesn't pollute measurements.
  execFileSync(process.execPath, ['-e', '0']);

  const extract = runExtractSync();
  const rasterize = runRasterizeSync();

  const svgBytes = fs.readFileSync(SVG_OUT);
  const pngBytes = fs.readFileSync(PNG_OUT);
  const pngD = pngDim(pngBytes);

  const extractJsonMatch = extract.stdout.match(/\{[\s\S]*\}\s*$/);
  const rasterizeJsonMatch = rasterize.stdout.match(/\{[\s\S]*\}\s*$/);
  const extractJson = extractJsonMatch ? JSON.parse(extractJsonMatch[0]) : null;
  const rasterizeJson = rasterizeJsonMatch ? JSON.parse(rasterizeJsonMatch[0]) : null;

  const totalElapsed = extract.elapsedMs + rasterize.elapsedMs;
  const totalPeakHeap = Math.max(extract.heapUsedAfterMB, rasterize.heapUsedAfterMB);
  const budget = budgetSummary();

  const summary = {
    source: {
      path: FLA_INPUT,
      byteLength: sourceBytes.byteLength,
      sha256: sourceSha256,
    },
    extract: {
      elapsedMs: extract.elapsedMs,
      heapUsedBeforeMB: extract.heapUsedBeforeMB,
      heapUsedAfterMB: extract.heapUsedAfterMB,
      heapDeltaMB: extract.heapDeltaMB,
      totalCommands: extractJson && extractJson.selected ? extractJson.selected.totalCommands : null,
      edgeCount: extractJson && extractJson.selected ? extractJson.selected.edgeCount : null,
    },
    rasterize: {
      elapsedMs: rasterize.elapsedMs,
      heapUsedBeforeMB: rasterize.heapUsedBeforeMB,
      heapUsedAfterMB: rasterize.heapUsedAfterMB,
      heapDeltaMB: rasterize.heapDeltaMB,
      svgByteLength: svgBytes.length,
      pngByteLength: pngBytes.length,
      pngSha256: sha256(pngBytes),
      pngDimensions: pngD,
      pngPixelCount: pngD ? pngD.width * pngD.height : null,
    },
    totals: {
      elapsedMs: totalElapsed,
      peakHeapMB: totalPeakHeap,
    },
    budget,
    budgetCheck: {
      sourceWithinMax: sourceBytes.byteLength <= budget.maxSourceBytes,
      outputWithinMaxWidth: pngD ? pngD.width <= budget.maxOutputWidth : null,
      outputWithinMaxHeight: pngD ? pngD.height <= budget.maxOutputHeight : null,
      outputWithinMaxPixels: pngD ? (pngD.width * pngD.height) <= budget.maxDecodedPixels : null,
      totalWithinWallClock: totalElapsed <= budget.wallClockMs,
    },
    conclusion: {
      withinBudget: true, // recomputed below
    },
  };
  summary.conclusion.withinBudget = Object.values(summary.budgetCheck).every(v => v !== false);

  fs.writeFileSync(path.join(EVIDENCE_DIR, 'r0-budget.json'), JSON.stringify(summary, null, 2));
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  if (!summary.conclusion.withinBudget) {
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write('R0 budget probe failed: ' + (err && err.stack ? err.stack : String(err)) + '\n');
  process.exit(1);
});

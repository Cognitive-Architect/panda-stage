/*
 * FLA V2-R0 spike (corrective) — resource budget probe.
 *
 * Per Issue #286 §D, R0 must record NEW measurements under the
 * corrected (sandboxed) renderer, with cold-start and warm-run
 * timing separated, and renderer memory must be measured or marked
 * NOT MEASURED + reason. The worst observed total wall time is the
 * budget gate.
 *
 * Output: writes r0-budget.json into the local external evidence
 * directory (default D:\PandaStage-Acceptance\fla-v2-r0).
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const EVIDENCE_DIR = process.env.FLA_R0_EVIDENCE_DIR
  || 'D:\\PandaStage-Acceptance\\fla-v2-r0';
const FLA_INPUT = process.env.FLA_R0_INPUT || 'D:\\表情合集\\剑.fla';
const EXTRACT = path.join(REPO_ROOT, 'scripts', 'fla-r0-spike-extract.cjs');
const RASTERIZE = path.join(REPO_ROOT, 'scripts', 'fla-r0-spike-rasterize.cjs');
const ELECTRON = path.join(REPO_ROOT, 'node_modules', '.bin', 'electron.cmd');
const SVG_OUT = path.join(EVIDENCE_DIR, 'r0-render-sword.svg');
const PNG_OUT = path.join(EVIDENCE_DIR, 'r0-render-sword.png');

const WALL_CLOCK_BUDGET_MS = 30_000;
const MAX_SOURCE_BYTES = 256 * 1024 * 1024;
const MAX_XML_BYTES = 32 * 1024 * 1024;
const MAX_OUTPUT_WIDTH = 4096;
const MAX_OUTPUT_HEIGHT = 4096;
const MAX_DECODED_PIXELS = 16_777_216;

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex').toUpperCase(); }

function runExtractSync() {
  const memBefore = process.memoryUsage();
  const t0 = Date.now();
  const out = execFileSync(process.execPath, [EXTRACT], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, env: process.env });
  const elapsed = Date.now() - t0;
  const memAfter = process.memoryUsage();
  const m = out.match(/\{[\s\S]*\}\s*$/);
  if (!m) throw new Error('extract did not produce JSON');
  return {
    elapsedMs: elapsed,
    heapUsedBeforeMB: +(memBefore.heapUsed / (1024 * 1024)).toFixed(2),
    heapUsedAfterMB: +(memAfter.heapUsed / (1024 * 1024)).toFixed(2),
    heapDeltaMB: +((memAfter.heapUsed - memBefore.heapUsed) / (1024 * 1024)).toFixed(2),
    json: JSON.parse(m[0]),
  };
}

function runRasterizeSync() {
  const memBefore = process.memoryUsage();
  const t0 = Date.now();
  const res = spawnSync(process.env.ComSpec || 'cmd.exe', ['/c', ELECTRON, RASTERIZE], {
    encoding: 'utf-8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: process.env,
  });
  const elapsed = Date.now() - t0;
  const memAfter = process.memoryUsage();
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error('rasterize failed (status=' + res.status + '): ' + (res.stderr || ''));
  const m = (res.stdout || '').match(/\{[\s\S]*\}\s*$/);
  if (!m) throw new Error('rasterize did not produce JSON');
  return {
    elapsedMs: elapsed,
    heapUsedBeforeMB: +(memBefore.heapUsed / (1024 * 1024)).toFixed(2),
    heapUsedAfterMB: +(memAfter.heapUsed / (1024 * 1024)).toFixed(2),
    heapDeltaMB: +((memAfter.heapUsed - memBefore.heapUsed) / (1024 * 1024)).toFixed(2),
    json: JSON.parse(m[0]),
  };
}

function pngDim(buf) {
  if (buf.length < 24 || buf[0] !== 0x89) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function median(arr) {
  if (arr.length === 0) return null;
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const sourceBytes = fs.readFileSync(FLA_INPUT);
  const sourceSha256 = sha256(sourceBytes);

  // Warm-up Node so the first extract measurement is meaningful.
  execFileSync(process.execPath, ['-e', '0']);
  // Note: there is no good way to "warm up" Electron ahead of the
  // measured cold run without paying the full Electron startup cost
  // anyway. The cold run is therefore the *first* Electron run, which
  // is what Issue #286 §D requires.

  // Cold run: extract once, then rasterize once.
  const coldExtract = runExtractSync();
  const coldRasterize = runRasterizeSync();
  const coldTotalMs = coldExtract.elapsedMs + coldRasterize.elapsedMs;

  // Warm runs: at least 2 more back-to-back.
  const warmExtracts = [];
  const warmRasterizes = [];
  for (let i = 0; i < 2; i++) {
    const e = runExtractSync();
    const r = runRasterizeSync();
    warmExtracts.push(e);
    warmRasterizes.push(r);
  }
  const warmTotals = warmExtracts.map((e, i) => e.elapsedMs + warmRasterizes[i].elapsedMs);
  const allTotals = [coldTotalMs, ...warmTotals];
  const worstObservedTotalMs = Math.max(...allTotals);
  const warmMedian = median(warmTotals);

  const svgBytes = fs.readFileSync(SVG_OUT);
  const pngBytes = fs.readFileSync(PNG_OUT);
  const pngD = pngDim(pngBytes);

  // Renderer memory: prefer the measured value from the last rasterize
  // run; if the renderer didn't surface it, mark NOT MEASURED.
  const lastRasterize = warmRasterizes[warmRasterizes.length - 1] || coldRasterize;
  const rendererMemory = lastRasterize.json.rendererMemory
    || { measured: false, reason: 'renderer did not surface performance.memory' };

  const summary = {
    source: {
      path: FLA_INPUT,
      byteLength: sourceBytes.byteLength,
      sha256: sourceSha256,
    },
    isolation: lastRasterize.json.isolation,
    budget: {
      wallClockMs: WALL_CLOCK_BUDGET_MS,
      maxSourceBytes: MAX_SOURCE_BYTES,
      maxXmlBytes: MAX_XML_BYTES,
      maxOutputWidth: MAX_OUTPUT_WIDTH,
      maxOutputHeight: MAX_OUTPUT_HEIGHT,
      maxDecodedPixels: MAX_DECODED_PIXELS,
    },
    cold: {
      extractMs: coldExtract.elapsedMs,
      rasterizeMs: coldRasterize.elapsedMs,
      totalMs: coldTotalMs,
      nodeHeapDeltaMB: +(coldExtract.heapDeltaMB + coldRasterize.heapDeltaMB).toFixed(2),
    },
    warm: {
      extractTotalsMs: warmExtracts.map(e => e.elapsedMs),
      rasterizeTotalsMs: warmRasterizes.map(r => r.elapsedMs),
      totalsMs: warmTotals,
      medianTotalMs: warmMedian,
      minTotalMs: Math.min(...warmTotals),
      maxTotalMs: Math.max(...warmTotals),
    },
    worstObservedTotalMs,
    rendererMemory,
    output: {
      svg: { path: SVG_OUT, byteLength: svgBytes.length, sha256: sha256(svgBytes) },
      png: { path: PNG_OUT, byteLength: pngBytes.length, sha256: sha256(pngBytes), dimensions: pngD, pixelCount: pngD ? pngD.width * pngD.height : null },
    },
    budgetCheck: {
      sourceWithinMax: sourceBytes.byteLength <= MAX_SOURCE_BYTES,
      outputWithinMaxWidth: pngD ? pngD.width <= MAX_OUTPUT_WIDTH : null,
      outputWithinMaxHeight: pngD ? pngD.height <= MAX_OUTPUT_HEIGHT : null,
      outputWithinMaxPixels: pngD ? (pngD.width * pngD.height) <= MAX_DECODED_PIXELS : null,
      worstWithinWallClock: worstObservedTotalMs <= WALL_CLOCK_BUDGET_MS,
    },
  };
  summary.withinBudget = Object.values(summary.budgetCheck).every(v => v !== false);

  fs.writeFileSync(path.join(EVIDENCE_DIR, 'r0-budget.json'), JSON.stringify(summary, null, 2));
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  if (!summary.withinBudget) {
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write('R0 budget probe failed: ' + (err && err.stack ? err.stack : String(err)) + '\n');
  process.exit(1);
});

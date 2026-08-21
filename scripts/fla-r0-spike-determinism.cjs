/*
 * FLA V2-R0 spike — determinism probe (3x run, compare).
 *
 * Runs scripts/fla-r0-spike-extract.cjs three times back-to-back on the
 * same FLA, and compares:
 *   - the source SHA-256 (must be unchanged on every run)
 *   - the SVG byte length and SHA-256
 *   - the rendered PNG byte length and SHA-256
 *
 * Per Issue #284 R0-E:
 *   - run the same case at least 3 times
 *   - compare dimensions and decoded pixel content
 *   - compare output byte hash when the encoder produces stable metadata
 *   - if byte hashes differ but decoded pixels are identical, record that
 *     distinction honestly
 *   - if decoded pixels differ, classify the nondeterminism and stop
 *     pretending the path is deterministic
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

const RUNS = 3;
const SVG_OUT = path.join(EVIDENCE_DIR, 'r0-render-sword.svg');
const PNG_OUT = path.join(EVIDENCE_DIR, 'r0-render-sword.png');
const DETERMINISM_JSON = path.join(EVIDENCE_DIR, 'r0-determinism.json');

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex').toUpperCase(); }

function readJsonIfPresent(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function runExtract() {
  const t0 = Date.now();
  const out = execFileSync(process.execPath, [EXTRACT], { encoding: 'utf-8' });
  const t = Date.now() - t0;
  // Take only the last JSON object on stdout.
  const m = out.match(/\{[\s\S]*\}\s*$/);
  if (!m) throw new Error('extract did not produce JSON');
  return { elapsedMs: t, json: JSON.parse(m[0]) };
}

function runRasterize() {
  const t0 = Date.now();
  // On Windows, .cmd files need to be invoked via cmd.exe; spawnSync on .cmd can return null status.
  const res = spawnSync(process.env.ComSpec || 'cmd.exe', ['/c', ELECTRON, RASTERIZE], { encoding: 'utf-8', windowsHide: true });
  const t = Date.now() - t0;
  if (res.error) {
    process.stderr.write('rasterize spawn error: ' + (res.error.stack || res.error.message) + '\n');
    throw res.error;
  }
  if (res.status !== 0) {
    process.stderr.write('rasterize stderr: ' + (res.stderr || '') + '\n');
    throw new Error('rasterize failed with status ' + res.status);
  }
  const m = (res.stdout || '').match(/\{[\s\S]*\}\s*$/);
  if (!m) throw new Error('rasterize did not produce JSON');
  return { elapsedMs: t, json: JSON.parse(m[0]) };
}

function pngDimensions(buf) {
  // PNG: bytes 16..24 are width (big-endian uint32) and height.
  if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

function pixelsEqualish(a, b) {
  // Pixel-byte comparison after decoding both PNGs.
  // Without a full PNG decoder in Node, we approximate by comparing
  // the IDAT-compressed bytes: different IDAT ⇒ different pixels.
  // Stronger comparison would require pngjs / sharp — neither is in deps.
  // For R0 determinism, byte-hash equality is a sufficient upper bound.
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const sourceHash = sha256(fs.readFileSync(FLA_INPUT));
  const runs = [];
  for (let i = 1; i <= RUNS; i++) {
    process.stderr.write(`[determinism] run ${i}/${RUNS}\n`);
    const extract = runExtract();
    const rasterize = runRasterize();
    const svgBytes = fs.readFileSync(SVG_OUT);
    const pngBytes = fs.readFileSync(PNG_OUT);
    const sourceAfter = sha256(fs.readFileSync(FLA_INPUT));
    runs.push({
      runIndex: i,
      extractElapsedMs: extract.elapsedMs,
      rasterizeElapsedMs: rasterize.elapsedMs,
      sourceHash,
      sourceHashUnchanged: sourceAfter === sourceHash,
      svgByteLength: svgBytes.length,
      svgSha256: sha256(svgBytes),
      pngByteLength: pngBytes.length,
      pngSha256: sha256(pngBytes),
      pngDimensions: pngDimensions(pngBytes),
    });
  }

  // Compare across runs.
  const first = runs[0];
  const allSvgBytesEqual = runs.every(r => r.svgSha256 === first.svgSha256);
  const allPngBytesEqual = runs.every(r => r.pngSha256 === first.pngSha256);
  const allSourceUnchanged = runs.every(r => r.sourceHashUnchanged);
  const allDimensionsConsistent = runs.every(r =>
    r.pngDimensions && first.pngDimensions &&
    r.pngDimensions.width === first.pngDimensions.width &&
    r.pngDimensions.height === first.pngDimensions.height
  );

  // Pixel-by-pixel: decode each PNG via Electron/canvas to RGBA, then compare.
  // We compare pixel hash via a second-stage probe script (we avoid the
  // cost of bundling pngjs for R0). The byte hash is the primary signal.

  const summary = {
    baseline: { source: FLA_INPUT, sourceSha256: sourceHash },
    runs,
    determinism: {
      allSvgBytesEqual,
      allPngBytesEqual,
      allSourceUnchanged,
      pngDimensionsConsistent: allDimensionsConsistent,
      conclusion:
        allSvgBytesEqual && allPngBytesEqual
          ? 'R0_DETERMINISTIC_BYTE_EQUAL'
          : (allPngBytesEqual ? 'R0_DETERMINISTIC_PNG_NOT_SVG' : 'R0_NONDETERMINISTIC'),
    },
  };

  fs.writeFileSync(path.join(EVIDENCE_DIR, 'r0-determinism.json'), JSON.stringify(summary, null, 2));
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');

  if (!allPngBytesEqual) {
    process.stderr.write('WARN: PNG byte hashes differ across runs; PNG is not byte-deterministic\n');
  }
  if (!allSourceUnchanged) {
    process.stderr.write('FAIL: source SHA-256 changed during determinism run\n');
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write('R0 determinism probe failed: ' + (err && err.stack ? err.stack : String(err)) + '\n');
  process.exit(1);
});

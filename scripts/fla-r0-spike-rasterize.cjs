/*
 * FLA V2-R0 spike — SVG -> PNG rasterizer (Electron, isolated).
 *
 * Reads docs/evidence/issue-284-r0/r0-render-sword.svg, rasterizes to
 * 1920x1080 PNG via the Electron renderer's canvas, writes
 * docs/evidence/issue-284-r0/r0-render-sword.png, prints the result hash.
 *
 * This is a research-only tool. It uses a hidden BrowserWindow with
 * contextIsolation:false / nodeIntegration:true so the renderer can
 * run the same JS as the R0 extract script's path. The window has no
 * remote content; only data: URL with an inline <svg> is loaded.
 */

'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REPO_ROOT = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(REPO_ROOT, 'docs', 'evidence', 'issue-284-r0');
const SVG_IN = process.env.FLA_R0_SVG || path.join(EVIDENCE_DIR, 'r0-render-sword.svg');
const PNG_OUT = process.env.FLA_R0_PNG || path.join(EVIDENCE_DIR, 'r0-render-sword.png');
const EXPECTED_WIDTH = 1920;
const EXPECTED_HEIGHT = 1080;

const isolatedUserData = path.join(EVIDENCE_DIR, 'electron-user-data');
fs.mkdirSync(isolatedUserData, { recursive: true });
app.setPath('userData', isolatedUserData);

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex').toUpperCase(); }

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function rasterize() {
  const svgText = fs.readFileSync(SVG_IN, 'utf-8');
  const svgBytes = Buffer.from(svgText, 'utf-8');
  const svgHashBefore = sha256(svgBytes);

  const win = new BrowserWindow({
    show: false,
    width: EXPECTED_WIDTH + 20,
    height: EXPECTED_HEIGHT + 20,
    webPreferences: {
      offscreen: true,
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
    },
  });
  win.webContents.setFrameRate(2);

  // Load the SVG as a data: URL — no remote fetch, no file system access from the renderer beyond the inline data.
  const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svgText, 'utf-8').toString('base64');

  // We use a tiny HTML page that draws the SVG into a canvas at 1920x1080.
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent}#c{display:block}</style></head><body>
<canvas id="c" width="${EXPECTED_WIDTH}" height="${EXPECTED_HEIGHT}"></canvas>
<script>
(async () => {
  const c = document.getElementById('c');
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, c.width, c.height);
  const img = new Image();
  img.decoding = 'sync';
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('image load failed'));
    img.src = ${JSON.stringify(dataUrl)};
  });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL('image/png');
  window.__renderResult = { dataUrl, width: c.width, height: c.height };
})().catch((e) => { window.__renderError = String(e && e.stack || e); });
</script>
</body></html>`;

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  // Wait for the render to complete.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await win.webContents.executeJavaScript('JSON.stringify(window.__renderResult || null)');
    const error = await win.webContents.executeJavaScript('window.__renderError || null');
    if (error) throw new Error('renderer error: ' + error);
    if (result) {
      const parsed = JSON.parse(result);
      if (parsed && parsed.dataUrl) {
        // dataUrl: 'data:image/png;base64,XXXX'
        const base64 = parsed.dataUrl.split(',', 2)[1];
        const pngBytes = Buffer.from(base64, 'base64');
        // Verify hash invariants.
        const svgBytesAfter = fs.readFileSync(SVG_IN);
        const svgHashAfter = sha256(svgBytesAfter);
        fs.writeFileSync(PNG_OUT, pngBytes);
        const pngHash = sha256(pngBytes);

        return {
          svg: { path: SVG_IN, byteLength: svgBytes.length, sha256: svgHashBefore, sha256Unchanged: svgHashAfter === svgHashBefore },
          png: { path: PNG_OUT, byteLength: pngBytes.length, sha256: pngHash, width: parsed.width, height: parsed.height },
        };
      }
    }
    await delay(50);
  }
  throw new Error('renderer timed out without producing a result');
}

app.whenReady().then(async () => {
  try {
    const result = await rasterize();
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    // Force exit so the harness (spawn) sees a clean 0 status.
    setImmediate(() => app.exit(0));
  } catch (err) {
    process.stderr.write('R0 rasterize failed: ' + (err && err.stack ? err.stack : String(err)) + '\n');
    setImmediate(() => app.exit(1));
  }
}).catch((e) => {
  process.stderr.write('electron app error: ' + String(e) + '\n');
  setImmediate(() => app.exit(1));
});

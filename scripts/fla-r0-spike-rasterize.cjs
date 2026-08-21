/*
 * FLA V2-R0 spike (corrective) — SVG -> PNG rasterizer under the
 * Issue #284 / Issue #286 isolation model:
 *
 *   sandbox:          true
 *   contextIsolation: true
 *   nodeIntegration:  false
 *
 * Ownership:
 *   Main (this process)
 *     - reads the SVG from disk
 *     - creates a hidden BrowserWindow with the above isolation
 *     - blocks navigation, new-window, and non-data: network
 *     - injects a restrictive Content-Security-Policy
 *     - sends the SVG to the renderer via executeJavaScript
 *     - receives the PNG data URL + renderer memory measurement
 *     - writes the PNG to the evidence directory on disk
 *     - hashes everything
 *
 *   Renderer (sandbox:true / contextIsolation:true / nodeIntegration:false)
 *     - has no Node, no fs, no net
 *     - CSP forbids remote connect / script
 *     - just draws the SVG to a 1920x1080 canvas and reports
 *       performance.memory back to main
 *
 *   Preload (sandbox-compatible)
 *     - exposes contextBridge.window.r0.render() as a Promise
 *     - relays the renderer-side measurement back to main
 */

'use strict';

const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_EVIDENCE_DIR = process.env.FLA_R0_EVIDENCE_DIR
  || 'D:\\PandaStage-Acceptance\\fla-v2-r0';
const SVG_IN = process.env.FLA_R0_SVG || path.join(DEFAULT_EVIDENCE_DIR, 'r0-render-sword.svg');
const PNG_OUT = process.env.FLA_R0_PNG || path.join(DEFAULT_EVIDENCE_DIR, 'r0-render-sword.png');
const RENDERER_HTML = path.resolve(__dirname, 'fla-r0-spike-renderer.html');
const EXPECTED_WIDTH = 1920;
const EXPECTED_HEIGHT = 1080;

const isolatedUserData = path.join(DEFAULT_EVIDENCE_DIR, 'electron-user-data');
fs.mkdirSync(isolatedUserData, { recursive: true });
fs.mkdirSync(DEFAULT_EVIDENCE_DIR, { recursive: true });
app.setPath('userData', isolatedUserData);

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex').toUpperCase(); }

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function rasterize() {
  if (!fs.existsSync(SVG_IN)) {
    throw new Error(`SVG input not found: ${SVG_IN}. Run scripts/fla-r0-spike-extract.cjs first.`);
  }
  const svgText = fs.readFileSync(SVG_IN, 'utf-8');
  const svgBytes = Buffer.from(svgText, 'utf-8');
  const svgHashBefore = sha256(svgBytes);

  const win = new BrowserWindow({
    show: false,
    width: EXPECTED_WIDTH + 20,
    height: EXPECTED_HEIGHT + 20,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      preload: path.resolve(__dirname, 'fla-r0-spike-preload.cjs'),
    },
  });
  win.webContents.setFrameRate(2);

  // ==== Boundary guards (Issue #286 §A.3 Network / navigation proof) ====

  // Block all new-window / popup attempts.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Block any in-page navigation away from the renderer HTML.
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    process.stderr.write(`[R0] blocked will-navigate to ${url}\n`);
  });
  win.webContents.on('will-redirect', (event, url) => {
    event.preventDefault();
    process.stderr.write(`[R0] blocked will-redirect to ${url}\n`);
  });

  // Block any subresource network request that is not data:. The main
  // frame is loaded via a data: URL below, so this rule is purely
  // about subresources the renderer might try to fetch.
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['*://*/*', 'file://*/*'] }, (details, callback) => {
    const url = details.url;
    if (url.startsWith('data:')) {
      callback({ cancel: false });
    } else {
      process.stderr.write(`[R0] blocked network request to ${url}\n`);
      callback({ cancel: true });
    }
  });

  // Inject a restrictive CSP on every response (defence in depth alongside
  // the meta tag in the renderer HTML).
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['*://*/*', 'file://*/*', 'data:*'] }, (details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'none';",
        ],
      },
    });
  });

  // Load the renderer HTML inline as a data: URL (no file:// traversal).
  const rendererHtml = fs.readFileSync(RENDERER_HTML, 'utf-8');
  const rendererB64 = Buffer.from(rendererHtml, 'utf-8').toString('base64');
  const rendererDataUrl = 'data:text/html;charset=utf-8;base64,' + rendererB64;
  await win.loadURL(rendererDataUrl);

  // Wait for the renderer to expose window.r0RenderImpl (installed by
  // the inline script in scripts/fla-r0-spike-renderer.html).
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      const flag = await win.webContents.executeJavaScript('Boolean(window.r0RenderImpl) && typeof window.r0RenderImpl === "function"', true);
      if (flag) { ready = true; break; }
    } catch { /* retry */ }
    await delay(50);
  }
  if (!ready) throw new Error('renderer did not install window.r0RenderImpl');

  // Send the SVG to the renderer. JSON.stringify handles escaping safely.
  // We call window.r0RenderImpl (installed by the renderer HTML inline
  // script) directly, NOT through the preload's contextBridge, because
  // contextIsolation means the preload's window is a different world.
  // The main process executeJavaScript runs in the page main world,
  // where r0RenderImpl is defined.
  const deadline = Date.now() + 30_000;
  let renderResult = null;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await win.webContents.executeJavaScript(
        `(async () => {
           try {
             if (typeof window.r0RenderImpl !== 'function') {
               return JSON.stringify({ error: 'window.r0RenderImpl is not a function' });
             }
             const r = await window.r0RenderImpl(${JSON.stringify(svgText)}, ${EXPECTED_WIDTH}, ${EXPECTED_HEIGHT});
             return JSON.stringify(r);
           } catch (e) {
             return JSON.stringify({ error: String(e && e.stack || e) });
           }
         })()`,
        true
      );
      const parsed = JSON.parse(value);
      if (parsed && parsed.error) { lastError = parsed.error; await delay(50); continue; }
      if (parsed && parsed.dataUrl) { renderResult = parsed; break; }
    } catch (e) { lastError = String(e); await delay(50); }
  }
  if (!renderResult) throw new Error('renderer did not return a render result: ' + (lastError || 'timeout'));

  win.destroy();

  // Decode the data URL to bytes and write to the evidence directory.
  const base64 = renderResult.dataUrl.split(',', 2)[1];
  const pngBytes = Buffer.from(base64, 'base64');
  const svgBytesAfter = fs.readFileSync(SVG_IN);
  const svgHashAfter = sha256(svgBytesAfter);
  fs.writeFileSync(PNG_OUT, pngBytes);
  const pngHash = sha256(pngBytes);

  return {
    isolation: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      navigationBlocked: true,
      newWindowBlocked: true,
      nonDataNetworkBlocked: true,
      cspInjected: true,
    },
    svg: { path: SVG_IN, byteLength: svgBytes.length, sha256: svgHashBefore, sha256Unchanged: svgHashAfter === svgHashBefore },
    png: { path: PNG_OUT, byteLength: pngBytes.length, sha256: pngHash, width: renderResult.width, height: renderResult.height },
    rendererMemory: renderResult.memory || null,
    rendererPath: 'sandboxed-electron-browserwindow-canvas-2d',
  };
}

app.whenReady().then(async () => {
  try {
    const result = await rasterize();
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    setImmediate(() => app.exit(0));
  } catch (err) {
    process.stderr.write('R0 rasterize failed: ' + (err && err.stack ? err.stack : String(err)) + '\n');
    setImmediate(() => app.exit(1));
  }
}).catch((e) => {
  process.stderr.write('electron app error: ' + String(e) + '\n');
  setImmediate(() => app.exit(1));
});

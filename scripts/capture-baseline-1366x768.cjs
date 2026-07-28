/**
 * Phase 0A baseline screenshot capture (1366x768).
 *
 * Non-production helper added during Phase 0A. It does NOT modify any src/
 * code; it only launches Electron headlessly, loads the already-built
 * renderer, and writes a 1366x768 PNG baseline to docs/design/.
 *
 * Run (after `pnpm build`) with:
 *   env -u ELECTRON_RUN_AS_NODE electron scripts/capture-baseline-1366x768.cjs
 */
const { app, BrowserWindow } = require('electron');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');

const WIDTH = 1366;
const HEIGHT = 768;

async function captureBaseline() {
  const window = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    useContentSize: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await window.loadFile(path.join(__dirname, '../dist/renderer/index.html'));
  // Wait for fonts + two animation frames so the React tree has painted.
  await window.webContents.executeJavaScript(`
    document.fonts.ready.then(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    )
  `);
  await new Promise((resolve) => setTimeout(resolve, 250));

  // Capture whatever the headless renderer lays out, then force the exact
  // 1366x768 baseline size with Electron's built-in NativeImage.resize()
  // (no external image tooling, no src/ change). capturePage() follows the
  // page's scrollable bounds in show:false mode, so a post-capture resize
  // is the reliable way to lock the agreed baseline dimensions.
  const image = await window.webContents.capturePage();
  const resized = image.resize({ width: WIDTH, height: HEIGHT, quality: 'best' });
  const outputPath = path.join(__dirname, '../docs/design/baseline-1366x768.png');
  await writeFile(outputPath, resized.toPNG());
  console.log(`Phase 0A baseline screenshot (${WIDTH}x${HEIGHT}) written to ${outputPath}`);
  window.destroy();
}

app
  .whenReady()
  .then(captureBaseline)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

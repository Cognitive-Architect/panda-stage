/**
 * Phase 0A baseline screenshot capture (1366x768).
 *
 * Non-production helper added during Phase 0A. It does NOT modify any src/
 * code; it only launches Electron headlessly, loads the already-built
 * renderer, and writes a 1366x768 PNG baseline to docs/design/.
 *
 * WHY THIS VERSION (Phase 0A finishing patch):
 *   The previous version called `capturePage()` (which, in `show:false` mode,
 *   follows the page's full scrollable bounds) and then used
 *   `NativeImage.resize({width:1366, height:768})` to force the baseline
 *   dimensions. That `resize()` *stretches/compresses the whole painted page*
 *   into 1366x768 — it is NOT the real 1366x768 viewport. This patch instead:
 *     - enables OFFSCREEN rendering (`webPreferences.offscreen: true`) so the
 *       window has a real backing store even without a physical display;
 *     - loads the real built renderer through a preload stub
 *       (`baseline-preload-stub.cjs`) that defines `window.pandaStage` so the
 *       React app actually mounts and paints (otherwise it throws at render
 *       time and the capture is blank/black);
 *     - waits until the stable `.app-shell` root is present and painted;
 *     - captures exactly the visible 1366x768 viewport with
 *       `capturePage({x:0,y:0,width:1366,height:768})` and writes it at NATIVE
 *       size. `NativeImage.resize` is NEVER called.
 *
 * RUN (after `pnpm build`) with:
 *   env -u ELECTRON_RUN_AS_NODE electron scripts/capture-baseline-1366x768.cjs
 */
const { app, BrowserWindow } = require('electron');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');

const WIDTH = 1366;
const HEIGHT = 768;

/**
 * Configure Electron to render without a physical display. The sandbox has no
 * DISPLAY/GPU, so we disable hardware acceleration and fall back to software
 * (SwiftShader) compositing. These switches keep the offscreen window painting
 * a real 1366x768 viewport even though there is no monitor attached.
 */
function configureHeadless() {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-dev-shm-usage');
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('use-gl', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  // Force device scale factor to 1 so capturePage() returns the viewport at
  // NATIVE 1366x768 (otherwise it returns 1366x768 * deviceScaleFactor).
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
}

async function captureBaseline() {
  const window = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'baseline-preload-stub.cjs'),
    },
  });

  // On the headless Windows sandbox, `new BrowserWindow({width:1366})` can
  // create a smaller initial window. Explicitly pin the content area to the
  // target dimensions so the rendered viewport is genuinely 1366x768.
  window.setContentSize(WIDTH, HEIGHT);

  await window.loadFile(path.join(__dirname, '../dist/renderer/index.html'));

  // Wait for fonts + paint + a known-stable root node (`.app-shell`). We only
  // capture once the real UI has actually mounted and painted, so the baseline
  // is never a mid-hydration / blank frame.
  await window.webContents
    .executeJavaScript(
      `
      (async () => {
        if (document.fonts && document.fonts.ready) {
          await document.fonts.ready;
        }
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          const root = document.querySelector('.app-shell');
          if (root && root.getBoundingClientRect().height > 0) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      })();
    `,
    )
    .catch((error) => {
      // A failed wait must not abort the capture; log and continue so we still
      // get the best-effort real screenshot.
      console.warn('pre-capture wait warning:', error && error.message);
    });

  // Best-effort extra paint settle.
  await new Promise((resolve) => setTimeout(resolve, 600));

  // Capture the visible 1366x768 viewport at native (no-resize) size.
  // NOTE: `NativeImage.resize` is intentionally NOT used anywhere here.
  const image = await window.webContents.capturePage({
    x: 0,
    y: 0,
    width: WIDTH,
    height: HEIGHT,
  });

  const size = image.getSize();

  const outputPath = path.join(__dirname, '../docs/design/baseline-1366x768.png');
  await writeFile(outputPath, image.toPNG());
  console.log(
    `Phase 0A baseline screenshot (${size.width}x${size.height}) written to ${outputPath}`,
  );
  window.destroy();
}

// Headless/offscreen configuration MUST be applied before the app is ready,
// otherwise Electron throws "can only be called before app is ready".
configureHeadless();

app
  .whenReady()
  .then(captureBaseline)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

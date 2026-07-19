const { app, BrowserWindow } = require('electron');
const {
  registerIpcHandlers,
} = require('../dist-electron/main/ipc/register-ipc-handlers.js');
const {
  HiddenWindowManager,
} = require('../dist-electron/main/windows/hidden-window-manager.js');
const {
  createMainWindow,
} = require('../dist-electron/main/windows/main-window.js');

const POLL_TIMEOUT_MS = 5_000;

// Keep the verification process alive long enough to assert cleanup after the
// last BrowserWindow closes. Production still owns its normal quit behavior.
app.on('window-all-closed', () => {});

async function waitForPingResult(window) {
  await window.webContents.executeJavaScript(`
    document.querySelector('[data-testid="ping-button"]').click()
  `);

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await window.webContents.executeJavaScript(`
      document.querySelector('[data-testid="ping-result"]').textContent
    `);
    if (result === 'pong') {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error('Timed out waiting for the Renderer to receive pong.');
}

async function runVerification() {
  const hiddenWindowManager = new HiddenWindowManager();
  let mainWindow = null;
  const removeIpcHandlers = registerIpcHandlers({
    getMainWindow: () => mainWindow,
    getHiddenWindow: () => hiddenWindowManager.getWindow(),
    markHiddenReady: (senderId) => hiddenWindowManager.markReady(senderId),
  });

  try {
    mainWindow = await createMainWindow();
    mainWindow.once('closed', () => hiddenWindowManager.close());
    const hiddenWindow = await hiddenWindowManager.create();
    const ping = await waitForPingResult(mainWindow);
    const rendererGlobals = await mainWindow.webContents.executeJavaScript(`({
      requireType: typeof window.require,
      processType: typeof window.process,
      apiKeys: Object.keys(window.pandaStage),
      appApiKeys: Object.keys(window.pandaStage.app)
    })`);
    const hiddenReady = await hiddenWindow.webContents.executeJavaScript(`
      document.documentElement.dataset.ready
    `);

    const closed = new Promise((resolve) => mainWindow.once('closed', resolve));
    mainWindow.close();
    await closed;
    await new Promise((resolve) => setTimeout(resolve, 50));

    const result = {
      ping,
      hiddenReady,
      rendererGlobals,
      remainingWindows: BrowserWindow.getAllWindows().length,
    };

    if (
      result.ping !== 'pong' ||
      result.hiddenReady !== 'true' ||
      result.rendererGlobals.requireType !== 'undefined' ||
      result.rendererGlobals.processType !== 'undefined' ||
      JSON.stringify(result.rendererGlobals.apiKeys) !== '["app"]' ||
      JSON.stringify(result.rendererGlobals.appApiKeys) !== '["ping"]' ||
      result.remainingWindows !== 0
    ) {
      throw new Error(`Day 03 verification failed: ${JSON.stringify(result)}`);
    }

    console.log(JSON.stringify(result, null, 2));
  } finally {
    removeIpcHandlers();
    hiddenWindowManager.close();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.destroy();
    }
  }
}

app
  .whenReady()
  .then(runVerification)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

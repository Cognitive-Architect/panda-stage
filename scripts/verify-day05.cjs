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

const POLL_TIMEOUT_MS = 8_000;

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.on('window-all-closed', () => {});

async function readPreviewState(window) {
  return window.webContents.executeJavaScript(`(() => {
    const panel = document.querySelector('[data-testid="preview-panel"]');
    const stage = document.querySelector('[data-testid="stage-renderer"]');
    if (!panel || !stage) {
      throw new Error('Preview probe elements are missing.');
    }
    return {
      status: panel.dataset.previewStatus,
      timeMs: Number(panel.dataset.previewTime),
      activeSources: Number(panel.dataset.activeAudioSources),
      sourceStarts: Number(panel.dataset.sourceStartCount),
      sourceStops: Number(panel.dataset.sourceStopCount),
      clockKind: panel.dataset.audioClock,
      clockState: panel.dataset.audioClockState,
      characterX: Number(panel.dataset.characterX),
      captionVisible: stage.dataset.captionVisible === 'true',
      captionText: stage.dataset.captionText
    };
  })()`);
}

async function waitForState(window, predicate, description) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await readPreviewState(window);
    if (predicate(latest)) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Timed out waiting for ${description}: ${JSON.stringify(latest)}`,
  );
}

async function click(window, testId) {
  await window.webContents.executeJavaScript(`
    document.querySelector('[data-testid="${testId}"]').click()
  `);
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
    await hiddenWindowManager.create();

    const initial = await waitForState(
      mainWindow,
      (state) => state.status === 'stopped',
      'audio probe initialization',
    );
    await click(mainWindow, 'preview-play');
    const firstPlayback = await waitForState(
      mainWindow,
      (state) =>
        state.status === 'playing' &&
        state.timeMs >= 450 &&
        state.captionVisible,
      'first playback sample',
    );

    await click(mainWindow, 'preview-pause');
    const paused = await waitForState(
      mainWindow,
      (state) => state.status === 'paused',
      'paused state',
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    const pausedLater = await readPreviewState(mainWindow);

    await click(mainWindow, 'preview-play');
    const resumed = await waitForState(
      mainWindow,
      (state) =>
        state.status === 'playing' && state.timeMs >= paused.timeMs + 250,
      'resumed playback',
    );

    await click(mainWindow, 'preview-replay');
    const replayed = await waitForState(
      mainWindow,
      (state) =>
        state.status === 'playing' &&
        state.timeMs < 200 &&
        state.sourceStarts >= 3,
      'replay reset',
    );
    const midpoint = await waitForState(
      mainWindow,
      (state) =>
        state.status === 'playing' &&
        state.timeMs >= 1_500 &&
        state.captionText.includes('每一个故事'),
      'second subtitle cue',
    );
    const completed = await waitForState(
      mainWindow,
      (state) => state.status === 'ended',
      'three-second completion',
    );
    await click(mainWindow, 'preview-stop');
    const stopped = await waitForState(
      mainWindow,
      (state) => state.status === 'stopped' && state.timeMs === 0,
      'stopped reset',
    );

    const result = {
      initial,
      firstPlayback,
      paused: {
        timeMs: paused.timeMs,
        timeAfter250Ms: pausedLater.timeMs,
        activeSources: pausedLater.activeSources,
      },
      resumed,
      replayed,
      midpoint,
      completed,
      stopped,
    };

    const observed = [
      initial,
      firstPlayback,
      paused,
      pausedLater,
      resumed,
      replayed,
      midpoint,
      completed,
      stopped,
    ];
    if (
      initial.timeMs !== 0 ||
      initial.captionVisible ||
      firstPlayback.clockKind !== 'audio-context' ||
      firstPlayback.clockState !== 'running' ||
      firstPlayback.characterX <= initial.characterX ||
      Math.abs(pausedLater.timeMs - paused.timeMs) > 5 ||
      pausedLater.activeSources !== 0 ||
      resumed.timeMs <= paused.timeMs ||
      replayed.timeMs >= 200 ||
      replayed.activeSources !== 1 ||
      midpoint.characterX <= firstPlayback.characterX ||
      completed.timeMs !== 3_000 ||
      completed.characterX !== 1_490 ||
      completed.captionVisible ||
      completed.activeSources !== 0 ||
      stopped.timeMs !== 0 ||
      stopped.characterX !== 430 ||
      observed.some((state) => state.activeSources > 1)
    ) {
      throw new Error(`Day 05 verification failed: ${JSON.stringify(result)}`);
    }
    console.log(JSON.stringify(result, null, 2));

    const closed = new Promise((resolve) => mainWindow.once('closed', resolve));
    mainWindow.close();
    await closed;
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (BrowserWindow.getAllWindows().length !== 0) {
      throw new Error('Day 05 verification left BrowserWindows open.');
    }
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

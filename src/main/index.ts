import { app, type BrowserWindow } from 'electron';
import { registerIpcHandlers } from './ipc/register-ipc-handlers';
import { HiddenWindowManager } from './windows/hidden-window-manager';
import { createMainWindow } from './windows/main-window';

let mainWindow: BrowserWindow | null = null;
const hiddenWindowManager = new HiddenWindowManager();
let removeIpcHandlers: (() => void) | null = null;

async function createApplicationWindows(): Promise<void> {
  mainWindow = await createMainWindow();
  mainWindow.once('closed', () => {
    mainWindow = null;
    hiddenWindowManager.close();
  });

  await hiddenWindowManager.create();
}

async function initialize(): Promise<void> {
  removeIpcHandlers = registerIpcHandlers({
    getMainWindow: () => mainWindow,
    getHiddenWindow: () => hiddenWindowManager.getWindow(),
    markHiddenReady: (senderId) => hiddenWindowManager.markReady(senderId),
  });

  await createApplicationWindows();
}

void app
  .whenReady()
  .then(initialize)
  .catch((error: unknown) => {
    console.error('Panda Stage failed to initialize.', error);
    app.exit(1);
  });

app.on('activate', () => {
  if (!mainWindow) {
    void createApplicationWindows().catch((error: unknown) => {
      console.error('Panda Stage failed to recreate its windows.', error);
    });
  }
});

app.on('before-quit', () => {
  removeIpcHandlers?.();
  removeIpcHandlers = null;
  hiddenWindowManager.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

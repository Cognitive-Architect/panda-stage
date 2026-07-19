import { app, BrowserWindow, screen } from 'electron';
import path from 'node:path';

let mainWindow: BrowserWindow | null = null;

function createMainWindow(): BrowserWindow {
  const { width: workAreaWidth, height: workAreaHeight } =
    screen.getPrimaryDisplay().workAreaSize;

  const window = new BrowserWindow({
    width: Math.min(1200, workAreaWidth),
    height: Math.min(760, workAreaHeight),
    minWidth: Math.min(800, workAreaWidth),
    minHeight: Math.min(560, workAreaHeight),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const developmentUrl = process.env.VITE_DEV_SERVER_URL;

  if (developmentUrl) {
    void window.loadURL(developmentUrl);
  } else {
    void window.loadFile(
      path.join(__dirname, '../../dist/renderer/index.html'),
    );
  }

  window.once('ready-to-show', () => {
    window.show();
  });

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  return window;
}

void app.whenReady().then(() => {
  mainWindow = createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

import { BrowserWindow, screen } from 'electron';
import path from 'node:path';

export async function createMainWindow(): Promise<BrowserWindow> {
  const { width: workAreaWidth, height: workAreaHeight } =
    screen.getPrimaryDisplay().workAreaSize;
  const window = new BrowserWindow({
    width: Math.min(1200, workAreaWidth),
    height: Math.min(760, workAreaHeight),
    minWidth: Math.min(800, workAreaWidth),
    minHeight: Math.min(560, workAreaHeight),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.once('ready-to-show', () => window.show());

  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) {
    await window.loadURL(developmentUrl);
  } else {
    await window.loadFile(
      path.join(__dirname, '../../../dist/renderer/index.html'),
    );
  }

  return window;
}

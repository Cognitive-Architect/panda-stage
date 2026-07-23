import { BrowserWindow, screen } from 'electron';
import path from 'node:path';

export interface MainWindowOptions {
  gateA?: boolean;
  show?: boolean;
}

export async function createMainWindow(
  options: MainWindowOptions = {},
): Promise<BrowserWindow> {
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
  if (options.show !== false) {
    window.once('ready-to-show', () => window.show());
  }

  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) {
    const url = new URL(developmentUrl);
    if (options.gateA) url.searchParams.set('gateA', '1');
    await window.loadURL(url.toString());
  } else {
    await window.loadFile(
      path.join(__dirname, '../../../dist/renderer/index.html'),
      options.gateA ? { query: { gateA: '1' } } : undefined,
    );
  }

  return window;
}

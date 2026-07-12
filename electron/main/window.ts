import { BrowserWindow } from 'electron';
import path from 'path';

const MAIN_WINDOW_WIDTH = 1600;
const MAIN_WINDOW_HEIGHT = 900;

export async function createMainWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: MAIN_WINDOW_WIDTH,
    height: MAIN_WINDOW_HEIGHT,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    await win.loadURL('http://localhost:5173');
  } else {
    await win.loadFile(path.join(__dirname, '../../renderer/index.html'));
  }

  win.once('ready-to-show', () => {
    win.show();
  });

  return win;
}

let exportWindow: BrowserWindow | null = null;

export async function createExportWindow(): Promise<BrowserWindow> {
  if (exportWindow && !exportWindow.isDestroyed()) {
    return exportWindow;
  }

  exportWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: false,
    useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/export-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
    },
  });

  // 严格确保 1920x1080 渲染尺寸，不受 DPI 缩放影响
  exportWindow.webContents.setZoomFactor(1);
  exportWindow.setContentSize(1920, 1080);

  const loadUrl = process.env.NODE_ENV === 'development'
    ? 'http://localhost:5173/index.html?mode=export'
    : path.join(__dirname, '../../renderer/index.html');

  if (process.env.NODE_ENV === 'development') {
    await exportWindow.loadURL(loadUrl);
  } else {
    await exportWindow.loadFile(loadUrl);
  }

  // 等待窗口加载完成（字体、图片、Stage 绘制由 renderer 自行处理）
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Export window load timeout after 30s'));
    }, 30000);

    const onReady = () => {
      clearTimeout(timeout);
      resolve();
    };

    exportWindow!.webContents.once('did-finish-load', onReady);
  });

  return exportWindow;
}

export function getExportWindow(): BrowserWindow | null {
  return exportWindow && !exportWindow.isDestroyed() ? exportWindow : null;
}

export function closeExportWindow(): void {
  if (exportWindow && !exportWindow.isDestroyed()) {
    exportWindow.close();
    exportWindow = null;
  }
}

import { app, BrowserWindow } from 'electron';
import { createMainWindow, closeExportWindow } from './window';
import { registerExportIpc } from './ipc/handlers/export';
import { registerFfmpegIpc } from './ipc/handlers/ffmpeg';

let mainWindow: BrowserWindow | null = null;

async function initialize(): Promise<void> {
  mainWindow = await createMainWindow();
  registerExportIpc(mainWindow);
  registerFfmpegIpc();
}

app.whenReady().then(initialize).catch((err: Error) => {
  console.error('Failed to initialize app:', err);
  process.exit(1);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = await createMainWindow();
  }
});

app.on('before-quit', () => {
  closeExportWindow();
});

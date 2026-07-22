import { app, type BrowserWindow } from 'electron';
import { registerIpcHandlers } from './ipc/register-ipc-handlers';
import { ExportService } from './services/ExportService';
import { FileSystemService } from './services/FileSystemService';
import { FFmpegAdapter } from './services/FFmpegAdapter';
import { HiddenWindowManager } from './windows/hidden-window-manager';
import { createMainWindow } from './windows/main-window';
import { IPC_CHANNELS } from '../shared/ipc/channels';

let mainWindow: BrowserWindow | null = null;
const hiddenWindowManager = new HiddenWindowManager();
const exportService = new ExportService(
  hiddenWindowManager,
  new FileSystemService(),
  new FFmpegAdapter(),
);
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
  exportService.subscribe((update) => {
    const window = mainWindow;
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.EXPORT_JOB_UPDATE, update);
    }
  });
  removeIpcHandlers = registerIpcHandlers({
    getMainWindow: () => mainWindow,
    getHiddenWindow: () => hiddenWindowManager.getWindow(),
    markHiddenReady: (senderId) => hiddenWindowManager.markReady(senderId),
    markProbeLoaded: (senderId, payload) =>
      hiddenWindowManager.markProbeLoaded(senderId, payload),
    markFrameReady: (senderId, payload) =>
      hiddenWindowManager.markFrameReady(senderId, payload),
    markFrameFailed: (senderId, payload) =>
      hiddenWindowManager.markFrameFailed(senderId, payload),
    startFullProbe: (request) => {
      const handle = exportService.startFullProbe(request);
      void handle.completion.catch((error: unknown) => {
        console.error(`Export Job ${handle.jobId} stopped.`, error);
      });
      return { jobId: handle.jobId, status: 'running' };
    },
    cancelExport: (jobId) => {
      const accepted = exportService.cancelJob(jobId);
      return {
        jobId,
        accepted,
        status: exportService.getJob(jobId)?.status ?? 'cancelled',
      };
    },
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
  exportService.cancelActiveJob();
  removeIpcHandlers?.();
  removeIpcHandlers = null;
  hiddenWindowManager.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

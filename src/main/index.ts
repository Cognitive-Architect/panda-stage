import { app, type BrowserWindow } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { registerIpcHandlers } from './ipc/register-ipc-handlers';
import { ExportService } from './services/ExportService';
import { FileSystemService } from './services/FileSystemService';
import { FFmpegAdapter } from './services/FFmpegAdapter';
import { HiddenWindowManager } from './windows/hidden-window-manager';
import { createMainWindow } from './windows/main-window';
import { IPC_CHANNELS } from '../shared/ipc/channels';
import { resolveMediaToolPaths } from './services/production-resources';
import { runPackagedGateA } from './gate-a-runner';

let mainWindow: BrowserWindow | null = null;
const hiddenWindowManager = new HiddenWindowManager();
let exportService: ExportService | null = null;
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
  const resourcesPath =
    process.env.PANDA_STAGE_GATE_A_FORCE_MISSING_MEDIA === '1'
      ? `${process.resourcesPath}-missing-gate-fixture`
      : process.resourcesPath;
  const mediaTools = resolveMediaToolPaths({
    isPackaged: app.isPackaged,
    resourcesPath,
  });
  if (process.env.PANDA_STAGE_GATE_A === '1') {
    if (!app.isPackaged) {
      throw new Error('Gate A runner requires the packaged application.');
    }
    const outputRoot = process.env.PANDA_STAGE_GATE_A_OUTPUT?.trim();
    if (!outputRoot) {
      throw new Error('PANDA_STAGE_GATE_A_OUTPUT is required.');
    }
    await runPackagedGateA(mediaTools, outputRoot);
    app.quit();
    return;
  }
  exportService = new ExportService(
    hiddenWindowManager,
    new FileSystemService(),
    new FFmpegAdapter({
      ffmpegPath: mediaTools.ffmpegPath,
      ffprobePath: mediaTools.ffprobePath,
    }),
  );
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
      const handle = exportService!.startFullProbe(request);
      void handle.completion.catch((error: unknown) => {
        console.error(`Export Job ${handle.jobId} stopped.`, error);
      });
      return { jobId: handle.jobId, status: 'running' };
    },
    cancelExport: (jobId) => {
      const accepted = exportService!.cancelJob(jobId);
      return {
        jobId,
        accepted,
        status: exportService!.getJob(jobId)?.status ?? 'cancelled',
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
    const outputRoot = process.env.PANDA_STAGE_GATE_A_OUTPUT?.trim();
    const writeGateError = outputRoot
      ? mkdir(outputRoot, { recursive: true }).then(() =>
          writeFile(
            path.join(outputRoot, 'packaged-gate-error.json'),
            `${JSON.stringify(
              {
                status: 'FAIL',
                message: error instanceof Error ? error.message : String(error),
              },
              null,
              2,
            )}\n`,
            'utf8',
          ),
        )
      : Promise.resolve();
    void writeGateError.finally(() => app.exit(1));
  });

app.on('activate', () => {
  if (process.env.PANDA_STAGE_GATE_A === '1') return;
  if (!mainWindow) {
    void createApplicationWindows().catch((error: unknown) => {
      console.error('Panda Stage failed to recreate its windows.', error);
    });
  }
});

app.on('before-quit', () => {
  exportService?.cancelActiveJob();
  removeIpcHandlers?.();
  removeIpcHandlers = null;
  hiddenWindowManager.close();
});

app.on('window-all-closed', () => {
  if (process.env.PANDA_STAGE_GATE_A === '1') return;
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

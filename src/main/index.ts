import { app, dialog, type BrowserWindow } from 'electron';
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
import { registerProjectIpcHandlers } from './ipc/register-project-ipc-handlers';
import { ProjectService } from './services/ProjectService';
import { registerRecoveryIpcHandlers } from './ipc/register-recovery-ipc-handlers';
import { AutosaveService } from './services/AutosaveService';
import { RecoveryService } from './services/RecoveryService';
import { ProjectOperationCoordinator } from './services/ProjectOperationCoordinator';
import { PathService } from './services/PathService';
import { RecentProjectsService } from './services/RecentProjectsService';
import { registerRecentProjectsIpcHandlers } from './ipc/register-recent-projects-ipc-handlers';
import {
  UnsavedCloseController,
  createUnsavedCloseDialogOptions,
} from './services/UnsavedCloseController';
import { UnsavedCloseGuard } from './windows/unsaved-close-guard';
import { AssetImportService } from './services/AssetImportService';
import { declaredMimeTypeForPath } from './services/MediaInspectionService';
import { registerAssetImportIpcHandlers } from './ipc/register-asset-import-ipc-handlers';

let mainWindow: BrowserWindow | null = null;
const hiddenWindowManager = new HiddenWindowManager();
let exportService: ExportService | null = null;
let removeIpcHandlers: (() => void) | null = null;
let removeProjectIpcHandlers: (() => void) | null = null;
let removeRecoveryIpcHandlers: (() => void) | null = null;
let removeRecentProjectsIpcHandlers: (() => void) | null = null;
let removeAssetImportIpcHandlers: (() => void) | null = null;
let autosaveService: AutosaveService | null = null;
let projectService: ProjectService | null = null;
let unsavedCloseController: UnsavedCloseController | null = null;
let unsavedCloseGuard: UnsavedCloseGuard | null = null;

if (process.env.PANDA_STAGE_GATE_A === '1') {
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
}

async function createApplicationWindows(): Promise<void> {
  const window = await createMainWindow();
  mainWindow = window;
  if (unsavedCloseController) {
    const guard = new UnsavedCloseGuard({
      controller: unsavedCloseController,
      closeWindow: () => {
        if (!window.isDestroyed()) window.close();
      },
      quitApplication: () => app.quit(),
    });
    unsavedCloseGuard = guard;
    window.on('close', (event) => guard.handleWindowClose(event));
  }
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = null;
    if (unsavedCloseGuard) unsavedCloseGuard = null;
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
  const recoveryService = new RecoveryService();
  const pathService = new PathService();
  const recentProjectsService = new RecentProjectsService({
    configurationFilePath: path.join(
      app.getPath('userData'),
      'recent-projects.json',
    ),
    pathService,
  });
  const projectOperationCoordinator = new ProjectOperationCoordinator();
  autosaveService = new AutosaveService({
    recoveryService,
    coordinator: projectOperationCoordinator,
    onError: (error) => {
      const window = mainWindow;
      if (window && !window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.AUTOSAVE_ERROR, error);
      }
    },
  });
  projectService = new ProjectService({
    coordinator: projectOperationCoordinator,
    pathService,
    onProjectSaved: async (projectRoot, project, revision) => {
      try {
        await recoveryService.cleanupAfterFormalSave(
          projectRoot,
          project.id,
        );
      } catch (error) {
        console.error('Recovery cleanup after formal save failed.', error);
      } finally {
        if (revision !== undefined) {
          autosaveService?.markFormalSaved(
            projectRoot,
            project,
            revision,
          );
        }
      }
    },
    onPostSaveError: (error) => {
      console.error('Post-save recovery coordination failed.', error);
    },
  });
  removeProjectIpcHandlers = registerProjectIpcHandlers({
    getMainWindow: () => mainWindow,
    projectService,
    onProjectAccessed: (document) =>
      recentProjectsService.record(document).then(() => undefined),
    onRecentProjectError: (error) => {
      console.error('Recent project update failed.', error);
    },
  });
  removeRecoveryIpcHandlers = registerRecoveryIpcHandlers({
    getMainWindow: () => mainWindow,
    projectService,
    recoveryService,
    autosaveService,
  });
  removeRecentProjectsIpcHandlers = registerRecentProjectsIpcHandlers({
    getMainWindow: () => mainWindow,
    projectService,
    recentProjectsService,
    selectProjectDirectory: async (window) => {
      const selection = await dialog.showOpenDialog(window, {
        title: '重新定位 Panda Stage 项目',
        buttonLabel: '选择项目目录',
        properties: ['openDirectory'],
      });
      return selection.canceled ? null : selection.filePaths[0] ?? null;
    },
  });
  const assetImportService = new AssetImportService({
    projectService,
  });
  removeAssetImportIpcHandlers = registerAssetImportIpcHandlers({
    getMainWindow: () => mainWindow,
    assetImportService,
    selectAssetCandidates: async (window) => {
      const selection = await dialog.showOpenDialog(window, {
        title: '导入素材到 Panda Stage 项目',
        buttonLabel: '导入素材',
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: 'PNG / JPG / MP3 / WAV',
            extensions: ['png', 'jpg', 'jpeg', 'mp3', 'wav'],
          },
        ],
      });
      if (selection.canceled) return null;
      return selection.filePaths.flatMap((sourcePath) => {
        const declaredMimeType = declaredMimeTypeForPath(sourcePath);
        return declaredMimeType
          ? [{ sourcePath, declaredMimeType }]
          : [];
      });
    },
  });
  unsavedCloseController = new UnsavedCloseController({
    getDirtyProject: () =>
      autosaveService?.getDirtyProjectSnapshot() ?? null,
    prompt: async (project) => {
      const window = mainWindow;
      if (!window || window.isDestroyed()) return 'cancel';
      const result = await dialog.showMessageBox(
        window,
        createUnsavedCloseDialogOptions(project.project.name),
      );
      return result.response === 0
        ? 'save'
        : result.response === 1
          ? 'discard'
          : 'cancel';
    },
    save: async (snapshot) => {
      if (!projectService) throw new Error('Project service is unavailable.');
      await projectService.save(
        snapshot.projectRoot,
        snapshot.project,
        snapshot.revision,
      );
    },
    discard: async (snapshot) => {
      if (!autosaveService) {
        throw new Error('Autosave service is unavailable.');
      }
      await autosaveService.discard(
        snapshot.projectRoot,
        snapshot.project.id,
      );
    },
    reportSaveFailure: (snapshot, error) => {
      console.error('Save before close failed.', error);
      dialog.showErrorBox(
        '无法保存项目',
        `“${snapshot.project.name}”保存失败，窗口将保持打开。请检查磁盘和目录权限后重试。`,
      );
    },
    reportDiscardFailure: (snapshot, error) => {
      console.error('Discard before close failed.', error);
      dialog.showErrorBox(
        '无法放弃修改并安全退出',
        `“${snapshot.project.name}”的恢复数据清理失败，窗口将保持打开。请检查磁盘和目录权限后重试。`,
      );
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

app.on('before-quit', (event) => {
  unsavedCloseGuard?.handleBeforeQuit(event);
});

app.on('will-quit', () => {
  exportService?.cancelActiveJob();
  removeIpcHandlers?.();
  removeIpcHandlers = null;
  removeProjectIpcHandlers?.();
  removeProjectIpcHandlers = null;
  removeRecoveryIpcHandlers?.();
  removeRecoveryIpcHandlers = null;
  removeRecentProjectsIpcHandlers?.();
  removeRecentProjectsIpcHandlers = null;
  removeAssetImportIpcHandlers?.();
  removeAssetImportIpcHandlers = null;
  void autosaveService?.stopAll();
  autosaveService = null;
  projectService = null;
  unsavedCloseController = null;
  unsavedCloseGuard = null;
  hiddenWindowManager.close();
});

app.on('window-all-closed', () => {
  if (process.env.PANDA_STAGE_GATE_A === '1') return;
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

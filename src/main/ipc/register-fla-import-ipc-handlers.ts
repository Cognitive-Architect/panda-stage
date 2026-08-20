import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import {
  FlaCancelRequestSchema,
  FlaCancelResponseSchema,
  FlaInspectRequestSchema,
  FlaInspectionResponseSchema,
} from '../../shared/fla-import-api';
import {
  FlaAssetCommitResponseSchema,
  type FlaAssetCommitResponse,
} from '../../shared/fla-asset-commit-api';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { FlaImportService } from '../services/FlaImportService';
import {
  FlaAssetCommitService,
  FlaAssetCommitServiceError,
} from '../services/FlaAssetCommitService';

export interface FlaImportIpcDependencies {
  getMainWindow: () => BrowserWindow | null;
  flaImportService: FlaImportService;
  flaAssetCommitService: FlaAssetCommitService;
  selectFlaSource: (window: BrowserWindow) => Promise<string | null>;
}

function assertTrustedSender(
  event: IpcMainInvokeEvent | IpcMainEvent,
  expectedWindow: BrowserWindow | null,
): void {
  if (!expectedWindow || expectedWindow.isDestroyed() || event.sender.id !== expectedWindow.webContents.id) {
    throw new Error('Untrusted FLA IPC sender');
  }
}

function commitFailure(
  error: unknown,
  projectRoot: string,
): FlaAssetCommitResponse {
  const normalized =
    error instanceof FlaAssetCommitServiceError
      ? error
      : new FlaAssetCommitServiceError(
          'ASSET_COMMIT_FAILED',
          projectRoot,
          'The selected FLA Assets could not be committed.',
          { cause: error },
        );
  return FlaAssetCommitResponseSchema.parse({
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      projectRoot: normalized.projectRoot,
      ...(normalized.currentProject
        ? { currentProject: normalized.currentProject }
        : {}),
      ...(normalized.currentRevision !== undefined
        ? { currentRevision: normalized.currentRevision }
        : {}),
      ...(normalized.residualPaths.length > 0
        ? { residualPaths: normalized.residualPaths }
        : {}),
    },
  });
}

function requestProjectRoot(rawRequest: unknown): string {
  if (
    typeof rawRequest === 'object' &&
    rawRequest !== null &&
    'projectRoot' in rawRequest &&
    typeof rawRequest.projectRoot === 'string' &&
    rawRequest.projectRoot.trim()
  ) {
    return rawRequest.projectRoot;
  }
  return '(unknown project)';
}

export function registerFlaImportIpcHandlers(
  dependencies: FlaImportIpcDependencies,
): () => void {
  const inspect = async (event: IpcMainInvokeEvent, rawRequest: unknown) => {
    assertTrustedSender(event, dependencies.getMainWindow());
    const request = FlaInspectRequestSchema.parse(rawRequest);
    const window = dependencies.getMainWindow();
    if (!window) {
      return FlaInspectionResponseSchema.parse({
        ok: false,
        error: { code: 'PARSER_CRASH', message: 'Panda Stage main window is unavailable' },
      });
    }
    const sourcePath = await dependencies.selectFlaSource(window);
    if (!sourcePath) {
      return FlaInspectionResponseSchema.parse({
        ok: false,
        error: { code: 'USER_CANCELLED', message: 'FLA inspection was cancelled' },
      });
    }
    return FlaInspectionResponseSchema.parse(
      await dependencies.flaImportService.inspectSource(sourcePath, request.requestId),
    );
  };
  const cancel = async (event: IpcMainInvokeEvent, rawRequest: unknown) => {
    assertTrustedSender(event, dependencies.getMainWindow());
    const request = FlaCancelRequestSchema.parse(rawRequest);
    return FlaCancelResponseSchema.parse(dependencies.flaImportService.cancel(request));
  };

  const onReady = (event: IpcMainEvent) => {
    try {
      dependencies.flaImportService.markWorkerReady(event.sender.id);
    } catch (error) {
      console.error('FLA parser ready message rejected.', error);
    }
  };
  const onProgress = (event: IpcMainEvent, payload: unknown) => {
    try {
      dependencies.flaImportService.markWorkerProgress(event.sender.id, payload);
    } catch (error) {
      console.error('FLA parser progress message rejected.', error);
    }
  };
  const onResult = (event: IpcMainEvent, payload: unknown) => {
    try {
      dependencies.flaImportService.markWorkerResult(event.sender.id, payload);
    } catch (error) {
      console.error('FLA parser result message rejected.', error);
    }
  };
  const onError = (event: IpcMainEvent, payload: unknown) => {
    try {
      dependencies.flaImportService.markWorkerError(event.sender.id, payload);
    } catch (error) {
      console.error('FLA parser error message rejected.', error);
    }
  };

  ipcMain.handle(IPC_CHANNELS.FLA_INSPECT_CHOOSE, inspect);
  ipcMain.handle(IPC_CHANNELS.FLA_CANCEL, cancel);
  ipcMain.handle(
    IPC_CHANNELS.FLA_COMMIT_SELECTED,
    async (event, rawRequest: unknown) => {
      assertTrustedSender(event, dependencies.getMainWindow());
      const projectRoot = requestProjectRoot(rawRequest);
      try {
        const operation = await dependencies.flaAssetCommitService.commit(
          rawRequest,
        );
        return FlaAssetCommitResponseSchema.parse({
          ok: true,
          status: 'completed',
          ...operation,
        } satisfies FlaAssetCommitResponse);
      } catch (error) {
        return commitFailure(error, projectRoot);
      }
    },
  );
  ipcMain.on(IPC_CHANNELS.FLA_WORKER_READY, onReady);
  ipcMain.on(IPC_CHANNELS.FLA_WORKER_PROGRESS, onProgress);
  ipcMain.on(IPC_CHANNELS.FLA_WORKER_RESULT, onResult);
  ipcMain.on(IPC_CHANNELS.FLA_WORKER_ERROR, onError);

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.FLA_INSPECT_CHOOSE);
    ipcMain.removeHandler(IPC_CHANNELS.FLA_CANCEL);
    ipcMain.removeHandler(IPC_CHANNELS.FLA_COMMIT_SELECTED);
    ipcMain.removeListener(IPC_CHANNELS.FLA_WORKER_READY, onReady);
    ipcMain.removeListener(IPC_CHANNELS.FLA_WORKER_PROGRESS, onProgress);
    ipcMain.removeListener(IPC_CHANNELS.FLA_WORKER_RESULT, onResult);
    ipcMain.removeListener(IPC_CHANNELS.FLA_WORKER_ERROR, onError);
  };
}

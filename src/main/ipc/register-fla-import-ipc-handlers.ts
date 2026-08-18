import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import {
  FlaCancelRequestSchema,
  FlaCancelResponseSchema,
  FlaInspectRequestSchema,
  FlaInspectionResponseSchema,
} from '../../shared/fla-import-api';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { FlaImportService } from '../services/FlaImportService';

export interface FlaImportIpcDependencies {
  getMainWindow: () => BrowserWindow | null;
  flaImportService: FlaImportService;
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
  ipcMain.on(IPC_CHANNELS.FLA_WORKER_READY, onReady);
  ipcMain.on(IPC_CHANNELS.FLA_WORKER_PROGRESS, onProgress);
  ipcMain.on(IPC_CHANNELS.FLA_WORKER_RESULT, onResult);
  ipcMain.on(IPC_CHANNELS.FLA_WORKER_ERROR, onError);

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.FLA_INSPECT_CHOOSE);
    ipcMain.removeHandler(IPC_CHANNELS.FLA_CANCEL);
    ipcMain.removeListener(IPC_CHANNELS.FLA_WORKER_READY, onReady);
    ipcMain.removeListener(IPC_CHANNELS.FLA_WORKER_PROGRESS, onProgress);
    ipcMain.removeListener(IPC_CHANNELS.FLA_WORKER_RESULT, onResult);
    ipcMain.removeListener(IPC_CHANNELS.FLA_WORKER_ERROR, onError);
  };
}

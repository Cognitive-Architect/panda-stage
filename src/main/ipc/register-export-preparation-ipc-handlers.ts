import {
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from 'electron';
import {
  ExportPreparationCancelRequestSchema,
  ExportPreparationCancelResponseSchema,
  ExportPreparationDiscardRequestSchema,
  ExportPreparationDiscardResponseSchema,
  ExportPreparationRequestSchema,
  ExportPreparationResponseSchema,
  ExportPreparationSelectOutputRequestSchema,
  ExportPreparationSelectOutputResponseSchema,
  type ExportPreparationSelectOutputRequest,
} from '../../shared/export-preparation-types';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { ExportPreparationService } from '../services/ExportPreparationService';

interface ExportPreparationIpcDependencies {
  getMainWindow: () => BrowserWindow | null;
  service: ExportPreparationService;
  selectOutputPath: (
    window: BrowserWindow,
    request: ExportPreparationSelectOutputRequest,
  ) => Promise<string | null>;
}

function assertTrustedSender(
  event: IpcMainInvokeEvent,
  expectedWindow: BrowserWindow | null,
  channel: string,
): BrowserWindow {
  if (!expectedWindow || expectedWindow.isDestroyed()) {
    throw new Error('IPC ' + channel + ' rejected: target window is unavailable.');
  }
  if (event.sender.id !== expectedWindow.webContents.id) {
    throw new Error('IPC ' + channel + ' rejected: untrusted sender.');
  }
  return expectedWindow;
}

export function registerExportPreparationIpcHandlers(
  dependencies: ExportPreparationIpcDependencies,
): () => void {
  ipcMain.handle(
    IPC_CHANNELS.EXPORT_PREPARATION_SELECT_OUTPUT,
    async (event, rawRequest: unknown) => {
      const window = assertTrustedSender(
        event,
        dependencies.getMainWindow(),
        IPC_CHANNELS.EXPORT_PREPARATION_SELECT_OUTPUT,
      );
      const request =
        ExportPreparationSelectOutputRequestSchema.parse(rawRequest);
      const selectedPath = await dependencies.selectOutputPath(window, request);
      return ExportPreparationSelectOutputResponseSchema.parse(
        await dependencies.service.selectOutput(request, selectedPath),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.EXPORT_PREPARATION_START,
    async (event, rawRequest: unknown) => {
      assertTrustedSender(
        event,
        dependencies.getMainWindow(),
        IPC_CHANNELS.EXPORT_PREPARATION_START,
      );
      const request = ExportPreparationRequestSchema.parse(rawRequest);
      return ExportPreparationResponseSchema.parse(
        await dependencies.service.prepare(request),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.EXPORT_PREPARATION_CANCEL,
    (event, rawRequest: unknown) => {
      assertTrustedSender(
        event,
        dependencies.getMainWindow(),
        IPC_CHANNELS.EXPORT_PREPARATION_CANCEL,
      );
      const request = ExportPreparationCancelRequestSchema.parse(rawRequest);
      return ExportPreparationCancelResponseSchema.parse({
        accepted: dependencies.service.cancel(request.attemptId),
      });
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.EXPORT_PREPARATION_DISCARD,
    async (event, rawRequest: unknown) => {
      assertTrustedSender(
        event,
        dependencies.getMainWindow(),
        IPC_CHANNELS.EXPORT_PREPARATION_DISCARD,
      );
      const request = ExportPreparationDiscardRequestSchema.parse(rawRequest);
      return ExportPreparationDiscardResponseSchema.parse({
        discarded: await dependencies.service.discard(
          request.selectionId,
          request.snapshotId,
        ),
      });
    },
  );

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.EXPORT_PREPARATION_SELECT_OUTPUT);
    ipcMain.removeHandler(IPC_CHANNELS.EXPORT_PREPARATION_START);
    ipcMain.removeHandler(IPC_CHANNELS.EXPORT_PREPARATION_CANCEL);
    ipcMain.removeHandler(IPC_CHANNELS.EXPORT_PREPARATION_DISCARD);
  };
}

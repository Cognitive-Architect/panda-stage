import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import {
  FlaPartPreviewCancelRequestSchema,
  FlaPartPreviewCancelResponseSchema,
  FlaPartPreviewRequestSchema,
  FlaPartPreviewResponseSchema,
} from '../../shared/fla-part-preview-api';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import type { FlaPartPreviewService } from '../services/FlaPartPreviewService';

export interface FlaPartPreviewIpcDependencies {
  getMainWindow: () => BrowserWindow | null;
  service: FlaPartPreviewService;
}

function assertTrustedSender(
  event: IpcMainInvokeEvent,
  expectedWindow: BrowserWindow | null,
): void {
  if (!expectedWindow || expectedWindow.isDestroyed() || event.sender.id !== expectedWindow.webContents.id) {
    throw new Error('Untrusted FLA part preview IPC sender');
  }
}

export function registerFlaPartPreviewIpcHandlers(
  dependencies: FlaPartPreviewIpcDependencies,
): () => void {
  const preview = async (event: IpcMainInvokeEvent, rawRequest: unknown) => {
    assertTrustedSender(event, dependencies.getMainWindow());
    let request;
    try {
      request = FlaPartPreviewRequestSchema.parse(rawRequest);
    } catch {
      return FlaPartPreviewResponseSchema.parse({
        ok: false,
        status: 'ERROR',
        error: { code: 'INVALID_REQUEST', message: 'Invalid F1-02 part preview request' },
      });
    }
    return FlaPartPreviewResponseSchema.parse(await dependencies.service.preview(request));
  };

  const cancel = (event: IpcMainInvokeEvent, rawRequest: unknown) => {
    assertTrustedSender(event, dependencies.getMainWindow());
    let request;
    try {
      request = FlaPartPreviewCancelRequestSchema.parse(rawRequest);
    } catch {
      return FlaPartPreviewCancelResponseSchema.parse({ accepted: false });
    }
    return FlaPartPreviewCancelResponseSchema.parse(dependencies.service.cancel(request));
  };

  ipcMain.handle(IPC_CHANNELS.FLA_PART_PREVIEW, preview);
  ipcMain.handle(IPC_CHANNELS.FLA_PART_PREVIEW_CANCEL, cancel);

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.FLA_PART_PREVIEW);
    ipcMain.removeHandler(IPC_CHANNELS.FLA_PART_PREVIEW_CANCEL);
  };
}

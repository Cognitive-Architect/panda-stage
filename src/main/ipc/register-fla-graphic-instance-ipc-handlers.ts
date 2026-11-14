import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import {
  FlaGraphicInstanceCommitRequestSchema,
  FlaGraphicInstanceCommitResponseSchema,
} from '../../shared/fla-graphic-instance-api';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import type { FlaGraphicInstanceCommitService } from '../services/FlaGraphicInstanceCommitService';

export interface FlaGraphicInstanceIpcDependencies {
  readonly getMainWindow: () => BrowserWindow | null;
  readonly service: FlaGraphicInstanceCommitService;
}

function assertTrustedSender(event: IpcMainInvokeEvent, expectedWindow: BrowserWindow | null): void {
  if (!expectedWindow || expectedWindow.isDestroyed() || event.sender.id !== expectedWindow.webContents.id) {
    throw new Error('Untrusted FLA Graphic instance IPC sender');
  }
}

export function registerFlaGraphicInstanceIpcHandlers(
  dependencies: FlaGraphicInstanceIpcDependencies,
): () => void {
  const commit = async (event: IpcMainInvokeEvent, rawRequest: unknown) => {
    assertTrustedSender(event, dependencies.getMainWindow());
    let request;
    try {
      request = FlaGraphicInstanceCommitRequestSchema.parse(rawRequest);
    } catch {
      return FlaGraphicInstanceCommitResponseSchema.parse({
        ok: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid FLA Graphic instance import request.',
          projectRoot: '(unknown project)',
        },
      });
    }
    return FlaGraphicInstanceCommitResponseSchema.parse(await dependencies.service.commit(request));
  };

  ipcMain.handle(IPC_CHANNELS.FLA_GRAPHIC_INSTANCE_COMMIT, commit);
  return () => ipcMain.removeHandler(IPC_CHANNELS.FLA_GRAPHIC_INSTANCE_COMMIT);
}

import {
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from 'electron';
import {
  AppPingRequestSchema,
  AppPingResponseSchema,
  HiddenReadyRequestSchema,
  HiddenReadyResponseSchema,
} from '../../shared/ipc/contracts';
import { IPC_CHANNELS } from '../../shared/ipc/channels';

interface IpcHandlerDependencies {
  getMainWindow: () => BrowserWindow | null;
  getHiddenWindow: () => BrowserWindow | null;
  markHiddenReady: (senderId: number) => void;
}

function assertTrustedSender(
  event: IpcMainInvokeEvent,
  expectedWindow: BrowserWindow | null,
  channel: string,
): void {
  if (!expectedWindow || expectedWindow.isDestroyed()) {
    throw new Error(`IPC ${channel} rejected: target window is unavailable.`);
  }

  if (event.sender.id !== expectedWindow.webContents.id) {
    throw new Error(`IPC ${channel} rejected: untrusted sender.`);
  }
}

export function registerIpcHandlers(
  dependencies: IpcHandlerDependencies,
): () => void {
  ipcMain.handle(IPC_CHANNELS.APP_PING, (event, rawRequest: unknown) => {
    assertTrustedSender(
      event,
      dependencies.getMainWindow(),
      IPC_CHANNELS.APP_PING,
    );
    AppPingRequestSchema.parse(rawRequest);

    return AppPingResponseSchema.parse({
      message: 'pong',
      receivedAtMs: Date.now(),
    });
  });

  ipcMain.handle(IPC_CHANNELS.HIDDEN_READY, (event, rawRequest: unknown) => {
    assertTrustedSender(
      event,
      dependencies.getHiddenWindow(),
      IPC_CHANNELS.HIDDEN_READY,
    );
    const request = HiddenReadyRequestSchema.parse(rawRequest);
    dependencies.markHiddenReady(event.sender.id);

    return HiddenReadyResponseSchema.parse({
      acknowledged: true,
      role: request.role,
    });
  });

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.APP_PING);
    ipcMain.removeHandler(IPC_CHANNELS.HIDDEN_READY);
  };
}

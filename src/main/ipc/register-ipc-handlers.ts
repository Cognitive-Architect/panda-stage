import {
  ipcMain,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import type {
  ExportFrameFailed,
  ExportFrameReady,
  ExportProbeLoaded,
} from '../../shared/export-types';
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
  markProbeLoaded: (senderId: number, payload: ExportProbeLoaded) => void;
  markFrameReady: (senderId: number, payload: ExportFrameReady) => void;
  markFrameFailed: (senderId: number, payload: ExportFrameFailed) => void;
}

function assertTrustedSender(
  event: IpcMainInvokeEvent | IpcMainEvent,
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
  const onProbeLoaded = (event: IpcMainEvent, payload: ExportProbeLoaded) => {
    assertTrustedSender(
      event,
      dependencies.getHiddenWindow(),
      IPC_CHANNELS.EXPORT_PROBE_LOADED,
    );
    dependencies.markProbeLoaded(event.sender.id, payload);
  };
  const onFrameReady = (event: IpcMainEvent, payload: ExportFrameReady) => {
    assertTrustedSender(
      event,
      dependencies.getHiddenWindow(),
      IPC_CHANNELS.EXPORT_FRAME_READY,
    );
    dependencies.markFrameReady(event.sender.id, payload);
  };
  const onFrameFailed = (event: IpcMainEvent, payload: ExportFrameFailed) => {
    assertTrustedSender(
      event,
      dependencies.getHiddenWindow(),
      IPC_CHANNELS.EXPORT_FRAME_FAILED,
    );
    dependencies.markFrameFailed(event.sender.id, payload);
  };

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

  ipcMain.on(IPC_CHANNELS.EXPORT_PROBE_LOADED, onProbeLoaded);
  ipcMain.on(IPC_CHANNELS.EXPORT_FRAME_READY, onFrameReady);
  ipcMain.on(IPC_CHANNELS.EXPORT_FRAME_FAILED, onFrameFailed);

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.APP_PING);
    ipcMain.removeHandler(IPC_CHANNELS.HIDDEN_READY);
    ipcMain.removeListener(IPC_CHANNELS.EXPORT_PROBE_LOADED, onProbeLoaded);
    ipcMain.removeListener(IPC_CHANNELS.EXPORT_FRAME_READY, onFrameReady);
    ipcMain.removeListener(IPC_CHANNELS.EXPORT_FRAME_FAILED, onFrameFailed);
  };
}

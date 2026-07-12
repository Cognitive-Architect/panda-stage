import { ipcMain, BrowserWindow } from 'electron';
import { IpcChannels } from '../../../../shared/ipc-channels';
import type { ExportConfig, RenderFrameResult } from '../../../../shared/types';
import { ExportService } from '../../services/ExportService';

let activeExportService: ExportService | null = null;

export function registerExportIpc(mainWindow: BrowserWindow): void {
  ipcMain.handle(IpcChannels.EXPORT_START, async (_event, config: ExportConfig) => {
    try {
      if (activeExportService) {
        throw new Error('Export already in progress');
      }

      activeExportService = new ExportService(mainWindow, config);
      await activeExportService.start();
      activeExportService = null;
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      mainWindow.webContents.send(IpcChannels.EXPORT_ERROR, message);
      activeExportService = null;
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IpcChannels.EXPORT_CANCEL, async () => {
    if (activeExportService) {
      await activeExportService.cancel();
      activeExportService = null;
    }
    return { success: true };
  });

  ipcMain.on(IpcChannels.RENDER_FRAME_DONE, (_event, result: RenderFrameResult) => {
    if (activeExportService) {
      activeExportService.handleFrameResult(result).catch((err: Error) => {
        console.error('handleFrameResult error:', err);
      });
    }
  });

  ipcMain.on(IpcChannels.RENDER_READY, (_event, frameIndex: number) => {
    if (activeExportService) {
      activeExportService.handleFrameReady(frameIndex).catch((err: Error) => {
        console.error('handleFrameReady error:', err);
      });
    }
  });

  ipcMain.on(IpcChannels.RENDER_ERROR, (_event, payload: { frameIndex: number; error: string }) => {
    if (activeExportService) {
      activeExportService.handleFrameError(payload.frameIndex, payload.error);
    }
  });
}

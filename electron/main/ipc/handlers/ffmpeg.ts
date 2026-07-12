import { ipcMain } from 'electron';
import { IpcChannels } from '../../../../shared/ipc-channels';
import { FFmpegAdapter } from '../../services/FFmpegAdapter';

const ffmpegAdapter = new FFmpegAdapter();

let configuredPath: string | null = null;

export function registerFfmpegIpc(): void {
  ipcMain.handle(IpcChannels.FFMPEG_GET_VERSION, async () => {
    try {
      const pathToUse = configuredPath || await ffmpegAdapter.findFfmpeg();
      ffmpegAdapter.setPath(pathToUse);
      const version = await ffmpegAdapter.getVersion();
      return { success: true, version };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IpcChannels.FFMPEG_VALIDATE_PATH, async (_event, ffmpegPath: string) => {
    const isValid = await ffmpegAdapter.validatePath(ffmpegPath);
    return { success: true, valid: isValid };
  });

  ipcMain.handle(IpcChannels.FFMPEG_SET_PATH, async (_event, ffmpegPath: string) => {
    const isValid = await ffmpegAdapter.validatePath(ffmpegPath);
    if (isValid) {
      configuredPath = ffmpegPath;
      ffmpegAdapter.setPath(ffmpegPath);
      return { success: true };
    }
    return { success: false, error: 'Invalid FFmpeg path' };
  });
}

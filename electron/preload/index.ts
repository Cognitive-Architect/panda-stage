import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels } from '../../shared/ipc-channels';
import type { Project, ExportConfig, ExportProgress } from '../../shared/types';

const api = {
  project: {
    create: () => ipcRenderer.invoke(IpcChannels.PROJECT_CREATE),
    open: () => ipcRenderer.invoke(IpcChannels.PROJECT_OPEN),
    save: (project: Project) => ipcRenderer.invoke(IpcChannels.PROJECT_SAVE, project),
    migrate: (data: unknown) => ipcRenderer.invoke(IpcChannels.PROJECT_MIGRATE, data),
  },
  asset: {
    import: (filePath: string) => ipcRenderer.invoke(IpcChannels.ASSET_IMPORT, filePath),
    delete: (assetId: string) => ipcRenderer.invoke(IpcChannels.ASSET_DELETE, assetId),
  },
  export: {
    start: (config: ExportConfig) => ipcRenderer.invoke(IpcChannels.EXPORT_START, config),
    cancel: () => ipcRenderer.invoke(IpcChannels.EXPORT_CANCEL),
    onProgress: (callback: (progress: ExportProgress) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: ExportProgress) => callback(progress);
      ipcRenderer.on(IpcChannels.EXPORT_PROGRESS, handler);
      return () => ipcRenderer.removeListener(IpcChannels.EXPORT_PROGRESS, handler);
    },
    onComplete: (callback: (outputPath: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, outputPath: string) => callback(outputPath);
      ipcRenderer.on(IpcChannels.EXPORT_COMPLETE, handler);
      return () => ipcRenderer.removeListener(IpcChannels.EXPORT_COMPLETE, handler);
    },
    onError: (callback: (error: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, error: string) => callback(error);
      ipcRenderer.on(IpcChannels.EXPORT_ERROR, handler);
      return () => ipcRenderer.removeListener(IpcChannels.EXPORT_ERROR, handler);
    },
  },
  ffmpeg: {
    getVersion: () => ipcRenderer.invoke(IpcChannels.FFMPEG_GET_VERSION),
    validatePath: (ffmpegPath: string) => ipcRenderer.invoke(IpcChannels.FFMPEG_VALIDATE_PATH, ffmpegPath),
    setPath: (ffmpegPath: string) => ipcRenderer.invoke(IpcChannels.FFMPEG_SET_PATH, ffmpegPath),
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;

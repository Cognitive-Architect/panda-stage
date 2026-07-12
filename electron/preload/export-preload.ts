import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels } from '../../shared/ipc-channels';
import type { Project, RenderFrameRequest, RenderFrameResult } from '../../shared/types';

const exportApi = {
  // 接收完整项目数据（仅一次）
  onExportStart: (callback: (project: Project) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, project: Project) => callback(project);
    ipcRenderer.on(IpcChannels.EXPORT_START, handler);
    return () => ipcRenderer.removeListener(IpcChannels.EXPORT_START, handler);
  },
  // 接收帧渲染请求（frameIndex + timeMs）
  onRenderFrame: (callback: (request: RenderFrameRequest) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, request: RenderFrameRequest) => callback(request);
    ipcRenderer.on(IpcChannels.RENDER_FRAME, handler);
    return () => ipcRenderer.removeListener(IpcChannels.RENDER_FRAME, handler);
  },
  // 发送帧渲染完成（方式 B）
  frameDone: (result: RenderFrameResult) => ipcRenderer.send(IpcChannels.RENDER_FRAME_DONE, result),
  // 发送帧就绪（方式 A）
  frameReady: (frameIndex: number) => ipcRenderer.send(IpcChannels.RENDER_READY, frameIndex),
  // 发送错误
  frameError: (frameIndex: number, error: string) => {
    ipcRenderer.send(IpcChannels.RENDER_ERROR, { frameIndex, error });
  },
  // 监听取消信号
  onCancel: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on(IpcChannels.RENDER_CANCEL, handler);
    return () => ipcRenderer.removeListener(IpcChannels.RENDER_CANCEL, handler);
  },
  // 方式 B: 发送 canvas.toBlob() 获取的 ArrayBuffer
  sendFrameBuffer: (frameIndex: number, buffer: ArrayBuffer) => {
    const result: RenderFrameResult = {
      frameIndex,
      buffer: new Uint8Array(buffer),
      method: 'canvas',
    };
    ipcRenderer.send(IpcChannels.RENDER_FRAME_DONE, result);
  },
};

contextBridge.exposeInMainWorld('exportAPI', exportApi);

export type ExportAPI = typeof exportApi;

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  FlaWorkerErrorSchema,
  FlaWorkerProgressSchema,
  FlaWorkerResultSchema,
  FlaWorkerStartRequestSchema,
} from '../shared/fla-import-api';
import { IPC_CHANNELS } from '../shared/ipc/channels';

const api = {
  ready(): void {
    ipcRenderer.send(IPC_CHANNELS.FLA_WORKER_READY);
  },
  onStart(callback: (request: unknown) => void): () => void {
    const listener = (_event: IpcRendererEvent, value: unknown) => {
      const parsed = FlaWorkerStartRequestSchema.safeParse(value);
      if (parsed.success) callback(parsed.data);
    };
    ipcRenderer.on(IPC_CHANNELS.FLA_WORKER_START, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.FLA_WORKER_START, listener);
  },
  onCancel(callback: (sessionId: string) => void): () => void {
    const listener = (_event: IpcRendererEvent, value: unknown) => {
      if (typeof value === 'string') callback(value);
    };
    ipcRenderer.on(IPC_CHANNELS.FLA_WORKER_CANCEL, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.FLA_WORKER_CANCEL, listener);
  },
  progress(payload: unknown): void {
    const parsed = FlaWorkerProgressSchema.safeParse(payload);
    if (parsed.success) ipcRenderer.send(IPC_CHANNELS.FLA_WORKER_PROGRESS, parsed.data);
  },
  result(payload: unknown): void {
    const parsed = FlaWorkerResultSchema.safeParse(payload);
    if (parsed.success) ipcRenderer.send(IPC_CHANNELS.FLA_WORKER_RESULT, parsed.data);
  },
  error(payload: unknown): void {
    const parsed = FlaWorkerErrorSchema.safeParse(payload);
    if (parsed.success) ipcRenderer.send(IPC_CHANNELS.FLA_WORKER_ERROR, parsed.data);
  },
};

contextBridge.exposeInMainWorld('pandaStageFlaParser', Object.freeze(api));

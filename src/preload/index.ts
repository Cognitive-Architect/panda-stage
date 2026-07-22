import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc/channels';
import {
  AppPingRequestSchema,
  AppPingResponseSchema,
} from '../shared/ipc/contracts';
import {
  ExportCancelRequestSchema,
  ExportCancelResponseSchema,
  ExportJobUpdateSchema,
  ExportStartResponseSchema,
  FullProbeExportRequestSchema,
  type ExportJobUpdate,
  type FullProbeExportRequest,
} from '../shared/export-types';

type Unsubscribe = () => void;

const pandaStageApi = Object.freeze({
  app: Object.freeze({
    ping: async () => {
      const request = AppPingRequestSchema.parse({});
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.APP_PING,
        request,
      );
      return AppPingResponseSchema.parse(response);
    },
  }),
  export: Object.freeze({
    startProbe: async (rawRequest: FullProbeExportRequest) => {
      const request = FullProbeExportRequestSchema.parse(rawRequest);
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.EXPORT_START_PROBE,
        request,
      );
      return ExportStartResponseSchema.parse(response);
    },
    cancel: async (jobId: string) => {
      const request = ExportCancelRequestSchema.parse({ jobId });
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.EXPORT_CANCEL_JOB,
        request,
      );
      return ExportCancelResponseSchema.parse(response);
    },
    onUpdate: (callback: (update: ExportJobUpdate) => void): Unsubscribe => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        rawUpdate: unknown,
      ) => callback(ExportJobUpdateSchema.parse(rawUpdate));
      ipcRenderer.on(IPC_CHANNELS.EXPORT_JOB_UPDATE, listener);
      return () =>
        ipcRenderer.removeListener(IPC_CHANNELS.EXPORT_JOB_UPDATE, listener);
    },
  }),
});

contextBridge.exposeInMainWorld('pandaStage', pandaStageApi);

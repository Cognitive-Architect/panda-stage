import { contextBridge, ipcRenderer } from 'electron';
import { ProjectSchema } from '../domain';
import {
  ExportFrameFailedSchema,
  ExportFrameReadySchema,
  ExportCancelRenderRequestSchema,
  ExportLoadProbeRequestSchema,
  ExportLoadFormalRequestSchema,
  ExportFormalLoadedSchema,
  ExportProbeLoadedSchema,
  ExportRenderFrameRequestSchema,
  type ExportFrameFailed,
  type ExportFrameReady,
  type ExportLoadProbeRequest,
  type ExportLoadFormalRequest,
  type ExportRenderFrameRequest,
  type ExportCancelRenderRequest,
} from '../shared/export-types';
import { IPC_CHANNELS } from '../shared/ipc/channels';
import {
  HiddenReadyRequestSchema,
  HiddenReadyResponseSchema,
} from '../shared/ipc/contracts';

type Unsubscribe = () => void;

function onValidatedMessage<T>(
  channel: string,
  parse: (rawPayload: unknown) => T,
  callback: (payload: T) => void,
): Unsubscribe {
  const listener = (_event: Electron.IpcRendererEvent, rawPayload: unknown) => {
    callback(parse(rawPayload));
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const hiddenApi = Object.freeze({
  ready: async () => {
    const request = HiddenReadyRequestSchema.parse({
      role: 'hidden-renderer',
      loadedAtMs: Date.now(),
    });
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.HIDDEN_READY,
      request,
    );
    return HiddenReadyResponseSchema.parse(response);
  },
  onLoadProbe: (callback: (request: ExportLoadProbeRequest) => void) =>
    onValidatedMessage(
      IPC_CHANNELS.EXPORT_LOAD_PROBE,
      (payload) => ExportLoadProbeRequestSchema.parse(payload),
      callback,
    ),
  onLoadFormal: (callback: (request: ExportLoadFormalRequest) => void) =>
    onValidatedMessage(
      IPC_CHANNELS.EXPORT_LOAD_FORMAL,
      (payload) => {
        const parsed = ExportLoadFormalRequestSchema.parse(payload);
        return {
          ...parsed,
          project: ProjectSchema.parse(parsed.project),
        } as ExportLoadFormalRequest;
      },
      callback,
    ),
  probeLoaded: (rawPayload: unknown) => {
    const payload = ExportProbeLoadedSchema.parse(rawPayload);
    ipcRenderer.send(IPC_CHANNELS.EXPORT_PROBE_LOADED, payload);
  },
  formalLoaded: (rawPayload: unknown) => {
    const payload = ExportFormalLoadedSchema.parse(rawPayload);
    ipcRenderer.send(IPC_CHANNELS.EXPORT_FORMAL_LOADED, payload);
  },
  onRenderFrame: (callback: (request: ExportRenderFrameRequest) => void) =>
    onValidatedMessage(
      IPC_CHANNELS.EXPORT_RENDER_FRAME,
      (payload) => ExportRenderFrameRequestSchema.parse(payload),
      callback,
    ),
  onCancelExport: (
    callback: (request: ExportCancelRenderRequest) => void,
  ) =>
    onValidatedMessage(
      IPC_CHANNELS.EXPORT_CANCEL_RENDER,
      (payload) => ExportCancelRenderRequestSchema.parse(payload),
      callback,
    ),
  frameReady: (rawPayload: ExportFrameReady) => {
    const payload = ExportFrameReadySchema.parse(rawPayload);
    ipcRenderer.send(IPC_CHANNELS.EXPORT_FRAME_READY, payload);
  },
  frameFailed: (rawPayload: ExportFrameFailed) => {
    const payload = ExportFrameFailedSchema.parse(rawPayload);
    ipcRenderer.send(IPC_CHANNELS.EXPORT_FRAME_FAILED, payload);
  },
});

contextBridge.exposeInMainWorld('pandaStageHidden', hiddenApi);

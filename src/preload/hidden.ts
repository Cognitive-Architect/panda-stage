import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc/channels';
import {
  HiddenReadyRequestSchema,
  HiddenReadyResponseSchema,
} from '../shared/ipc/contracts';

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
});

contextBridge.exposeInMainWorld('pandaStageHidden', hiddenApi);

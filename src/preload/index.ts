import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc/channels';
import {
  AppPingRequestSchema,
  AppPingResponseSchema,
} from '../shared/ipc/contracts';

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
});

contextBridge.exposeInMainWorld('pandaStage', pandaStageApi);

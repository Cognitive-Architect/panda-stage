import type {
  AppPingResponse,
  HiddenReadyResponse,
} from '../shared/ipc/contracts';

declare global {
  interface Window {
    pandaStage: {
      app: {
        ping: () => Promise<AppPingResponse>;
      };
    };
    pandaStageHidden: {
      ready: () => Promise<HiddenReadyResponse>;
    };
  }
}

export {};

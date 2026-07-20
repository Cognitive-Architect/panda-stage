import type {
  AppPingResponse,
  HiddenReadyResponse,
} from '../shared/ipc/contracts';
import type {
  ExportFrameFailed,
  ExportFrameReady,
  ExportLoadProbeRequest,
  ExportRenderFrameRequest,
} from '../shared/export-types';

declare global {
  interface Window {
    pandaStage: {
      app: {
        ping: () => Promise<AppPingResponse>;
      };
    };
    pandaStageHidden: {
      ready: () => Promise<HiddenReadyResponse>;
      onLoadProbe: (
        callback: (request: ExportLoadProbeRequest) => void,
      ) => () => void;
      probeLoaded: (payload: {
        jobId: string;
        acknowledged: true;
      }) => void;
      onRenderFrame: (
        callback: (request: ExportRenderFrameRequest) => void,
      ) => () => void;
      frameReady: (payload: ExportFrameReady) => void;
      frameFailed: (payload: ExportFrameFailed) => void;
    };
  }
}

export {};

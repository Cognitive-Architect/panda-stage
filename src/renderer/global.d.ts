import type {
  AppPingResponse,
  HiddenReadyResponse,
} from '../shared/ipc/contracts';
import type {
  ExportFrameFailed,
  ExportFrameReady,
  ExportLoadProbeRequest,
  ExportRenderFrameRequest,
  ExportCancelRenderRequest,
} from '../shared/export-types';
import type {
  AutosaveTrackRequest,
  AutosaveUpdateRequest,
  RecoveryAcknowledgeResponse,
  RecoveryDetectResponse,
  RecoveryError,
  RecoveryIgnoreResponse,
  RecoveryRestoreResponse,
  RecoverySelectionRequest,
} from '../shared/recovery-api';
import type {
  ProjectCreateRequest,
  ProjectOpenRequest,
  ProjectOperationResponse,
  ProjectSaveRequest,
} from '../shared/project-api';
import type {
  ExportCancelResponse,
  ExportJobUpdate,
  ExportStartResponse,
  FullProbeExportRequest,
} from '../shared/export-types';

declare global {
  interface Window {
    pandaStage: {
      app: {
        ping: () => Promise<AppPingResponse>;
      };
      project: {
        create: (
          request: ProjectCreateRequest,
        ) => Promise<ProjectOperationResponse>;
        open: (
          request: ProjectOpenRequest,
        ) => Promise<ProjectOperationResponse>;
        save: (
          request: ProjectSaveRequest,
        ) => Promise<ProjectOperationResponse>;
      };
      autosave: {
        track: (
          request: AutosaveTrackRequest,
        ) => Promise<RecoveryAcknowledgeResponse>;
        update: (
          request: AutosaveUpdateRequest,
        ) => Promise<RecoveryAcknowledgeResponse>;
        stop: (
          projectRoot: string,
        ) => Promise<RecoveryAcknowledgeResponse>;
        onError: (
          callback: (error: RecoveryError) => void,
        ) => () => void;
      };
      recovery: {
        detect: (projectRoot: string) => Promise<RecoveryDetectResponse>;
        restore: (
          request: RecoverySelectionRequest,
        ) => Promise<RecoveryRestoreResponse>;
        ignore: (
          request: RecoverySelectionRequest,
        ) => Promise<RecoveryIgnoreResponse>;
      };
      export: {
        startProbe: (
          request: FullProbeExportRequest,
        ) => Promise<ExportStartResponse>;
        cancel: (jobId: string) => Promise<ExportCancelResponse>;
        onUpdate: (callback: (update: ExportJobUpdate) => void) => () => void;
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
      onCancelExport: (
        callback: (request: ExportCancelRenderRequest) => void,
      ) => () => void;
      frameReady: (payload: ExportFrameReady) => void;
      frameFailed: (payload: ExportFrameFailed) => void;
    };
  }
}

export {};

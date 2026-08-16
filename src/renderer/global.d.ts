import type {
  AssetImportProjectRequest,
  AssetImportResponse,
} from '../shared/asset-import-api';
import type {
  AssetMetadataCancelResponse,
  AssetMetadataRequest,
  AssetMetadataResponse,
} from '../shared/asset-metadata-api';
import type {
  AssetDeleteRequest,
  AssetDeleteResponse,
} from '../shared/asset-delete-api';
import type {
  AssetThumbnailReadRequest,
  AssetThumbnailReadResponse,
} from '../shared/asset-thumbnail-api';
import type {
  AssetCanvasImageReadRequest,
  AssetCanvasImageReadResponse,
} from '../shared/asset-canvas-image-api';
import type {
  AssetAudioReadRequest,
  AssetAudioReadResponse,
} from '../shared/asset-audio-api';
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
  RecentProjectsListResponse,
  RecentProjectsOpenRequest,
  RecentProjectsOpenResponse,
  RecentProjectsRelocateRequest,
  RecentProjectsRelocateResponse,
  RecentProjectsRemoveRequest,
} from '../shared/recent-projects-api';
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
  ProjectChooseDirectoryResponse,
  ProjectCreateAtRequest,
  ProjectCreateRequest,
  ProjectOpenRequest,
  ProjectOpenFolderResponse,
  ProjectOperationResponse,
  ProjectSaveRequest,
  ProjectSwitchGuardRequest,
  ProjectSwitchGuardResponse,
} from '../shared/project-api';
import type {
  ExportCancelResponse,
  ExportJobUpdate,
  ExportStartResponse,
  FullProbeExportRequest,
} from '../shared/export-types';
import type {
  NativeCloseSyncRequest,
  NativeCloseSyncResponse,
} from '../shared/native-close-sync';

declare global {
  interface Window {
    pandaStage: {
      app: {
        ping: () => Promise<AppPingResponse>;
      };
      project: {
        chooseDirectory: () => Promise<ProjectChooseDirectoryResponse>;
        openFolder: (
          projectRoot: string,
        ) => Promise<ProjectOpenFolderResponse>;
        confirmSwitch: (
          request: ProjectSwitchGuardRequest,
        ) => Promise<ProjectSwitchGuardResponse>;
        create: (
          request: ProjectCreateRequest,
        ) => Promise<ProjectOperationResponse>;
        createAt: (
          request: ProjectCreateAtRequest,
        ) => Promise<ProjectOperationResponse>;
        open: (
          request: ProjectOpenRequest,
        ) => Promise<ProjectOperationResponse>;
        save: (
          request: ProjectSaveRequest,
        ) => Promise<ProjectOperationResponse>;
      };
      assets: {
        choose: (
          request: AssetImportProjectRequest,
        ) => Promise<AssetImportResponse>;
        importDropped: (
          request: AssetImportProjectRequest,
          files: readonly File[],
        ) => Promise<AssetImportResponse>;
        refreshMetadata: (
          request: AssetMetadataRequest,
        ) => Promise<AssetMetadataResponse>;
        cancelMetadata: (
          requestId: string,
        ) => Promise<AssetMetadataCancelResponse>;
        delete: (
          request: AssetDeleteRequest,
        ) => Promise<AssetDeleteResponse>;
        readThumbnail: (
          request: AssetThumbnailReadRequest,
        ) => Promise<AssetThumbnailReadResponse>;
        readCanvasImage: (
          request: AssetCanvasImageReadRequest,
        ) => Promise<AssetCanvasImageReadResponse>;
        readAudio: (
          request: AssetAudioReadRequest,
        ) => Promise<AssetAudioReadResponse>;
      };
      recentProjects: {
        list: () => Promise<RecentProjectsListResponse>;
        open: (
          request: RecentProjectsOpenRequest,
        ) => Promise<RecentProjectsOpenResponse>;
        remove: (
          request: RecentProjectsRemoveRequest,
        ) => Promise<RecentProjectsListResponse>;
        relocate: (
          request: RecentProjectsRelocateRequest,
        ) => Promise<RecentProjectsRelocateResponse>;
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
      nativeClose: {
        onSyncRequest: (
          callback: (request: NativeCloseSyncRequest) => void,
        ) => () => void;
        respondSync: (response: NativeCloseSyncResponse) => void;
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

import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc/channels';
import {
  AssetImportDroppedRequestSchema,
  AssetImportProjectRequestSchema,
  AssetImportResponseSchema,
  declaredMimeTypeForAssetPath,
  type AssetImportProjectRequest,
} from '../shared/asset-import-api';
import {
  AssetMetadataCancelRequestSchema,
  AssetMetadataCancelResponseSchema,
  AssetMetadataRequestSchema,
  AssetMetadataResponseSchema,
  type AssetMetadataRequest,
} from '../shared/asset-metadata-api';
import {
  AssetDeleteRequestSchema,
  AssetDeleteResponseSchema,
  type AssetDeleteRequest,
} from '../shared/asset-delete-api';
import {
  AssetThumbnailReadRequestSchema,
  AssetThumbnailReadResponseSchema,
  type AssetThumbnailReadRequest,
} from '../shared/asset-thumbnail-api';
import {
  AssetCanvasImageReadRequestSchema,
  AssetCanvasImageReadResponseSchema,
  type AssetCanvasImageReadRequest,
} from '../shared/asset-canvas-image-api';
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
import {
  ProjectChooseDirectoryRequestSchema,
  ProjectChooseDirectoryResponseSchema,
  ProjectCreateAtRequestSchema,
  ProjectCreateRequestSchema,
  ProjectOpenFolderRequestSchema,
  ProjectOpenFolderResponseSchema,
  ProjectOpenRequestSchema,
  ProjectOperationResponseSchema,
  ProjectSaveRequestSchema,
  ProjectSwitchGuardRequestSchema,
  ProjectSwitchGuardResponseSchema,
  type ProjectCreateAtRequest,
  type ProjectCreateRequest,
  type ProjectOpenRequest,
  type ProjectSaveRequest,
  type ProjectSwitchGuardRequest,
} from '../shared/project-api';
import {
  AutosaveErrorEventSchema,
  AutosaveStopRequestSchema,
  AutosaveTrackRequestSchema,
  AutosaveUpdateRequestSchema,
  RecoveryAcknowledgeResponseSchema,
  RecoveryDetectRequestSchema,
  RecoveryDetectResponseSchema,
  RecoveryIgnoreResponseSchema,
  RecoveryRestoreResponseSchema,
  RecoverySelectionRequestSchema,
  type AutosaveTrackRequest,
  type AutosaveUpdateRequest,
  type RecoveryError,
  type RecoverySelectionRequest,
} from '../shared/recovery-api';
import {
  RecentProjectsListRequestSchema,
  RecentProjectsListResponseSchema,
  RecentProjectsOpenRequestSchema,
  RecentProjectsOpenResponseSchema,
  RecentProjectsRelocateRequestSchema,
  RecentProjectsRelocateResponseSchema,
  RecentProjectsRemoveRequestSchema,
  type RecentProjectsRelocateRequest,
  type RecentProjectsOpenRequest,
  type RecentProjectsRemoveRequest,
} from '../shared/recent-projects-api';
import {
  NativeCloseSyncRequestSchema,
  NativeCloseSyncResponseSchema,
  type NativeCloseSyncRequest,
  type NativeCloseSyncResponse,
} from '../shared/native-close-sync';
import {
  FlaCancelRequestSchema,
  FlaCancelResponseSchema,
  FlaInspectRequestSchema,
  FlaInspectionStartedSchema,
  FlaInspectionResponseSchema,
  type FlaInspectionStarted,
} from '../shared/fla-import-api';
import {
  FlaAssetCommitRequestSchema,
  FlaAssetCommitResponseSchema,
  type FlaAssetCommitRequest,
} from '../shared/fla-asset-commit-api';
import {
  FlaRenderableTargetCatalogRequestSchema,
  FlaRenderableTargetCatalogResponseSchema,
  FlaStaticSnapshotCancelRequestSchema,
  FlaStaticSnapshotCancelResponseSchema,
  FlaStaticSnapshotCommitRequestSchema,
  FlaStaticSnapshotCommitResponseSchema,
  FlaStaticSnapshotPreviewRequestSchema,
  FlaStaticSnapshotPreviewResponseSchema,
  type FlaRenderableTargetCatalogRequest,
  type FlaStaticSnapshotCancelRequest,
  type FlaStaticSnapshotCommitRequest,
  type FlaStaticSnapshotPreviewRequest,
} from '../shared/fla-static-snapshot-api';
import {
  FlaFrameSequenceCancelRequestSchema,
  FlaFrameSequenceCancelResponseSchema,
  FlaFrameSequenceCommitRequestSchema,
  FlaFrameSequenceCommitResponseSchema,
  FlaFrameSequenceProgressSchema,
  FlaFrameSequenceRequestSchema,
  FlaFrameSequenceResponseSchema,
  type FlaFrameSequenceCancelRequest,
  type FlaFrameSequenceCommitRequest,
  type FlaFrameSequenceProgress,
  type FlaFrameSequenceRequest,
} from '../shared/fla-frame-sequence-api';

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
  project: Object.freeze({
    chooseDirectory: async () => {
      const request = ProjectChooseDirectoryRequestSchema.parse({});
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY,
        request,
      );
      return ProjectChooseDirectoryResponseSchema.parse(response);
    },
    openFolder: async (projectRoot: string) => {
      const request = ProjectOpenFolderRequestSchema.parse({ projectRoot });
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.PROJECT_OPEN_FOLDER,
        request,
      );
      return ProjectOpenFolderResponseSchema.parse(response);
    },
    confirmSwitch: async (rawRequest: ProjectSwitchGuardRequest) => {
      const request = ProjectSwitchGuardRequestSchema.parse(rawRequest);
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.PROJECT_CONFIRM_SWITCH,
        request,
      );
      return ProjectSwitchGuardResponseSchema.parse(response);
    },
    create: async (rawRequest: ProjectCreateRequest) => {
      const request = ProjectCreateRequestSchema.parse(rawRequest);
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.PROJECT_CREATE,
        request,
      );
      return ProjectOperationResponseSchema.parse(response);
    },
    createAt: async (rawRequest: ProjectCreateAtRequest) => {
      const request = ProjectCreateAtRequestSchema.parse(rawRequest);
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.PROJECT_CREATE_AT,
        request,
      );
      return ProjectOperationResponseSchema.parse(response);
    },
    open: async (rawRequest: ProjectOpenRequest) => {
      const request = ProjectOpenRequestSchema.parse(rawRequest);
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.PROJECT_OPEN,
        request,
      );
      return ProjectOperationResponseSchema.parse(response);
    },
    save: async (rawRequest: ProjectSaveRequest) => {
      const request = ProjectSaveRequestSchema.parse(rawRequest);
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.PROJECT_SAVE,
        request,
      );
      return ProjectOperationResponseSchema.parse(response);
    },
  }),
  assets: Object.freeze({
    choose: async (rawRequest: AssetImportProjectRequest) => {
      const request = AssetImportProjectRequestSchema.parse(rawRequest);
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.ASSET_IMPORT_CHOOSE,
        request,
      );
      return AssetImportResponseSchema.parse(response);
    },
    importDropped: async (
      rawRequest: AssetImportProjectRequest,
      files: ReadonlyArray<
        Parameters<typeof webUtils.getPathForFile>[0] & {
          readonly type: string;
        }
      >,
    ) => {
      const projectRequest =
        AssetImportProjectRequestSchema.parse(rawRequest);
      const request = AssetImportDroppedRequestSchema.parse({
        ...projectRequest,
        candidates: files.map((file) => ({
          sourcePath: webUtils.getPathForFile(file),
          declaredMimeType:
            file.type.trim() ||
            declaredMimeTypeForAssetPath(file.name) ||
            'application/octet-stream',
        })),
      });
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.ASSET_IMPORT_DROPPED,
        request,
      );
      return AssetImportResponseSchema.parse(response);
    },
    refreshMetadata: async (rawRequest: AssetMetadataRequest) => {
      const request = AssetMetadataRequestSchema.parse(rawRequest);
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.ASSET_METADATA_REFRESH,
        request,
      );
      return AssetMetadataResponseSchema.parse(response);
    },
    cancelMetadata: async (requestId: string) => {
      const request = AssetMetadataCancelRequestSchema.parse({
        requestId,
      });
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.ASSET_METADATA_CANCEL,
        request,
      );
      return AssetMetadataCancelResponseSchema.parse(response);
    },
    delete: async (rawRequest: AssetDeleteRequest) => {
      const request = AssetDeleteRequestSchema.parse(rawRequest);
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.ASSET_DELETE,
        request,
      );
      return AssetDeleteResponseSchema.parse(response);
    },
    readThumbnail: async (
      rawRequest: AssetThumbnailReadRequest,
    ) => {
      const request =
        AssetThumbnailReadRequestSchema.parse(rawRequest);
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.ASSET_THUMBNAIL_READ,
        request,
      );
      return AssetThumbnailReadResponseSchema.parse(response);
    },
    readCanvasImage: async (
      rawRequest: AssetCanvasImageReadRequest,
    ) => {
      const request =
        AssetCanvasImageReadRequestSchema.parse(rawRequest);
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ,
        request,
      );
      return AssetCanvasImageReadResponseSchema.parse(response);
    },
  }),
  recentProjects: Object.freeze({
    list: async () => {
      const request = RecentProjectsListRequestSchema.parse({});
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.RECENT_PROJECTS_LIST,
        request,
      );
      return RecentProjectsListResponseSchema.parse(response);
    },
    open: async (rawRequest: RecentProjectsOpenRequest) => {
      const request = RecentProjectsOpenRequestSchema.parse(rawRequest);
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.RECENT_PROJECTS_OPEN,
        request,
      );
      return RecentProjectsOpenResponseSchema.parse(response);
    },
    remove: async (rawRequest: RecentProjectsRemoveRequest) => {
      const request = RecentProjectsRemoveRequestSchema.parse(rawRequest);
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.RECENT_PROJECTS_REMOVE,
        request,
      );
      return RecentProjectsListResponseSchema.parse(response);
    },
    relocate: async (rawRequest: RecentProjectsRelocateRequest) => {
      const request =
        RecentProjectsRelocateRequestSchema.parse(rawRequest);
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.RECENT_PROJECTS_RELOCATE,
        request,
      );
      return RecentProjectsRelocateResponseSchema.parse(response);
    },
  }),
  autosave: Object.freeze({
    track: async (rawRequest: AutosaveTrackRequest) => {
      const request = AutosaveTrackRequestSchema.parse(rawRequest);
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.AUTOSAVE_TRACK,
        request,
      );
      return RecoveryAcknowledgeResponseSchema.parse(response);
    },
    update: async (rawRequest: AutosaveUpdateRequest) => {
      const request = AutosaveUpdateRequestSchema.parse(rawRequest);
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.AUTOSAVE_UPDATE,
        request,
      );
      return RecoveryAcknowledgeResponseSchema.parse(response);
    },
    stop: async (projectRoot: string) => {
      const request = AutosaveStopRequestSchema.parse({ projectRoot });
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.AUTOSAVE_STOP,
        request,
      );
      return RecoveryAcknowledgeResponseSchema.parse(response);
    },
    onError: (callback: (error: RecoveryError) => void): Unsubscribe => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        rawError: unknown,
      ) => callback(AutosaveErrorEventSchema.parse(rawError));
      ipcRenderer.on(IPC_CHANNELS.AUTOSAVE_ERROR, listener);
      return () =>
        ipcRenderer.removeListener(IPC_CHANNELS.AUTOSAVE_ERROR, listener);
    },
  }),
  nativeClose: Object.freeze({
    onSyncRequest: (
      callback: (request: NativeCloseSyncRequest) => void,
    ): Unsubscribe => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        rawRequest: unknown,
      ) => callback(NativeCloseSyncRequestSchema.parse(rawRequest));
      ipcRenderer.on(IPC_CHANNELS.NATIVE_CLOSE_SYNC_REQUEST, listener);
      return () =>
        ipcRenderer.removeListener(
          IPC_CHANNELS.NATIVE_CLOSE_SYNC_REQUEST,
          listener,
        );
    },
    respondSync: (rawResponse: NativeCloseSyncResponse): void => {
      const response = NativeCloseSyncResponseSchema.parse(rawResponse);
      ipcRenderer.send(IPC_CHANNELS.NATIVE_CLOSE_SYNC_RESPONSE, response);
    },
  }),
  recovery: Object.freeze({
    detect: async (projectRoot: string) => {
      const request = RecoveryDetectRequestSchema.parse({ projectRoot });
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.RECOVERY_DETECT,
        request,
      );
      return RecoveryDetectResponseSchema.parse(response);
    },
    restore: async (rawRequest: RecoverySelectionRequest) => {
      const request = RecoverySelectionRequestSchema.parse(rawRequest);
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.RECOVERY_RESTORE,
        request,
      );
      return RecoveryRestoreResponseSchema.parse(response);
    },
    ignore: async (rawRequest: RecoverySelectionRequest) => {
      const request = RecoverySelectionRequestSchema.parse(rawRequest);
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.RECOVERY_IGNORE,
        request,
      );
      return RecoveryIgnoreResponseSchema.parse(response);
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
  fla: Object.freeze({
    chooseAndInspect: async (requestId = crypto.randomUUID()) => {
      const request = FlaInspectRequestSchema.parse({ requestId });
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.FLA_INSPECT_CHOOSE,
        request,
      );
      return FlaInspectionResponseSchema.parse(response);
    },
    onInspectionStarted: (
      callback: (event: FlaInspectionStarted) => void,
    ): Unsubscribe => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        rawEvent: unknown,
      ) => callback(FlaInspectionStartedSchema.parse(rawEvent));
      ipcRenderer.on(IPC_CHANNELS.FLA_INSPECTION_STARTED, listener);
      return () =>
        ipcRenderer.removeListener(
          IPC_CHANNELS.FLA_INSPECTION_STARTED,
          listener,
        );
    },
    cancel: async (sessionId: string) => {
      const request = FlaCancelRequestSchema.parse({
        requestId: sessionId,
        sessionId,
      });
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.FLA_CANCEL,
        request,
      );
      return FlaCancelResponseSchema.parse(response);
    },
    commitSelected: async (rawRequest: FlaAssetCommitRequest) => {
      const request = FlaAssetCommitRequestSchema.parse(rawRequest);
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.FLA_COMMIT_SELECTED,
        request,
      );
      return FlaAssetCommitResponseSchema.parse(response);
    },
    staticSnapshotCatalog: async (rawRequest: FlaRenderableTargetCatalogRequest) => {
      const request = FlaRenderableTargetCatalogRequestSchema.parse(rawRequest);
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.FLA_SNAPSHOT_CATALOG,
        request,
      );
      return FlaRenderableTargetCatalogResponseSchema.parse(response);
    },
    staticSnapshotPreview: async (rawRequest: FlaStaticSnapshotPreviewRequest) => {
      const request = FlaStaticSnapshotPreviewRequestSchema.parse(rawRequest);
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.FLA_SNAPSHOT_PREVIEW,
        request,
      );
      return FlaStaticSnapshotPreviewResponseSchema.parse(response);
    },
    staticSnapshotCommit: async (rawRequest: FlaStaticSnapshotCommitRequest) => {
      const request = FlaStaticSnapshotCommitRequestSchema.parse(rawRequest);
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.FLA_SNAPSHOT_COMMIT,
        request,
      );
      return FlaStaticSnapshotCommitResponseSchema.parse(response);
    },
    staticSnapshotCancel: async (rawRequest: FlaStaticSnapshotCancelRequest) => {
      const request = FlaStaticSnapshotCancelRequestSchema.parse(rawRequest);
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.FLA_SNAPSHOT_CANCEL,
        request,
      );
      return FlaStaticSnapshotCancelResponseSchema.parse(response);
    },
    // V2-R2 Frame Sequence (Issue #294).  Bounded contiguous frame range
    // preview, per-session cancel, and N-frame ImageAsset commit.  The
    // renderer only sends serialized R2 contract objects; the per-frame
    // PNG bytes stay on the Main side of the process boundary (R2-E
    // invariant — no Renderer PNG accumulation).
    frameSequenceRender: async (rawRequest: FlaFrameSequenceRequest) => {
      const request = FlaFrameSequenceRequestSchema.parse(rawRequest);
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.FLA_FRAME_SEQUENCE_RENDER,
        request,
      );
      return FlaFrameSequenceResponseSchema.parse(response);
    },
    frameSequenceCancel: async (rawRequest: FlaFrameSequenceCancelRequest) => {
      const request = FlaFrameSequenceCancelRequestSchema.parse(rawRequest);
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.FLA_FRAME_SEQUENCE_CANCEL,
        request,
      );
      return FlaFrameSequenceCancelResponseSchema.parse(response);
    },
    frameSequenceCommit: async (rawRequest: FlaFrameSequenceCommitRequest) => {
      const request = FlaFrameSequenceCommitRequestSchema.parse(rawRequest);
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.FLA_FRAME_SEQUENCE_COMMIT,
        request,
      );
      return FlaFrameSequenceCommitResponseSchema.parse(response);
    },
    // R2-B (Corrective B): narrow typed progress subscription. The
    // Renderer receives only the Panda-owned R2 progress contract; the
    // raw ipcRenderer.on primitive is never exposed to the Renderer.
    frameSequenceProgressSubscribe: (
      callback: (progress: FlaFrameSequenceProgress) => void,
    ): Unsubscribe => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        rawProgress: unknown,
      ) => callback(FlaFrameSequenceProgressSchema.parse(rawProgress));
      ipcRenderer.on(IPC_CHANNELS.FLA_FRAME_SEQUENCE_PROGRESS, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.FLA_FRAME_SEQUENCE_PROGRESS, listener);
    },
  }),
});

contextBridge.exposeInMainWorld('pandaStage', pandaStageApi);

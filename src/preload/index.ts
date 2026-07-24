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
import {
  ProjectCreateRequestSchema,
  ProjectOpenRequestSchema,
  ProjectOperationResponseSchema,
  ProjectSaveRequestSchema,
  type ProjectCreateRequest,
  type ProjectOpenRequest,
  type ProjectSaveRequest,
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
  RecentProjectsRelocateRequestSchema,
  RecentProjectsRelocateResponseSchema,
  RecentProjectsRemoveRequestSchema,
  type RecentProjectsRelocateRequest,
  type RecentProjectsRemoveRequest,
} from '../shared/recent-projects-api';

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
    create: async (rawRequest: ProjectCreateRequest) => {
      const request = ProjectCreateRequestSchema.parse(rawRequest);
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.PROJECT_CREATE,
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
  recentProjects: Object.freeze({
    list: async () => {
      const request = RecentProjectsListRequestSchema.parse({});
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.RECENT_PROJECTS_LIST,
        request,
      );
      return RecentProjectsListResponseSchema.parse(response);
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
});

contextBridge.exposeInMainWorld('pandaStage', pandaStageApi);

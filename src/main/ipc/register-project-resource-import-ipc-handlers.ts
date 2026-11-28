import {
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import {
  ProjectResourceImportApplyRequestSchema,
  ProjectResourceImportApplyResponseSchema,
  ProjectResourceImportChooseRequestSchema,
  ProjectResourceImportChooseResponseSchema,
  ProjectResourceImportPreviewRequestSchema,
  ProjectResourceImportPreviewResponseSchema,
  type ProjectResourceImportError,
} from '../../shared/project-resource-import-api';
import {
  ProjectResourceImportService,
  ProjectResourceImportServiceError,
} from '../services/ProjectResourceImportService';

export interface ProjectResourceImportIpcHandlerDependencies {
  getMainWindow: () => BrowserWindow | null;
  projectResourceImportService: ProjectResourceImportService;
  selectSourceProjectDirectory: (
    window: BrowserWindow,
  ) => Promise<string | null>;
}

function assertTrustedSender(
  event: IpcMainInvokeEvent,
  expectedWindow: BrowserWindow | null,
  channel: string,
): BrowserWindow {
  if (!expectedWindow || expectedWindow.isDestroyed()) {
    throw new Error(`IPC ${channel} rejected: target window is unavailable.`);
  }
  if (event.sender.id !== expectedWindow.webContents.id) {
    throw new Error(`IPC ${channel} rejected: untrusted sender.`);
  }
  return expectedWindow;
}

function toImportError(
  error: unknown,
  projectRoot: string,
): ProjectResourceImportError {
  const normalized =
    error instanceof ProjectResourceImportServiceError
      ? error
      : new ProjectResourceImportServiceError(
          'PROJECT_RESOURCE_OPERATION_FAILED',
          projectRoot,
          `跨项目导入失败：${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
  return {
    code: normalized.code,
    message: normalized.message,
    projectRoot: normalized.projectRoot,
    ...(normalized.currentProject
      ? { currentProject: normalized.currentProject }
      : {}),
    ...(normalized.currentRevision !== undefined
      ? { currentRevision: normalized.currentRevision }
      : {}),
    ...(normalized.residualPaths.length > 0
      ? { residualPaths: [...normalized.residualPaths] }
      : {}),
  };
}

export function registerProjectResourceImportIpcHandlers(
  dependencies: ProjectResourceImportIpcHandlerDependencies,
): () => void {
  ipcMain.handle(
    IPC_CHANNELS.PROJECT_RESOURCE_IMPORT_CHOOSE,
    async (event, rawRequest: unknown) => {
      const window = assertTrustedSender(
        event,
        dependencies.getMainWindow(),
        IPC_CHANNELS.PROJECT_RESOURCE_IMPORT_CHOOSE,
      );
      const request = ProjectResourceImportChooseRequestSchema.parse(rawRequest);
      try {
        const sourceRoot = await dependencies.selectSourceProjectDirectory(window);
        if (!sourceRoot) {
          return ProjectResourceImportChooseResponseSchema.parse({
            ok: true,
            status: 'cancelled',
          });
        }
        return await dependencies.projectResourceImportService.selectSourceProject(
          request,
          sourceRoot,
        );
      } catch (error) {
        return ProjectResourceImportChooseResponseSchema.parse({
          ok: false,
          error: toImportError(error, request.projectRoot),
        });
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_RESOURCE_IMPORT_PREVIEW,
    (event, rawRequest: unknown) => {
      assertTrustedSender(
        event,
        dependencies.getMainWindow(),
        IPC_CHANNELS.PROJECT_RESOURCE_IMPORT_PREVIEW,
      );
      const request =
        ProjectResourceImportPreviewRequestSchema.parse(rawRequest);
      try {
        return dependencies.projectResourceImportService.previewImport(request);
      } catch (error) {
        return ProjectResourceImportPreviewResponseSchema.parse({
          ok: false,
          error: toImportError(error, request.projectRoot),
        });
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_RESOURCE_IMPORT_APPLY,
    async (event, rawRequest: unknown) => {
      assertTrustedSender(
        event,
        dependencies.getMainWindow(),
        IPC_CHANNELS.PROJECT_RESOURCE_IMPORT_APPLY,
      );
      const request = ProjectResourceImportApplyRequestSchema.parse(rawRequest);
      try {
        const operation =
          await dependencies.projectResourceImportService.importResources(
            request,
          );
        return ProjectResourceImportApplyResponseSchema.parse({
          ok: true,
          status: 'completed',
          ...operation,
        });
      } catch (error) {
        return ProjectResourceImportApplyResponseSchema.parse({
          ok: false,
          error: toImportError(error, request.projectRoot),
        });
      }
    },
  );

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.PROJECT_RESOURCE_IMPORT_CHOOSE);
    ipcMain.removeHandler(IPC_CHANNELS.PROJECT_RESOURCE_IMPORT_PREVIEW);
    ipcMain.removeHandler(IPC_CHANNELS.PROJECT_RESOURCE_IMPORT_APPLY);
  };
}

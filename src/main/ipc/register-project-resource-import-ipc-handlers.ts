import {
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from 'electron';
import {
  ProjectResourceImportApplyRequestSchema,
  ProjectResourceImportChooseRequestSchema,
  ProjectResourceImportResponseSchema,
  type ProjectResourceImportResponse,
} from '../../shared/project-resource-import-api';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import {
  ProjectResourceImportService,
  ProjectResourceImportServiceError,
} from '../services/ProjectResourceImportService';

export interface ProjectResourceImportIpcHandlerDependencies {
  getMainWindow: () => BrowserWindow | null;
  projectResourceImportService: ProjectResourceImportService;
  selectSourceProject: (window: BrowserWindow) => Promise<string | null>;
}

function assertTrustedSender(
  event: IpcMainInvokeEvent,
  expectedWindow: BrowserWindow | null,
  channel: string,
): void {
  if (
    !expectedWindow ||
    expectedWindow.isDestroyed() ||
    event.sender.id !== expectedWindow.webContents.id
  ) {
    throw new Error(`IPC ${channel} rejected: untrusted sender.`);
  }
}

function failure(error: unknown, projectRoot: string): ProjectResourceImportResponse {
  const normalized =
    error instanceof ProjectResourceImportServiceError
      ? error
      : new ProjectResourceImportServiceError(
          'PROJECT_RESOURCE_OPERATION_FAILED',
          projectRoot,
          '跨项目导入失败。',
          { cause: error },
        );
  return ProjectResourceImportResponseSchema.parse({
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message.slice(0, 1_000),
      projectRoot: normalized.projectRoot,
      ...(normalized.currentProject
        ? { currentProject: normalized.currentProject }
        : {}),
      ...(normalized.currentRevision !== undefined
        ? { currentRevision: normalized.currentRevision }
        : {}),
      ...(normalized.residualPaths.length > 0
        ? { residualPaths: normalized.residualPaths.slice(0, 100) }
        : {}),
    },
  });
}

export function registerProjectResourceImportIpcHandlers(
  dependencies: ProjectResourceImportIpcHandlerDependencies,
): () => void {
  ipcMain.handle(
    IPC_CHANNELS.PROJECT_RESOURCE_IMPORT_CHOOSE,
    async (event, rawRequest: unknown) => {
      const window = dependencies.getMainWindow();
      assertTrustedSender(
        event,
        window,
        IPC_CHANNELS.PROJECT_RESOURCE_IMPORT_CHOOSE,
      );
      const request = ProjectResourceImportChooseRequestSchema.parse(rawRequest);
      try {
        const sourceRoot = await dependencies.selectSourceProject(window!);
        if (!sourceRoot) {
          return ProjectResourceImportResponseSchema.parse({
            ok: true,
            status: 'cancelled',
          });
        }
        return ProjectResourceImportResponseSchema.parse(
          await dependencies.projectResourceImportService.selectSourceProject(
            request,
            sourceRoot,
          ),
        );
      } catch (error) {
        return failure(error, request.projectRoot);
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
        return ProjectResourceImportResponseSchema.parse({
          ok: true,
          status: 'completed',
          ...operation,
        } satisfies ProjectResourceImportResponse);
      } catch (error) {
        return failure(error, request.projectRoot);
      }
    },
  );

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.PROJECT_RESOURCE_IMPORT_CHOOSE);
    ipcMain.removeHandler(IPC_CHANNELS.PROJECT_RESOURCE_IMPORT_APPLY);
  };
}

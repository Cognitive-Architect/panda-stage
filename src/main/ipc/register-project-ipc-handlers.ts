import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import {
  ProjectCreateRequestSchema,
  ProjectOpenRequestSchema,
  ProjectOperationResponseSchema,
  ProjectSaveRequestSchema,
  type ProjectOperationResponse,
} from '../../shared/project-api';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { ProjectService, ProjectServiceError } from '../services/ProjectService';

interface ProjectIpcHandlerDependencies {
  getMainWindow: () => BrowserWindow | null;
  projectService: ProjectService;
}

function assertTrustedSender(
  event: IpcMainInvokeEvent,
  expectedWindow: BrowserWindow | null,
  channel: string,
): void {
  if (!expectedWindow || expectedWindow.isDestroyed()) {
    throw new Error(`IPC ${channel} rejected: target window is unavailable.`);
  }
  if (event.sender.id !== expectedWindow.webContents.id) {
    throw new Error(`IPC ${channel} rejected: untrusted sender.`);
  }
}

function failure(
  error: unknown,
  projectRoot: string,
  fallbackCode: 'CREATE_FAILED' | 'OPEN_FAILED' | 'SAVE_FAILED',
): ProjectOperationResponse {
  const normalized =
    error instanceof ProjectServiceError
      ? error
      : new ProjectServiceError(
          fallbackCode,
          projectRoot,
          `Project operation failed at ${projectRoot}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
  return ProjectOperationResponseSchema.parse({
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      projectRoot: normalized.projectRoot,
    },
  });
}

export function registerProjectIpcHandlers(
  dependencies: ProjectIpcHandlerDependencies,
): () => void {
  ipcMain.handle(
    IPC_CHANNELS.PROJECT_CREATE,
    async (event, rawRequest: unknown) => {
      assertTrustedSender(
        event,
        dependencies.getMainWindow(),
        IPC_CHANNELS.PROJECT_CREATE,
      );
      const request = ProjectCreateRequestSchema.parse(rawRequest);
      try {
        const value = await dependencies.projectService.create(
          request.projectRoot,
          request.metadata,
        );
        return ProjectOperationResponseSchema.parse({ ok: true, value });
      } catch (error) {
        return failure(error, request.projectRoot, 'CREATE_FAILED');
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_OPEN,
    async (event, rawRequest: unknown) => {
      assertTrustedSender(
        event,
        dependencies.getMainWindow(),
        IPC_CHANNELS.PROJECT_OPEN,
      );
      const request = ProjectOpenRequestSchema.parse(rawRequest);
      try {
        const value = await dependencies.projectService.open(
          request.projectRoot,
        );
        return ProjectOperationResponseSchema.parse({ ok: true, value });
      } catch (error) {
        return failure(error, request.projectRoot, 'OPEN_FAILED');
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_SAVE,
    async (event, rawRequest: unknown) => {
      assertTrustedSender(
        event,
        dependencies.getMainWindow(),
        IPC_CHANNELS.PROJECT_SAVE,
      );
      const request = ProjectSaveRequestSchema.parse(rawRequest);
      try {
        const value = await dependencies.projectService.save(
          request.projectRoot,
          request.project,
          request.revision,
        );
        return ProjectOperationResponseSchema.parse({ ok: true, value });
      } catch (error) {
        return failure(error, request.projectRoot, 'SAVE_FAILED');
      }
    },
  );

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.PROJECT_CREATE);
    ipcMain.removeHandler(IPC_CHANNELS.PROJECT_OPEN);
    ipcMain.removeHandler(IPC_CHANNELS.PROJECT_SAVE);
  };
}

import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import {
  ProjectChooseDirectoryRequestSchema,
  ProjectChooseDirectoryResponseSchema,
  ProjectCreateAtRequestSchema,
  ProjectCreateRequestSchema,
  ProjectOpenRequestSchema,
  ProjectOperationResponseSchema,
  ProjectSaveRequestSchema,
  ProjectSwitchGuardRequestSchema,
  ProjectSwitchGuardResponseSchema,
  type ProjectDocument,
  type ProjectOperationResponse,
  type ProjectSwitchGuardRequest,
  type ProjectSwitchGuardOutcome,
} from '../../shared/project-api';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { ProjectService, ProjectServiceError } from '../services/ProjectService';

interface ProjectIpcHandlerDependencies {
  getMainWindow: () => BrowserWindow | null;
  projectService: ProjectService;
  selectProjectDirectory?: (
    window: BrowserWindow,
  ) => Promise<string | null>;
  confirmProjectSwitch?: (
    request: ProjectSwitchGuardRequest,
  ) => Promise<ProjectSwitchGuardOutcome>;
  onProjectAccessed?: (document: ProjectDocument) => void | Promise<void>;
  onRecentProjectError?: (error: unknown) => void;
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
      ...(normalized.currentProject
        ? { currentProject: normalized.currentProject }
        : {}),
      ...(normalized.currentRevision !== undefined
        ? { currentRevision: normalized.currentRevision }
        : {}),
    },
  });
}

async function recordProjectAccess(
  dependencies: ProjectIpcHandlerDependencies,
  document: ProjectDocument,
): Promise<void> {
  try {
    await dependencies.onProjectAccessed?.(document);
  } catch (error) {
    dependencies.onRecentProjectError?.(error);
  }
}

export function registerProjectIpcHandlers(
  dependencies: ProjectIpcHandlerDependencies,
): () => void {
  ipcMain.handle(
    IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY,
    async (event, rawRequest: unknown) => {
      const window = assertTrustedSender(
        event,
        dependencies.getMainWindow(),
        IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY,
      );
      ProjectChooseDirectoryRequestSchema.parse(rawRequest);
      if (!dependencies.selectProjectDirectory) {
        throw new Error('Project directory selection is unavailable.');
      }
      const projectRoot =
        await dependencies.selectProjectDirectory(window);
      return ProjectChooseDirectoryResponseSchema.parse(
        projectRoot
          ? { ok: true, status: 'selected', projectRoot }
          : { ok: true, status: 'cancelled' },
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_CONFIRM_SWITCH,
    async (event, rawRequest: unknown) => {
      assertTrustedSender(
        event,
        dependencies.getMainWindow(),
        IPC_CHANNELS.PROJECT_CONFIRM_SWITCH,
      );
      const request = ProjectSwitchGuardRequestSchema.parse(rawRequest);
      if (!dependencies.confirmProjectSwitch) {
        throw new Error('Project switch confirmation is unavailable.');
      }
      return ProjectSwitchGuardResponseSchema.parse({
        outcome: await dependencies.confirmProjectSwitch(request),
      });
    },
  );

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
        await recordProjectAccess(dependencies, value);
        return ProjectOperationResponseSchema.parse({ ok: true, value });
      } catch (error) {
        return failure(error, request.projectRoot, 'CREATE_FAILED');
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_CREATE_AT,
    async (event, rawRequest: unknown) => {
      assertTrustedSender(
        event,
        dependencies.getMainWindow(),
        IPC_CHANNELS.PROJECT_CREATE_AT,
      );
      const request = ProjectCreateAtRequestSchema.parse(rawRequest);
      try {
        const value = await dependencies.projectService.createAt(
          request.parentDirectory,
          request.projectName,
          request.metadata,
        );
        await recordProjectAccess(dependencies, value);
        return ProjectOperationResponseSchema.parse({ ok: true, value });
      } catch (error) {
        return failure(error, request.parentDirectory, 'CREATE_FAILED');
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
        await recordProjectAccess(dependencies, value);
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
        await recordProjectAccess(dependencies, value);
        return ProjectOperationResponseSchema.parse({ ok: true, value });
      } catch (error) {
        return failure(error, request.projectRoot, 'SAVE_FAILED');
      }
    },
  );

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY);
    ipcMain.removeHandler(IPC_CHANNELS.PROJECT_CONFIRM_SWITCH);
    ipcMain.removeHandler(IPC_CHANNELS.PROJECT_CREATE);
    ipcMain.removeHandler(IPC_CHANNELS.PROJECT_CREATE_AT);
    ipcMain.removeHandler(IPC_CHANNELS.PROJECT_OPEN);
    ipcMain.removeHandler(IPC_CHANNELS.PROJECT_SAVE);
  };
}

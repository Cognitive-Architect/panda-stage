import {
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import {
  RecentProjectsListRequestSchema,
  RecentProjectsListResponseSchema,
  RecentProjectsOpenRequestSchema,
  RecentProjectsOpenResponseSchema,
  RecentProjectsRelocateRequestSchema,
  RecentProjectsRelocateResponseSchema,
  RecentProjectsRemoveRequestSchema,
  type RecentProjectsError,
  type RecentProjectsListResponse,
  type RecentProjectsOpenResponse,
  type RecentProjectsRelocateResponse,
} from '../../shared/recent-projects-api';
import {
  ProjectService,
  ProjectServiceError,
} from '../services/ProjectService';
import {
  RecentProjectsService,
  RecentProjectsServiceError,
} from '../services/RecentProjectsService';

export interface RecentProjectsIpcHandlerDependencies {
  getMainWindow: () => BrowserWindow | null;
  projectService: ProjectService;
  recentProjectsService: RecentProjectsService;
  selectProjectDirectory: (
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

function errorResponse(
  error: unknown,
  projectRoot: string | null,
): RecentProjectsError {
  if (error instanceof RecentProjectsServiceError) {
    return {
      code: error.code,
      message: error.message,
      projectRoot: error.projectRoot,
    };
  }
  if (error instanceof ProjectServiceError) {
    return {
      code: 'RECENT_PROJECT_RELOCATE_FAILED',
      message: error.message,
      projectRoot,
    };
  }
  return {
    code: 'RECENT_PROJECT_CONFIG_FAILED',
    message: `Recent project operation failed: ${error instanceof Error ? error.message : String(error)}`,
    projectRoot,
  };
}

export function registerRecentProjectsIpcHandlers(
  dependencies: RecentProjectsIpcHandlerDependencies,
): () => void {
  ipcMain.handle(
    IPC_CHANNELS.RECENT_PROJECTS_LIST,
    async (event, rawRequest: unknown) => {
      assertTrustedSender(
        event,
        dependencies.getMainWindow(),
        IPC_CHANNELS.RECENT_PROJECTS_LIST,
      );
      RecentProjectsListRequestSchema.parse(rawRequest);
      try {
        return RecentProjectsListResponseSchema.parse({
          ok: true,
          entries: await dependencies.recentProjectsService.list(),
        } satisfies RecentProjectsListResponse);
      } catch (error) {
        return RecentProjectsListResponseSchema.parse({
          ok: false,
          error: errorResponse(error, null),
        } satisfies RecentProjectsListResponse);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.RECENT_PROJECTS_OPEN,
    async (event, rawRequest: unknown) => {
      assertTrustedSender(
        event,
        dependencies.getMainWindow(),
        IPC_CHANNELS.RECENT_PROJECTS_OPEN,
      );
      const request = RecentProjectsOpenRequestSchema.parse(rawRequest);
      try {
        const document = await dependencies.projectService.open(
          request.projectRoot,
        );
        if (document.project.id !== request.expectedProjectId) {
          throw new RecentProjectsServiceError(
            'RECENT_PROJECT_MISMATCH',
            request.projectRoot,
            'The project at this path no longer matches the recent-project record.',
          );
        }
        await dependencies.recentProjectsService.record(document);
        return RecentProjectsOpenResponseSchema.parse({
          ok: true,
          document,
        } satisfies RecentProjectsOpenResponse);
      } catch (error) {
        return RecentProjectsOpenResponseSchema.parse({
          ok: false,
          error: errorResponse(error, request.projectRoot),
        } satisfies RecentProjectsOpenResponse);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.RECENT_PROJECTS_REMOVE,
    async (event, rawRequest: unknown) => {
      assertTrustedSender(
        event,
        dependencies.getMainWindow(),
        IPC_CHANNELS.RECENT_PROJECTS_REMOVE,
      );
      const request = RecentProjectsRemoveRequestSchema.parse(rawRequest);
      try {
        return RecentProjectsListResponseSchema.parse({
          ok: true,
          entries: await dependencies.recentProjectsService.remove(
            request.projectRoot,
          ),
        } satisfies RecentProjectsListResponse);
      } catch (error) {
        return RecentProjectsListResponseSchema.parse({
          ok: false,
          error: errorResponse(error, request.projectRoot),
        } satisfies RecentProjectsListResponse);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.RECENT_PROJECTS_RELOCATE,
    async (event, rawRequest: unknown) => {
      const window = assertTrustedSender(
        event,
        dependencies.getMainWindow(),
        IPC_CHANNELS.RECENT_PROJECTS_RELOCATE,
      );
      const request = RecentProjectsRelocateRequestSchema.parse(rawRequest);
      try {
        const selectedRoot =
          await dependencies.selectProjectDirectory(window);
        if (!selectedRoot) {
          return RecentProjectsRelocateResponseSchema.parse({
            ok: true,
            status: 'cancelled',
          } satisfies RecentProjectsRelocateResponse);
        }
        const document =
          await dependencies.projectService.open(selectedRoot);
        const entries = await dependencies.recentProjectsService.relocate(
          request.projectRoot,
          document,
        );
        return RecentProjectsRelocateResponseSchema.parse({
          ok: true,
          status: 'relocated',
          document,
          entries,
        } satisfies RecentProjectsRelocateResponse);
      } catch (error) {
        return RecentProjectsRelocateResponseSchema.parse({
          ok: false,
          error: errorResponse(error, request.projectRoot),
        } satisfies RecentProjectsRelocateResponse);
      }
    },
  );

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.RECENT_PROJECTS_LIST);
    ipcMain.removeHandler(IPC_CHANNELS.RECENT_PROJECTS_OPEN);
    ipcMain.removeHandler(IPC_CHANNELS.RECENT_PROJECTS_REMOVE);
    ipcMain.removeHandler(IPC_CHANNELS.RECENT_PROJECTS_RELOCATE);
  };
}

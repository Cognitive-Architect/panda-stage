import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import {
  AutosaveStopRequestSchema,
  AutosaveTrackRequestSchema,
  AutosaveUpdateRequestSchema,
  RecoveryAcknowledgeResponseSchema,
  RecoveryDetectRequestSchema,
  RecoveryDetectResponseSchema,
  RecoveryIgnoreResponseSchema,
  RecoveryRestoreResponseSchema,
  RecoverySelectionRequestSchema,
  type RecoveryError,
  type RecoveryErrorCode,
} from '../../shared/recovery-api';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { AutosaveService } from '../services/AutosaveService';
import {
  RecoveryService,
  RecoveryServiceError,
} from '../services/RecoveryService';
import { ProjectService } from '../services/ProjectService';

interface RecoveryIpcHandlerDependencies {
  getMainWindow: () => BrowserWindow | null;
  projectService: ProjectService;
  recoveryService: RecoveryService;
  autosaveService: AutosaveService;
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

function recoveryError(
  error: unknown,
  projectRoot: string,
  fallbackCode: RecoveryErrorCode,
): RecoveryError {
  const normalized =
    error instanceof RecoveryServiceError
      ? error
      : new RecoveryServiceError(
          fallbackCode,
          projectRoot,
          `Recovery operation failed for ${projectRoot}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
  return {
    code: normalized.code,
    message: normalized.message,
    projectRoot: normalized.projectRoot,
  };
}

export function registerRecoveryIpcHandlers(
  dependencies: RecoveryIpcHandlerDependencies,
): () => void {
  ipcMain.handle(
    IPC_CHANNELS.AUTOSAVE_TRACK,
    async (event, rawRequest: unknown) => {
      assertTrustedSender(
        event,
        dependencies.getMainWindow(),
        IPC_CHANNELS.AUTOSAVE_TRACK,
      );
      const request = AutosaveTrackRequestSchema.parse(rawRequest);
      try {
        const document = await dependencies.projectService.open(
          request.projectRoot,
        );
        if (document.project.id !== request.project.id) {
          throw new RecoveryServiceError(
            'RECOVERY_PROJECT_MISMATCH',
            request.projectRoot,
            `Cannot track autosave at ${request.projectRoot}: existing project ID ${document.project.id} does not match incoming project ID ${request.project.id}.`,
          );
        }
        dependencies.autosaveService.track(request);
        return RecoveryAcknowledgeResponseSchema.parse({ ok: true });
      } catch (error) {
        return RecoveryAcknowledgeResponseSchema.parse({
          ok: false,
          error: recoveryError(
            error,
            request.projectRoot,
            'RECOVERY_WRITE_FAILED',
          ),
        });
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.AUTOSAVE_UPDATE,
    (event, rawRequest: unknown) => {
      assertTrustedSender(
        event,
        dependencies.getMainWindow(),
        IPC_CHANNELS.AUTOSAVE_UPDATE,
      );
      const request = AutosaveUpdateRequestSchema.parse(rawRequest);
      try {
        dependencies.autosaveService.update(request);
        return RecoveryAcknowledgeResponseSchema.parse({ ok: true });
      } catch (error) {
        return RecoveryAcknowledgeResponseSchema.parse({
          ok: false,
          error: recoveryError(
            error,
            request.projectRoot,
            'RECOVERY_WRITE_FAILED',
          ),
        });
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.AUTOSAVE_STOP,
    async (event, rawRequest: unknown) => {
      assertTrustedSender(
        event,
        dependencies.getMainWindow(),
        IPC_CHANNELS.AUTOSAVE_STOP,
      );
      const request = AutosaveStopRequestSchema.parse(rawRequest);
      await dependencies.autosaveService.stop(request.projectRoot);
      return RecoveryAcknowledgeResponseSchema.parse({ ok: true });
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.RECOVERY_DETECT,
    async (event, rawRequest: unknown) => {
      assertTrustedSender(
        event,
        dependencies.getMainWindow(),
        IPC_CHANNELS.RECOVERY_DETECT,
      );
      const request = RecoveryDetectRequestSchema.parse(rawRequest);
      try {
        const document = await dependencies.projectService.open(
          request.projectRoot,
        );
        const candidate = await dependencies.recoveryService.detectLatest(
          request.projectRoot,
          document.project,
        );
        return RecoveryDetectResponseSchema.parse({ ok: true, candidate });
      } catch (error) {
        return RecoveryDetectResponseSchema.parse({
          ok: false,
          error: recoveryError(
            error,
            request.projectRoot,
            'RECOVERY_READ_FAILED',
          ),
        });
      }
    },
  );

  const loadSelectedRecovery = async (
    rawRequest: unknown,
  ): Promise<{
    request: ReturnType<typeof RecoverySelectionRequestSchema.parse>;
    candidate: Awaited<ReturnType<RecoveryService['restore']>>;
  }> => {
    const request = RecoverySelectionRequestSchema.parse(rawRequest);
    const document = await dependencies.projectService.open(
      request.projectRoot,
    );
    const candidate = await dependencies.recoveryService.restore(
      request.projectRoot,
      request.recoveryFilePath,
      document.project.id,
    );
    return { request, candidate };
  };

  ipcMain.handle(
    IPC_CHANNELS.RECOVERY_RESTORE,
    async (event, rawRequest: unknown) => {
      assertTrustedSender(
        event,
        dependencies.getMainWindow(),
        IPC_CHANNELS.RECOVERY_RESTORE,
      );
      let projectRoot = 'unknown.pandastage';
      try {
        const parsed = RecoverySelectionRequestSchema.parse(rawRequest);
        projectRoot = parsed.projectRoot;
        const { candidate } = await loadSelectedRecovery(parsed);
        return RecoveryRestoreResponseSchema.parse({ ok: true, candidate });
      } catch (error) {
        return RecoveryRestoreResponseSchema.parse({
          ok: false,
          error: recoveryError(
            error,
            projectRoot,
            'RECOVERY_READ_FAILED',
          ),
        });
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.RECOVERY_IGNORE,
    async (event, rawRequest: unknown) => {
      assertTrustedSender(
        event,
        dependencies.getMainWindow(),
        IPC_CHANNELS.RECOVERY_IGNORE,
      );
      let projectRoot = 'unknown.pandastage';
      try {
        const parsed = RecoverySelectionRequestSchema.parse(rawRequest);
        projectRoot = parsed.projectRoot;
        const { request, candidate } = await loadSelectedRecovery(parsed);
        await dependencies.recoveryService.ignore(
          request.projectRoot,
          request.recoveryFilePath,
          candidate.projectId,
        );
        return RecoveryIgnoreResponseSchema.parse({
          ok: true,
          retained: true,
        });
      } catch (error) {
        return RecoveryIgnoreResponseSchema.parse({
          ok: false,
          error: recoveryError(
            error,
            projectRoot,
            'RECOVERY_READ_FAILED',
          ),
        });
      }
    },
  );

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.AUTOSAVE_TRACK);
    ipcMain.removeHandler(IPC_CHANNELS.AUTOSAVE_UPDATE);
    ipcMain.removeHandler(IPC_CHANNELS.AUTOSAVE_STOP);
    ipcMain.removeHandler(IPC_CHANNELS.RECOVERY_DETECT);
    ipcMain.removeHandler(IPC_CHANNELS.RECOVERY_RESTORE);
    ipcMain.removeHandler(IPC_CHANNELS.RECOVERY_IGNORE);
  };
}

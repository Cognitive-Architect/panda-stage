import {
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from 'electron';
import {
  AssetImportDroppedRequestSchema,
  AssetImportProjectRequestSchema,
  AssetImportResponseSchema,
  type AssetImportCandidate,
  type AssetImportResponse,
} from '../../shared/asset-import-api';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import {
  AssetImportService,
  AssetImportServiceError,
} from '../services/AssetImportService';

export interface AssetImportIpcHandlerDependencies {
  getMainWindow: () => BrowserWindow | null;
  assetImportService: AssetImportService;
  selectAssetCandidates: (
    window: BrowserWindow,
  ) => Promise<AssetImportCandidate[] | null>;
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
): AssetImportResponse {
  const normalized =
    error instanceof AssetImportServiceError
      ? error
      : new AssetImportServiceError(
          'ASSET_IMPORT_OPERATION_FAILED',
          projectRoot,
          `Asset import failed at ${projectRoot}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
  return AssetImportResponseSchema.parse({
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
      ...(normalized.residualPaths.length > 0
        ? { residualPaths: normalized.residualPaths }
        : {}),
    },
  });
}

async function executeImport(
  dependencies: AssetImportIpcHandlerDependencies,
  request: ReturnType<typeof AssetImportDroppedRequestSchema.parse>,
): Promise<AssetImportResponse> {
  try {
    const operation =
      await dependencies.assetImportService.importCandidates(request);
    return AssetImportResponseSchema.parse({
      ok: true,
      status: 'completed',
      ...operation,
    } satisfies AssetImportResponse);
  } catch (error) {
    return failure(error, request.projectRoot);
  }
}

export function registerAssetImportIpcHandlers(
  dependencies: AssetImportIpcHandlerDependencies,
): () => void {
  ipcMain.handle(
    IPC_CHANNELS.ASSET_IMPORT_CHOOSE,
    async (event, rawRequest: unknown) => {
      const window = assertTrustedSender(
        event,
        dependencies.getMainWindow(),
        IPC_CHANNELS.ASSET_IMPORT_CHOOSE,
      );
      const projectRequest =
        AssetImportProjectRequestSchema.parse(rawRequest);
      const candidates = await dependencies.selectAssetCandidates(window);
      if (!candidates || candidates.length === 0) {
        return AssetImportResponseSchema.parse({
          ok: true,
          status: 'cancelled',
        } satisfies AssetImportResponse);
      }
      return executeImport(
        dependencies,
        AssetImportDroppedRequestSchema.parse({
          ...projectRequest,
          candidates,
        }),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.ASSET_IMPORT_DROPPED,
    async (event, rawRequest: unknown) => {
      assertTrustedSender(
        event,
        dependencies.getMainWindow(),
        IPC_CHANNELS.ASSET_IMPORT_DROPPED,
      );
      return executeImport(
        dependencies,
        AssetImportDroppedRequestSchema.parse(rawRequest),
      );
    },
  );

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.ASSET_IMPORT_CHOOSE);
    ipcMain.removeHandler(IPC_CHANNELS.ASSET_IMPORT_DROPPED);
  };
}

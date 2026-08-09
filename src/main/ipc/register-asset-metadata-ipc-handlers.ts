import {
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from 'electron';
import {
  AssetMetadataCancelRequestSchema,
  AssetMetadataCancelResponseSchema,
  AssetMetadataRequestSchema,
  AssetMetadataResponseSchema,
  type AssetMetadataResponse,
} from '../../shared/asset-metadata-api';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import {
  AssetMetadataService,
  AssetMetadataServiceError,
} from '../services/AssetMetadataService';

export interface AssetMetadataIpcHandlerDependencies {
  getMainWindow: () => BrowserWindow | null;
  assetMetadataService: AssetMetadataService;
}

function assertTrustedSender(
  event: IpcMainInvokeEvent,
  expectedWindow: BrowserWindow | null,
): void {
  if (
    !expectedWindow ||
    expectedWindow.isDestroyed() ||
    event.sender.id !== expectedWindow.webContents.id
  ) {
    throw new Error(
      `IPC ${IPC_CHANNELS.ASSET_METADATA_REFRESH} rejected: untrusted sender.`,
    );
  }
}

function failure(
  error: unknown,
  projectRoot: string,
  assetId: string,
): AssetMetadataResponse {
  const normalized =
    error instanceof AssetMetadataServiceError
      ? error
      : new AssetMetadataServiceError(
          'ASSET_METADATA_OPERATION_FAILED',
          projectRoot,
          assetId,
          `无法处理素材元数据：${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
  return AssetMetadataResponseSchema.parse({
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      projectRoot: normalized.projectRoot,
      assetId: normalized.assetId,
      ...(normalized.relativePath
        ? { relativePath: normalized.relativePath }
        : {}),
      ...(normalized.currentProject
        ? { currentProject: normalized.currentProject }
        : {}),
      ...(normalized.currentRevision !== undefined
        ? { currentRevision: normalized.currentRevision }
        : {}),
    },
  });
}

export function registerAssetMetadataIpcHandlers(
  dependencies: AssetMetadataIpcHandlerDependencies,
): () => void {
  const activeRequests = new Map<string, AbortController>();
  ipcMain.handle(
    IPC_CHANNELS.ASSET_METADATA_REFRESH,
    async (event, rawRequest: unknown) => {
      assertTrustedSender(event, dependencies.getMainWindow());
      let request;
      try {
        request = AssetMetadataRequestSchema.parse(rawRequest);
      } catch (error) {
        return failure(
          new AssetMetadataServiceError(
            'ASSET_METADATA_INVALID_REQUEST',
            '.',
            '(invalid)',
            '素材元数据请求格式无效。',
            { cause: error },
          ),
          '.',
          '(invalid)',
        );
      }
      const controller = new AbortController();
      activeRequests.set(request.requestId, controller);
      try {
        const operation =
          await dependencies.assetMetadataService.refresh(
            request,
            { signal: controller.signal },
          );
        return AssetMetadataResponseSchema.parse({
          ok: true,
          ...operation,
        });
      } catch (error) {
        return failure(error, request.projectRoot, request.assetId);
      } finally {
        if (activeRequests.get(request.requestId) === controller) {
          activeRequests.delete(request.requestId);
        }
      }
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.ASSET_METADATA_CANCEL,
    (event, rawRequest: unknown) => {
      assertTrustedSender(event, dependencies.getMainWindow());
      const request = AssetMetadataCancelRequestSchema.parse(rawRequest);
      const controller = activeRequests.get(request.requestId);
      controller?.abort();
      return AssetMetadataCancelResponseSchema.parse({
        requestId: request.requestId,
        accepted: Boolean(controller),
      });
    },
  );

  return () => {
    for (const controller of activeRequests.values()) controller.abort();
    activeRequests.clear();
    ipcMain.removeHandler(IPC_CHANNELS.ASSET_METADATA_REFRESH);
    ipcMain.removeHandler(IPC_CHANNELS.ASSET_METADATA_CANCEL);
  };
}

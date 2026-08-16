import {
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from 'electron';
import {
  AssetDeleteRequestSchema,
  AssetDeleteResponseSchema,
  type AssetDeleteResponse,
} from '../../shared/asset-delete-api';
import {
  AssetThumbnailReadRequestSchema,
  AssetThumbnailReadResponseSchema,
} from '../../shared/asset-thumbnail-api';
import {
  AssetCanvasImageReadRequestSchema,
  AssetCanvasImageReadResponseSchema,
  type AssetCanvasImageReadResponse,
} from '../../shared/asset-canvas-image-api';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import {
  AssetDeleteService,
  AssetDeleteServiceError,
} from '../services/AssetDeleteService';
import { AssetThumbnailService } from '../services/AssetThumbnailService';
import { AssetCanvasImageService } from '../services/AssetCanvasImageService';

export interface AssetLibraryIpcHandlerDependencies {
  getMainWindow: () => BrowserWindow | null;
  assetDeleteService: AssetDeleteService;
  assetThumbnailService: AssetThumbnailService;
  assetCanvasImageService: AssetCanvasImageService;
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

function deleteFailure(
  error: unknown,
  projectRoot: string,
  assetId: string,
): AssetDeleteResponse {
  const normalized =
    error instanceof AssetDeleteServiceError
      ? error
      : new AssetDeleteServiceError(
          'ASSET_DELETE_FAILED',
          projectRoot,
          assetId,
          `素材删除失败：${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
  return AssetDeleteResponseSchema.parse({
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message.slice(0, 1_000),
      projectRoot: normalized.projectRoot,
      assetId: normalized.assetId,
      ...(normalized.references.length > 0
        ? { references: normalized.references }
        : {}),
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

function canvasImageFailure(
  error: unknown,
  assetId: string,
): AssetCanvasImageReadResponse {
  const rawMessage =
    error instanceof Error ? error.message : 'Canvas image service failed.';
  const message =
    Array.from(rawMessage, (character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f ? ' ' : character;
    })
      .join('')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 1_000) || 'Canvas image service failed.';
  return AssetCanvasImageReadResponseSchema.parse({
    ok: false,
    error: {
      code: 'ASSET_CANVAS_IMAGE_READ_FAILED',
      message,
      assetId: assetId.slice(0, 200),
    },
  });
}

export function registerAssetLibraryIpcHandlers(
  dependencies: AssetLibraryIpcHandlerDependencies,
): () => void {
  ipcMain.handle(
    IPC_CHANNELS.ASSET_DELETE,
    async (event, rawRequest: unknown) => {
      assertTrustedSender(
        event,
        dependencies.getMainWindow(),
        IPC_CHANNELS.ASSET_DELETE,
      );
      let request;
      try {
        request = AssetDeleteRequestSchema.parse(rawRequest);
      } catch (error) {
        return deleteFailure(
          new AssetDeleteServiceError(
            'ASSET_DELETE_INVALID_REQUEST',
            '.',
            '(invalid)',
            '素材删除请求格式无效。',
            { cause: error },
          ),
          '.',
          '(invalid)',
        );
      }
      try {
        const operation =
          await dependencies.assetDeleteService.deleteAsset(request);
        return AssetDeleteResponseSchema.parse({
          ok: true,
          ...operation,
        });
      } catch (error) {
        return deleteFailure(
          error,
          request.projectRoot,
          request.assetId,
        );
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.ASSET_THUMBNAIL_READ,
    async (event, rawRequest: unknown) => {
      assertTrustedSender(
        event,
        dependencies.getMainWindow(),
        IPC_CHANNELS.ASSET_THUMBNAIL_READ,
      );
      let request;
      try {
        request = AssetThumbnailReadRequestSchema.parse(rawRequest);
      } catch {
        return AssetThumbnailReadResponseSchema.parse({
          ok: false,
          error: {
            code: 'ASSET_THUMBNAIL_INVALID_REQUEST',
            message: '缩略图请求格式无效。',
            assetId: '(invalid)',
          },
        });
      }
      return AssetThumbnailReadResponseSchema.parse(
        await dependencies.assetThumbnailService.read(request),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ,
    async (event, rawRequest: unknown) => {
      assertTrustedSender(
        event,
        dependencies.getMainWindow(),
        IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ,
      );
      let request;
      try {
        request = AssetCanvasImageReadRequestSchema.parse(rawRequest);
      } catch {
        return AssetCanvasImageReadResponseSchema.parse({
          ok: false,
          error: {
            code: 'ASSET_CANVAS_IMAGE_INVALID_REQUEST',
            message: 'Canvas image request is invalid.',
            assetId: '(invalid)',
          },
        });
      }
      try {
        const response = await dependencies.assetCanvasImageService.read(
          request,
        );
        return AssetCanvasImageReadResponseSchema.parse(response);
      } catch (error) {
        return canvasImageFailure(error, request.assetId);
      }
    },
  );

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.ASSET_DELETE);
    ipcMain.removeHandler(IPC_CHANNELS.ASSET_THUMBNAIL_READ);
    ipcMain.removeHandler(IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ);
  };
}

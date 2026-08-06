import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectSchema } from '../../src/domain';

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...arguments_: unknown[]) => unknown>(),
  handle: vi.fn(
    (channel: string, handler: (...arguments_: unknown[]) => unknown) => {
      electronMocks.handlers.set(channel, handler);
    },
  ),
  removeHandler: vi.fn((channel: string) => {
    electronMocks.handlers.delete(channel);
  }),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: electronMocks.handle,
    removeHandler: electronMocks.removeHandler,
  },
}));

import { registerAssetLibraryIpcHandlers } from '../../src/main/ipc/register-asset-library-ipc-handlers';
import {
  AssetDeleteServiceError,
  type AssetDeleteService,
} from '../../src/main/services/AssetDeleteService';
import type { AssetThumbnailService } from '../../src/main/services/AssetThumbnailService';
import type { AssetCanvasImageService } from '../../src/main/services/AssetCanvasImageService';
import { IPC_CHANNELS } from '../../src/shared/ipc/channels';
import exampleProject from '../../demo-project/project-v1.example.json';

function mainWindow(senderId = 42): BrowserWindow {
  return {
    isDestroyed: () => false,
    webContents: { id: senderId },
  } as unknown as BrowserWindow;
}

function event(senderId = 42): IpcMainInvokeEvent {
  return { sender: { id: senderId } } as IpcMainInvokeEvent;
}

function services(): {
  assetDeleteService: AssetDeleteService;
  assetThumbnailService: AssetThumbnailService;
  assetCanvasImageService: AssetCanvasImageService;
  deleteAsset: ReturnType<typeof vi.fn>;
  read: ReturnType<typeof vi.fn>;
  readCanvasImage: ReturnType<typeof vi.fn>;
} {
  const deleteAsset = vi.fn();
  const read = vi.fn();
  const readCanvasImage = vi.fn();
  return {
    assetDeleteService: { deleteAsset } as unknown as AssetDeleteService,
    assetThumbnailService: { read } as unknown as AssetThumbnailService,
    assetCanvasImageService: {
      read: readCanvasImage,
    } as unknown as AssetCanvasImageService,
    deleteAsset,
    read,
    readCanvasImage,
  };
}

describe('asset library IPC handlers', () => {
  beforeEach(() => {
    electronMocks.handlers.clear();
    electronMocks.handle.mockClear();
    electronMocks.removeHandler.mockClear();
  });

  it('registers and removes the asset library channels exactly once', () => {
    const dependencies = services();
    const remove = registerAssetLibraryIpcHandlers({
      getMainWindow: () => mainWindow(),
      ...dependencies,
    });

    expect([...electronMocks.handlers.keys()]).toEqual([
      IPC_CHANNELS.ASSET_DELETE,
      IPC_CHANNELS.ASSET_THUMBNAIL_READ,
      IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ,
    ]);
    expect(electronMocks.handle).toHaveBeenCalledTimes(3);
    remove();
    expect(electronMocks.handlers.size).toBe(0);
    expect(electronMocks.removeHandler).toHaveBeenCalledTimes(3);
  });

  it('rejects an untrusted renderer before calling any service', async () => {
    const dependencies = services();
    registerAssetLibraryIpcHandlers({
      getMainWindow: () => mainWindow(42),
      ...dependencies,
    });

    await expect(
      electronMocks.handlers.get(IPC_CHANNELS.ASSET_DELETE)!(
        event(7),
        {},
      ),
    ).rejects.toThrow('untrusted sender');
    await expect(
      electronMocks.handlers.get(IPC_CHANNELS.ASSET_THUMBNAIL_READ)!(
        event(7),
        {},
      ),
    ).rejects.toThrow('untrusted sender');
    await expect(
      electronMocks.handlers.get(IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ)!(
        event(7),
        {},
      ),
    ).rejects.toThrow('untrusted sender');
    expect(dependencies.deleteAsset).not.toHaveBeenCalled();
    expect(dependencies.read).not.toHaveBeenCalled();
    expect(dependencies.readCanvasImage).not.toHaveBeenCalled();
  });

  it('returns strict structured failures for malformed payloads', async () => {
    const dependencies = services();
    registerAssetLibraryIpcHandlers({
      getMainWindow: () => mainWindow(),
      ...dependencies,
    });

    await expect(
      electronMocks.handlers.get(IPC_CHANNELS.ASSET_DELETE)!(
        event(),
        { projectRoot: 'D:\\demo', command: 'Remove-Item -Recurse' },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_DELETE_INVALID_REQUEST' },
    });
    await expect(
      electronMocks.handlers.get(IPC_CHANNELS.ASSET_THUMBNAIL_READ)!(
        event(),
        { projectRoot: 'D:\\demo', assetId: '../secret' },
      ),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'ASSET_THUMBNAIL_INVALID_REQUEST',
        message: '缩略图请求格式无效。',
        assetId: '(invalid)',
      },
    });
    await expect(
      electronMocks.handlers.get(IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ)!(
        event(),
        { projectRoot: 'D:\\demo', assetId: '../secret' },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_CANVAS_IMAGE_INVALID_REQUEST' },
    });
    expect(dependencies.deleteAsset).not.toHaveBeenCalled();
    expect(dependencies.read).not.toHaveBeenCalled();
    expect(dependencies.readCanvasImage).not.toHaveBeenCalled();
  });

  it('validates the canvas response and converts service failures to structured errors', async () => {
    const dependencies = services();
    registerAssetLibraryIpcHandlers({
      getMainWindow: () => mainWindow(),
      ...dependencies,
    });
    const request = {
      projectRoot: 'D:\\demo.pandastage',
      assetId: '10000000-0000-4000-8000-000000000002',
      sha256: 'a'.repeat(64),
    };
    dependencies.readCanvasImage.mockResolvedValue({
      ok: true,
      status: 'ready',
      assetId: request.assetId,
      mimeType: 'image/png',
      width: 2,
      height: 2,
      byteLength: 3,
      bytes: new Uint8Array([1, 2]),
    });
    await expect(
      electronMocks.handlers.get(IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ)!(
        event(),
        request,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_CANVAS_IMAGE_READ_FAILED' },
    });

    dependencies.readCanvasImage.mockRejectedValue(
      new Error('x'.repeat(5_000)),
    );
    const response = await electronMocks.handlers.get(
      IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ,
    )!(event(), request);
    expect(response).toMatchObject({
      ok: false,
      error: { code: 'ASSET_CANVAS_IMAGE_READ_FAILED' },
    });
    expect(
      (response as { error: { message: string } }).error.message,
    ).toHaveLength(1_000);
  });

  it('bounds unexpected service error text to the response contract', async () => {
    const dependencies = services();
    dependencies.deleteAsset.mockRejectedValue(
      new Error('x'.repeat(5_000)),
    );
    registerAssetLibraryIpcHandlers({
      getMainWindow: () => mainWindow(),
      ...dependencies,
    });
    const response = await electronMocks.handlers.get(
      IPC_CHANNELS.ASSET_DELETE,
    )!(event(), {
      projectRoot: 'D:\\demo.pandastage',
      project: exampleProject,
      baseRevision: 0,
      assetId: '10000000-0000-4000-8000-000000000002',
    });

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'ASSET_DELETE_FAILED' },
    });
    expect(
      (response as { error: { message: string } }).error.message,
    ).toHaveLength(1_000);
  });

  it('preserves the current project and revision in a stale response', async () => {
    const dependencies = services();
    const currentProject = ProjectSchema.parse(exampleProject);
    dependencies.deleteAsset.mockRejectedValue(
      new AssetDeleteServiceError(
        'ASSET_DELETE_STALE_REVISION',
        'D:\\demo.pandastage',
        '10000000-0000-4000-8000-000000000002',
        '删除期间项目已变化。',
        {
          currentProject,
          currentRevision: 4,
        },
      ),
    );
    registerAssetLibraryIpcHandlers({
      getMainWindow: () => mainWindow(),
      ...dependencies,
    });

    await expect(
      electronMocks.handlers.get(IPC_CHANNELS.ASSET_DELETE)!(
        event(),
        {
          projectRoot: 'D:\\demo.pandastage',
          project: exampleProject,
          baseRevision: 3,
          assetId: '10000000-0000-4000-8000-000000000002',
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'ASSET_DELETE_STALE_REVISION',
        currentProject,
        currentRevision: 4,
      },
    });
  });
});

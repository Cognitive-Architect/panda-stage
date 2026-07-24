import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { ProjectSchema } from '../../src/domain';
import { registerAssetMetadataIpcHandlers } from '../../src/main/ipc/register-asset-metadata-ipc-handlers';
import type { AssetMetadataService } from '../../src/main/services/AssetMetadataService';
import { IPC_CHANNELS } from '../../src/shared/ipc/channels';
import exampleProject from '../../demo-project/project-v1.example.json';

const project = ProjectSchema.parse(exampleProject);
const request = {
  projectRoot: 'D:\\project.pandastage',
  assetId: project.assets[0]!.id,
};

function mainWindow(senderId = 42): BrowserWindow {
  return {
    isDestroyed: () => false,
    webContents: { id: senderId },
  } as unknown as BrowserWindow;
}

function event(senderId = 42): IpcMainInvokeEvent {
  return { sender: { id: senderId } } as IpcMainInvokeEvent;
}

describe('asset metadata IPC handlers', () => {
  beforeEach(() => {
    electronMocks.handlers.clear();
    electronMocks.handle.mockClear();
    electronMocks.removeHandler.mockClear();
  });

  it('returns structured asset status through the allowlisted channel', async () => {
    const operation = {
      project,
      result: {
        status: 'ready' as const,
        asset: project.assets[0]!,
        thumbnail: {
          relativePath: `cache/asset-thumbnails/v1-max256-${'a'.repeat(64)}.png`,
          width: 16,
          height: 12,
          cacheHit: false,
        },
        warnings: [],
      },
    };
    const refresh = vi.fn().mockResolvedValue(operation);
    const remove = registerAssetMetadataIpcHandlers({
      getMainWindow: () => mainWindow(),
      assetMetadataService: {
        refresh,
      } as unknown as AssetMetadataService,
    });

    await expect(
      electronMocks.handlers.get(
        IPC_CHANNELS.ASSET_METADATA_REFRESH,
      )!(event(), request),
    ).resolves.toEqual({ ok: true, ...operation });
    expect(refresh).toHaveBeenCalledWith(
      request.projectRoot,
      request.assetId,
    );
    remove();
    expect(electronMocks.handlers.size).toBe(0);
  });

  it('rejects an untrusted renderer before reading media', async () => {
    const refresh = vi.fn();
    registerAssetMetadataIpcHandlers({
      getMainWindow: () => mainWindow(42),
      assetMetadataService: {
        refresh,
      } as unknown as AssetMetadataService,
    });

    await expect(
      electronMocks.handlers.get(
        IPC_CHANNELS.ASSET_METADATA_REFRESH,
      )!(event(7), request),
    ).rejects.toThrow('untrusted sender');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('returns a localized structured error for malformed input', async () => {
    registerAssetMetadataIpcHandlers({
      getMainWindow: () => mainWindow(),
      assetMetadataService: {
        refresh: vi.fn(),
      } as unknown as AssetMetadataService,
    });

    await expect(
      electronMocks.handlers.get(
        IPC_CHANNELS.ASSET_METADATA_REFRESH,
      )!(event(), {
        projectRoot: request.projectRoot,
        assetId: 'not-a-uuid',
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'ASSET_METADATA_INVALID_REQUEST',
        message: '素材元数据请求格式无效。',
      },
    });
  });
});

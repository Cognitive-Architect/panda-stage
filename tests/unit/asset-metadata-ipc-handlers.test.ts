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

import { migrateProject } from '../../src/domain';
import { registerAssetMetadataIpcHandlers } from '../../src/main/ipc/register-asset-metadata-ipc-handlers';
import type { AssetMetadataService } from '../../src/main/services/AssetMetadataService';
import { IPC_CHANNELS } from '../../src/shared/ipc/channels';
import exampleProject from '../../demo-project/project-v1.example.json';

const project = migrateProject(exampleProject);
const request = {
  projectRoot: 'D:\\project.pandastage',
  project,
  baseRevision: 3,
  assetId: project.assets[0]!.id,
  requestId: 'f2f4dc13-312e-4620-9bd6-4d345b45ecf8',
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
      baseRevision: 3,
      savedRevision: 4,
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
      request,
      { signal: expect.any(AbortSignal) },
    );
    remove();
    expect(electronMocks.handlers.size).toBe(0);
  });

  it('cancels an active refresh by request ID', async () => {
    const refresh = vi.fn(
      async (
        _request: typeof request,
        options: { signal: AbortSignal },
      ) =>
        new Promise((resolve) => {
          options.signal.addEventListener('abort', () => {
            resolve({
              project,
              baseRevision: 3,
              savedRevision: 4,
              result: {
                status: 'ready',
                asset: project.assets[0]!,
                thumbnail: null,
                warnings: [],
              },
            });
          });
        }),
    );
    registerAssetMetadataIpcHandlers({
      getMainWindow: () => mainWindow(),
      assetMetadataService: { refresh } as unknown as AssetMetadataService,
    });
    const pending = electronMocks.handlers.get(
      IPC_CHANNELS.ASSET_METADATA_REFRESH,
    )!(event(), request);
    expect(
      electronMocks.handlers.get(
        IPC_CHANNELS.ASSET_METADATA_CANCEL,
      )!(event(), { requestId: request.requestId }),
    ).toEqual({
      requestId: request.requestId,
      accepted: true,
    });
    await pending;
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
        project,
        baseRevision: 3,
        assetId: 'not-a-uuid',
        requestId: request.requestId,
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

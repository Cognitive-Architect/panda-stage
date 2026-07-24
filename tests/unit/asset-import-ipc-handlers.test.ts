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
import { registerAssetImportIpcHandlers } from '../../src/main/ipc/register-asset-import-ipc-handlers';
import {
  AssetImportServiceError,
  type AssetImportService,
} from '../../src/main/services/AssetImportService';
import { IPC_CHANNELS } from '../../src/shared/ipc/channels';
import exampleProject from '../../demo-project/project-v1.example.json';

const project = ProjectSchema.parse(exampleProject);
const request = {
  projectRoot: 'D:\\project.pandastage',
  project,
  baseRevision: 0,
};
const operation = {
  project,
  baseRevision: 0,
  savedRevision: 0,
  projectChanged: false,
  results: [
    {
      sourceName: 'duplicate.png',
      status: 'duplicate' as const,
      sha256: 'a'.repeat(64),
      asset: project.assets[0]!,
      duplicateOfAssetId: project.assets[0]!.id,
      code: null,
      message: 'Duplicate reused.',
    },
  ],
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

function dependencies() {
  return {
    assetImportService: {
      importCandidates: vi.fn().mockResolvedValue(operation),
    } as unknown as AssetImportService,
    selectAssetCandidates: vi.fn().mockResolvedValue([
      {
        sourcePath: 'D:\\source.png',
        declaredMimeType: 'image/png',
      },
    ]),
  };
}

describe('asset import IPC handlers', () => {
  beforeEach(() => {
    electronMocks.handlers.clear();
    electronMocks.handle.mockClear();
    electronMocks.removeHandler.mockClear();
  });

  it('registers and removes only the asset import allowlist', () => {
    const remove = registerAssetImportIpcHandlers({
      getMainWindow: () => mainWindow(),
      ...dependencies(),
    });

    expect([...electronMocks.handlers.keys()]).toEqual([
      IPC_CHANNELS.ASSET_IMPORT_CHOOSE,
      IPC_CHANNELS.ASSET_IMPORT_DROPPED,
    ]);
    remove();
    expect(electronMocks.handlers.size).toBe(0);
  });

  it('uses the native picker candidates and executes a strict import', async () => {
    const services = dependencies();
    registerAssetImportIpcHandlers({
      getMainWindow: () => mainWindow(),
      ...services,
    });

    await expect(
      electronMocks.handlers.get(IPC_CHANNELS.ASSET_IMPORT_CHOOSE)!(
        event(),
        request,
      ),
    ).resolves.toEqual({
      ok: true,
      status: 'completed',
      ...operation,
    });
    expect(services.assetImportService.importCandidates).toHaveBeenCalledWith({
      ...request,
      candidates: [
        {
          sourcePath: 'D:\\source.png',
          declaredMimeType: 'image/png',
        },
      ],
    });
  });

  it('returns cancelled without touching the project when selection is cancelled', async () => {
    const services = dependencies();
    services.selectAssetCandidates.mockResolvedValue(null);
    registerAssetImportIpcHandlers({
      getMainWindow: () => mainWindow(),
      ...services,
    });

    await expect(
      electronMocks.handlers.get(IPC_CHANNELS.ASSET_IMPORT_CHOOSE)!(
        event(),
        request,
      ),
    ).resolves.toEqual({ ok: true, status: 'cancelled' });
    expect(
      services.assetImportService.importCandidates,
    ).not.toHaveBeenCalled();
  });

  it('rejects an untrusted sender before importing dropped files', async () => {
    const services = dependencies();
    registerAssetImportIpcHandlers({
      getMainWindow: () => mainWindow(42),
      ...services,
    });

    await expect(
      electronMocks.handlers.get(IPC_CHANNELS.ASSET_IMPORT_DROPPED)!(
        event(7),
        {
          ...request,
          candidates: [
            {
              sourcePath: 'D:\\source.png',
              declaredMimeType: 'image/png',
            },
          ],
        },
      ),
    ).rejects.toThrow('untrusted sender');
    expect(
      services.assetImportService.importCandidates,
    ).not.toHaveBeenCalled();
  });

  it('returns the authoritative snapshot for a stale revision', async () => {
    const services = dependencies();
    services.assetImportService.importCandidates = vi
      .fn()
      .mockRejectedValue(
        new AssetImportServiceError(
          'ASSET_IMPORT_STALE_REVISION',
          request.projectRoot,
          'Refresh the project snapshot and retry.',
          {
            currentProject: project,
            currentRevision: 3,
          },
        ),
      );
    registerAssetImportIpcHandlers({
      getMainWindow: () => mainWindow(),
      ...services,
    });

    await expect(
      electronMocks.handlers.get(IPC_CHANNELS.ASSET_IMPORT_DROPPED)!(
        event(),
        {
          ...request,
          candidates: [
            {
              sourcePath: 'D:\\source.png',
              declaredMimeType: 'image/png',
            },
          ],
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'ASSET_IMPORT_STALE_REVISION',
        currentProject: project,
        currentRevision: 3,
      },
    });
  });

  it('returns residual paths when rollback cannot restore the directory', async () => {
    const services = dependencies();
    const residualPath = 'D:\\project.pandastage\\assets\\orphan.png';
    services.assetImportService.importCandidates = vi
      .fn()
      .mockRejectedValue(
        new AssetImportServiceError(
          'ASSET_IMPORT_ROLLBACK_FAILED',
          request.projectRoot,
          'Manual cleanup is required.',
          { residualPaths: [residualPath] },
        ),
      );
    registerAssetImportIpcHandlers({
      getMainWindow: () => mainWindow(),
      ...services,
    });

    await expect(
      electronMocks.handlers.get(IPC_CHANNELS.ASSET_IMPORT_DROPPED)!(
        event(),
        {
          ...request,
          candidates: [
            {
              sourcePath: 'D:\\source.png',
              declaredMimeType: 'image/png',
            },
          ],
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'ASSET_IMPORT_ROLLBACK_FAILED',
        residualPaths: [residualPath],
      },
    });
  });
});

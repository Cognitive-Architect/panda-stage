import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...arguments_: unknown[]) => unknown>(),
  listeners: new Map<string, (...arguments_: unknown[]) => unknown>(),
  handle: vi.fn(
    (channel: string, handler: (...arguments_: unknown[]) => unknown) => {
      electronMocks.handlers.set(channel, handler);
    },
  ),
  removeHandler: vi.fn((channel: string) => {
    electronMocks.handlers.delete(channel);
  }),
  on: vi.fn((channel: string, listener: (...arguments_: unknown[]) => unknown) => {
    electronMocks.listeners.set(channel, listener);
  }),
  removeListener: vi.fn((channel: string, listener: (...arguments_: unknown[]) => unknown) => {
    if (electronMocks.listeners.get(channel) === listener) {
      electronMocks.listeners.delete(channel);
    }
  }),
}));

vi.mock('electron', () => ({
  BrowserWindow: class BrowserWindow {},
  ipcMain: {
    handle: electronMocks.handle,
    removeHandler: electronMocks.removeHandler,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
  },
}));

import { migrateProject } from '../../src/domain';
import { registerFlaImportIpcHandlers } from '../../src/main/ipc/register-fla-import-ipc-handlers';
import {
  FlaAssetCommitServiceError,
  type FlaAssetCommitService,
} from '../../src/main/services/FlaAssetCommitService';
import type { FlaImportService } from '../../src/main/services/FlaImportService';
import { IPC_CHANNELS } from '../../src/shared/ipc/channels';
import exampleProject from '../../demo-project/project-v1.example.json';

const project = migrateProject(exampleProject);
const imageAsset = project.assets.find((asset) => asset.kind === 'image')!;
const request = {
  format: 'fla-raster-commit' as const,
  version: 1 as const,
  projectRoot: 'D:\\project.pandastage',
  project,
  baseRevision: 0,
  sessionId: '00000000-0000-4000-8000-000000000257',
  source: { basename: 'sample.fla', sha256: 'a'.repeat(64) },
  selectedMediaIds: ['fla-media-contract-0001'],
  selectedCount: 1,
  confirmed: true as const,
};
const operation = {
  project,
  baseRevision: 0,
  savedRevision: 1,
  projectChanged: true,
  results: [
    {
      mediaId: 'fla-media-contract-0001',
      sourceName: 'a1.jpg',
      sourceFormat: 'jpg' as const,
      width: imageAsset.kind === 'image' ? imageAsset.width : 320,
      height: imageAsset.kind === 'image' ? imageAsset.height : 240,
      status: 'duplicate' as const,
      sha256: 'a'.repeat(64),
      asset: imageAsset,
      duplicateOfAssetId: imageAsset.id,
      targetFileName: 'a1.png',
      renamed: false,
      message: 'Reused existing Asset a1.png.',
    },
  ],
  summary: {
    selectedCount: 1,
    importedCount: 0,
    duplicateCount: 1,
    renamedCount: 0,
  },
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
    flaImportService: {} as FlaImportService,
    flaAssetCommitService: {
      commit: vi.fn().mockResolvedValue(operation),
    } as unknown as FlaAssetCommitService,
    selectFlaSource: vi.fn(),
  };
}

describe('FLA commit IPC boundary', () => {
  beforeEach(() => {
    electronMocks.handlers.clear();
    electronMocks.listeners.clear();
    electronMocks.handle.mockClear();
    electronMocks.removeHandler.mockClear();
    electronMocks.on.mockClear();
    electronMocks.removeListener.mockClear();
  });

  it('registers and removes the FLA commit allowlist', () => {
    const remove = registerFlaImportIpcHandlers({
      getMainWindow: () => mainWindow(),
      ...dependencies(),
    });

    expect([...electronMocks.handlers.keys()]).toEqual([
      IPC_CHANNELS.FLA_INSPECT_CHOOSE,
      IPC_CHANNELS.FLA_CANCEL,
      IPC_CHANNELS.FLA_COMMIT_SELECTED,
    ]);
    expect(electronMocks.listeners.size).toBe(4);
    remove();
    expect(electronMocks.handlers.size).toBe(0);
    expect(electronMocks.listeners.size).toBe(0);
  });

  it('passes only the strict request to the Main-owned commit service', async () => {
    const services = dependencies();
    registerFlaImportIpcHandlers({
      getMainWindow: () => mainWindow(),
      ...services,
    });

    await expect(
      electronMocks.handlers.get(IPC_CHANNELS.FLA_COMMIT_SELECTED)!(
        event(),
        request,
      ),
    ).resolves.toMatchObject({
      ok: true,
      status: 'completed',
      summary: operation.summary,
    });
    expect(services.flaAssetCommitService.commit).toHaveBeenCalledWith(request);
  });

  it('rejects an untrusted sender before touching the commit service', async () => {
    const services = dependencies();
    registerFlaImportIpcHandlers({
      getMainWindow: () => mainWindow(42),
      ...services,
    });

    await expect(
      electronMocks.handlers.get(IPC_CHANNELS.FLA_COMMIT_SELECTED)!(
        event(7),
        request,
      ),
    ).rejects.toThrow('Untrusted FLA IPC sender');
    expect(services.flaAssetCommitService.commit).not.toHaveBeenCalled();
  });

  it('serializes stable stale errors instead of leaking service exceptions', async () => {
    const services = dependencies();
    services.flaAssetCommitService.commit = vi.fn().mockRejectedValue(
      new FlaAssetCommitServiceError(
        'STALE_PROJECT_REVISION',
        request.projectRoot,
        'Refresh the Project and retry.',
        { currentProject: project, currentRevision: 3 },
      ),
    ) as unknown as FlaAssetCommitService['commit'];
    registerFlaImportIpcHandlers({
      getMainWindow: () => mainWindow(),
      ...services,
    });

    await expect(
      electronMocks.handlers.get(IPC_CHANNELS.FLA_COMMIT_SELECTED)!(
        event(),
        request,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'STALE_PROJECT_REVISION',
        currentRevision: 3,
      },
    });
  });
});

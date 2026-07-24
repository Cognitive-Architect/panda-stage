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
import { registerRecentProjectsIpcHandlers } from '../../src/main/ipc/register-recent-projects-ipc-handlers';
import type { ProjectService } from '../../src/main/services/ProjectService';
import type { RecentProjectsService } from '../../src/main/services/RecentProjectsService';
import { IPC_CHANNELS } from '../../src/shared/ipc/channels';
import exampleProject from '../../demo-project/project-v1.example.json';

const project = ProjectSchema.parse(exampleProject);
const oldRoot = 'D:\\missing.pandastage';
const movedRoot = 'D:\\moved.pandastage';
const document = {
  projectRoot: movedRoot,
  projectFilePath: `${movedRoot}\\project.json`,
  project,
  migrated: false,
  sourceVersion: 1 as const,
};
const entries = [
  {
    projectId: project.id,
    projectName: project.name,
    projectRoot: movedRoot,
    lastOpenedAt: '2026-07-24T00:00:00.000Z',
    status: 'available' as const,
  },
];

function mainWindow(senderId = 42): BrowserWindow {
  return {
    isDestroyed: () => false,
    webContents: { id: senderId },
  } as unknown as BrowserWindow;
}

function event(senderId = 42): IpcMainInvokeEvent {
  return { sender: { id: senderId } } as IpcMainInvokeEvent;
}

function services() {
  return {
    projectService: {
      open: vi.fn().mockResolvedValue(document),
    } as unknown as ProjectService,
    recentProjectsService: {
      list: vi.fn().mockResolvedValue(entries),
      remove: vi.fn().mockResolvedValue([]),
      relocate: vi.fn().mockResolvedValue(entries),
    } as unknown as RecentProjectsService,
  };
}

describe('recent projects IPC handlers', () => {
  beforeEach(() => {
    electronMocks.handlers.clear();
    electronMocks.handle.mockClear();
    electronMocks.removeHandler.mockClear();
  });

  it('registers and removes only the recent-project allowlist', () => {
    const dependencies = services();
    const remove = registerRecentProjectsIpcHandlers({
      getMainWindow: () => mainWindow(),
      ...dependencies,
      selectProjectDirectory: vi.fn(),
    });

    expect([...electronMocks.handlers.keys()]).toEqual([
      IPC_CHANNELS.RECENT_PROJECTS_LIST,
      IPC_CHANNELS.RECENT_PROJECTS_REMOVE,
      IPC_CHANNELS.RECENT_PROJECTS_RELOCATE,
    ]);
    remove();
    expect(electronMocks.handlers.size).toBe(0);
  });

  it('lists and explicitly removes records through strict requests', async () => {
    const dependencies = services();
    registerRecentProjectsIpcHandlers({
      getMainWindow: () => mainWindow(),
      ...dependencies,
      selectProjectDirectory: vi.fn(),
    });

    await expect(
      electronMocks.handlers.get(IPC_CHANNELS.RECENT_PROJECTS_LIST)!(
        event(),
        {},
      ),
    ).resolves.toEqual({ ok: true, entries });
    await expect(
      electronMocks.handlers.get(IPC_CHANNELS.RECENT_PROJECTS_REMOVE)!(
        event(),
        { projectRoot: oldRoot },
      ),
    ).resolves.toEqual({ ok: true, entries: [] });
    expect(dependencies.recentProjectsService.remove).toHaveBeenCalledWith(
      oldRoot,
    );
  });

  it('leaves the record unchanged when relocation selection is cancelled', async () => {
    const dependencies = services();
    registerRecentProjectsIpcHandlers({
      getMainWindow: () => mainWindow(),
      ...dependencies,
      selectProjectDirectory: vi.fn().mockResolvedValue(null),
    });

    await expect(
      electronMocks.handlers.get(IPC_CHANNELS.RECENT_PROJECTS_RELOCATE)!(
        event(),
        { projectRoot: oldRoot },
      ),
    ).resolves.toEqual({ ok: true, status: 'cancelled' });
    expect(dependencies.projectService.open).not.toHaveBeenCalled();
    expect(dependencies.recentProjectsService.relocate).not.toHaveBeenCalled();
  });

  it('opens the selected root and relocates only after identity validation', async () => {
    const dependencies = services();
    registerRecentProjectsIpcHandlers({
      getMainWindow: () => mainWindow(),
      ...dependencies,
      selectProjectDirectory: vi.fn().mockResolvedValue(movedRoot),
    });

    await expect(
      electronMocks.handlers.get(IPC_CHANNELS.RECENT_PROJECTS_RELOCATE)!(
        event(),
        { projectRoot: oldRoot },
      ),
    ).resolves.toEqual({
      ok: true,
      status: 'relocated',
      document,
      entries,
    });
    expect(dependencies.projectService.open).toHaveBeenCalledWith(movedRoot);
    expect(dependencies.recentProjectsService.relocate).toHaveBeenCalledWith(
      oldRoot,
      document,
    );
  });

  it('rejects an untrusted renderer before opening a native picker', async () => {
    const dependencies = services();
    const selectProjectDirectory = vi.fn();
    registerRecentProjectsIpcHandlers({
      getMainWindow: () => mainWindow(42),
      ...dependencies,
      selectProjectDirectory,
    });

    await expect(
      electronMocks.handlers.get(IPC_CHANNELS.RECENT_PROJECTS_RELOCATE)!(
        event(7),
        { projectRoot: oldRoot },
      ),
    ).rejects.toThrow('untrusted sender');
    expect(selectProjectDirectory).not.toHaveBeenCalled();
  });
});

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

import { registerProjectIpcHandlers } from '../../src/main/ipc/register-project-ipc-handlers';
import {
  ProjectServiceError,
  type ProjectService,
} from '../../src/main/services/ProjectService';
import { ProjectSchema } from '../../src/domain';
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

function projectService(): ProjectService {
  return {
    create: vi.fn(),
    open: vi.fn(),
    save: vi.fn(),
  } as unknown as ProjectService;
}

describe('project IPC handlers', () => {
  beforeEach(() => {
    electronMocks.handlers.clear();
    electronMocks.handle.mockClear();
    electronMocks.removeHandler.mockClear();
  });

  it('registers only the three allowlisted project operations', () => {
    const remove = registerProjectIpcHandlers({
      getMainWindow: () => mainWindow(),
      projectService: projectService(),
    });

    expect([...electronMocks.handlers.keys()]).toEqual([
      IPC_CHANNELS.PROJECT_CREATE,
      IPC_CHANNELS.PROJECT_OPEN,
      IPC_CHANNELS.PROJECT_SAVE,
    ]);

    remove();
    expect(electronMocks.handlers.size).toBe(0);
  });

  it('rejects malformed input before calling ProjectService', async () => {
    const service = projectService();
    registerProjectIpcHandlers({
      getMainWindow: () => mainWindow(),
      projectService: service,
    });
    const handler = electronMocks.handlers.get(IPC_CHANNELS.PROJECT_SAVE)!;

    await expect(
      handler(event(), {
        projectRoot: 'demo.pandastage',
        project: { schemaVersion: 999 },
      }),
    ).rejects.toThrow();
    expect(service.save).not.toHaveBeenCalled();
  });

  it('rejects an untrusted renderer before parsing input', async () => {
    const service = projectService();
    registerProjectIpcHandlers({
      getMainWindow: () => mainWindow(42),
      projectService: service,
    });
    const handler = electronMocks.handlers.get(IPC_CHANNELS.PROJECT_OPEN)!;

    await expect(
      handler(event(7), { projectRoot: 'demo.pandastage' }),
    ).rejects.toThrow('untrusted sender');
    expect(service.open).not.toHaveBeenCalled();
  });

  it('returns a distinct failure response for a project identity mismatch', async () => {
    const service = projectService();
    const projectRoot = 'D:\\projects\\target.pandastage';
    const project = ProjectSchema.parse(exampleProject);
    vi.spyOn(service, 'save').mockRejectedValue(
      new ProjectServiceError(
        'PROJECT_ID_MISMATCH',
        projectRoot,
        `Cannot save project at ${projectRoot}: project identity mismatch.`,
      ),
    );
    registerProjectIpcHandlers({
      getMainWindow: () => mainWindow(),
      projectService: service,
    });
    const handler = electronMocks.handlers.get(IPC_CHANNELS.PROJECT_SAVE)!;

    await expect(
      handler(event(), { projectRoot, project, revision: 7 }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'PROJECT_ID_MISMATCH',
        projectRoot,
      },
    });
    expect(service.save).toHaveBeenCalledWith(projectRoot, project, 7);
  });
});

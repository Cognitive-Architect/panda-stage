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
    createAt: vi.fn(),
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

  it('registers only the seven allowlisted project operations', () => {
    const remove = registerProjectIpcHandlers({
      getMainWindow: () => mainWindow(),
      projectService: projectService(),
    });

    expect([...electronMocks.handlers.keys()]).toEqual([
      IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY,
      IPC_CHANNELS.PROJECT_OPEN_FOLDER,
      IPC_CHANNELS.PROJECT_CONFIRM_SWITCH,
      IPC_CHANNELS.PROJECT_CREATE,
      IPC_CHANNELS.PROJECT_CREATE_AT,
      IPC_CHANNELS.PROJECT_OPEN,
      IPC_CHANNELS.PROJECT_SAVE,
    ]);

    remove();
    expect(electronMocks.handlers.size).toBe(0);
  });

  it('opens only the validated current project folder through the main process', async () => {
    const service = projectService();
    const openProjectFolder = vi.fn().mockResolvedValue('');
    registerProjectIpcHandlers({
      getMainWindow: () => mainWindow(),
      projectService: service,
      openProjectFolder,
    });
    const handler = electronMocks.handlers.get(
      IPC_CHANNELS.PROJECT_OPEN_FOLDER,
    )!;

    await expect(
      handler(event(), { projectRoot: 'D:\\projects\\folder.pandastage' }),
    ).resolves.toEqual({ ok: true });
    expect(openProjectFolder).toHaveBeenCalledWith(
      'D:\\projects\\folder.pandastage',
    );

    openProjectFolder.mockResolvedValueOnce('The folder could not be opened.');
    await expect(
      handler(event(), { projectRoot: 'D:\\projects\\folder.pandastage' }),
    ).resolves.toEqual({
      ok: false,
      error: 'The folder could not be opened.',
    });
  });

  it('forwards only the parent directory, name, and metadata to createAt', async () => {
    const service = projectService();
    const project = ProjectSchema.parse(exampleProject);
    const document = {
      projectRoot: 'D:\\projects\\新项目.pandastage',
      projectFilePath: 'D:\\projects\\新项目.pandastage\\project.json',
      project,
      migrated: false,
      sourceVersion: 1 as const,
    };
    vi.spyOn(service, 'createAt').mockResolvedValue(document);
    const onProjectAccessed = vi.fn();
    registerProjectIpcHandlers({
      getMainWindow: () => mainWindow(),
      projectService: service,
      onProjectAccessed,
    });
    const handler = electronMocks.handlers.get(
      IPC_CHANNELS.PROJECT_CREATE_AT,
    )!;

    await expect(
      handler(event(), {
        parentDirectory: 'D:\\projects',
        projectName: '新项目',
        metadata: { name: '新项目' },
      }),
    ).resolves.toEqual({ ok: true, value: document });
    expect(service.createAt).toHaveBeenCalledWith(
      'D:\\projects',
      '新项目',
      { name: '新项目' },
    );
    expect(service.create).not.toHaveBeenCalled();
    expect(onProjectAccessed).toHaveBeenCalledWith(document);
  });

  it('rejects a createAt request that smuggles a project root or traversal', async () => {
    const service = projectService();
    registerProjectIpcHandlers({
      getMainWindow: () => mainWindow(),
      projectService: service,
    });
    const handler = electronMocks.handlers.get(
      IPC_CHANNELS.PROJECT_CREATE_AT,
    )!;

    await expect(
      handler(event(), {
        parentDirectory: 'D:\\projects',
        projectName: '新项目',
        metadata: { name: '新项目' },
        projectRoot: 'D:\\elsewhere\\evil.pandastage',
      }),
    ).rejects.toThrow();
    await expect(
      handler(event(), {
        parentDirectory: 'D:\\projects',
        projectName: '..\\..\\evil',
        metadata: { name: 'evil' },
      }),
    ).rejects.toThrow();
    expect(service.createAt).not.toHaveBeenCalled();
  });

  it('maps a duplicate project directory to PROJECT_ALREADY_EXISTS', async () => {
    const service = projectService();
    const projectRoot = 'D:\\projects\\重名.pandastage';
    vi.spyOn(service, 'createAt').mockRejectedValue(
      new ProjectServiceError(
        'PROJECT_ALREADY_EXISTS',
        projectRoot,
        `Cannot create project at ${projectRoot}: the target directory already exists.`,
      ),
    );
    registerProjectIpcHandlers({
      getMainWindow: () => mainWindow(),
      projectService: service,
    });

    await expect(
      electronMocks.handlers.get(IPC_CHANNELS.PROJECT_CREATE_AT)!(event(), {
        parentDirectory: 'D:\\projects',
        projectName: '重名',
        metadata: { name: '重名' },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'PROJECT_ALREADY_EXISTS', projectRoot },
    });
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

  it('returns selected and cancelled native project directories without opening them', async () => {
    const service = projectService();
    const selectProjectDirectory = vi
      .fn()
      .mockResolvedValueOnce('D:\\projects\\picked.pandastage')
      .mockResolvedValueOnce(null);
    registerProjectIpcHandlers({
      getMainWindow: () => mainWindow(),
      projectService: service,
      selectProjectDirectory,
    });
    const handler = electronMocks.handlers.get(
      IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY,
    )!;

    await expect(handler(event(), {})).resolves.toEqual({
      ok: true,
      status: 'selected',
      projectRoot: 'D:\\projects\\picked.pandastage',
    });
    await expect(handler(event(), {})).resolves.toEqual({
      ok: true,
      status: 'cancelled',
    });
    expect(service.open).not.toHaveBeenCalled();
  });

  it('validates and forwards the exact dirty snapshot to the shared switch guard', async () => {
    const service = projectService();
    const confirmProjectSwitch = vi.fn().mockResolvedValue('discarded');
    const project = ProjectSchema.parse(exampleProject);
    registerProjectIpcHandlers({
      getMainWindow: () => mainWindow(),
      projectService: service,
      confirmProjectSwitch,
    });
    const request = {
      projectRoot: 'D:\\projects\\dirty.pandastage',
      project,
      dirty: true as const,
      revision: 8,
    };

    await expect(
      electronMocks.handlers.get(IPC_CHANNELS.PROJECT_CONFIRM_SWITCH)!(
        event(),
        request,
      ),
    ).resolves.toEqual({ outcome: 'discarded' });
    expect(confirmProjectSwitch).toHaveBeenCalledWith(request);
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

  it('returns the authoritative project and revision for a stale save', async () => {
    const service = projectService();
    const projectRoot = 'D:\\projects\\target.pandastage';
    const project = ProjectSchema.parse(exampleProject);
    const currentProject = ProjectSchema.parse({
      ...project,
      name: 'Revision 6',
    });
    vi.spyOn(service, 'save').mockRejectedValue(
      new ProjectServiceError(
        'PROJECT_SAVE_STALE_REVISION',
        projectRoot,
        'Revision 5 is stale.',
        { currentProject, currentRevision: 6 },
      ),
    );
    registerProjectIpcHandlers({
      getMainWindow: () => mainWindow(),
      projectService: service,
    });

    await expect(
      electronMocks.handlers.get(IPC_CHANNELS.PROJECT_SAVE)!(
        event(),
        { projectRoot, project, revision: 5 },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'PROJECT_SAVE_STALE_REVISION',
        currentProject: { name: 'Revision 6' },
        currentRevision: 6,
      },
    });
  });

  it('records a successful open without failing the open when recent config is unavailable', async () => {
    const service = projectService();
    const project = ProjectSchema.parse(exampleProject);
    const document = {
      projectRoot: 'D:\\projects\\demo.pandastage',
      projectFilePath: 'D:\\projects\\demo.pandastage\\project.json',
      project,
      migrated: false,
      sourceVersion: 1 as const,
    };
    vi.spyOn(service, 'open').mockResolvedValue(document);
    const onProjectAccessed = vi
      .fn()
      .mockRejectedValue(new Error('Injected recent config failure.'));
    const onRecentProjectError = vi.fn();
    registerProjectIpcHandlers({
      getMainWindow: () => mainWindow(),
      projectService: service,
      onProjectAccessed,
      onRecentProjectError,
    });

    await expect(
      electronMocks.handlers.get(IPC_CHANNELS.PROJECT_OPEN)!(
        event(),
        { projectRoot: document.projectRoot },
      ),
    ).resolves.toEqual({ ok: true, value: document });
    expect(onProjectAccessed).toHaveBeenCalledWith(document);
    expect(onRecentProjectError).toHaveBeenCalledOnce();
  });
});

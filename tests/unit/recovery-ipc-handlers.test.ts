import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectSchema } from '../../src/domain';
import exampleProject from '../../demo-project/project-v1.example.json';

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

import { registerRecoveryIpcHandlers } from '../../src/main/ipc/register-recovery-ipc-handlers';
import type { AutosaveService } from '../../src/main/services/AutosaveService';
import type { ProjectService } from '../../src/main/services/ProjectService';
import type { RecoveryService } from '../../src/main/services/RecoveryService';
import { IPC_CHANNELS } from '../../src/shared/ipc/channels';

const project = ProjectSchema.parse(exampleProject);
const projectRoot = 'D:\\projects\\recovery.pandastage';

function mainWindow(senderId = 42): BrowserWindow {
  return {
    isDestroyed: () => false,
    webContents: { id: senderId },
  } as unknown as BrowserWindow;
}

function event(senderId = 42): IpcMainInvokeEvent {
  return { sender: { id: senderId } } as IpcMainInvokeEvent;
}

function dependencies(): {
  projectService: ProjectService;
  recoveryService: RecoveryService;
  autosaveService: AutosaveService;
} {
  return {
    projectService: {
      open: vi.fn().mockResolvedValue({
        projectRoot,
        projectFilePath: `${projectRoot}\\project.json`,
        project,
        migrated: false,
        sourceVersion: 1,
      }),
    } as unknown as ProjectService,
    recoveryService: {
      detectLatest: vi.fn().mockResolvedValue(null),
      restore: vi.fn(),
      ignore: vi.fn(),
    } as unknown as RecoveryService,
    autosaveService: {
      track: vi.fn(),
      update: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
    } as unknown as AutosaveService,
  };
}

describe('recovery IPC handlers', () => {
  beforeEach(() => {
    electronMocks.handlers.clear();
    electronMocks.handle.mockClear();
    electronMocks.removeHandler.mockClear();
  });

  it('registers and removes only the recovery/autosave allowlist', () => {
    const remove = registerRecoveryIpcHandlers({
      getMainWindow: () => mainWindow(),
      ...dependencies(),
    });
    expect([...electronMocks.handlers.keys()]).toEqual([
      IPC_CHANNELS.AUTOSAVE_TRACK,
      IPC_CHANNELS.AUTOSAVE_UPDATE,
      IPC_CHANNELS.AUTOSAVE_STOP,
      IPC_CHANNELS.RECOVERY_DETECT,
      IPC_CHANNELS.RECOVERY_RESTORE,
      IPC_CHANNELS.RECOVERY_IGNORE,
    ]);

    remove();
    expect(electronMocks.handlers.size).toBe(0);
  });

  it('runtime-validates dirty state before tracking autosave', async () => {
    const services = dependencies();
    registerRecoveryIpcHandlers({
      getMainWindow: () => mainWindow(),
      ...services,
    });
    const handler = electronMocks.handlers.get(
      IPC_CHANNELS.AUTOSAVE_TRACK,
    )!;

    await expect(
      handler(event(), {
        projectRoot,
        project,
        dirty: 'yes',
        revision: 1,
      }),
    ).rejects.toThrow();
    expect(services.autosaveService.track).not.toHaveBeenCalled();
  });

  it('rejects an untrusted renderer before recovery detection', async () => {
    const services = dependencies();
    registerRecoveryIpcHandlers({
      getMainWindow: () => mainWindow(42),
      ...services,
    });
    const handler = electronMocks.handlers.get(
      IPC_CHANNELS.RECOVERY_DETECT,
    )!;

    await expect(
      handler(event(7), { projectRoot }),
    ).rejects.toThrow('untrusted sender');
    expect(services.projectService.open).not.toHaveBeenCalled();
  });

  it('rejects tracking a project whose identity does not match the disk target', async () => {
    const services = dependencies();
    registerRecoveryIpcHandlers({
      getMainWindow: () => mainWindow(),
      ...services,
    });
    const handler = electronMocks.handlers.get(
      IPC_CHANNELS.AUTOSAVE_TRACK,
    )!;
    const otherProject = {
      ...project,
      id: '99000000-0000-4000-8000-000000000001',
    };

    await expect(
      handler(event(), {
        projectRoot,
        project: otherProject,
        dirty: true,
        revision: 1,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'RECOVERY_PROJECT_MISMATCH',
        projectRoot,
      },
    });
    expect(services.autosaveService.track).not.toHaveBeenCalled();
  });
});

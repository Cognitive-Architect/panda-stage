import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';

const handlers = new Map<string, (event: IpcMainInvokeEvent, raw: unknown) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, listener: (event: IpcMainInvokeEvent, raw: unknown) => unknown) => {
      handlers.set(channel, listener);
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel);
    },
  },
}));

import { IPC_CHANNELS } from '../../src/shared/ipc/channels';
import { registerProjectResourceImportIpcHandlers } from '../../src/main/ipc/register-project-resource-import-ipc-handlers';
import type { ProjectResourceImportService } from '../../src/main/services/ProjectResourceImportService';

describe('registerProjectResourceImportIpcHandlers security', () => {
  beforeEach(() => {
    handlers.clear();
  });

  it('rejects untrusted senders and invalid Zod payloads on all channels', async () => {
    const fakeWindow = {
      isDestroyed: () => false,
      webContents: { id: 42 },
    } as unknown as BrowserWindow;

    const fakeService = {
      selectSourceProject: vi.fn(),
      previewImport: vi.fn(),
      importResources: vi.fn(),
    } as unknown as ProjectResourceImportService;

    const dispose = registerProjectResourceImportIpcHandlers({
      getMainWindow: () => fakeWindow,
      projectResourceImportService: fakeService,
      selectSourceProjectDirectory: vi.fn().mockResolvedValue(null),
    });

    try {
      const untrustedEvent = { sender: { id: 999 } } as unknown as IpcMainInvokeEvent;
      const trustedEvent = { sender: { id: 42 } } as unknown as IpcMainInvokeEvent;

      // Untrusted sender must be rejected on choose, preview, and apply
      const chooseHandler = handlers.get(IPC_CHANNELS.PROJECT_RESOURCE_IMPORT_CHOOSE)!;
      const previewHandler = handlers.get(IPC_CHANNELS.PROJECT_RESOURCE_IMPORT_PREVIEW)!;
      const applyHandler = handlers.get(IPC_CHANNELS.PROJECT_RESOURCE_IMPORT_APPLY)!;

      await expect(chooseHandler(untrustedEvent, {})).rejects.toThrow(/untrusted sender/i);
      expect(() => previewHandler(untrustedEvent, {})).toThrow(/untrusted sender/i);
      await expect(applyHandler(untrustedEvent, {})).rejects.toThrow(/untrusted sender/i);

      // Trusted sender with invalid Zod payload must be rejected
      await expect(
        chooseHandler(trustedEvent, { projectRoot: '' }),
      ).rejects.toThrow();
      expect(() =>
        previewHandler(trustedEvent, {
          projectRoot: 'D:\\target',
          sourceToken: randomUUID(),
          resources: [],
        }),
      ).toThrow();
      await expect(
        applyHandler(trustedEvent, {
          projectRoot: 'D:\\target',
          sourceToken: 'not-a-uuid',
          resources: [],
        }),
      ).rejects.toThrow();
    } finally {
      dispose();
    }

    expect(handlers.size).toBe(0);
  });
});

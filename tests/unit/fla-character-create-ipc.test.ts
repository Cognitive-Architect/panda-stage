import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    electronMocks.handlers.set(channel, handler);
  }),
  removeHandler: vi.fn((channel: string) => electronMocks.handlers.delete(channel)),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: electronMocks.handle,
    removeHandler: electronMocks.removeHandler,
  },
}));

import { registerFlaCharacterCreateIpcHandlers } from '../../src/main/ipc/register-fla-character-create-ipc-handlers';
import type { FlaCharacterCreateService } from '../../src/main/services/FlaCharacterCreateService';
import { IPC_CHANNELS } from '../../src/shared/ipc/channels';

const OPERATION_ID = '90800000-0000-4000-8000-000000000004';

function mainWindow(senderId = 42): BrowserWindow {
  return { isDestroyed: () => false, webContents: { id: senderId } } as unknown as BrowserWindow;
}

function event(senderId = 42): IpcMainInvokeEvent {
  return { sender: { id: senderId } } as IpcMainInvokeEvent;
}

function handler(channel: string): (...args: unknown[]) => unknown {
  const registered = electronMocks.handlers.get(channel);
  if (!registered) throw new Error(`IPC handler was not registered: ${channel}`);
  return registered;
}

describe('F1-03 character creation IPC', () => {
  beforeEach(() => {
    electronMocks.handlers.clear();
    electronMocks.handle.mockClear();
    electronMocks.removeHandler.mockClear();
  });

  it('validates requests at Main and does not call the service for malformed payloads', async () => {
    const service = {
      commit: vi.fn(),
      getStatus: vi.fn(async () => ({ ok: true as const, status: 'NOT_FOUND' as const, operationId: OPERATION_ID })),
    } as unknown as FlaCharacterCreateService;
    const remove = registerFlaCharacterCreateIpcHandlers({ getMainWindow: () => mainWindow(), service });

    const invalidCommit = await handler(IPC_CHANNELS.FLA_CHARACTER_CREATE)(event(), { operationId: OPERATION_ID });
    expect(invalidCommit).toMatchObject({ ok: false, status: 'ERROR', error: { code: 'INVALID_REQUEST' } });
    expect(service.commit).not.toHaveBeenCalled();

    const validStatus = {
      format: 'panda-fla-character-create-status',
      version: 1,
      operationId: OPERATION_ID,
      projectRoot: 'D:\\Panda Stage\\Test.pandastage',
      projectId: '90810000-0000-4000-8000-000000000001',
    };
    expect(await handler(IPC_CHANNELS.FLA_CHARACTER_CREATE_STATUS)(event(), validStatus)).toMatchObject({
      ok: true,
      status: 'NOT_FOUND',
      operationId: OPERATION_ID,
    });
    expect(service.getStatus).toHaveBeenCalledWith(validStatus);
    remove();
    expect(electronMocks.handlers.size).toBe(0);
  });

  it('rejects untrusted renderer senders on both routes', async () => {
    const service = {
      commit: vi.fn(),
      getStatus: vi.fn(),
    } as unknown as FlaCharacterCreateService;
    registerFlaCharacterCreateIpcHandlers({ getMainWindow: () => mainWindow(42), service });

    await expect(handler(IPC_CHANNELS.FLA_CHARACTER_CREATE)(event(99), {})).rejects.toThrow('Untrusted FLA character creation IPC sender');
    await expect(handler(IPC_CHANNELS.FLA_CHARACTER_CREATE_STATUS)(event(99), {})).rejects.toThrow('Untrusted FLA character creation IPC sender');
    expect(service.commit).not.toHaveBeenCalled();
    expect(service.getStatus).not.toHaveBeenCalled();
  });

  it('lets a controlled response-loss fault escape after Main has committed', async () => {
    const service = {
      commit: vi.fn(async () => ({ operationId: OPERATION_ID }) as never),
      getStatus: vi.fn(),
    } as unknown as FlaCharacterCreateService;
    const afterCommitBeforeResponse = vi.fn(() => {
      throw new Error('injected response loss after Main commit');
    });
    registerFlaCharacterCreateIpcHandlers({
      getMainWindow: () => mainWindow(),
      service,
      afterCommitBeforeResponse,
    });

    const request = {
      format: 'panda-fla-character-create',
      version: 1,
      operationId: OPERATION_ID,
      projectRoot: 'D:\\Panda Stage\\Test.pandastage',
      projectId: 'test-project',
      baseRevision: 0,
      openInstanceId: 17,
      name: 'Sample Character',
      confirmation: {
        confirmed: true,
        capability: 'EDITABLE_PARTS_READY',
        planId: '90800000-0000-4000-8000-000000000001',
        sessionId: '90800000-0000-4000-8000-000000000002',
        requestId: '90800000-0000-4000-8000-000000000003',
        generation: 1,
        poseIdentity: 'c'.repeat(64),
        target: { renderTargetId: 'fla-render-target-908000000001', selectedFrameIndex: 2 },
      },
    };

    await expect(handler(IPC_CHANNELS.FLA_CHARACTER_CREATE)(event(), request))
      .rejects.toThrow('injected response loss after Main commit');
    expect(service.commit).toHaveBeenCalledTimes(1);
    expect(afterCommitBeforeResponse).toHaveBeenCalledTimes(1);
    expect(service.getStatus).not.toHaveBeenCalled();
  });
});

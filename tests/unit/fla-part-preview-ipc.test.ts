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

import { registerFlaPartPreviewIpcHandlers } from '../../src/main/ipc/register-fla-part-preview-ipc-handlers';
import type { FlaPartPreviewService } from '../../src/main/services/FlaPartPreviewService';
import { IPC_CHANNELS } from '../../src/shared/ipc/channels';

const SESSION_ID = '90600000-0000-4000-8000-000000000001';
const REQUEST_ID = '90600000-0000-4000-8000-000000000002';
const request = {
  format: 'fla-part-preview',
  version: 1,
  requestId: REQUEST_ID,
  sessionId: SESSION_ID,
  generation: 1,
  target: {
    renderTargetId: 'fla-render-target-1234567890',
    selectedFrameIndex: 0,
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

function handler(channel: string): (...args: unknown[]) => unknown {
  const registered = electronMocks.handlers.get(channel);
  if (!registered) throw new Error(`IPC handler was not registered: ${channel}`);
  return registered;
}

describe('F1-02 Part preview IPC', () => {
  beforeEach(() => {
    electronMocks.handlers.clear();
    electronMocks.handle.mockClear();
    electronMocks.removeHandler.mockClear();
  });

  it('validates the request at Main and returns only the service preview response', async () => {
    const preview = vi.fn(async () => ({
      ok: false as const,
      status: 'ERROR' as const,
      error: { code: 'SESSION_NOT_FOUND' as const, message: 'Inspection session is unavailable' },
    }));
    const service = {
      preview,
      cancel: vi.fn(() => ({ accepted: false })),
    } as unknown as FlaPartPreviewService;
    registerFlaPartPreviewIpcHandlers({ getMainWindow: () => mainWindow(), service });

    const response = await handler(IPC_CHANNELS.FLA_PART_PREVIEW)(event(), request);
    expect(response).toEqual(await preview.mock.results[0]?.value);
    expect(preview).toHaveBeenCalledWith(request);

    const malformed = await handler(IPC_CHANNELS.FLA_PART_PREVIEW)(event(), { ...request, extra: true });
    expect(malformed).toEqual({
      ok: false,
      status: 'ERROR',
      error: { code: 'INVALID_REQUEST', message: 'Invalid F1-02 part preview request' },
    });
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it('enforces Main window sender identity for preview and cancel', async () => {
    const service = {
      preview: vi.fn(),
      cancel: vi.fn(),
    } as unknown as FlaPartPreviewService;
    registerFlaPartPreviewIpcHandlers({ getMainWindow: () => mainWindow(42), service });

    await expect(async () => handler(IPC_CHANNELS.FLA_PART_PREVIEW)(event(99), request))
      .rejects.toThrow('Untrusted FLA part preview IPC sender');
    await expect(async () => handler(IPC_CHANNELS.FLA_PART_PREVIEW_CANCEL)(event(99), {
      format: 'fla-part-preview-cancel',
      version: 1,
      requestId: REQUEST_ID,
    })).rejects.toThrow('Untrusted FLA part preview IPC sender');
    expect(service.preview).not.toHaveBeenCalled();
    expect(service.cancel).not.toHaveBeenCalled();
  });

  it('validates cancellation and removes both handlers on teardown', () => {
    const service = {
      preview: vi.fn(),
      cancel: vi.fn(() => ({ accepted: true })),
    } as unknown as FlaPartPreviewService;
    const remove = registerFlaPartPreviewIpcHandlers({ getMainWindow: () => mainWindow(), service });
    const cancel = handler(IPC_CHANNELS.FLA_PART_PREVIEW_CANCEL);

    expect(cancel(event(), { format: 'wrong' })).toEqual({ accepted: false });
    expect(service.cancel).not.toHaveBeenCalled();
    expect(cancel(event(), {
      format: 'fla-part-preview-cancel',
      version: 1,
      sessionId: SESSION_ID,
      generation: 1,
    })).toEqual({ accepted: true });
    expect(service.cancel).toHaveBeenCalledWith({
      format: 'fla-part-preview-cancel',
      version: 1,
      sessionId: SESSION_ID,
      generation: 1,
    });

    remove();
    expect(electronMocks.handlers.has(IPC_CHANNELS.FLA_PART_PREVIEW)).toBe(false);
    expect(electronMocks.handlers.has(IPC_CHANNELS.FLA_PART_PREVIEW_CANCEL)).toBe(false);
  });
});

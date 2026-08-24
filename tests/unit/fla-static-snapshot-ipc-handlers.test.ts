import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    electronMocks.handlers.set(channel, handler);
  }),
  removeHandler: vi.fn((channel: string) => {
    electronMocks.handlers.delete(channel);
  }),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: electronMocks.handle,
    removeHandler: electronMocks.removeHandler,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
  },
}));

import { registerFlaStaticSnapshotIpcHandlers } from '../../src/main/ipc/register-fla-static-snapshot-ipc-handlers';
import {
  FlaRenderableTargetCatalogResponseSchema,
} from '../../src/shared/fla-static-snapshot-api';
import { IPC_CHANNELS } from '../../src/shared/ipc/channels';
import type { FlaStaticSnapshotRenderSession } from '../../src/main/services/fla-static-snapshot-render-session';
import type { BuildCatalogSuccess } from '../../src/main/services/fla-static-snapshot-svg-builder';

const sessionId = '00000000-0000-4000-8000-000000000001';
const validRequest = {
  format: 'fla-static-snapshot-catalog',
  version: 1,
  sessionId,
};

const successCatalog = {
  ok: true as const,
  entries: [
    {
      target: {
        renderTargetId: 'fla-render-target-1a2b3c4d5e6f7a8b',
        kind: 'graphic-symbol',
        userLabel: '剑 · 主体',
        sourceSymbolName: '剑主体',
        frameCount: 2,
        selectedFrameIndex: 0,
        compatibility: ['degraded'],
      },
      previewSupported: true,
    },
  ],
  summary: '这个 FLA 有 1 个可渲染图形。',
} satisfies BuildCatalogSuccess;

function mainWindow(senderId = 42): BrowserWindow {
  return {
    isDestroyed: () => false,
    webContents: { id: senderId },
  } as unknown as BrowserWindow;
}

function event(senderId = 42): IpcMainInvokeEvent {
  return { sender: { id: senderId } } as IpcMainInvokeEvent;
}

function makeRenderSession(catalogImpl: FlaStaticSnapshotRenderSession['catalog']) {
  return {
    catalog: vi.fn(catalogImpl),
  } as unknown as FlaStaticSnapshotRenderSession;
}

function register(renderSession: FlaStaticSnapshotRenderSession) {
  return registerFlaStaticSnapshotIpcHandlers({
    getMainWindow: () => mainWindow(),
    renderSession,
    commitService: {} as never,
    windowManager: {} as never,
  });
}

function catalogHandler(): (...args: unknown[]) => unknown {
  const handler = electronMocks.handlers.get(IPC_CHANNELS.FLA_SNAPSHOT_CATALOG);
  if (!handler) throw new Error('catalog handler was not registered');
  return handler;
}

describe('R1-A snapshot catalog IPC handler', () => {
  beforeEach(() => {
    electronMocks.handlers.clear();
    electronMocks.handle.mockClear();
    electronMocks.removeHandler.mockClear();
  });

  it('returns the exact ok:true envelope on a successful catalog', async () => {
    const renderSession = makeRenderSession(async () => successCatalog);
    register(renderSession);

    const response = await catalogHandler()(event(), validRequest);

    // Handler response construction — not just schema.parse independently.
    expect(response).toEqual({
      ok: true,
      sessionId,
      entries: successCatalog.entries,
      summary: successCatalog.summary,
    });
    // The assembled envelope satisfies the strict shared schema.
    expect(FlaRenderableTargetCatalogResponseSchema.safeParse(response).success).toBe(true);
    expect(renderSession.catalog).toHaveBeenCalledWith(sessionId);
  });

  it('returns ok:false INVALID_REQUEST for a malformed request', async () => {
    const renderSession = makeRenderSession(async () => successCatalog);
    register(renderSession);

    const response = await catalogHandler()(event(), { format: 'wrong' });

    expect(response).toEqual({
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'Invalid snapshot catalog request' },
    });
    expect(FlaRenderableTargetCatalogResponseSchema.safeParse(response).success).toBe(true);
    // The catalog service must not be consulted for an invalid request.
    expect(renderSession.catalog).not.toHaveBeenCalled();
  });

  it('returns ok:false SESSION_NOT_FOUND when the session is missing', async () => {
    const renderSession = makeRenderSession(async () => ({
      ok: false,
      code: 'SESSION_NOT_FOUND',
      message: 'The FLA inspection session has expired. Inspect the source again.',
    }));
    register(renderSession);

    const response = await catalogHandler()(event(), validRequest);

    expect(response).toEqual({
      ok: false,
      error: { code: 'SESSION_NOT_FOUND', message: 'The FLA inspection session has expired. Inspect the source again.' },
    });
    expect(FlaRenderableTargetCatalogResponseSchema.safeParse(response).success).toBe(true);
    expect(renderSession.catalog).toHaveBeenCalledWith(sessionId);
  });

  it('rejects an untrusted sender without consulting the catalog service', async () => {
    const renderSession = makeRenderSession(async () => successCatalog);
    register(renderSession);

    const untrusted = { isDestroyed: () => false, webContents: { id: 99 } } as unknown as BrowserWindow;
    const getMainWindow = () => untrusted;
    electronMocks.handlers.clear();
    registerFlaStaticSnapshotIpcHandlers({
      getMainWindow,
      renderSession,
      commitService: {} as never,
      windowManager: {} as never,
    });

    await expect(catalogHandler()(event(42), validRequest)).rejects.toThrow('Untrusted FLA snapshot IPC sender');
    expect(renderSession.catalog).not.toHaveBeenCalled();
  });
});

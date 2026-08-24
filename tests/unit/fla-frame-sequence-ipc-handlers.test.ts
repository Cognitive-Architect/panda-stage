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

import { registerFlaFrameSequenceIpcHandlers } from '../../src/main/ipc/register-fla-frame-sequence-ipc-handlers';
import {
  FlaFrameSequenceCancelResponseSchema,
  FlaFrameSequenceCommitResponseSchema,
  FlaFrameSequenceResponseSchema,
  type FlaFrameSequenceRange,
  type FlaFrameSequenceResponse,
} from '../../src/shared/fla-frame-sequence-api';
import { IPC_CHANNELS } from '../../src/shared/ipc/channels';
import type { FlaStaticSnapshotSource } from '../../src/main/services/fla-static-snapshot-render-session';
import { buildRenderableTargetCatalog } from '../../src/main/services/fla-static-snapshot-svg-builder';
import { buildMultiFrameGraphicFla } from '../helpers/fla-render-fixture';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject, type Project } from '../../src/domain';
import { ProjectSchema } from '../../src/domain';

const migratedProject = migrateProject(exampleProject as never) as Project;
// Sanity: the migrated fixture must be a valid current-version Project.
if (!ProjectSchema.safeParse(migratedProject).success) {
  throw new Error('demo project fixture did not migrate to a valid Project');
}

const sessionId = '00000000-0000-4000-8000-000000000001';
const requestId = '11111111-1111-4111-8111-111111111111';
const renderTargetId = 'fla-render-target-1a2b3c4d5e6f7a8b';
const range: FlaFrameSequenceRange = { renderTargetId, startFrameIndex: 0, endFrameIndex: 1 };

const validRenderRequest = {
  format: 'fla-frame-sequence-render',
  version: 1,
  requestId,
  sessionId,
  range,
};

const successResponse: FlaFrameSequenceResponse = {
  ok: true,
  requestId,
  renderTargetId,
  items: [
    {
      frameIndex: 0,
      sequenceOrdinal: 0,
      preview: {
        ok: true,
        requestId,
        targetRenderTargetId: renderTargetId,
        targetSelectedFrameIndex: 0,
        width: 4,
        height: 4,
        pixelCount: 16,
        bytes: new Uint8Array([1, 2, 3, 4]),
        sha256: 'a'.repeat(64),
        wallClockMs: 1,
        isFirstPreviewForSession: true,
        startedAt: '2026-08-22T00:00:00.000Z',
      },
    },
  ],
  sequenceTotalMs: 1,
  cancelledFrames: 0,
  totalPixelCount: 16,
};

const source: FlaStaticSnapshotSource = { bytes: new Uint8Array([9, 9]) } as unknown as FlaStaticSnapshotSource;

function mainWindow(senderId = 42): BrowserWindow {
  return { isDestroyed: () => false, webContents: { id: senderId } } as unknown as BrowserWindow;
}
function event(senderId = 42): IpcMainInvokeEvent {
  return { sender: { id: senderId } } as IpcMainInvokeEvent;
}

interface Mocks {
  sequenceService: { renderSequence: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };
  commitService: { commit: ReturnType<typeof vi.fn> };
  sourceLookup: { getSource: ReturnType<typeof vi.fn> };
  buildFrameSource?: () => AsyncIterable<{ frameIndex: number; svg: string }>;
}

function makeMocks(overrides: Partial<Mocks> = {}): Mocks {
  return {
    sequenceService: {
      renderSequence: vi.fn(async () => successResponse),
      cancel: vi.fn(() => true),
    },
    commitService: { commit: vi.fn(async () => ({ ok: true, status: 'completed', project: migratedProject, baseRevision: 0, savedRevision: 1, projectChanged: true, result: { items: [], summary: { requestedFrameCount: 1, importedCount: 1, duplicateCount: 0, renamedCount: 0, netNewImageAssetCount: 1 } } })) },
    sourceLookup: { getSource: vi.fn(() => source) },
    buildFrameSource: overrides.buildFrameSource,
    ...overrides,
  };
}

function register(mocks: Mocks) {
  return registerFlaFrameSequenceIpcHandlers({
    getMainWindow: () => mainWindow(),
    sequenceService: mocks.sequenceService as never,
    commitService: mocks.commitService as never,
    sourceLookup: mocks.sourceLookup as never,
    buildFrameSource: mocks.buildFrameSource as never,
  });
}

function handler(channel: string): (...args: unknown[]) => unknown {
  const h = electronMocks.handlers.get(channel);
  if (!h) throw new Error(`handler ${channel} was not registered`);
  return h;
}

describe('R2-H.1 frame sequence render IPC', () => {
  beforeEach(() => {
    electronMocks.handlers.clear();
    electronMocks.handle.mockClear();
    electronMocks.removeHandler.mockClear();
  });

  it('trusted sender + valid request invokes renderSequence with parsed request', async () => {
    const mocks = makeMocks();
    register(mocks);

    const response = await handler(IPC_CHANNELS.FLA_FRAME_SEQUENCE_RENDER)(event(), validRenderRequest);

    expect(FlaFrameSequenceResponseSchema.safeParse(response).success).toBe(true);
    expect(mocks.sequenceService.renderSequence).toHaveBeenCalledWith(
      sessionId,
      range,
      expect.anything(),
      { sequenceRequestId: requestId },
    );
    expect(mocks.sourceLookup.getSource).toHaveBeenCalledWith(sessionId);
  });

  it('returns the ok:true envelope and satisfies the strict union schema', async () => {
    const mocks = makeMocks();
    register(mocks);
    const response = await handler(IPC_CHANNELS.FLA_FRAME_SEQUENCE_RENDER)(event(), validRenderRequest);
    expect(response).toEqual(successResponse);
    expect(FlaFrameSequenceResponseSchema.safeParse(response).success).toBe(true);
  });

  it('invalid request returns a well-formed ok:false RENDER_FAILED (no service call)', async () => {
    const mocks = makeMocks();
    register(mocks);
    const response = await handler(IPC_CHANNELS.FLA_FRAME_SEQUENCE_RENDER)(event(), { format: 'wrong' });
    expect(response).toMatchObject({ ok: false, error: { code: 'RENDER_FAILED' } });
    expect(FlaFrameSequenceResponseSchema.safeParse(response).success).toBe(true);
    expect(mocks.sequenceService.renderSequence).not.toHaveBeenCalled();
  });

  it('missing inspection/source session returns RENDER_FAILED without invoking the service', async () => {
    const mocks = makeMocks();
    mocks.sourceLookup.getSource = vi.fn(() => null);
    register(mocks);
    const response = await handler(IPC_CHANNELS.FLA_FRAME_SEQUENCE_RENDER)(event(), validRenderRequest);
    expect(response).toMatchObject({ ok: false, error: { code: 'RENDER_FAILED', requestId } });
    expect(FlaFrameSequenceResponseSchema.safeParse(response).success).toBe(true);
    expect(mocks.sequenceService.renderSequence).not.toHaveBeenCalled();
  });

  it('source-build failure (missing target) returns a contract error', async () => {
    const mocks = makeMocks({
      buildFrameSource: () => {
        throw new Error('R2 target not found');
      },
    });
    register(mocks);
    const response = await handler(IPC_CHANNELS.FLA_FRAME_SEQUENCE_RENDER)(event(), validRenderRequest);
    expect(response).toMatchObject({ ok: false, error: { code: 'RENDER_FAILED' } });
    expect(FlaFrameSequenceResponseSchema.safeParse(response).success).toBe(true);
  });

  it('uses a real catalog target id in the default R2 frame-source bridge', async () => {
    const bytes = await buildMultiFrameGraphicFla();
    const catalog = await buildRenderableTargetCatalog(bytes);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;
    const target = catalog.entries.find((entry) => entry.target.frameCount >= 2)?.target;
    expect(target).toBeDefined();
    if (!target) return;

    const collected: Array<{ frameIndex: number; svg: string }> = [];
    const mocks = makeMocks();
    mocks.sourceLookup.getSource = vi.fn((): FlaStaticSnapshotSource => ({
      bytes,
      basename: 'r2-multi-frame-fixture.fla',
      sha256: 'b'.repeat(64),
    }));
    mocks.sequenceService.renderSequence.mockImplementation(async (
      _session: string,
      _requestedRange: FlaFrameSequenceRange,
      sourceIterable: AsyncIterable<{ frameIndex: number; svg: string }>,
    ) => {
      for await (const frame of sourceIterable) collected.push(frame);
      return { ...successResponse, renderTargetId: target.renderTargetId };
    });
    register(mocks);

    const response = await handler(IPC_CHANNELS.FLA_FRAME_SEQUENCE_RENDER)(event(), {
      ...validRenderRequest,
      range: { renderTargetId: target.renderTargetId, startFrameIndex: 0, endFrameIndex: 1 },
    });

    expect(response).toMatchObject({ ok: true, renderTargetId: target.renderTargetId });
    expect(collected.map((frame) => frame.frameIndex)).toEqual([0, 1]);
    expect(collected.every((frame) => frame.svg.includes('<path'))).toBe(true);
  });

  it('rejects an untrusted sender without invoking the service', async () => {
    const mocks = makeMocks();
    const untrusted = { isDestroyed: () => false, webContents: { id: 99 } } as unknown as BrowserWindow;
    registerFlaFrameSequenceIpcHandlers({
      getMainWindow: () => untrusted,
      sequenceService: mocks.sequenceService as never,
      commitService: mocks.commitService as never,
      sourceLookup: mocks.sourceLookup as never,
    });
    await expect(handler(IPC_CHANNELS.FLA_FRAME_SEQUENCE_RENDER)(event(42), validRenderRequest)).rejects.toThrow(
      'Untrusted FLA frame sequence IPC sender',
    );
    expect(mocks.sequenceService.renderSequence).not.toHaveBeenCalled();
  });
});

describe('R2-H.1 frame sequence cancel IPC', () => {
  beforeEach(() => {
    electronMocks.handlers.clear();
    electronMocks.handle.mockClear();
    electronMocks.removeHandler.mockClear();
  });

  it('trusted sender + valid cancel forwards stable identity to the service', async () => {
    const mocks = makeMocks();
    register(mocks);
    const response = await handler(IPC_CHANNELS.FLA_FRAME_SEQUENCE_CANCEL)(event(), {
      format: 'fla-frame-sequence-cancel',
      version: 1,
      requestId,
      sessionId,
    });
    expect(FlaFrameSequenceCancelResponseSchema.safeParse(response).success).toBe(true);
    expect(mocks.sequenceService.cancel).toHaveBeenCalledWith(sessionId, requestId);
  });

  it('cancel without identity still returns a typed response', async () => {
    const mocks = makeMocks();
    register(mocks);
    const response = await handler(IPC_CHANNELS.FLA_FRAME_SEQUENCE_CANCEL)(event(), {
      format: 'fla-frame-sequence-cancel',
      version: 1,
    });
    expect(FlaFrameSequenceCancelResponseSchema.safeParse(response).success).toBe(true);
    expect(mocks.sequenceService.cancel).toHaveBeenCalledWith('', undefined);
  });

  it('rejects an untrusted sender', async () => {
    const mocks = makeMocks();
    const untrusted = { isDestroyed: () => false, webContents: { id: 99 } } as unknown as BrowserWindow;
    registerFlaFrameSequenceIpcHandlers({
      getMainWindow: () => untrusted,
      sequenceService: mocks.sequenceService as never,
      commitService: mocks.commitService as never,
      sourceLookup: mocks.sourceLookup as never,
    });
    await expect(
      handler(IPC_CHANNELS.FLA_FRAME_SEQUENCE_CANCEL)(event(42), { format: 'fla-frame-sequence-cancel', version: 1 }),
    ).rejects.toThrow('Untrusted FLA frame sequence IPC sender');
  });
});

describe('R2-H.1 frame sequence commit IPC', () => {
  beforeEach(() => {
    electronMocks.handlers.clear();
    electronMocks.handle.mockClear();
    electronMocks.removeHandler.mockClear();
  });

  const validCommitRequest = {
    format: 'fla-frame-sequence-commit',
    version: 1,
    projectRoot: '/p',
    project: migratedProject,
    baseRevision: 0,
    sessionId,
    confirmedSequenceRequestId: requestId,
    source: { basename: 'x.fla', sha256: 'a'.repeat(64) },
    range,
    sequence: {
      requestId,
      sha256EachFrame: ['a'.repeat(64)],
      widthEachFrame: [4],
      heightEachFrame: [4],
      byteLengthEachFrame: [4],
      targetRenderTargetIdEachFrame: [renderTargetId],
    },
    confirmed: true,
  };

  it('trusted sender + valid commit invokes commitService.commit', async () => {
    const mocks = makeMocks();
    register(mocks);
    const response = await handler(IPC_CHANNELS.FLA_FRAME_SEQUENCE_COMMIT)(event(), validCommitRequest);
    expect(FlaFrameSequenceCommitResponseSchema.safeParse(response).success).toBe(true);
    expect(mocks.commitService.commit).toHaveBeenCalledWith(validCommitRequest);
  });

  it('invalid commit request returns INVALID_REQUEST without throwing across the boundary', async () => {
    const mocks = makeMocks();
    register(mocks);
    const response = await handler(IPC_CHANNELS.FLA_FRAME_SEQUENCE_COMMIT)(event(), { format: 'wrong' });
    expect(response).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(FlaFrameSequenceCommitResponseSchema.safeParse(response).success).toBe(true);
    expect(mocks.commitService.commit).not.toHaveBeenCalled();
  });

  it('rejects an untrusted sender', async () => {
    const mocks = makeMocks();
    const untrusted = { isDestroyed: () => false, webContents: { id: 99 } } as unknown as BrowserWindow;
    registerFlaFrameSequenceIpcHandlers({
      getMainWindow: () => untrusted,
      sequenceService: mocks.sequenceService as never,
      commitService: mocks.commitService as never,
      sourceLookup: mocks.sourceLookup as never,
    });
    await expect(
      handler(IPC_CHANNELS.FLA_FRAME_SEQUENCE_COMMIT)(event(42), validCommitRequest),
    ).rejects.toThrow('Untrusted FLA frame sequence IPC sender');
  });
});

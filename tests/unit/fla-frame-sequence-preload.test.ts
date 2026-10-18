import { describe, expect, it, vi } from 'vitest';

// Mock Electron so the preload module can be imported under vitest
// `environment: 'node'` (no jsdom) and its surface captured via
// contextBridge.exposeInMainWorld.
const preloadMocks = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  invoke: vi.fn(async (_channel: string, _request: unknown): Promise<unknown> => ({ ok: true, accepted: true })),
  send: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  exposed: {} as Record<string, unknown>,
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, api: unknown) => {
      preloadMocks.exposed[key] = api;
    },
  },
  ipcRenderer: {
    invoke: preloadMocks.invoke,
    send: preloadMocks.send,
    on: preloadMocks.on,
    removeListener: preloadMocks.removeListener,
  },
}));

import { IPC_CHANNELS } from '../../src/shared/ipc/channels';
import {
  FlaFrameSequenceCancelRequestSchema,
  FlaFrameSequenceCancelResponseSchema,
  FlaFrameSequenceCommitRequestSchema,
  FlaFrameSequenceCommitResponseSchema,
  FlaFrameSequenceRangeSchema,
  FlaFrameSequenceRequestSchema,
  FlaFrameSequenceResponseSchema,
  type FlaFrameSequenceProgress,
  type FlaFrameSequenceRange,
} from '../../src/shared/fla-frame-sequence-api';
import {
  FlaFrameSequenceService,
  type SequenceFrameInput,
} from '../../src/main/services/fla-frame-sequence-service';
import type {
  FlaStaticSnapshotRasterizer,
} from '../../src/main/services/fla-static-snapshot-render-session';
import {
  buildRenderableTargetCatalog,
  buildSvgForRenderTarget,
} from '../../src/main/services/fla-static-snapshot-svg-builder';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject, ProjectSchema, type Project } from '../../src/domain';
import { buildMultiFrameGraphicFla } from '../helpers/fla-render-fixture';

const migratedProject = migrateProject(exampleProject as never) as Project;
if (!ProjectSchema.safeParse(migratedProject).success) {
  throw new Error('demo project fixture did not migrate to a valid Project');
}

// Importing the preload registers the pandaStage surface.
await import('../../src/preload/index');

const pandaStage = preloadMocks.exposed.pandaStage as {
  fla: {
    frameSequenceRender: (r: unknown) => Promise<unknown>;
    frameSequenceCancel: (r: unknown) => Promise<unknown>;
    frameSequenceCommit: (r: unknown) => Promise<unknown>;
    frameSequenceProgressSubscribe: (cb: (p: FlaFrameSequenceProgress) => void) => () => void;
  };
};

const renderRequest = {
  format: 'fla-frame-sequence-render',
  version: 1,
  requestId: '11111111-1111-4111-8111-111111111111',
  sessionId: '00000000-0000-4000-8000-000000000001',
  range: { renderTargetId: 'fla-render-target-1a2b3c4d5e6f7a8b', startFrameIndex: 0, endFrameIndex: 1 },
};
const cancelRequest = { format: 'fla-frame-sequence-cancel', version: 1, sessionId: renderRequest.sessionId };
const commitRequest = {
  format: 'fla-frame-sequence-commit',
  version: 1,
  projectRoot: '/p',
  project: migratedProject,
  baseRevision: 0,
  sessionId: renderRequest.sessionId,
  confirmedSequenceRequestId: renderRequest.requestId,
  source: { basename: 'x.fla', sha256: 'a'.repeat(64) },
  range: renderRequest.range,
  sequence: {
    requestId: renderRequest.requestId,
    sha256EachFrame: ['a'.repeat(64)],
    widthEachFrame: [4],
    heightEachFrame: [4],
    byteLengthEachFrame: [4],
    targetRenderTargetIdEachFrame: ['fla-render-target-1a2b3c4d5e6f7a8b'],
  },
  confirmed: true,
};

describe('R2-H.1 preload frame sequence surface', () => {
  it('exposes the three R2 methods under pandaStage.fla', () => {
    expect(typeof pandaStage.fla.frameSequenceRender).toBe('function');
    expect(typeof pandaStage.fla.frameSequenceCancel).toBe('function');
    expect(typeof pandaStage.fla.frameSequenceCommit).toBe('function');
  });

  it('frameSequenceRender parses the outbound request and invokes the exact channel', async () => {
    preloadMocks.invoke.mockResolvedValueOnce({ ok: true, requestId: renderRequest.requestId, renderTargetId: renderRequest.range.renderTargetId, items: [], sequenceTotalMs: 0, cancelledFrames: 0, totalPixelCount: 0 });
    const response = await pandaStage.fla.frameSequenceRender(renderRequest);
    // Outbound request is re-parsed through the strict schema before invoke.
    expect(preloadMocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.FLA_FRAME_SEQUENCE_RENDER, expect.objectContaining(renderRequest));
    expect(FlaFrameSequenceRequestSchema.safeParse(renderRequest).success).toBe(true);
    // Inbound response is parsed through the shared contract.
    expect(FlaFrameSequenceResponseSchema.safeParse(response).success).toBe(true);
  });

  it('frameSequenceCancel invokes the cancel channel with the parsed request', async () => {
    preloadMocks.invoke.mockResolvedValueOnce({ accepted: true });
    const response = await pandaStage.fla.frameSequenceCancel(cancelRequest);
    expect(preloadMocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.FLA_FRAME_SEQUENCE_CANCEL, expect.objectContaining(cancelRequest));
    expect(FlaFrameSequenceCancelRequestSchema.safeParse(cancelRequest).success).toBe(true);
    expect(FlaFrameSequenceCancelResponseSchema.safeParse(response).success).toBe(true);
  });

  it('frameSequenceCommit invokes the commit channel with the parsed request', async () => {
    preloadMocks.invoke.mockResolvedValueOnce({ ok: true, status: 'completed', project: migratedProject, baseRevision: 0, savedRevision: 1, projectChanged: false, result: { items: [], summary: { requestedFrameCount: 1, importedCount: 0, duplicateCount: 0, renamedCount: 0, netNewImageAssetCount: 0 } } });
    const response = await pandaStage.fla.frameSequenceCommit(commitRequest);
    expect(preloadMocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.FLA_FRAME_SEQUENCE_COMMIT, expect.objectContaining(commitRequest));
    expect(FlaFrameSequenceCommitRequestSchema.safeParse(commitRequest).success).toBe(true);
    expect(FlaFrameSequenceCommitResponseSchema.safeParse(response).success).toBe(true);
  });

  it('does not expose raw Electron primitives on the R2 methods', async () => {
    preloadMocks.invoke.mockResolvedValueOnce({ ok: true, accepted: true });
    const render = pandaStage.fla.frameSequenceRender;
    const src = render.toString();
    expect(src).not.toContain('ipcRenderer.send');
    expect(src).not.toContain('contextBridge');
    expect(src).not.toContain('require(');
    expect(src).not.toContain('process.');
  });

  it('frameSequenceProgressSubscribe uses the narrow progress channel and returns an unsubscribe', () => {
    const unsub = pandaStage.fla.frameSequenceProgressSubscribe(() => {});
    expect(typeof unsub).toBe('function');
    expect(preloadMocks.on).toHaveBeenCalledWith(IPC_CHANNELS.FLA_FRAME_SEQUENCE_PROGRESS, expect.any(Function));
    // unsubscribe removes the listener from the dedicated channel only.
    unsub();
    expect(preloadMocks.removeListener).toHaveBeenCalledWith(IPC_CHANNELS.FLA_FRAME_SEQUENCE_PROGRESS, expect.any(Function));
  });

  it('progress subscriber parses the raw payload through the strict progress schema', () => {
    pandaStage.fla.frameSequenceProgressSubscribe(() => {});
    const listener = preloadMocks.on.mock.calls.find(
      (c) => c[0] === IPC_CHANNELS.FLA_FRAME_SEQUENCE_PROGRESS,
    )?.[1] as ((_e: unknown, raw: unknown) => void) | undefined;
    expect(listener).toBeTypeOf('function');
    const good = {
      format: 'fla-frame-sequence-progress',
      version: 1,
      sessionId: '00000000-0000-4000-8000-000000000001',
      requestId: '11111111-1111-4111-8111-111111111111',
      completedFrameCount: 2,
      totalFrameCount: 5,
    };
    expect(() => listener?.(null, good)).not.toThrow();
    // An unknown format must be rejected by the strict schema (no silent passthrough).
    expect(() => listener?.(null, { format: 'wrong', version: 1, sessionId: '00000000-0000-4000-8000-000000000001', requestId: '11111111-1111-4111-8111-111111111111', completedFrameCount: 1, totalFrameCount: 1 })).toThrow();
  });

  it('routes formal service events through the preload parser for zero and non-zero source ranges', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000001';
    const ranges = [
      { start: 0, end: 0, requestId: '11111111-1111-4111-8111-111111111101' },
      { start: 0, end: 23, requestId: '11111111-1111-4111-8111-111111111102' },
      { start: 1, end: 24, requestId: '11111111-1111-4111-8111-111111111103' },
      { start: 24, end: 25, requestId: '11111111-1111-4111-8111-111111111104' },
      { start: 100, end: 102, requestId: '11111111-1111-4111-8111-111111111105' },
    ];
    const sourceBytes = await buildMultiFrameGraphicFla({ frameCount: 103 });
    const catalog = await buildRenderableTargetCatalog(sourceBytes);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;
    const target = catalog.entries.find((entry) => (
      entry.target.kind === 'graphic-symbol' && entry.target.frameCount >= 103
    ))?.target;
    expect(target).toBeDefined();
    if (!target) return;

    const sourceFramesByIndex = new Map<number, SequenceFrameInput>();
    for (const { start, end } of ranges) {
      for (let frameIndex = start; frameIndex <= end; frameIndex += 1) {
        if (sourceFramesByIndex.has(frameIndex)) continue;
        const built = await buildSvgForRenderTarget(sourceBytes, {
          ...target,
          selectedFrameIndex: frameIndex,
        });
        expect(built.ok).toBe(true);
        if (built.ok) sourceFramesByIndex.set(frameIndex, { frameIndex, svg: built.svg });
      }
    }

    const rasterizer: FlaStaticSnapshotRasterizer = {
      async rasterize() {
        return { pngBytes: Uint8Array.of(1), width: 1, height: 1, pixelCount: 1 };
      },
      cancel: () => false,
      close: () => undefined,
    };
    const observations: Array<{
      range: [number, number];
      rendered: boolean;
      resultFrameIndices: number[];
      resultOrdinals: number[];
      progressCurrentFrameIndices: number[];
      progressCountsValid: boolean;
      progressIdentitiesValid: boolean;
      preloadDeliveredCount: number;
      preloadRejectedFrameIndices: number[];
    }> = [];

    for (const { start, end, requestId } of ranges) {
      const range: FlaFrameSequenceRange = FlaFrameSequenceRangeSchema.parse({
        renderTargetId: target.renderTargetId,
        startFrameIndex: start,
        endFrameIndex: end,
      });
      // This generated FLA target contains every requested source index,
      // including 100..102; frames come from the production SVG builder.
      const sourceFrames: SequenceFrameInput[] = [];
      for (let frameIndex = start; frameIndex <= end; frameIndex += 1) {
        const sourceFrame = sourceFramesByIndex.get(frameIndex);
        expect(sourceFrame).toBeDefined();
        if (sourceFrame) sourceFrames.push(sourceFrame);
      }
      const service = new FlaFrameSequenceService({ rasterizer });
      const serviceEvents: FlaFrameSequenceProgress[] = [];
      const unsubscribeService = service.subscribe((progress) => serviceEvents.push(progress));
      const response = await service.renderSequence(
        sessionId,
        range,
        sourceFrames,
        { sequenceRequestId: requestId },
      );
      unsubscribeService();

      const listenerCallStart = preloadMocks.on.mock.calls.length;
      const preloadDelivered: FlaFrameSequenceProgress[] = [];
      const unsubscribePreload = pandaStage.fla.frameSequenceProgressSubscribe((progress) => {
        preloadDelivered.push(progress);
      });
      const listener = preloadMocks.on.mock.calls.slice(listenerCallStart).find(
        (call) => call[0] === IPC_CHANNELS.FLA_FRAME_SEQUENCE_PROGRESS,
      )?.[1] as ((_event: unknown, raw: unknown) => void) | undefined;
      expect(listener).toBeTypeOf('function');

      const preloadRejectedFrameIndices: number[] = [];
      for (const progress of serviceEvents) {
        try {
          listener?.(null, progress);
        } catch {
          preloadRejectedFrameIndices.push(progress.currentFrameIndex ?? -1);
        }
      }
      unsubscribePreload();

      const resultItems = response.ok ? response.items : [];
      observations.push({
        range: [start, end],
        rendered: response.ok,
        resultFrameIndices: resultItems.map((item) => item.frameIndex),
        resultOrdinals: resultItems.map((item) => item.sequenceOrdinal),
        progressCurrentFrameIndices: serviceEvents.map((progress) => progress.currentFrameIndex ?? -1),
        progressCountsValid: serviceEvents.every((progress, index) => (
          progress.completedFrameCount === index + 1
          && progress.totalFrameCount === end - start + 1
        )),
        progressIdentitiesValid: serviceEvents.every((progress) => (
          progress.sessionId === sessionId && progress.requestId === requestId
        )),
        preloadDeliveredCount: preloadDelivered.length,
        preloadRejectedFrameIndices,
      });
    }

    expect(observations).toEqual(ranges.map(({ start, end }) => {
      const count = end - start + 1;
      return {
        range: [start, end],
        rendered: true,
        resultFrameIndices: Array.from({ length: count }, (_, ordinal) => start + ordinal),
        resultOrdinals: Array.from({ length: count }, (_, ordinal) => ordinal),
        progressCurrentFrameIndices: Array.from({ length: count }, (_, ordinal) => ordinal),
        progressCountsValid: true,
        progressIdentitiesValid: true,
        preloadDeliveredCount: count,
        preloadRejectedFrameIndices: [],
      };
    }));
  });

  it('rejects a 25-frame request before consuming or rasterizing source frames', async () => {
    const range = {
      renderTargetId: 'fla-render-target-1a2b3c4d5e6f7a8b',
      startFrameIndex: 0,
      endFrameIndex: 24,
    };
    expect(FlaFrameSequenceRangeSchema.safeParse(range).success).toBe(false);

    let sourceConsumed = false;
    let rasterized = 0;
    const rasterizer: FlaStaticSnapshotRasterizer = {
      async rasterize() {
        rasterized += 1;
        return { pngBytes: Uint8Array.of(1), width: 1, height: 1, pixelCount: 1 };
      },
      cancel: () => false,
      close: () => undefined,
    };
    const source = (async function* (): AsyncGenerator<SequenceFrameInput> {
      sourceConsumed = true;
      yield { frameIndex: 0, svg: '<svg/>' };
    })();
    const service = new FlaFrameSequenceService({ rasterizer });
    const response = await service.renderSequence(
      '00000000-0000-4000-8000-000000000001',
      range as unknown as FlaFrameSequenceRange,
      source,
      { sequenceRequestId: '11111111-1111-4111-8111-111111111199' },
    );

    expect(response).toMatchObject({ ok: false, error: { code: 'RANGE_TOO_LARGE', completedFrameCount: 0 } });
    expect(sourceConsumed).toBe(false);
    expect(rasterized).toBe(0);
  });

  it('frameSequenceProgressSubscribe does not expose raw Electron primitives', () => {
    const src = pandaStage.fla.frameSequenceProgressSubscribe.toString();
    expect(src).not.toContain('contextBridge');
    expect(src).not.toContain('require(');
    expect(src).not.toContain('process.');
  });
});

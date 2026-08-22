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
  FlaFrameSequenceRequestSchema,
  FlaFrameSequenceResponseSchema,
} from '../../src/shared/fla-frame-sequence-api';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject, ProjectSchema, type Project } from '../../src/domain';

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
});

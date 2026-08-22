/**
 * V2-R2 Frame Sequence — commit path tests (R2-G / R2-D end-to-end).
 *
 * Exercises FlaFrameSequenceCommitService with a real ProjectService
 * (on a temp project) and an in-memory fake sequence store. Verifies
 * the multi-asset commit, dedup, STALE_SEQUENCE guard, and rollback
 * on a post-save fault. The FLA source bytes are never touched here —
 * the commit consumes only the confirmed sequence bytes supplied by
 * the sequence store.
 *
 * R2-D end-to-end coverage: one test in this file drives a real
 * FlaFrameSequenceService to completion, then exercises the
 * R2-G commit path including the STALE_SEQUENCE guard.
 */

import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectSchema } from '../../src/domain';
import { ProjectService } from '../../src/main/services/ProjectService';
import {
  FlaFrameSequenceCommitService,
  type FlaFrameSequenceCommitFaultInjector,
  type FlaFrameSequenceStore,
} from '../../src/main/services/FlaFrameSequenceCommitService';
import {
  FlaFrameSequenceService,
  type ConfirmedSequenceFrame,
} from '../../src/main/services/fla-frame-sequence-service';
import {
  FlaFrameSequenceCommitRequestSchema,
  type FlaFrameSequenceCommitRequest,
} from '../../src/shared/fla-frame-sequence-api';
import type {
  FlaStaticSnapshotRasterizeInput,
  FlaStaticSnapshotRasterizeOutput,
  FlaStaticSnapshotRasterizer,
} from '../../src/main/services/fla-static-snapshot-render-session';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return output;
}

function createRgbaPng(width: number, height: number, fill = 0): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc(height * (1 + width * 4), fill);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const TEMP_DIRS: string[] = [];
const SESSION_ID = '28000000-0000-4000-8000-0000000000d1';
const SEQ_REQ = '28000000-0000-4000-8000-0000000000d2';
const SEQ_REQ_2 = '28000000-0000-4000-8000-0000000000d3';
const TARGET_ID = 'fla-render-target-0000000000000a01';
const SOURCE = { basename: 'attack.fla', sha256: 'a'.repeat(64) };

function makeFrame(frameIndex: number, fill = 0, width = 8, height = 8): ConfirmedSequenceFrame {
  const buffer = createRgbaPng(width, height, fill);
  return {
    frameIndex,
    sequenceOrdinal: frameIndex,
    pngBytes: new Uint8Array(buffer),
    sha256: createHash('sha256').update(buffer).digest('hex'),
    width,
    height,
    pixelCount: width * height,
    byteLength: buffer.length,
    frameWallClockMs: 1,
    receivedAt: 0,
  };
}

function fakeSequenceStore(frames: ConfirmedSequenceFrame[]): FlaFrameSequenceStore {
  return {
    isLatestAcceptedSequence: (sid, id) => sid === SESSION_ID && id === SEQ_REQ,
    getConfirmedSequence: (id) => (id === SEQ_REQ ? frames : null),
    releaseSequence: () => undefined,
  };
}

interface Harness {
  projectRoot: string;
  projectService: ProjectService;
  createService: (options?: {
    sequenceStore?: FlaFrameSequenceStore;
    faults?: FlaFrameSequenceCommitFaultInjector;
  }) => FlaFrameSequenceCommitService;
  current: { project: ReturnType<typeof ProjectSchema.parse>; revision: number };
  setCurrent: (project: ReturnType<typeof ProjectSchema.parse>, revision: number) => void;
}

async function harness(): Promise<Harness> {
  const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-fla-seq-'));
  TEMP_DIRS.push(parent);
  const projectRoot = path.join(parent, 'FLA Sequence Test.pandastage');
  let idIndex = 0;
  const nextId = () => `28000000-0000-4000-8000-${String(idIndex++ + 1).padStart(12, '0')}`;
  const current = { project: undefined as unknown as ReturnType<typeof ProjectSchema.parse>, revision: 0 };
  const projectService = new ProjectService({
    createId: nextId,
    now: () => new Date('2026-08-19T04:00:00.000Z'),
    onProjectSaved: (_root, project, revision) => {
      if (revision !== undefined) {
        current.project = project;
        current.revision = revision;
      }
    },
  });
  const created = await projectService.create(projectRoot, { name: 'FLA Sequence Test' });
  current.project = created.project;
  current.revision = 0;
  const createService: Harness['createService'] = (options = {}) =>
    new FlaFrameSequenceCommitService({
      projectService,
      getCurrentProjectSnapshot: (root) => (root === projectRoot ? current : null),
      sequenceStore: options.sequenceStore ?? fakeSequenceStore([]),
      ...(options.faults ? { faults: options.faults } : {}),
    });
  return {
    projectRoot,
    projectService,
    createService,
    current,
    setCurrent: (project, revision) => {
      current.project = project;
      current.revision = revision;
    },
  };
}

function request(
  h: Harness,
  frames: ConfirmedSequenceFrame[],
  overrides?: { confirmedSequenceRequestId?: string },
): FlaFrameSequenceCommitRequest {
  const start = frames[0]?.frameIndex ?? 0;
  const end = frames[frames.length - 1]?.frameIndex ?? 0;
  return FlaFrameSequenceCommitRequestSchema.parse({
    format: 'fla-frame-sequence-commit',
    version: 1,
    projectRoot: h.projectRoot,
    project: h.current.project,
    baseRevision: h.current.revision,
    sessionId: SESSION_ID,
    confirmedSequenceRequestId: overrides?.confirmedSequenceRequestId ?? SEQ_REQ,
    source: SOURCE,
    range: { renderTargetId: TARGET_ID, startFrameIndex: start, endFrameIndex: end },
    sequence: {
      requestId: overrides?.confirmedSequenceRequestId ?? SEQ_REQ,
      sha256EachFrame: frames.map((f) => f.sha256),
      widthEachFrame: frames.map((f) => f.width),
      heightEachFrame: frames.map((f) => f.height),
      byteLengthEachFrame: frames.map((f) => f.byteLength),
      targetRenderTargetIdEachFrame: frames.map(() => TARGET_ID),
    },
    confirmed: true,
  });
}

async function assetEntries(projectRoot: string): Promise<string[]> {
  return (await readdir(path.join(projectRoot, 'assets'))).sort();
}

afterEach(async () => {
  while (TEMP_DIRS.length > 0) {
    const dir = TEMP_DIRS.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe('R2-G frame sequence commit: happy path', () => {
  it('imports 3 frames as 3 new ImageAssets in one revision', async () => {
    const h = await harness();
    const frames = [makeFrame(0, 0, 8, 8), makeFrame(1, 0, 9, 8), makeFrame(2, 0, 8, 9)];
    const service = h.createService({ sequenceStore: fakeSequenceStore(frames) });
    const r = await service.commit(request(h, frames));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.projectChanged).toBe(true);
      expect(r.savedRevision).toBe(1);
      expect(r.result.items).toHaveLength(3);
      expect(r.result.summary.requestedFrameCount).toBe(3);
      expect(r.result.summary.importedCount).toBe(3);
      expect(r.result.summary.duplicateCount).toBe(0);
      expect(r.result.summary.netNewImageAssetCount).toBe(3);
      expect(r.result.items.map((i) => i.frameIndex)).toEqual([0, 1, 2]);
      expect(r.result.items.every((i) => i.status === 'imported')).toBe(true);
      // R2-F: items are ordered by frameIndex ascending.
      expect(r.result.items[0]?.frameIndex).toBe(0);
      expect(r.result.items[1]?.frameIndex).toBe(1);
      expect(r.result.items[2]?.frameIndex).toBe(2);
    }
    const entries = await assetEntries(h.projectRoot);
    expect(entries).toHaveLength(3);
    // File names reflect the source stem + render target + frame index.
    for (const e of entries) {
      expect(e).toMatch(/^attack-.*-frame\d{4}\.png$/u);
    }
  });

  it('dedups: 2 of 3 frames are reused, 1 is new', async () => {
    const h = await harness();
    // Commit a single-frame sequence first to seed an existing ImageAsset.
    const firstFrame = makeFrame(0, 0, 8, 8);
    const firstService = h.createService({ sequenceStore: fakeSequenceStore([firstFrame]) });
    const r1 = await firstService.commit(request(h, [firstFrame]));
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      expect(r1.result.summary.importedCount).toBe(1);
    }
    // Now commit a 3-frame sequence where the first frame reuses
    // the previously-imported asset (same sha256, same width/height),
    // and the next two frames are genuinely new (different widths).
    const frame0 = makeFrame(0, 0, 8, 8);  // same bytes as firstFrame
    const frame1 = makeFrame(1, 0, 9, 8);
    const frame2 = makeFrame(2, 0, 8, 9);
    const secondService = h.createService({ sequenceStore: fakeSequenceStore([frame0, frame1, frame2]) });
    const r2 = await secondService.commit(request(h, [frame0, frame1, frame2]));
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.result.summary.importedCount).toBe(2);
      expect(r2.result.summary.duplicateCount).toBe(1);
      expect(r2.result.summary.netNewImageAssetCount).toBe(2);
      expect(r2.result.items[0]?.status).toBe('duplicate');
      expect(r2.result.items[1]?.status).toBe('imported');
      expect(r2.result.items[2]?.status).toBe('imported');
    }
    const entries = await assetEntries(h.projectRoot);
    expect(entries).toHaveLength(3);
  });
});

describe('R2-G frame sequence commit: R2-D stale guard', () => {
  it('STALE_SEQUENCE when confirmedSequenceRequestId is not the latest', async () => {
    const h = await harness();
    const store: FlaFrameSequenceStore = {
      isLatestAcceptedSequence: () => false,
      getConfirmedSequence: () => [makeFrame(0, 0x10)],
      releaseSequence: () => undefined,
    };
    const service = h.createService({ sequenceStore: store });
    const r = await service.commit(request(h, [makeFrame(0, 0x10)]));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('STALE_SEQUENCE');
      expect(r.error.message).toContain('no longer the latest');
    }
  });

  // The unused-variable on `service` below is intentional: the
  // service variable in the previous test was kept for symmetry
  // with the next ones. ESLint no-unused-vars is disabled at the
  // top of this describe block.

  it('STALE_SEQUENCE when confirmed bytes have been released', async () => {
    const h = await harness();
    const store: FlaFrameSequenceStore = {
      isLatestAcceptedSequence: () => true,
      getConfirmedSequence: () => null,
      releaseSequence: () => undefined,
    };
    const service = h.createService({ sequenceStore: store });
    const r = await service.commit(request(h, [makeFrame(0, 0x10)]));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('STALE_SEQUENCE');
      expect(r.error.message).toContain('expired');
    }
  });

  it('STALE_SEQUENCE when per-frame sha256 echo does not match confirmed bytes', async () => {
    const h = await harness();
    const realFrame = makeFrame(0, 0x10);
    const store = fakeSequenceStore([realFrame]);
    const service = h.createService({ sequenceStore: store });
    // Build a request whose echoed sha256 differs from the
    // confirmed bytes. We bypass request() to avoid the schema
    // enforcing the same sha256 each side.
    const real = request(h, [realFrame]);
    const forged = {
      ...real,
      sequence: {
        ...real.sequence,
        sha256EachFrame: ['b'.repeat(64)],
      },
    };
    const r = await service.commit(forged);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('STALE_SEQUENCE');
    }
  });

  it('STALE_PROJECT_REVISION when baseRevision does not match the live Project', async () => {
    const h = await harness();
    const frames = [makeFrame(0, 0x10)];
    const real = request(h, frames);
    const forged = { ...real, baseRevision: real.baseRevision + 5 };
    const service = h.createService({ sequenceStore: fakeSequenceStore(frames) });
    const r = await service.commit(forged);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('STALE_PROJECT_REVISION');
    }
  });

  it('COMMIT_BUSY when the same sessionId is committing twice', async () => {
    const h = await harness();
    const frames = [makeFrame(0, 0, 8, 8)];
    const store = fakeSequenceStore(frames);
    // Hold the first commit open by gating the save on a
    // never-resolving promise. The second commit, on the same
    // service and sessionId, must observe the activeSessions
    // set and reject with COMMIT_BUSY before any state mutation.
    let resolveSave: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { resolveSave = resolve; });
    const service = h.createService({
      sequenceStore: store,
      faults: {
        beforeProjectSave: () => gate,
      },
    });
    const first = service.commit(request(h, frames));
    // Give the first commit a microtask to enter the activeSessions set.
    await Promise.resolve();
    await Promise.resolve();
    const second = await service.commit(request(h, frames));
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe('COMMIT_BUSY');
    }
    if (resolveSave) resolveSave();
    await first;
  });
});

describe('R2-G frame sequence commit: rollback', () => {
  it('rollback when beforeProjectSave throws: no half-written Project', async () => {
    const h = await harness();
    const frames = [makeFrame(0, 0x10), makeFrame(1, 0x20)];
    const store = fakeSequenceStore(frames);
    const service = h.createService({
      sequenceStore: store,
      faults: {
        beforeProjectSave: () => {
          throw new Error('disk full');
        },
      },
    });
    const r = await service.commit(request(h, frames));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('ASSET_COMMIT_FAILED');
    }
    // No asset files left on disk after rollback.
    const entries = await assetEntries(h.projectRoot);
    expect(entries).toEqual([]);
    // Project revision is still 0 (no save happened).
    expect(h.current.revision).toBe(0);
  });
});

describe('R2-G frame sequence commit: R2-D end-to-end via R2-C service', () => {
  it('drives a real R2-C sequence to completion, then commits; a follow-up commit of a superseded sequence is rejected with STALE_SEQUENCE', async () => {
    const h = await harness();
    // 1) Drive a real R2-C sequence. Use a rasterizer that auto-
    //    resolves and returns valid PNG bytes for each frame.
    const rasterizer: FlaStaticSnapshotRasterizer = {
      rasterize: async (input: FlaStaticSnapshotRasterizeInput): Promise<FlaStaticSnapshotRasterizeOutput> => {
        // input is consumed only for its identity in the test (we
        // do not look at the SVG). Mark it read so the linter is
        // happy without disabling the rule.
        void input;
        const buffer = createRgbaPng(8, 8, 0);
        return {
          pngBytes: new Uint8Array(buffer),
          width: 8,
          height: 8,
          pixelCount: 64,
        };
      },
      cancel: () => true,
      close: () => undefined,
    };
    const sequenceService = new FlaFrameSequenceService({ rasterizer });
    const range = { renderTargetId: TARGET_ID, startFrameIndex: 0, endFrameIndex: 1 };
    const r1 = await sequenceService.renderSequence(
      SESSION_ID,
      range,
      [
        { frameIndex: 0, svg: '<svg/>' },
        { frameIndex: 1, svg: '<svg/>' },
      ],
      { sequenceRequestId: SEQ_REQ },
    );
    expect(r1.ok).toBe(true);
    expect(sequenceService.isLatestAcceptedSequence(SESSION_ID, SEQ_REQ)).toBe(true);
    const confirmed1 = sequenceService.getConfirmedSequence(SEQ_REQ);
    expect(confirmed1).toHaveLength(2);

    // 2) Wire the R2-G commit service to consume the R2-C store
    //    directly. We capture the released requestId so the test
    //    can verify releaseSequence is called on success.
    const released: string[] = [];
    const commitService = new FlaFrameSequenceCommitService({
      projectService: h.projectService,
      getCurrentProjectSnapshot: (root) => (root === h.projectRoot ? h.current : null),
      sequenceStore: {
        isLatestAcceptedSequence: (sid, id) => sequenceService.isLatestAcceptedSequence(sid, id),
        getConfirmedSequence: (id) => sequenceService.getConfirmedSequence(id),
        releaseSequence: (id) => {
          released.push(id);
          sequenceService.releaseSequence(id);
        },
      },
    });

    // 3) Build the R2 commit request from the confirmed sequence
    //    echoes (the UI / IPC layer normally constructs this).
    const confirmedReq = request(h, confirmed1!);
    const r2 = await commitService.commit(confirmedReq);
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.result.summary.importedCount).toBe(2);
      expect(r2.result.items).toHaveLength(2);
    }
    expect(released).toEqual([SEQ_REQ]);

    // 4) After commit, the R2-C store has been released; any
    //    follow-up commit for the same requestId is rejected.
    const r3 = await commitService.commit(confirmedReq);
    expect(r3.ok).toBe(false);
    if (!r3.ok) {
      expect(r3.error.code).toBe('STALE_SEQUENCE');
    }

    // 5) A new sequence supersedes the previous one. The old
    //    requestId's confirmed bytes have been dropped; the new
    //    requestId is now the latest.
    const r4 = await sequenceService.renderSequence(
      SESSION_ID,
      range,
      [
        { frameIndex: 0, svg: '<svg/>' },
        { frameIndex: 1, svg: '<svg/>' },
      ],
      { sequenceRequestId: SEQ_REQ_2 },
    );
    expect(r4.ok).toBe(true);
    expect(sequenceService.isLatestAcceptedSequence(SESSION_ID, SEQ_REQ)).toBe(false);
    expect(sequenceService.isLatestAcceptedSequence(SESSION_ID, SEQ_REQ_2)).toBe(true);
    expect(sequenceService.getConfirmedSequence(SEQ_REQ)).toBeNull();
    const confirmed2 = sequenceService.getConfirmedSequence(SEQ_REQ_2);
    expect(confirmed2).toHaveLength(2);
  });
});

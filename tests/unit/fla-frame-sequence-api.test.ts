import { describe, expect, it } from 'vitest';
import { buildProject } from './domain/testProject';
import {
  FLA_FRAME_SEQUENCE_LIMITS,
  FlaFrameSequenceCancelRequestSchema,
  FlaFrameSequenceCancelResponseSchema,
  FlaFrameSequenceCommitErrorCodeSchema,
  FlaFrameSequenceCommitRequestSchema,
  FlaFrameSequenceCommitResponseSchema,
  FlaFrameSequenceErrorCodeSchema,
  FlaFrameSequenceRangeSchema,
  FlaFrameSequenceRequestSchema,
  FlaFrameSequenceResponseSchema,
} from '../../src/shared/fla-frame-sequence-api';
import { FlaStaticSnapshotPreviewSuccessSchema } from '../../src/shared/fla-static-snapshot-api';

const validUuid = '00000000-0000-4000-8000-000000000001';
const validRequestId = '00000000-0000-4000-8000-0000000000aa';
const validTargetId = 'fla-render-target-1a2b3c4d5e6f7a8b';
const validSha256 = 'a'.repeat(64);

const validPreviewSuccess = {
  ok: true as const,
  requestId: validRequestId,
  targetRenderTargetId: validTargetId,
  targetSelectedFrameIndex: 0,
  width: 1920,
  height: 1080,
  pixelCount: 1920 * 1080,
  bytes: new Uint8Array(16),
  sha256: validSha256,
  wallClockMs: 1234,
  isFirstPreviewForSession: true,
  startedAt: new Date(0).toISOString(),
};

// ---- Helpers ----
function makeValidSuccess(frameCount: number) {
  return {
    ok: true as const,
    requestId: validRequestId,
    renderTargetId: validTargetId,
    items: Array.from({ length: frameCount }, (_, ordinal) => ({
      frameIndex: ordinal,
      sequenceOrdinal: ordinal,
      preview: { ...validPreviewSuccess, targetSelectedFrameIndex: ordinal },
    })),
    sequenceTotalMs: 1234,
    cancelledFrames: 0,
    totalPixelCount: frameCount * 1920 * 1080,
  };
}

// ---- R2-A range contract ----
describe('R2-A range contract', () => {
  it('accepts an inclusive range (start <= end)', () => {
    const r = FlaFrameSequenceRangeSchema.parse({
      renderTargetId: validTargetId,
      startFrameIndex: 0,
      endFrameIndex: 5,
    });
    expect(r.startFrameIndex).toBe(0);
    expect(r.endFrameIndex).toBe(5);
  });

  it('accepts a single-frame range (start == end)', () => {
    expect(FlaFrameSequenceRangeSchema.safeParse({
      renderTargetId: validTargetId,
      startFrameIndex: 3,
      endFrameIndex: 3,
    }).success).toBe(true);
  });

  it('rejects a reversed range (start > end)', () => {
    const r = FlaFrameSequenceRangeSchema.safeParse({
      renderTargetId: validTargetId,
      startFrameIndex: 5,
      endFrameIndex: 2,
    });
    expect(r.success).toBe(false);
  });

  it('rejects a non-uuid-v4 target id', () => {
    const r = FlaFrameSequenceRangeSchema.safeParse({
      renderTargetId: 'fla-render-target-XX',
      startFrameIndex: 0,
      endFrameIndex: 1,
    });
    expect(r.success).toBe(false);
  });

  it('rejects a non-fla-render-target-format id (wrong prefix)', () => {
    const r = FlaFrameSequenceRangeSchema.safeParse({
      renderTargetId: 'fla-something-1a2b3c4d5e6f7a8b',
      startFrameIndex: 0,
      endFrameIndex: 1,
    });
    expect(r.success).toBe(false);
  });

  it('rejects a range that exceeds MAX_SEQUENCE_FRAMES (frame count cap)', () => {
    const span = FLA_FRAME_SEQUENCE_LIMITS.MAX_SEQUENCE_FRAMES + 1;
    const r = FlaFrameSequenceRangeSchema.safeParse({
      renderTargetId: validTargetId,
      startFrameIndex: 0,
      endFrameIndex: span - 1,
    });
    expect(r.success).toBe(false);
  });

  it('accepts a range of exactly MAX_SEQUENCE_FRAMES frames (boundary)', () => {
    const r = FlaFrameSequenceRangeSchema.safeParse({
      renderTargetId: validTargetId,
      startFrameIndex: 0,
      endFrameIndex: FLA_FRAME_SEQUENCE_LIMITS.MAX_SEQUENCE_FRAMES - 1,
    });
    expect(r.success).toBe(true);
  });

  it('rejects negative frame indices', () => {
    const r = FlaFrameSequenceRangeSchema.safeParse({
      renderTargetId: validTargetId,
      startFrameIndex: -1,
      endFrameIndex: 1,
    });
    expect(r.success).toBe(false);
  });
});

// ---- R2-A request contract ----
describe('R2-A request contract', () => {
  it('accepts a valid sequence render request', () => {
    const r = FlaFrameSequenceRequestSchema.parse({
      format: 'fla-frame-sequence-render',
      version: 1,
      requestId: validRequestId,
      sessionId: validUuid,
      range: { renderTargetId: validTargetId, startFrameIndex: 0, endFrameIndex: 3 },
    });
    expect(r.format).toBe('fla-frame-sequence-render');
  });

  it('rejects the wrong format discriminant (does not over-load R1)', () => {
    const r = FlaFrameSequenceRequestSchema.safeParse({
      format: 'fla-static-snapshot-preview',
      version: 1,
      requestId: validRequestId,
      sessionId: validUuid,
      range: { renderTargetId: validTargetId, startFrameIndex: 0, endFrameIndex: 1 },
    });
    expect(r.success).toBe(false);
  });

  it('rejects a missing sessionId', () => {
    const r = FlaFrameSequenceRequestSchema.safeParse({
      format: 'fla-frame-sequence-render',
      version: 1,
      requestId: validRequestId,
      range: { renderTargetId: validTargetId, startFrameIndex: 0, endFrameIndex: 1 },
    });
    expect(r.success).toBe(false);
  });

  it('rejects an empty range via over-cap refine', () => {
    // startFrameIndex == endFrameIndex + 1 is 0 frames (empty), but
    // the structural refine (start <= end) already rejects this.
    const r = FlaFrameSequenceRequestSchema.safeParse({
      format: 'fla-frame-sequence-render',
      version: 1,
      requestId: validRequestId,
      sessionId: validUuid,
      range: { renderTargetId: validTargetId, startFrameIndex: 5, endFrameIndex: 4 },
    });
    expect(r.success).toBe(false);
  });
});

// ---- R2-A success / error response ----
describe('R2-A success response', () => {
  it('accepts a 1-frame success', () => {
    const r = FlaFrameSequenceResponseSchema.parse(makeValidSuccess(1));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.items).toHaveLength(1);
      expect(r.items[0]?.frameIndex).toBe(0);
      expect(r.items[0]?.sequenceOrdinal).toBe(0);
    }
  });

  it('accepts a MAX_SEQUENCE_FRAMES success (boundary)', () => {
    const r = FlaFrameSequenceResponseSchema.parse(makeValidSuccess(FLA_FRAME_SEQUENCE_LIMITS.MAX_SEQUENCE_FRAMES));
    expect(r.ok).toBe(true);
  });

  it('rejects a success with more items than MAX_SEQUENCE_FRAMES', () => {
    const r = FlaFrameSequenceResponseSchema.safeParse(makeValidSuccess(FLA_FRAME_SEQUENCE_LIMITS.MAX_SEQUENCE_FRAMES + 1));
    expect(r.success).toBe(false);
  });

  it('items carry stable per-frame identity (frameIndex + sequenceOrdinal)', () => {
    const r = FlaFrameSequenceResponseSchema.parse(makeValidSuccess(3));
    if (!r.ok) throw new Error('expected ok');
    expect(r.items[0]?.frameIndex).toBe(0);
    expect(r.items[0]?.sequenceOrdinal).toBe(0);
    expect(r.items[1]?.frameIndex).toBe(1);
    expect(r.items[1]?.sequenceOrdinal).toBe(1);
    expect(r.items[2]?.frameIndex).toBe(2);
    expect(r.items[2]?.sequenceOrdinal).toBe(2);
  });

  it('items embed a real R1 preview success (re-uses R1 contract verbatim)', () => {
    const r = FlaFrameSequenceResponseSchema.parse(makeValidSuccess(2));
    if (!r.ok) throw new Error('expected ok');
    // The embedded preview must be parseable as an R1 success.
    expect(FlaStaticSnapshotPreviewSuccessSchema.safeParse(r.items[0]?.preview).success).toBe(true);
  });
});

describe('R2-A error response', () => {
  it('accepts every documented error code', () => {
    for (const code of FlaFrameSequenceErrorCodeSchema.options) {
      const failure = {
        ok: false as const,
        error: { code, message: 'r2 sequence error' },
      };
      const r = FlaFrameSequenceResponseSchema.parse(failure);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe(code);
    }
  });

  it('accepts a SEQUENCE_CANCELLED error with completedFrameCount (R2-D)', () => {
    const r = FlaFrameSequenceResponseSchema.parse({
      ok: false,
      error: { code: 'SEQUENCE_CANCELLED', message: 'cancelled by user', completedFrameCount: 3 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('SEQUENCE_CANCELLED');
      expect(r.error.completedFrameCount).toBe(3);
    }
  });

  it('rejects a non-enum error code', () => {
    const r = FlaFrameSequenceResponseSchema.safeParse({
      ok: false,
      error: { code: 'BOGUS_CODE', message: 'x' },
    });
    expect(r.success).toBe(false);
  });
});

// ---- R2-G commit request ----
describe('R2-G commit request', () => {
  const baseProject = buildProject();
  const N = 4;
  const validCommitBase = {
    format: 'fla-frame-sequence-commit' as const,
    version: 1 as const,
    projectRoot: 'D:\\projects\\sword',
    project: baseProject,
    baseRevision: 0,
    sessionId: validUuid,
    confirmedSequenceRequestId: validRequestId,
    source: { basename: 'sword.fla', sha256: validSha256 },
    range: { renderTargetId: validTargetId, startFrameIndex: 0, endFrameIndex: N - 1 },
    sequence: {
      requestId: validRequestId,
      sha256EachFrame: Array.from({ length: N }, () => validSha256),
      widthEachFrame: Array.from({ length: N }, () => 1920),
      heightEachFrame: Array.from({ length: N }, () => 1080),
      byteLengthEachFrame: Array.from({ length: N }, () => 16),
      targetRenderTargetIdEachFrame: Array.from({ length: N }, () => validTargetId),
    },
    confirmed: true as const,
  };

  it('accepts a valid commit request with N frames', () => {
    expect(FlaFrameSequenceCommitRequestSchema.safeParse(validCommitBase).success).toBe(true);
  });

  it('rejects a wrong format discriminant (does not over-load R1)', () => {
    const bad = { ...validCommitBase, format: 'fla-static-snapshot-commit' as const };
    expect(FlaFrameSequenceCommitRequestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a missing confirmed flag (R2-G: explicit user confirmation)', () => {
    const bad = { ...validCommitBase, confirmed: false };
    expect(FlaFrameSequenceCommitRequestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects sequence.requestId != confirmedSequenceRequestId (R2-D stale guard)', () => {
    const bad = {
      ...validCommitBase,
      sequence: { ...validCommitBase.sequence, requestId: '00000000-0000-4000-8000-0000000000ff' },
    };
    expect(FlaFrameSequenceCommitRequestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a missing confirmedSequenceRequestId', () => {
    const bad = { ...validCommitBase } as Record<string, unknown>;
    delete bad.confirmedSequenceRequestId;
    expect(FlaFrameSequenceCommitRequestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects unequal-length per-frame arrays (R2-G evidence integrity)', () => {
    const bad = {
      ...validCommitBase,
      sequence: {
        ...validCommitBase.sequence,
        sha256EachFrame: Array.from({ length: N + 1 }, () => validSha256),
      },
    };
    expect(FlaFrameSequenceCommitRequestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a reversed range inside the commit (R2-A invariant)', () => {
    const bad = {
      ...validCommitBase,
      range: { renderTargetId: validTargetId, startFrameIndex: N - 1, endFrameIndex: 0 },
    };
    expect(FlaFrameSequenceCommitRequestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an over-cap range inside the commit (R2-B)', () => {
    const span = FLA_FRAME_SEQUENCE_LIMITS.MAX_SEQUENCE_FRAMES + 1;
    const bad = {
      ...validCommitBase,
      range: { renderTargetId: validTargetId, startFrameIndex: 0, endFrameIndex: span - 1 },
    };
    expect(FlaFrameSequenceCommitRequestSchema.safeParse(bad).success).toBe(false);
  });
});

// ---- R2-G commit response ----
describe('R2-G commit response', () => {
  it('accepts a successful commit response with N items + summary', () => {
    const N = 3;
    const ok = {
      ok: true as const,
      status: 'completed' as const,
      project: buildProject(),
      baseRevision: 0,
      savedRevision: 1,
      projectChanged: true,
      result: {
        items: Array.from({ length: N }, (_, ordinal) => ({
          frameIndex: ordinal,
          sequenceOrdinal: ordinal,
          assetId: validUuid,
          sourceName: 'sword',
          width: 1920,
          height: 1080,
          sha256: validSha256,
          status: 'imported' as const,
          asset: { id: validUuid, name: 'sword', kind: 'image' as const, relativePath: 'sword.png', mimeType: 'image/png', width: 1920, height: 1080 },
          duplicateOfAssetId: null,
          targetFileName: 'sword.png',
          renamed: false,
          message: 'imported',
        })),
        summary: {
          requestedFrameCount: N,
          importedCount: N,
          duplicateCount: 0,
          renamedCount: 0,
          netNewImageAssetCount: N,
        },
      },
    };
    expect(FlaFrameSequenceCommitResponseSchema.safeParse(ok).success).toBe(true);
  });

  it('accepts a duplicate result (R2-F dedup)', () => {
    const ok = {
      ok: true as const,
      status: 'completed' as const,
      project: buildProject(),
      baseRevision: 0,
      savedRevision: 1,
      projectChanged: true,
      result: {
        items: [{
          frameIndex: 0,
          sequenceOrdinal: 0,
          assetId: validUuid,
          sourceName: 'sword',
          width: 1920,
          height: 1080,
          sha256: validSha256,
          status: 'duplicate' as const,
          asset: { id: validUuid, name: 'sword', kind: 'image' as const, relativePath: 'sword.png', mimeType: 'image/png', width: 1920, height: 1080 },
          duplicateOfAssetId: validUuid,
          targetFileName: 'sword.png',
          renamed: false,
          message: 'duplicate',
        }],
        summary: {
          requestedFrameCount: 1,
          importedCount: 0,
          duplicateCount: 1,
          renamedCount: 0,
          netNewImageAssetCount: 0,
        },
      },
    };
    expect(FlaFrameSequenceCommitResponseSchema.safeParse(ok).success).toBe(true);
  });

  it('accepts every documented commit error code', () => {
    for (const code of FlaFrameSequenceCommitErrorCodeSchema.options) {
      const failure = {
        ok: false as const,
        error: { code, message: 'commit failed', projectRoot: 'D:\\projects\\sword' },
      };
      const r = FlaFrameSequenceCommitResponseSchema.parse(failure);
      expect(r.ok).toBe(false);
    }
  });

  it('rejects a commit error with a non-enum code', () => {
    expect(FlaFrameSequenceCommitResponseSchema.safeParse({
      ok: false,
      error: { code: 'BOGUS', message: 'x', projectRoot: 'x' },
    }).success).toBe(false);
  });
});

// ---- R2-D cancel ----
describe('R2-D cancel contract', () => {
  it('accepts a cancel with requestId', () => {
    const r = FlaFrameSequenceCancelRequestSchema.parse({
      format: 'fla-frame-sequence-cancel',
      version: 1,
      requestId: validRequestId,
    });
    expect(r.format).toBe('fla-frame-sequence-cancel');
  });

  it('accepts a cancel with sessionId only (cancels latest)', () => {
    const r = FlaFrameSequenceCancelRequestSchema.parse({
      format: 'fla-frame-sequence-cancel',
      version: 1,
      sessionId: validUuid,
    });
    expect(r.sessionId).toBe(validUuid);
  });

  it('rejects a cancel without either requestId or sessionId', () => {
    const r = FlaFrameSequenceCancelRequestSchema.safeParse({
      format: 'fla-frame-sequence-cancel',
      version: 1,
    });
    expect(r.success).toBe(false);
  });

  it('accepts a cancel response with completedFrameCount (R2-D UI hint)', () => {
    const r = FlaFrameSequenceCancelResponseSchema.parse({
      accepted: true,
      cancelledRequestId: validRequestId,
      completedFrameCount: 5,
    });
    expect(r.completedFrameCount).toBe(5);
  });
});

// ---- R2-B limits sanity ----
describe('R2-B hard budget constants', () => {
  it('pins the documented budget numbers from R0/R1 evidence', () => {
    expect(FLA_FRAME_SEQUENCE_LIMITS.MAX_SEQUENCE_FRAMES).toBe(24);
    expect(FLA_FRAME_SEQUENCE_LIMITS.MAX_FRAME_WIDTH).toBe(4_096);
    expect(FLA_FRAME_SEQUENCE_LIMITS.MAX_FRAME_HEIGHT).toBe(4_096);
    expect(FLA_FRAME_SEQUENCE_LIMITS.MAX_FRAME_PIXELS).toBe(16_777_216);
    expect(FLA_FRAME_SEQUENCE_LIMITS.MAX_SEQUENCE_TOTAL_PIXELS).toBe(24 * 16_777_216);
    expect(FLA_FRAME_SEQUENCE_LIMITS.MAX_SEQUENCE_ENCODED_BYTES).toBe(24 * 64 * 1024 * 1024);
    expect(FLA_FRAME_SEQUENCE_LIMITS.perFrameTimeoutMs).toBe(30_000);
    expect(FLA_FRAME_SEQUENCE_LIMITS.sequenceTimeoutMs).toBe(24 * 30_000);
    expect(FLA_FRAME_SEQUENCE_LIMITS.maxActualRasterConcurrency).toBe(1);
  });
});

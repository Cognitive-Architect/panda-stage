import { describe, expect, it } from 'vitest';
import {
  buildRange,
  getDefaultSequenceRange,
  intentChangeReset,
  isCommitEligible,
  isCurrentResponse,
  isStaleAgainstIntent,
  MAX_SEQUENCE_FRAMES,
  postCommitSequenceState,
  rerenderReset,
  validateRange,
} from '../../src/renderer/fla-import/fla-frame-sequence-review-state';
import {
  FlaFrameSequenceProgressSchema,
} from '../../src/shared/fla-frame-sequence-api';

const targetFrameCount = 12;

describe('R2-H.2 bounded default range (Issue #400)', () => {
  it.each([
    [1, 0],
    [10, 9],
    [24, 23],
    [30, 23],
    [100, 23],
  ])('selects 0–%i for a %i-frame target', (frameCount, expectedEnd) => {
    expect(getDefaultSequenceRange(frameCount)).toEqual({
      startFrameIndex: 0,
      endFrameIndex: expectedEnd,
    });
    const validation = validateRange(0, expectedEnd, frameCount);
    expect(validation.valid).toBe(true);
    expect(validation.frameCount).toBe(Math.min(frameCount, MAX_SEQUENCE_FRAMES));
  });

  it('does not change explicit over-cap input into a valid range', () => {
    const defaultRange = getDefaultSequenceRange(30);
    expect(defaultRange).toEqual({ startFrameIndex: 0, endFrameIndex: 23 });
    expect(validateRange(0, 29, 30).valid).toBe(false);
    expect(validateRange(0, 23, 30).valid).toBe(true);
  });
});

describe('R2-H.2 range validation (Corrective D)', () => {
  it('initializes a valid bounded inclusive range', () => {
    const v = validateRange(0, 11, targetFrameCount);
    expect(v.valid).toBe(true);
    expect(v.frameCount).toBe(12);
    expect(v.message).toBeNull();
  });

  it('computes inclusive frame count correctly (end - start + 1)', () => {
    expect(validateRange(3, 5, targetFrameCount).frameCount).toBe(3);
    expect(validateRange(5, 5, targetFrameCount).frameCount).toBe(1);
  });

  it('rejects a reversed range with a beginner-readable message', () => {
    const v = validateRange(8, 2, targetFrameCount);
    expect(v.valid).toBe(false);
    expect(v.message).toContain('不能晚于');
  });

  it('rejects an out-of-range end frame', () => {
    const v = validateRange(0, 12, targetFrameCount);
    expect(v.valid).toBe(false);
    expect(v.message).toContain('超出');
  });

  it('rejects an over-cap selection before any invoke', () => {
    const overStart = 0;
    const overEnd = MAX_SEQUENCE_FRAMES; // frameCount = MAX+1
    const v = validateRange(overStart, overEnd, MAX_SEQUENCE_FRAMES + 5);
    expect(v.valid).toBe(false);
    expect(v.frameCount).toBe(MAX_SEQUENCE_FRAMES + 1);
    expect(v.message).toContain(String(MAX_SEQUENCE_FRAMES));
  });

  it('rejects negative frame indices', () => {
    expect(validateRange(-1, 3, targetFrameCount).valid).toBe(false);
  });
});

describe('R2-H.2 buildRange (no invalid range reaches IPC)', () => {
  it('returns a valid range contract for a good selection', () => {
    expect(buildRange('t1', 0, 11)).toEqual({ renderTargetId: 't1', startFrameIndex: 0, endFrameIndex: 11 });
  });
  it('returns null for a reversed range', () => {
    expect(buildRange('t1', 5, 2)).toBeNull();
  });
  it('returns null for negative indices', () => {
    expect(buildRange('t1', -1, 3)).toBeNull();
  });
});

describe('R2-H.2 stale / latest-request-wins guard (Corrective C)', () => {
  const requestId = '11111111-1111-4111-8111-111111111111';
  const success = {
    ok: true as const,
    requestId,
    renderTargetId: 't1',
    items: [{ frameIndex: 0, sequenceOrdinal: 0, preview: {} as never }],
    sequenceTotalMs: 1,
    cancelledFrames: 0,
    totalPixelCount: 16,
  };

  it('accepts a response that belongs to the active request', () => {
    expect(isCurrentResponse(requestId, success)).toBe(true);
    expect(
      isCurrentResponse(requestId, { ok: false, error: { code: 'SEQUENCE_CANCELLED', message: 'x', requestId, completedFrameCount: 0 } }),
    ).toBe(true);
  });

  it('rejects a late result from an older/stale request', () => {
    expect(isCurrentResponse('older-id', success)).toBe(false);
    expect(isCurrentResponse(null, success)).toBe(false);
  });

  it('only the latest accepted sequence is commit-eligible', () => {
    expect(isCommitEligible(success, true)).toBe(true);
    expect(isCommitEligible(success, false)).toBe(false);
  });

  it('empty sequence is never commit-eligible', () => {
    expect(isCommitEligible({ ...success, items: [] }, true)).toBe(false);
  });
});

describe('R2-H.2 re-render / post-commit lifecycle (Corrective C)', () => {
  it('re-render resets to rendering and clears commit eligibility', () => {
    const reset = rerenderReset();
    expect(reset.phase).toBe('rendering');
    expect(reset.commitEligible).toBe(false);
    expect(reset.commitResponse).toBeNull();
  });

  it('post-commit settles to committed and disables commit eligibility', () => {
    const next = postCommitSequenceState();
    expect(next.phase).toBe('committed');
    expect(next.commitEligible).toBe(false);
  });
});

const target = 'fla-render-target-aa';

describe('R2-H.2 Problem A: range/target change invalidates prior sequence (#296)', () => {
  const renderedRange = { renderTargetId: target, startFrameIndex: 0, endFrameIndex: 1 };

  it('intentChangeReset clears success, progress, commit response, and returns to selecting', () => {
    const reset = intentChangeReset();
    expect(reset.phase).toBe('selecting');
    expect(reset.success).toBeNull();
    expect(reset.completedFrameCount).toBe(0);
    expect(reset.commitResponse).toBeNull();
  });

  it('a successful range A becomes stale when start frame changes', () => {
    expect(isStaleAgainstIntent(renderedRange, { renderTargetId: target, startFrameIndex: 3, endFrameIndex: 1 })).toBe(true);
  });

  it('a successful range A becomes stale when end frame changes', () => {
    expect(isStaleAgainstIntent(renderedRange, { renderTargetId: target, startFrameIndex: 0, endFrameIndex: 5 })).toBe(true);
  });

  it('a successful range A becomes stale when target changes', () => {
    expect(isStaleAgainstIntent(renderedRange, { renderTargetId: 'fla-render-target-bb', startFrameIndex: 0, endFrameIndex: 1 })).toBe(true);
  });

  it('the displayed intent exactly matching the rendered range is NOT stale', () => {
    expect(isStaleAgainstIntent(renderedRange, { renderTargetId: target, startFrameIndex: 0, endFrameIndex: 1 })).toBe(false);
  });

  it('a null accepted sequence is always stale (no commit candidate)', () => {
    expect(isStaleAgainstIntent(null, { renderTargetId: target, startFrameIndex: 0, endFrameIndex: 1 })).toBe(true);
  });

  it('a stale accepted sequence is not commit-eligible even if still latest accepted', () => {
    const staleSuccess = {
      ok: true as const,
      requestId: 'rid',
      renderTargetId: target,
      items: [{} as never, {} as never],
      sequenceTotalMs: 0,
      cancelledFrames: 0,
      totalPixelCount: 0,
    };
    // The accept guard alone would pass (it is still the latest
    // accepted sequence)...
    expect(isCommitEligible(staleSuccess, true)).toBe(true);
    // ...but the displayed intent no longer matches the rendered range,
    // so the combined gate (accept && not stale) must reject.
    const stale = isStaleAgainstIntent(
      { renderTargetId: target, startFrameIndex: 0, endFrameIndex: 1 },
      { renderTargetId: target, startFrameIndex: 2, endFrameIndex: 1 },
    );
    expect(stale).toBe(true);
    expect(isCommitEligible(staleSuccess, true) && !stale).toBe(false);
  });
});

describe('R2-H.2 Problem B: real per-frame progress contract (#296)', () => {
  it('progress payload includes stable request identity + completed/total counts', () => {
    const p = {
      format: 'fla-frame-sequence-progress',
      version: 1,
      sessionId: '00000000-0000-4000-8000-000000000001',
      requestId: '11111111-1111-4111-8111-111111111111',
      completedFrameCount: 3,
      totalFrameCount: 12,
      currentFrameIndex: 2,
    };
    expect(FlaFrameSequenceProgressSchema.safeParse(p).success).toBe(true);
  });

  it('progress completedFrameCount can never exceed totalFrameCount', () => {
    const bad = {
      format: 'fla-frame-sequence-progress',
      version: 1,
      sessionId: '00000000-0000-4000-8000-000000000001',
      requestId: '11111111-1111-4111-8111-111111111111',
      completedFrameCount: 13,
      totalFrameCount: 12,
    };
    expect(FlaFrameSequenceProgressSchema.safeParse(bad).success).toBe(false);
  });

  it('progress strict schema rejects unknown fields', () => {
    const extra = {
      format: 'fla-frame-sequence-progress',
      version: 1,
      sessionId: '00000000-0000-4000-8000-000000000001',
      requestId: '11111111-1111-4111-8111-111111111111',
      completedFrameCount: 1,
      totalFrameCount: 4,
      injected: 'no',
    };
    expect(FlaFrameSequenceProgressSchema.safeParse(extra).success).toBe(false);
  });
});

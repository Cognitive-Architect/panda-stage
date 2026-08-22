import { describe, expect, it } from 'vitest';
import {
  buildRange,
  isCommitEligible,
  isCurrentResponse,
  MAX_SEQUENCE_FRAMES,
  postCommitSequenceState,
  rerenderReset,
  validateRange,
} from '../../src/renderer/fla-import/fla-frame-sequence-review-state';

const targetFrameCount = 12;

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

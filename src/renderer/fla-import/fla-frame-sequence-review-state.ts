/**
 * V2-R2 Frame Sequence — pure review UI decision logic (H.2 core).
 *
 * Extracted from the React component so the H.2 behavior assertions
 * (Corrective G) can run under vitest `environment: 'node'` without
 * jsdom / @testing-library. The component (`FlaFrameSequenceReview.tsx`)
 * delegates every validation and state-transition decision here.
 *
 * Hard boundaries honored:
 *  - range is contiguous, step = 1, inclusive on both ends (R2-A/C/D);
 *  - frame count = endFrameIndex - startFrameIndex + 1;
 *  - over-cap / reversed / out-of-range ranges are rejected BEFORE any
 *    IPC invoke (Corrective D);
 *  - the latest accepted sequence is the only commit-eligible sequence
 *    (R2-D stale guard);
 *  - a stale/late completion can never overwrite the current request or
 *    become commit-eligible (Corrective C);
 *  - re-render invalidates the prior commit candidate (Corrective C).
 */

import {
  FLA_FRAME_SEQUENCE_LIMITS,
  type FlaFrameSequenceRange,
  type FlaFrameSequenceResponse,
  type FlaFrameSequenceSuccess,
} from '../../shared/fla-frame-sequence-api';

export const MAX_SEQUENCE_FRAMES = FLA_FRAME_SEQUENCE_LIMITS.MAX_SEQUENCE_FRAMES;

export type SequencePhase =
  | 'rendering'
  | 'preview-ready'
  | 'committing'
  | 'committed'
  | 'cancelled'
  | 'error';

export interface RangeValidation {
  valid: boolean;
  frameCount: number;
  message: string | null;
}

export interface DefaultSequenceRange {
  startFrameIndex: number;
  endFrameIndex: number;
}

/**
 * Select the initial inclusive range for a target. This is used only when a
 * target is first selected or changed; it never rewrites an explicit user
 * edit. Keeping the default bounded makes targets larger than the sequence
 * cap immediately renderable without changing the cap or validation rules.
 */
export function getDefaultSequenceRange(frameCount: number): DefaultSequenceRange {
  const lastAvailableFrame = Math.max(0, Math.trunc(frameCount) - 1);
  return {
    startFrameIndex: 0,
    endFrameIndex: Math.min(lastAvailableFrame, MAX_SEQUENCE_FRAMES - 1),
  };
}

/**
 * Validate a candidate inclusive range against the selected target's
 * frameCount and the hard MAX_SEQUENCE_FRAMES cap. Returns a
 * beginner-readable message for any rejection. Does NOT invoke IPC.
 */
export function validateRange(
  startFrameIndex: number,
  endFrameIndex: number,
  targetFrameCount: number,
): RangeValidation {
  if (!Number.isInteger(startFrameIndex) || !Number.isInteger(endFrameIndex)) {
    return { valid: false, frameCount: 0, message: '起始帧和结束帧必须是整数。' };
  }
  if (startFrameIndex < 0 || endFrameIndex < 0) {
    return { valid: false, frameCount: 0, message: '帧序号不能为负数。' };
  }
  if (startFrameIndex > endFrameIndex) {
    return {
      valid: false,
      frameCount: 0,
      message: `起始帧（${startFrameIndex}）不能晚于结束帧（${endFrameIndex}）。`,
    };
  }
  if (endFrameIndex >= targetFrameCount) {
    return {
      valid: false,
      frameCount: 0,
      message: `结束帧（${endFrameIndex}）超出目标可用帧范围（0…${targetFrameCount - 1}）。`,
    };
  }
  const frameCount = endFrameIndex - startFrameIndex + 1;
  if (frameCount > MAX_SEQUENCE_FRAMES) {
    return {
      valid: false,
      frameCount,
      message: `选择的 ${frameCount} 帧超出单次序列上限 ${MAX_SEQUENCE_FRAMES} 帧。`,
    };
  }
  return { valid: true, frameCount, message: null };
}

/**
 * Build the R2-A range contract from a validated selection. Callers MUST
 * have already passed `validateRange`. Returns null when invalid so a bad
 * range can never reach the renderer IPC layer.
 */
export function buildRange(
  renderTargetId: string,
  startFrameIndex: number,
  endFrameIndex: number,
): FlaFrameSequenceRange | null {
  if (startFrameIndex < 0 || endFrameIndex < 0) return null;
  if (startFrameIndex > endFrameIndex) return null;
  return { renderTargetId, startFrameIndex, endFrameIndex };
}

/**
 * A late/older sequence result must never overwrite the current request.
 * The component tracks the active requestId in a ref; this helper decides
 * whether an arriving response belongs to the current request.
 */
export function isCurrentResponse(
  activeRequestId: string | null,
  response: FlaFrameSequenceResponse,
): boolean {
  if (!activeRequestId) return false;
  if (!response.ok) return response.error.requestId === activeRequestId;
  return response.requestId === activeRequestId;
}

/**
 * Determine whether a completed sequence is commit-eligible. R2-D: only the
 * latest accepted sequence for the session may be committed. The component
 * supplies `isLatestAccepted` from the Main-side accepted-sequence tracker
 * (surfaced via the success response's requestId echo).
 */
export function isCommitEligible(
  success: FlaFrameSequenceSuccess,
  isLatestAccepted: boolean,
): boolean {
  return success.ok && isLatestAccepted && success.items.length > 0;
}

/**
 * After a successful commit, the prior sequence can no longer be the
 * commit candidate. The component uses this to reset its commit-eligible
 * flag so a re-render is required before committing again.
 */
export function postCommitSequenceState(): { phase: SequencePhase; commitEligible: boolean } {
  return { phase: 'committed', commitEligible: false };
}

/**
 * Re-render invalidation: starting a new render clears any prior
 * commit-eligible / committed state so the old result cannot be committed.
 */
export function rerenderReset(): { phase: SequencePhase; commitEligible: boolean; commitResponse: null } {
  return { phase: 'rendering', commitEligible: false, commitResponse: null };
}

/**
 * Problem A (Corrective #296): a semantic change to the selected render
 * intent (start/end frame / target) MUST immediately invalidate the prior
 * accepted sequence. This is the pure decision the component applies when
 * any of those inputs change. Returns the cleared commit state so the UI
 * can never commit an old rendered range while displaying a new range.
 */
export function intentChangeReset(): {
  phase: 'selecting' | SequencePhase;
  success: null;
  completedFrameCount: number;
  commitResponse: null;
} {
  return { phase: 'selecting', success: null, completedFrameCount: 0, commitResponse: null };
}

/**
 * Problem A (Corrective #296): decide whether the current accepted
 * sequence is stale relative to the displayed intent. The accepted
 * sequence is the only commit-eligible one; if its rendered range no
 * longer matches the displayed inputs, it is not commit-eligible.
 *
 * `renderedRange` is the range the accepted sequence actually produced
 * (derived from success.items). `displayedRange` is the user's current
 * selection. They must match exactly for commit eligibility to hold.
 */
export function isStaleAgainstIntent(
  renderedRange: { renderTargetId: string; startFrameIndex: number; endFrameIndex: number } | null,
  displayedRange: { renderTargetId: string; startFrameIndex: number; endFrameIndex: number },
): boolean {
  if (!renderedRange) return true;
  return (
    renderedRange.renderTargetId !== displayedRange.renderTargetId ||
    renderedRange.startFrameIndex !== displayedRange.startFrameIndex ||
    renderedRange.endFrameIndex !== displayedRange.endFrameIndex
  );
}

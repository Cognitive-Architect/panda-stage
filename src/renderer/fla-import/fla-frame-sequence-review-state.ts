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

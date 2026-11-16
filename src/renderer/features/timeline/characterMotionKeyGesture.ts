import {
  frameTimeMs,
  lastValidFrameTime,
  TIMELINE_FPS,
} from '../../../domain/timeline/frame-grid';

export interface CharacterMotionKeyGroupPreview {
  deltaFrames: number;
  anchorPreviewTimeMs: number;
  previewTimesByOrigin: ReadonlyMap<number, number>;
}

function frameIndex(timeMs: number): number {
  return Math.round((timeMs * TIMELINE_FPS) / 1_000);
}

/**
 * Resolve a clamped frame shift for one or more selected Composite Keys on the same Part,
 * preserving relative frame spacing while blocking collisions and crossing unselected keys.
 */
export function previewCharacterMotionKeyGroupShift(input: {
  fromTimesMs: readonly number[];
  anchorTimeMs: number;
  unselectedTimesMs: readonly number[];
  deltaPx: number;
  pixelsPerMs: number;
  durationMs: number;
}): CharacterMotionKeyGroupPreview {
  const {
    fromTimesMs,
    anchorTimeMs,
    unselectedTimesMs,
    deltaPx,
    pixelsPerMs,
    durationMs,
  } = input;
  const noopMap = new Map(fromTimesMs.map((timeMs) => [timeMs, timeMs]));
  if (
    fromTimesMs.length === 0 ||
    !fromTimesMs.includes(anchorTimeMs) ||
    fromTimesMs.some((timeMs) => timeMs <= 0) ||
    !Number.isFinite(deltaPx) ||
    !Number.isFinite(pixelsPerMs) ||
    pixelsPerMs <= 0
  ) {
    return {
      deltaFrames: 0,
      anchorPreviewTimeMs: anchorTimeMs,
      previewTimesByOrigin: noopMap,
    };
  }

  const sortedUnselected = [...unselectedTimesMs].sort((left, right) => left - right);
  const lastShotFrame = frameIndex(lastValidFrameTime(durationMs));
  let minDeltaFrames = -Infinity;
  let maxDeltaFrames = Infinity;

  for (const fromTimeMs of fromTimesMs) {
    const currentFrame = frameIndex(fromTimeMs);
    let previousUnselected = 0;
    let nextUnselected: number | null = null;
    for (const candidate of sortedUnselected) {
      if (candidate < fromTimeMs) {
        previousUnselected = candidate;
      } else if (candidate > fromTimeMs) {
        nextUnselected = candidate;
        break;
      }
    }
    const minFrame = frameIndex(previousUnselected) + 1;
    const maxFrame =
      nextUnselected === null ? lastShotFrame : frameIndex(nextUnselected) - 1;
    minDeltaFrames = Math.max(minDeltaFrames, minFrame - currentFrame);
    maxDeltaFrames = Math.min(maxDeltaFrames, maxFrame - currentFrame);
  }

  if (maxDeltaFrames < minDeltaFrames) {
    return {
      deltaFrames: 0,
      anchorPreviewTimeMs: anchorTimeMs,
      previewTimesByOrigin: noopMap,
    };
  }

  const requestedTargetFrame = Math.round(
    ((anchorTimeMs + deltaPx / pixelsPerMs) * TIMELINE_FPS) / 1_000,
  );
  const requestedDeltaFrames = requestedTargetFrame - frameIndex(anchorTimeMs);
  const deltaFrames = Math.max(
    minDeltaFrames,
    Math.min(maxDeltaFrames, requestedDeltaFrames),
  );
  const previewTimesByOrigin = new Map(
    fromTimesMs.map((timeMs) => [
      timeMs,
      frameTimeMs(frameIndex(timeMs) + deltaFrames),
    ]),
  );
  return {
    deltaFrames,
    anchorPreviewTimeMs: previewTimesByOrigin.get(anchorTimeMs) ?? anchorTimeMs,
    previewTimesByOrigin,
  };
}

/** Resolve a drag preview time against adjacent Composite Keys without crossing either neighbor. */
export function previewCharacterMotionKeyTime(input: {
  fromTimeMs: number;
  deltaPx: number;
  pixelsPerMs: number;
  previousTimeMs: number;
  nextTimeMs: number | null;
  durationMs: number;
}): number {
  const unselectedTimesMs = [input.previousTimeMs];
  if (input.nextTimeMs !== null) unselectedTimesMs.push(input.nextTimeMs);
  return previewCharacterMotionKeyGroupShift({
    fromTimesMs: [input.fromTimeMs],
    anchorTimeMs: input.fromTimeMs,
    unselectedTimesMs,
    deltaPx: input.deltaPx,
    pixelsPerMs: input.pixelsPerMs,
    durationMs: input.durationMs,
  }).anchorPreviewTimeMs;
}

// Shared source Graphic clock: used by XFL child-frame selection and E6 properties.
export type FlaGraphicPlaybackMode =
  | 'loop'
  | 'play once'
  | 'single frame'
  | 'loop reverse'
  | 'play once reverse';

export type FlaGraphicFrameResult =
  | { readonly ok: true; readonly frameIndex: number }
  | { readonly ok: false; readonly message: string };

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/**
 * Select an authored Graphic frame from its parent-keyframe-relative elapsed
 * frame count. Range wrapping, reverse modes and play-once holding follow the
 * pinned viewer's graphicSymbolFrame behavior after Panda validates raw XFL
 * bounds instead of silently clamping malformed input.
 */
export function evaluateFlaGraphicFrame(
  loop: string,
  firstFrame: number,
  lastFrame: number | undefined,
  totalFrames: number,
  frameOffset: number,
): FlaGraphicFrameResult {
  const modes: readonly string[] = [
    'loop', 'play once', 'single frame', 'loop reverse', 'play once reverse',
  ];
  if (!modes.includes(loop)) return { ok: false, message: `Unknown Graphic playback mode: ${loop}` };
  if (!Number.isSafeInteger(totalFrames) || totalFrames <= 0) {
    return { ok: false, message: 'Graphic timeline must have a positive safe frame count' };
  }
  if (!Number.isSafeInteger(firstFrame) || firstFrame < 0) {
    return { ok: false, message: 'Graphic firstFrame must be a non-negative safe integer' };
  }
  if (lastFrame !== undefined && (!Number.isSafeInteger(lastFrame) || lastFrame >= totalFrames)) {
    return { ok: false, message: `Graphic lastFrame ${lastFrame} is outside frameCount ${totalFrames}` };
  }
  if (!Number.isSafeInteger(frameOffset) || frameOffset < 0) {
    return { ok: false, message: 'Graphic frame offset must be a non-negative safe integer' };
  }

  const n = totalFrames;
  const first = modulo(firstFrame, n);
  if (loop === 'single frame') return { ok: true, frameIndex: first };

  const reverse = loop === 'loop reverse' || loop === 'play once reverse';
  const repeats = loop === 'loop' || loop === 'loop reverse';
  const step = reverse ? -1 : 1;
  let length: number;
  if (lastFrame !== undefined && lastFrame >= 0) {
    const last = Math.min(lastFrame, n - 1);
    length = (reverse ? modulo(first - last, n) : modulo(last - first, n)) + 1;
  } else if (repeats) {
    length = n;
  } else {
    length = (reverse ? first : n - 1 - first) + 1;
  }

  const offset = repeats ? frameOffset % length : Math.min(frameOffset, length - 1);
  return { ok: true, frameIndex: modulo(first + step * offset, n) };
}

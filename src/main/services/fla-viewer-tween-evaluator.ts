import type { FlaDisplayListMatrix } from './fla-display-list-resolver';

/**
 * Reimplementation of the bounded evaluator behavior in lifeart/fla-viewer at
 * b14fa1d1e3e2d2b035e174bde472a7941d385b17. The source project declares ISC
 * in package.json and its README badge, but that revision has no LICENSE file.
 * See docs/third-party-notices.md for the provenance record. This module keeps
 * Panda's validation and failure contract and does not import the viewer.
 */

export type FlaViewerGraphicPlaybackMode =
  | 'loop'
  | 'play once'
  | 'single frame'
  | 'loop reverse'
  | 'play once reverse';

export type FlaViewerGraphicFrameResult =
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
export function evaluateFlaViewerGraphicFrame(
  loop: string,
  firstFrame: number,
  lastFrame: number | undefined,
  totalFrames: number,
  frameOffset: number,
): FlaViewerGraphicFrameResult {
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

export interface FlaViewerTweenRotation {
  readonly direction: 'clockwise' | 'counter-clockwise';
  readonly turns: number;
}

export type FlaViewerTweenMatrixResult =
  | { readonly ok: true; readonly matrix: FlaDisplayListMatrix }
  | { readonly ok: false; readonly code: 'INVALID_PROGRESS' | 'INVALID_MATRIX' | 'INVALID_ROTATION'; readonly message: string };

function interpolateFlaMatrixEntries(
  start: FlaDisplayListMatrix,
  end: FlaDisplayListMatrix,
  progress: number,
): FlaDisplayListMatrix {
  const lerp = (from: number, to: number) => from + (to - from) * progress;
  return {
    a: lerp(start.a, end.a), b: lerp(start.b, end.b),
    c: lerp(start.c, end.c), d: lerp(start.d, end.d),
    tx: lerp(start.tx, end.tx), ty: lerp(start.ty, end.ty),
  };
}

/**
 * Decomposed Classic Motion matrix interpolation, adapted from the pinned
 * viewer's layer-utils.interpolateDecomposed. Reflection changes and singular
 * crossings use entry-wise interpolation as in that evaluator.
 */
export function interpolateFlaViewerClassicTweenMatrix(
  start: FlaDisplayListMatrix,
  end: FlaDisplayListMatrix,
  progress: number,
  rotation?: FlaViewerTweenRotation,
): FlaViewerTweenMatrixResult {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    return { ok: false, code: 'INVALID_PROGRESS', message: 'Classic tween progress must be between 0 and 1' };
  }
  if (![start.a, start.b, start.c, start.d, start.tx, start.ty,
    end.a, end.b, end.c, end.d, end.tx, end.ty].every(Number.isFinite)) {
    return { ok: false, code: 'INVALID_MATRIX', message: 'Classic tween endpoint matrix contains non-finite values' };
  }
  if (rotation !== undefined &&
      ((rotation.direction !== 'clockwise' && rotation.direction !== 'counter-clockwise') ||
        !Number.isSafeInteger(rotation.turns) || rotation.turns < 0 || rotation.turns > 1_000_000)) {
    return { ok: false, code: 'INVALID_ROTATION', message: 'Classic tween rotation metadata is invalid' };
  }
  if (progress === 0) return { ok: true, matrix: { ...start } };
  if (progress === 1) return { ok: true, matrix: { ...end } };

  const detStart = start.a * start.d - start.b * start.c;
  const detEnd = end.a * end.d - end.b * end.c;
  if ((detStart < 0) !== (detEnd < 0) || !Number.isFinite(detStart * detEnd)) {
    return { ok: true, matrix: interpolateFlaMatrixEntries(start, end, progress) };
  }

  const sign = detStart < 0 ? -1 : 1;
  const parts = (matrix: FlaDisplayListMatrix) => ({
    scaleX: sign * Math.hypot(matrix.a, matrix.b),
    scaleY: Math.hypot(matrix.c, matrix.d),
    skewY: Math.atan2(sign * matrix.b, sign * matrix.a),
    skewX: Math.atan2(-matrix.c, matrix.d),
  });
  const from = parts(start);
  const to = parts(end);
  const turn = Math.PI * 2;
  const wrap = (angle: number) => angle - turn * Math.round(angle / turn);
  let turnY = wrap(to.skewY - from.skewY);
  if (Math.abs(turnY) < 1e-6) turnY = 0;
  if (rotation?.direction === 'clockwise') {
    if (turnY < 0) turnY += turn;
    turnY += turn * rotation.turns;
  } else if (rotation?.direction === 'counter-clockwise') {
    if (turnY > 0) turnY -= turn;
    turnY -= turn * rotation.turns;
  }
  const turnX = turnY + wrap(to.skewX - from.skewX - turnY);
  const lerp = (a: number, b: number) => a + (b - a) * progress;
  const scaleX = lerp(from.scaleX, to.scaleX);
  const scaleY = lerp(from.scaleY, to.scaleY);
  const skewY = from.skewY + turnY * progress;
  const skewX = from.skewX + turnX * progress;
  return {
    ok: true,
    matrix: {
      a: scaleX * Math.cos(skewY),
      b: scaleX * Math.sin(skewY),
      c: -scaleY * Math.sin(skewX),
      d: scaleY * Math.cos(skewX),
      tx: lerp(start.tx, end.tx),
      ty: lerp(start.ty, end.ty),
    },
  };
}

export interface FlaViewerEasePoint {
  readonly x: number;
  readonly y: number;
}

export interface FlaViewerTweenEase {
  readonly target: string;
  readonly method?: string;
  readonly intensity?: number;
  readonly customPoints?: readonly FlaViewerEasePoint[];
}

export type FlaViewerTweenProgressResult =
  | { readonly ok: true; readonly progress: number }
  | { readonly ok: false; readonly message: string };

const EASE_BASES = new Set(['quad', 'cubic', 'quart', 'quint', 'sine', 'circ', 'expo', 'back', 'elastic', 'bounce']);

function bounceOut(value: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (value < 1 / d) return n * value * value;
  if (value < 2 / d) return n * (value - 1.5 / d) ** 2 + 0.75;
  if (value < 2.5 / d) return n * (value - 2.25 / d) ** 2 + 0.9375;
  return n * (value - 2.625 / d) ** 2 + 0.984375;
}

function easeIn(value: number, base: string): number {
  switch (base) {
    case 'quad': return value * value;
    case 'cubic': return value ** 3;
    case 'quart': return value ** 4;
    case 'quint': return value ** 5;
    case 'sine': return 1 - Math.cos(value * Math.PI / 2);
    case 'expo': return value === 0 ? 0 : 2 ** (10 * (value - 1));
    case 'circ': return 1 - Math.sqrt(1 - value * value);
    case 'back': return value * value * (2.7 * value - 1.7);
    case 'elastic': {
      if (value === 0 || value === 1) return value;
      const period = 0.3;
      return -(2 ** (10 * (value - 1))) * Math.sin(((value - 1 - period / 4) * Math.PI * 2) / period);
    }
    case 'bounce': return 1 - bounceOut(1 - value);
    default: return value;
  }
}

function easeOut(value: number, base: string): number {
  switch (base) {
    case 'quad': return 1 - (1 - value) ** 2;
    case 'cubic': return 1 + (value - 1) ** 3;
    case 'quart': return 1 - (1 - value) ** 4;
    case 'quint': return 1 + (value - 1) ** 5;
    case 'sine': return Math.sin(value * Math.PI / 2);
    case 'expo': return value === 1 ? 1 : 1 - 2 ** (-10 * value);
    case 'circ': return Math.sqrt(1 - (value - 1) ** 2);
    case 'back': return (value - 1) ** 2 * (2.7 * (value - 1) + 1.7) + 1;
    case 'elastic': {
      if (value === 0 || value === 1) return value;
      const period = 0.3;
      return (2 ** (-10 * value)) * Math.sin(((value - period / 4) * Math.PI * 2) / period) + 1;
    }
    case 'bounce': return bounceOut(value);
    default: return value;
  }
}

function easeInOut(value: number, base: string): number {
  if (base === 'bounce') {
    return value < 0.5
      ? (1 - bounceOut(1 - 2 * value)) / 2
      : (1 + bounceOut(2 * value - 1)) / 2;
  }
  if (base === 'elastic') {
    if (value === 0 || value === 1) return value;
    const period = 0.45;
    const u = 2 * value - 1;
    return u < 0
      ? -0.5 * (2 ** (10 * u)) * Math.sin(((u - period / 4) * Math.PI * 2) / period)
      : 0.5 * (2 ** (-10 * u)) * Math.sin(((u - period / 4) * Math.PI * 2) / period) + 1;
  }
  if (base === 'back') {
    const strength = 1.7 * 1.525;
    const u = 2 * value;
    return u < 1
      ? 0.5 * (u * u * ((strength + 1) * u - strength))
      : 0.5 * ((u - 2) ** 2 * ((strength + 1) * (u - 2) + strength) + 2);
  }
  return value < 0.5 ? easeIn(value * 2, base) / 2 : 0.5 + easeOut(value * 2 - 1, base) / 2;
}

function applyEaseMethod(value: number, method: string, intensity?: number): number | null {
  if (method === 'none') return value;
  let direction: 'in' | 'out' | 'inOut';
  let base: string;
  if (method.endsWith('InOut')) {
    direction = 'inOut';
    base = method.slice(0, -5);
  } else if (method.endsWith('In')) {
    direction = 'in';
    base = method.slice(0, -2);
  } else if (method.endsWith('Out')) {
    direction = 'out';
    base = method.slice(0, -3);
  } else {
    return null;
  }
  if (!EASE_BASES.has(base)) return null;
  const eased = direction === 'in' ? easeIn(value, base)
    : direction === 'out' ? easeOut(value, base)
      : easeInOut(value, base);
  const strength = intensity ? Math.min(Math.abs(intensity), 100) / 100 : 1;
  return value + (eased - value) * strength;
}

function cubicBezier(value: number, p0: number, p1: number, p2: number, p3: number): number {
  const inverse = 1 - value;
  return inverse ** 3 * p0 + 3 * inverse ** 2 * value * p1 + 3 * inverse * value ** 2 * p2 + value ** 3 * p3;
}

function evaluateCustomEase(value: number, points: readonly FlaViewerEasePoint[]): number | null {
  if (points.length < 4 || (points.length - 1) % 3 !== 0 ||
      points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)) ||
      points[0]?.x !== 0 || points[points.length - 1]?.x !== 1) return null;
  for (let index = 3; index < points.length; index += 3) {
    if (points[index]!.x < points[index - 3]!.x) return null;
  }
  const segmentCount = (points.length - 1) / 3;
  let segment = 0;
  while (segment < segmentCount - 1 && value > points[3 * (segment + 1)]!.x) segment += 1;
  const p0 = points[3 * segment]!;
  const p1 = points[3 * segment + 1]!;
  const p2 = points[3 * segment + 2]!;
  const p3 = points[3 * segment + 3]!;
  const span = p3.x - p0.x;
  let parameter = span > 0 ? (value - p0.x) / span : 0;
  parameter = Math.max(0, Math.min(1, parameter));
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const x = cubicBezier(parameter, p0.x, p1.x, p2.x, p3.x);
    const inverse = 1 - parameter;
    const derivative = 3 * inverse ** 2 * (p1.x - p0.x) +
      6 * inverse * parameter * (p2.x - p1.x) + 3 * parameter ** 2 * (p3.x - p2.x);
    if (Math.abs(derivative) < 0.0001) break;
    parameter -= (x - value) / derivative;
    parameter = Math.max(0, Math.min(1, parameter));
  }
  const output = cubicBezier(parameter, p0.y, p1.y, p2.y, p3.y);
  return Number.isFinite(output) ? output : null;
}

/**
 * Easing semantics adapted from the pinned viewer's Classic Motion progress
 * path. Unknown or malformed easing metadata fails closed at the Panda adapter.
 */
export function evaluateFlaViewerClassicTweenProgress(
  progress: number,
  acceleration: number | undefined,
  eases: readonly FlaViewerTweenEase[],
): FlaViewerTweenProgressResult {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    return { ok: false, message: 'Classic tween progress must be between 0 and 1' };
  }
  if (acceleration !== undefined && (!Number.isFinite(acceleration) || acceleration < -100 || acceleration > 100)) {
    return { ok: false, message: 'Classic tween acceleration must be between -100 and 100' };
  }
  let value = progress;
  if (eases.length > 0) {
    const ease = eases.find((candidate) => candidate.target === 'all') ??
      eases.find((candidate) => candidate.target === 'position') ?? eases[0]!;
    if (ease.customPoints) {
      const eased = evaluateCustomEase(value, ease.customPoints);
      if (eased === null) return { ok: false, message: 'Classic tween CustomEase points are malformed' };
      value = eased;
    } else if (ease.method !== undefined) {
      const eased = applyEaseMethod(value, ease.method, ease.intensity);
      if (eased === null) return { ok: false, message: `Unsupported Classic tween ease method: ${ease.method}` };
      value = eased;
    } else if (ease.intensity !== undefined) {
      const strength = Math.abs(ease.intensity) / 100;
      value = ease.intensity < 0 ? value ** (1 + strength * 2)
        : 1 - (1 - value) ** (1 + strength * 2);
    }
  } else if (acceleration !== undefined && acceleration !== 0) {
    const strength = Math.abs(acceleration) / 100;
    value = acceleration < 0 ? value ** (1 + strength * 2)
      : 1 - (1 - value) ** (1 + strength * 2);
  }
  if (!Number.isFinite(value)) return { ok: false, message: 'Classic tween easing produced a non-finite value' };
  return { ok: true, progress: Math.max(0, Math.min(1, value)) };
}

/**
 * Bounded XFL timeline-coordinate resolver shared by Scene/Timeline and
 * Graphic adapters. It indexes authored DOMFrame spans without expanding
 * held frames or implementing tween playback.
 */

export const FLA_TIMELINE_FRAME_SPAN_LIMITS = Object.freeze({
  maxFrameCount: 100_000,
  maxLayerCount: 100_000,
  maxFrameSpanCount: 100_000,
});

export type FlaTimelineTweenType = 'none' | 'motion' | 'shape';

export interface FlaTimelineFrameSpanInput<T> {
  /** Raw DOMFrame index attribute. */
  readonly index?: string | number;
  /** Raw DOMFrame duration attribute. Missing means a one-frame span. */
  readonly duration?: string | number;
  /** Raw DOMFrame tweenType attribute. */
  readonly tweenType?: string;
  /** Opaque source frame retained for the eventual display-list adapter. */
  readonly sourceFrame: T;
}

export interface FlaTimelineLayerSpanInput<T> {
  readonly visible: boolean;
  readonly frames: readonly FlaTimelineFrameSpanInput<T>[];
}

export interface FlaNormalizedFrameSpan<T> {
  readonly index: number;
  readonly duration: number;
  readonly endExclusive: number;
  readonly tweenType: FlaTimelineTweenType;
  readonly sourceFrame: T;
}

export interface FlaTimelineFrameSpanIndex<T> {
  /** Maximum endExclusive across every layer, not the DOMFrame node count. */
  readonly frameCount: number;
  readonly layers: readonly {
    readonly visible: boolean;
    readonly spans: readonly FlaNormalizedFrameSpan<T>[];
  }[];
}

export type FlaTimelineFrameSpanErrorCode =
  | 'INVALID_TIMELINE'
  | 'INVALID_FRAME_SPAN'
  | 'OVERLAPPING_FRAME_SPANS'
  | 'FRAME_COUNT_LIMIT_EXCEEDED'
  | 'FRAME_SPAN_BUDGET_EXCEEDED'
  | 'INVALID_FRAME_INDEX'
  | 'FRAME_INDEX_OUT_OF_RANGE';

export type FlaTimelineFrameSpanBuildResult<T> =
  | { readonly ok: true; readonly index: FlaTimelineFrameSpanIndex<T> }
  | {
      readonly ok: false;
      readonly code: FlaTimelineFrameSpanErrorCode;
      readonly message: string;
      readonly layerIndex?: number;
      readonly frameIndex?: number;
    };

export interface FlaTimelineFrameSpanMetadata {
  readonly index: number;
  readonly duration: number;
  readonly endExclusive: number;
  readonly tweenType: FlaTimelineTweenType;
}

export type FlaTimelineFrameSelection<T> =
  | {
      readonly kind: 'authored-frame';
      readonly layerIndex: number;
      readonly visible: boolean;
      readonly state: 'keyframe' | 'held';
      readonly sourceFrame: T;
      readonly span: FlaTimelineFrameSpanMetadata;
    }
  | {
      readonly kind: 'uncovered';
      readonly layerIndex: number;
      readonly visible: boolean;
    }
  | {
      readonly kind: 'unsupported-tween-interior';
      readonly layerIndex: number;
      readonly visible: boolean;
      readonly span: FlaTimelineFrameSpanMetadata & { readonly tweenType: 'motion' | 'shape' };
    };

export type FlaTimelineFrameResolveResult<T> =
  | {
      readonly ok: true;
      readonly frameIndex: number;
      readonly frameCount: number;
      readonly layers: readonly FlaTimelineFrameSelection<T>[];
    }
  | {
      readonly ok: false;
      readonly code: 'INVALID_FRAME_INDEX' | 'FRAME_INDEX_OUT_OF_RANGE';
      readonly message: string;
    };

function failure<T>(
  code: FlaTimelineFrameSpanErrorCode,
  message: string,
  location: { readonly layerIndex?: number; readonly frameIndex?: number } = {},
): FlaTimelineFrameSpanBuildResult<T> {
  return { ok: false, code, message, ...location };
}

function parseUnsignedInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!/^\d+$/u.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseTweenType(value: unknown): FlaTimelineTweenType | null {
  if (value === undefined) return 'none';
  if (typeof value !== 'string') return null;

  switch (value.trim().toLowerCase()) {
    case 'none':
      return 'none';
    case 'motion':
      return 'motion';
    case 'shape':
      return 'shape';
    default:
      return null;
  }
}

/** Parse and index bounded DOMFrame spans without expanding duration-sized arrays. */
export function buildFlaTimelineFrameSpanIndex<T>(
  layers: readonly FlaTimelineLayerSpanInput<T>[],
): FlaTimelineFrameSpanBuildResult<T> {
  if (!Array.isArray(layers)) {
    return failure('INVALID_TIMELINE', 'Timeline layers must be an array');
  }
  if (layers.length > FLA_TIMELINE_FRAME_SPAN_LIMITS.maxLayerCount) {
    return failure(
      'FRAME_SPAN_BUDGET_EXCEEDED',
      `Timeline layer count exceeded ${FLA_TIMELINE_FRAME_SPAN_LIMITS.maxLayerCount}`,
    );
  }

  let totalSpanCount = 0;
  let frameCount = 0;
  const normalizedLayers: FlaTimelineFrameSpanIndex<T>['layers'][number][] = [];

  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const layer = layers[layerIndex];
    if (!layer || typeof layer.visible !== 'boolean' || !Array.isArray(layer.frames)) {
      return failure('INVALID_TIMELINE', `Timeline layer ${layerIndex} is malformed`, { layerIndex });
    }
    if (layer.frames.length > FLA_TIMELINE_FRAME_SPAN_LIMITS.maxFrameSpanCount - totalSpanCount) {
      return failure(
        'FRAME_SPAN_BUDGET_EXCEEDED',
        `Timeline frame-span count exceeded ${FLA_TIMELINE_FRAME_SPAN_LIMITS.maxFrameSpanCount}`,
        { layerIndex },
      );
    }
    totalSpanCount += layer.frames.length;

    const spans: FlaNormalizedFrameSpan<T>[] = [];
    for (let sourceIndex = 0; sourceIndex < layer.frames.length; sourceIndex += 1) {
      const frame = layer.frames[sourceIndex];
      if (!frame || typeof frame !== 'object') {
        return failure(
          'INVALID_FRAME_SPAN',
          `Timeline layer ${layerIndex} has malformed DOMFrame metadata at source position ${sourceIndex}`,
          { layerIndex, frameIndex: sourceIndex },
        );
      }

      const index = parseUnsignedInteger(frame.index);
      const duration = frame.duration === undefined ? 1 : parseUnsignedInteger(frame.duration);
      const tweenType = parseTweenType(frame.tweenType);
      if (index === null || duration === null || duration <= 0 || tweenType === null) {
        return failure(
          'INVALID_FRAME_SPAN',
          `Timeline layer ${layerIndex} has invalid DOMFrame span metadata at source position ${sourceIndex}`,
          { layerIndex, frameIndex: sourceIndex },
        );
      }

      const endExclusive = index + duration;
      if (!Number.isSafeInteger(endExclusive) ||
          endExclusive > FLA_TIMELINE_FRAME_SPAN_LIMITS.maxFrameCount) {
        return failure(
          'FRAME_COUNT_LIMIT_EXCEEDED',
          `Timeline layer ${layerIndex} has a DOMFrame span beyond the ${FLA_TIMELINE_FRAME_SPAN_LIMITS.maxFrameCount}-frame limit`,
          { layerIndex, frameIndex: sourceIndex },
        );
      }

      spans.push({ index, duration, endExclusive, tweenType, sourceFrame: frame.sourceFrame });
      frameCount = Math.max(frameCount, endExclusive);
    }

    spans.sort((left, right) => left.index - right.index);
    for (let spanIndex = 1; spanIndex < spans.length; spanIndex += 1) {
      const previous = spans[spanIndex - 1];
      const current = spans[spanIndex];
      if (previous && current && current.index < previous.endExclusive) {
        return failure(
          'OVERLAPPING_FRAME_SPANS',
          `Timeline layer ${layerIndex} has overlapping DOMFrame spans at timeline index ${current.index}`,
          { layerIndex, frameIndex: current.index },
        );
      }
    }

    normalizedLayers.push({ visible: layer.visible, spans });
  }

  return {
    ok: true,
    index: { frameCount, layers: normalizedLayers },
  };
}

function findCoveringSpan<T>(
  spans: readonly FlaNormalizedFrameSpan<T>[],
  frameIndex: number,
): FlaNormalizedFrameSpan<T> | null {
  let low = 0;
  let high = spans.length - 1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const span = spans[middle];
    if (!span) return null;
    if (frameIndex < span.index) {
      high = middle - 1;
    } else if (frameIndex >= span.endExclusive) {
      low = middle + 1;
    } else {
      return span;
    }
  }
  return null;
}

function spanMetadata(span: FlaNormalizedFrameSpan<unknown>): FlaTimelineFrameSpanMetadata {
  return {
    index: span.index,
    duration: span.duration,
    endExclusive: span.endExclusive,
    tweenType: span.tweenType,
  };
}

/** Resolve one 0-based authored timeline coordinate for each layer. */
export function resolveFlaTimelineFrameSpan<T>(
  index: FlaTimelineFrameSpanIndex<T>,
  frameIndex: number,
): FlaTimelineFrameResolveResult<T> {
  if (!Number.isSafeInteger(frameIndex) || frameIndex < 0) {
    return {
      ok: false,
      code: 'INVALID_FRAME_INDEX',
      message: 'Timeline frame index must be a non-negative safe integer',
    };
  }
  if (frameIndex >= index.frameCount) {
    return {
      ok: false,
      code: 'FRAME_INDEX_OUT_OF_RANGE',
      message: `Timeline frame index ${frameIndex} is outside frameCount ${index.frameCount}`,
    };
  }

  const layers = index.layers.map((layer, layerIndex): FlaTimelineFrameSelection<T> => {
    const span = findCoveringSpan(layer.spans, frameIndex);
    if (!span) return { kind: 'uncovered', layerIndex, visible: layer.visible };

    const metadata = spanMetadata(span);
    if (span.tweenType !== 'none' && frameIndex > span.index) {
      return {
        kind: 'unsupported-tween-interior',
        layerIndex,
        visible: layer.visible,
        span: { ...metadata, tweenType: span.tweenType },
      };
    }

    return {
      kind: 'authored-frame',
      layerIndex,
      visible: layer.visible,
      state: frameIndex === span.index ? 'keyframe' : 'held',
      sourceFrame: span.sourceFrame,
      span: metadata,
    };
  });

  return { ok: true, frameIndex, frameCount: index.frameCount, layers };
}

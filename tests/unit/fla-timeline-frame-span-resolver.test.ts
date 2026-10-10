import { describe, expect, it } from 'vitest';
import {
  buildFlaTimelineFrameSpanIndex,
  FLA_TIMELINE_FRAME_SPAN_LIMITS,
  resolveFlaTimelineFrameSpan,
  type FlaTimelineFrameSpanInput,
  type FlaTimelineLayerSpanInput,
} from '../../src/main/services/fla-timeline-frame-span-resolver';

function frame<T>(
  sourceFrame: T,
  index: string | number | undefined,
  duration?: string | number,
  tweenType?: string,
): FlaTimelineFrameSpanInput<T> {
  return {
    sourceFrame,
    ...(index === undefined ? {} : { index }),
    ...(duration === undefined ? {} : { duration }),
    ...(tweenType === undefined ? {} : { tweenType }),
  };
}

function layer<T>(
  frames: readonly FlaTimelineFrameSpanInput<T>[],
  visible = true,
): FlaTimelineLayerSpanInput<T> {
  return { visible, frames };
}

function build<T>(layers: readonly FlaTimelineLayerSpanInput<T>[]) {
  const result = buildFlaTimelineFrameSpanIndex(layers);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.index;
}

describe('XFL timeline frame-span resolver foundation', () => {
  it('keeps one non-tween authored frame state across its full held span', () => {
    const index = build([layer([frame('held-state', '0', '5')])]);

    expect(index.frameCount).toBe(5);
    for (let frameIndex = 0; frameIndex < 5; frameIndex += 1) {
      const result = resolveFlaTimelineFrameSpan(index, frameIndex);
      expect(result).toMatchObject({ ok: true, frameIndex, frameCount: 5 });
      if (!result.ok) continue;
      expect(result.layers).toEqual([{
        kind: 'authored-frame',
        layerIndex: 0,
        visible: true,
        state: frameIndex === 0 ? 'keyframe' : 'held',
        sourceFrame: 'held-state',
        span: { index: 0, duration: 5, endExclusive: 5, tweenType: 'none' },
      }]);
    }
  });

  it('resolves the authored span covering a 0-based timeline coordinate, independent of node order', () => {
    const index = build([layer([
      frame('frame-b', 3, 2),
      frame('frame-a', 0, 3),
    ])]);

    expect(index.frameCount).toBe(5);
    expect(resolveFlaTimelineFrameSpan(index, 2)).toMatchObject({
      ok: true,
      layers: [{ kind: 'authored-frame', state: 'held', sourceFrame: 'frame-a' }],
    });
    expect(resolveFlaTimelineFrameSpan(index, 3)).toMatchObject({
      ok: true,
      layers: [{ kind: 'authored-frame', state: 'keyframe', sourceFrame: 'frame-b' }],
    });
    expect(resolveFlaTimelineFrameSpan(index, 4)).toMatchObject({
      ok: true,
      layers: [{ kind: 'authored-frame', state: 'held', sourceFrame: 'frame-b' }],
    });
  });

  it('leaves an uncovered sparse layer empty and preserves layer visibility', () => {
    const index = build([
      layer([frame('before-gap', 0, 2), frame('after-gap', 4, 1)], false),
      layer([frame('covering-layer', 0, 5)]),
    ]);

    const result = resolveFlaTimelineFrameSpan(index, 2);
    expect(result).toMatchObject({
      ok: true,
      layers: [
        { kind: 'uncovered', layerIndex: 0, visible: false },
        { kind: 'authored-frame', layerIndex: 1, visible: true, sourceFrame: 'covering-layer' },
      ],
    });
  });

  it('derives frameCount from the furthest authored span end, not DOMFrame count', () => {
    const index = build([layer([
      frame('first', 0, 3),
      frame('last', 7, 2),
    ])]);

    expect(index.layers[0]?.spans).toHaveLength(2);
    expect(index.frameCount).toBe(9);
    expect(resolveFlaTimelineFrameSpan(index, 8)).toMatchObject({
      ok: true,
      frameCount: 9,
      layers: [{ kind: 'authored-frame', sourceFrame: 'last', state: 'held' }],
    });
  });

  it('defaults an omitted duration to one authored frame', () => {
    const index = build([layer([frame('single-frame', 2)])]);

    expect(index.frameCount).toBe(3);
    expect(resolveFlaTimelineFrameSpan(index, 2)).toMatchObject({
      ok: true,
      layers: [{ kind: 'authored-frame', sourceFrame: 'single-frame', state: 'keyframe' }],
    });
    expect(resolveFlaTimelineFrameSpan(index, 1)).toMatchObject({
      ok: true,
      layers: [{ kind: 'uncovered' }],
    });
  });

  it.each([
    { name: 'missing index', value: frame('bad', undefined, 1) },
    { name: 'negative index', value: frame('bad', '-1', 1) },
    { name: 'fractional index', value: frame('bad', '1.5', 1) },
    { name: 'unsafe index', value: frame('bad', Number.MAX_SAFE_INTEGER + 1, 1) },
    { name: 'zero duration', value: frame('bad', 0, 0) },
    { name: 'negative duration', value: frame('bad', 0, '-2') },
    { name: 'fractional duration', value: frame('bad', 0, '2.5') },
    { name: 'non-finite duration', value: frame('bad', 0, Number.POSITIVE_INFINITY) },
    { name: 'unknown tween type', value: frame('bad', 0, 2, 'bounce') },
  ])('rejects $name deterministically', ({ value }) => {
    const input = [layer([value])];
    const first = buildFlaTimelineFrameSpanIndex(input);
    const second = buildFlaTimelineFrameSpanIndex(input);

    expect(first).toEqual(second);
    expect(first).toMatchObject({ ok: false, code: 'INVALID_FRAME_SPAN' });
  });

  it('rejects overlapping spans within one layer instead of choosing one', () => {
    const input = [layer([
      frame('first', 0, 4),
      frame('ambiguous', 3, 2),
    ])];
    const first = buildFlaTimelineFrameSpanIndex(input);
    const second = buildFlaTimelineFrameSpanIndex(input);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      ok: false,
      code: 'OVERLAPPING_FRAME_SPANS',
      layerIndex: 0,
      frameIndex: 3,
    });
  });

  it('rejects unsafe span ends and spans exceeding the public frame-count bound', () => {
    expect(buildFlaTimelineFrameSpanIndex([layer([
      frame('overflow', Number.MAX_SAFE_INTEGER, 2),
    ])])).toMatchObject({ ok: false, code: 'FRAME_COUNT_LIMIT_EXCEEDED' });

    expect(buildFlaTimelineFrameSpanIndex([layer([
      frame('out-of-budget', FLA_TIMELINE_FRAME_SPAN_LIMITS.maxFrameCount - 1, 2),
    ])])).toMatchObject({ ok: false, code: 'FRAME_COUNT_LIMIT_EXCEEDED' });
  });

  it('bounds total authored spans without expanding held-frame durations', () => {
    const overBudget = Array.from(
      { length: FLA_TIMELINE_FRAME_SPAN_LIMITS.maxFrameSpanCount + 1 },
      (_, sourceIndex) => frame(sourceIndex, sourceIndex, 1),
    );

    expect(buildFlaTimelineFrameSpanIndex([layer(overBudget)])).toMatchObject({
      ok: false,
      code: 'FRAME_SPAN_BUDGET_EXCEEDED',
      layerIndex: 0,
    });
  });

  it('marks motion and shape tween interiors unsupported while allowing their concrete start state', () => {
    const index = build([layer([
      frame('motion-start', 0, 3, 'motion'),
      frame('shape-start', 4, 3, 'shape'),
    ])]);

    expect(resolveFlaTimelineFrameSpan(index, 0)).toMatchObject({
      ok: true,
      layers: [{ kind: 'authored-frame', sourceFrame: 'motion-start', state: 'keyframe' }],
    });
    expect(resolveFlaTimelineFrameSpan(index, 1)).toMatchObject({
      ok: true,
      layers: [{
        kind: 'unsupported-tween-interior',
        span: { index: 0, endExclusive: 3, tweenType: 'motion' },
      }],
    });
    expect(resolveFlaTimelineFrameSpan(index, 4)).toMatchObject({
      ok: true,
      layers: [{ kind: 'authored-frame', sourceFrame: 'shape-start', state: 'keyframe' }],
    });
    expect(resolveFlaTimelineFrameSpan(index, 5)).toMatchObject({
      ok: true,
      layers: [{ kind: 'unsupported-tween-interior', span: { tweenType: 'shape' } }],
    });
  });

  it('rejects invalid and out-of-range requested timeline coordinates', () => {
    const index = build([layer([frame('only-frame', 0, 2)])]);

    expect(resolveFlaTimelineFrameSpan(index, -1)).toMatchObject({
      ok: false,
      code: 'INVALID_FRAME_INDEX',
    });
    expect(resolveFlaTimelineFrameSpan(index, 1.5)).toMatchObject({
      ok: false,
      code: 'INVALID_FRAME_INDEX',
    });
    expect(resolveFlaTimelineFrameSpan(index, 2)).toMatchObject({
      ok: false,
      code: 'FRAME_INDEX_OUT_OF_RANGE',
    });
    expect(build([])).toMatchObject({ frameCount: 0, layers: [] });
  });
});

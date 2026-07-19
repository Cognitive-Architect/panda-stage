import { describe, expect, it } from 'vitest';
import {
  ShotSchema,
  evaluateShotAtTime,
  type Shot,
} from '../../src/shared/domain';

const SHOT_ID = '10000000-0000-4000-8000-000000000001';
const LAYER_ID = '10000000-0000-4000-8000-000000000002';
const ASSET_ID = '10000000-0000-4000-8000-000000000003';

function createShot(): Shot {
  return ShotSchema.parse({
    id: SHOT_ID,
    name: 'Move evaluator fixture',
    durationMs: 2_000,
    layers: [
      {
        id: LAYER_ID,
        assetId: ASSET_ID,
        name: 'Moving layer',
        anchor: 'center',
        x: 100,
        y: 200,
        zIndex: 0,
      },
    ],
    timelineEvents: [
      {
        id: '10000000-0000-4000-8000-000000000004',
        type: 'move',
        layerId: LAYER_ID,
        startMs: 250,
        durationMs: 1_000,
        from: { x: 100, y: 200 },
        to: { x: 500, y: 600 },
        easing: 'linear',
      },
    ],
  });
}

describe('evaluateShotAtTime', () => {
  it('keeps the center position before a move starts', () => {
    const snapshot = evaluateShotAtTime(createShot(), 0);

    expect(snapshot).toMatchObject({
      shotId: SHOT_ID,
      timeMs: 0,
      layers: [{ anchor: 'center', x: 100, y: 200 }],
    });
  });

  it('linearly interpolates a move at integer milliseconds', () => {
    const snapshot = evaluateShotAtTime(createShot(), 750);

    expect(snapshot.layers[0]).toMatchObject({ x: 300, y: 400 });
  });

  it('holds the move target after the event ends', () => {
    const snapshot = evaluateShotAtTime(createShot(), 1_500);

    expect(snapshot.layers[0]).toMatchObject({ x: 500, y: 600 });
  });

  it('clamps evaluation after the shot end', () => {
    const snapshot = evaluateShotAtTime(createShot(), 5_000);

    expect(snapshot.timeMs).toBe(2_000);
    expect(snapshot.layers[0]).toMatchObject({ x: 500, y: 600 });
  });

  it.each([-1, 100.5, Number.NaN])(
    'rejects an invalid evaluation time: %s',
    (timeMs) => {
      expect(() => evaluateShotAtTime(createShot(), timeMs)).toThrow();
    },
  );

  it('returns the same snapshot for repeated evaluation', () => {
    const shot = createShot();

    expect(evaluateShotAtTime(shot, 750)).toEqual(
      evaluateShotAtTime(shot, 750),
    );
  });
});

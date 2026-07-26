import { describe, expect, it } from 'vitest';
import { evaluateShotAtTime } from '../../../src/domain';
import type { Project, Shot, TimelineEvent } from '../../../src/domain';
import { buildProject, IDS } from './testProject';

function shotWithEvents(events: readonly TimelineEvent[]): Shot {
  const project = buildProject();
  const shot = project.shots[0]!;
  return { ...shot, timelineEvents: [...events] };
}

describe('T02 evaluateShotAtTime', () => {
  const project: Project = buildProject();
  const shot = project.shots[0]!;

  it('clamps the requested time into [0, durationMs]', () => {
    expect(evaluateShotAtTime(shot, -100, project).timeMs).toBe(0);
    expect(evaluateShotAtTime(shot, 99999, project).timeMs).toBe(shot.durationMs);
    expect(evaluateShotAtTime(shot, 1234.6, project).timeMs).toBe(1235);
  });

  it('interpolates a linear move event across the interval', () => {
    const move: TimelineEvent = {
      id: 'ev-move',
      type: 'move',
      layerId: IDS.layerChar,
      startMs: 0,
      endMs: 1000,
      easing: 'linear',
      from: { x: 500, y: 600 },
      to: { x: 1000, y: 800 },
    };
    const shotWith = shotWithEvents([move]);
    const layerAt = (t: number) =>
      evaluateShotAtTime(shotWith, t, project).layers.find(
        (layer) => layer.id === IDS.layerChar,
      )!;
    expect(layerAt(0).x).toBe(500);
    expect(layerAt(0).y).toBe(600);
    expect(layerAt(500).x).toBeCloseTo(750, 6);
    expect(layerAt(1000).x).toBe(1000);
    expect(layerAt(1000).y).toBe(800);
  });

  it('interpolates a scale event', () => {
    const scale: TimelineEvent = {
      id: 'ev-scale',
      type: 'scale',
      layerId: IDS.layerChar,
      startMs: 0,
      endMs: 1000,
      easing: 'linear',
      from: { x: 0.5, y: 0.5 },
      to: { x: 1, y: 1 },
    };
    const layer = evaluateShotAtTime(shotWithEvents([scale]), 500, project).layers.find(
      (candidate) => candidate.id === IDS.layerChar,
    )!;
    expect(layer.scaleX).toBeCloseTo(0.75, 6);
    expect(layer.scaleY).toBeCloseTo(0.75, 6);
  });

  it('interpolates an opacity event between 0 and 1', () => {
    const opacity: TimelineEvent = {
      id: 'ev-opacity',
      type: 'opacity',
      layerId: IDS.layerChar,
      startMs: 0,
      endMs: 1000,
      easing: 'linear',
      from: 0,
      to: 1,
    };
    const layerAt = (t: number) =>
      evaluateShotAtTime(shotWithEvents([opacity]), t, project).layers.find(
        (candidate) => candidate.id === IDS.layerChar,
      )!;
    expect(layerAt(0).opacity).toBe(0);
    expect(layerAt(500).opacity).toBeCloseTo(0.5, 6);
    expect(layerAt(1000).opacity).toBe(1);
  });

  it('adds a sinusoidal shake offset while the event is active', () => {
    const shake: TimelineEvent = {
      id: 'ev-shake',
      type: 'shake',
      layerId: IDS.layerChar,
      startMs: 0,
      endMs: 1000,
      amplitudeX: 24,
      amplitudeY: 0,
      frequencyHz: 6,
    };
    const layerAt = (t: number) =>
      evaluateShotAtTime(shotWithEvents([shake]), t, project).layers.find(
        (candidate) => candidate.id === IDS.layerChar,
      )!;
    // At start there is no offset.
    expect(layerAt(0).x).toBe(500);
    // At 125ms the sine reaches -1, so x = 500 - 24 = 476.
    expect(layerAt(125).x).toBe(476);
  });

  it('applies flip and visibility flags', () => {
    const flip: TimelineEvent = {
      id: 'ev-flip',
      type: 'flip',
      layerId: IDS.layerChar,
      startMs: 0,
      endMs: 500,
      axis: 'horizontal',
      flipped: true,
    };
    const visibility: TimelineEvent = {
      id: 'ev-visibility',
      type: 'visibility',
      layerId: IDS.layerChar,
      startMs: 0,
      endMs: 500,
      visible: false,
    };
    const layer = evaluateShotAtTime(
      shotWithEvents([flip, visibility]),
      250,
      project,
    ).layers.find((candidate) => candidate.id === IDS.layerChar)!;
    expect(layer.flipX).toBe(true);
    expect(layer.visible).toBe(false);
  });

  it('resolves a valid expression event to the expression asset', () => {
    const expression: TimelineEvent = {
      id: 'ev-expression',
      type: 'expression',
      layerId: IDS.layerChar,
      startMs: 0,
      endMs: 1000,
      expressionId: IDS.expressionAngry,
    };
    const layer = evaluateShotAtTime(
      shotWithEvents([expression]),
      500,
      project,
    ).layers.find((candidate) => candidate.id === IDS.layerChar)!;
    expect(layer.assetId).toBe(IDS.assetChar2);
  });

  it('R6: an invalid expression id falls back to the layer base expression (no throw)', () => {
    const expression: TimelineEvent = {
      id: 'ev-expression',
      type: 'expression',
      layerId: IDS.layerChar,
      startMs: 0,
      endMs: 1000,
      expressionId: IDS.unknownExpression,
    };
    const evaluated = evaluateShotAtTime(
      shotWithEvents([expression]),
      500,
      project,
    );
    const layer = evaluated.layers.find(
      (candidate) => candidate.id === IDS.layerChar,
    )!;
    // The unknown expression is not part of the character; fall back to the
    // layer base expressionNormal -> assetChar.
    expect(layer.assetId).toBe(IDS.assetChar);
  });

  it('carries the background layer id and sorts layers by zIndex', () => {
    const evaluated = evaluateShotAtTime(shot, 0, project);
    expect(evaluated.backgroundLayerId).toBe(IDS.layerBg);
    expect(evaluated.layers.map((layer) => layer.zIndex)).toEqual([0, 1, 2]);
  });
});

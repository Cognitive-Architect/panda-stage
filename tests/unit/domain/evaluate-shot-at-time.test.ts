import { describe, expect, it } from 'vitest';
import { evaluateShotAtTime } from '../../../src/domain';
import type { EvaluatedLayer, Project, Shot, TimelineEvent } from '../../../src/domain';
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
    // The persisted end boundary is the settled position for composition.
    expect(layerAt(1000).x).toBe(500);
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

describe('T02 evaluateShotAtTime — time semantics (before / in / after, no revert)', () => {
  const project: Project = buildProject();

  function evalChar(t: number, events: readonly TimelineEvent[]): EvaluatedLayer {
    const shot = shotWithEvents(events);
    return evaluateShotAtTime(shot, t, project).layers.find(
      (layer) => layer.id === IDS.layerChar,
    )!;
  }

  function exprEvent(
    startMs: number,
    endMs: number,
    expressionId: string,
    id = 'ev-expr',
  ): TimelineEvent {
    return {
      id,
      type: 'expression',
      layerId: IDS.layerChar,
      startMs,
      endMs,
      expressionId,
    } as TimelineEvent;
  }
  function flipEvent(
    startMs: number,
    endMs: number,
    flipped: boolean,
    id = 'ev-flip',
  ): TimelineEvent {
    return {
      id,
      type: 'flip',
      layerId: IDS.layerChar,
      startMs,
      endMs,
      axis: 'horizontal',
      flipped,
    } as TimelineEvent;
  }
  function visEvent(
    startMs: number,
    endMs: number,
    visible: boolean,
    id = 'ev-vis',
  ): TimelineEvent {
    return {
      id,
      type: 'visibility',
      layerId: IDS.layerChar,
      startMs,
      endMs,
      visible,
    } as TimelineEvent;
  }
  function moveEvent(
    startMs: number,
    endMs: number,
    from = { x: 500, y: 600 },
    to = { x: 1000, y: 600 },
    id = 'ev-move',
  ): TimelineEvent {
    return {
      id,
      type: 'move',
      layerId: IDS.layerChar,
      startMs,
      endMs,
      easing: 'linear',
      from,
      to,
    } as TimelineEvent;
  }
  function scaleEvent(
    startMs: number,
    endMs: number,
    id = 'ev-scale',
  ): TimelineEvent {
    return {
      id,
      type: 'scale',
      layerId: IDS.layerChar,
      startMs,
      endMs,
      easing: 'linear',
      from: { x: 0.5, y: 0.5 },
      to: { x: 1, y: 1 },
    } as TimelineEvent;
  }
  function opacityEvent(
    startMs: number,
    endMs: number,
    from = 1,
    to = 0,
    id = 'ev-opacity',
  ): TimelineEvent {
    return {
      id,
      type: 'opacity',
      layerId: IDS.layerChar,
      startMs,
      endMs,
      easing: 'linear',
      from,
      to,
    } as TimelineEvent;
  }

  // --- expression ---
  it('expression: before=base, during=target, after=final', () => {
    const ev = exprEvent(500, 1500, IDS.expressionAngry);
    expect(evalChar(100, [ev]).assetId).toBe(IDS.assetChar);
    expect(evalChar(1000, [ev]).assetId).toBe(IDS.assetChar2);
    expect(evalChar(2000, [ev]).assetId).toBe(IDS.assetChar2);
  });

  it('expression: two consecutive events do not revert to base', () => {
    const a = exprEvent(500, 1500, IDS.expressionAngry, 'a');
    const b = exprEvent(1500, 2500, IDS.expressionNormal, 'b');
    expect(evalChar(1000, [a, b]).assetId).toBe(IDS.assetChar2);
    expect(evalChar(2000, [a, b]).assetId).toBe(IDS.assetChar);
    expect(evalChar(2800, [a, b]).assetId).toBe(IDS.assetChar);
  });

  // --- flip ---
  it('flip: before=base, during=target, after=final', () => {
    const ev = flipEvent(500, 1500, true);
    expect(evalChar(100, [ev]).flipX).toBe(false);
    expect(evalChar(1000, [ev]).flipX).toBe(true);
    expect(evalChar(2000, [ev]).flipX).toBe(true);
  });

  it('flip: two consecutive events do not revert', () => {
    const a = flipEvent(500, 1500, true, 'a');
    const b = flipEvent(1500, 2500, false, 'b');
    expect(evalChar(1000, [a, b]).flipX).toBe(true);
    expect(evalChar(2000, [a, b]).flipX).toBe(false);
    expect(evalChar(2800, [a, b]).flipX).toBe(false);
  });

  // --- visibility ---
  it('visibility: before=base, during=target, after=final', () => {
    const ev = visEvent(500, 1500, false);
    expect(evalChar(100, [ev]).visible).toBe(true);
    expect(evalChar(1000, [ev]).visible).toBe(false);
    expect(evalChar(2000, [ev]).visible).toBe(false);
  });

  it('visibility: two consecutive events do not revert', () => {
    const a = visEvent(500, 1500, false, 'a');
    const b = visEvent(1500, 2500, true, 'b');
    expect(evalChar(1000, [a, b]).visible).toBe(false);
    expect(evalChar(2000, [a, b]).visible).toBe(true);
    expect(evalChar(2800, [a, b]).visible).toBe(true);
  });

  // --- move ---
  it('move: before=base, during=interpolated, after=final', () => {
    const ev = moveEvent(500, 1500);
    expect(evalChar(100, [ev]).x).toBe(500);
    expect(evalChar(1000, [ev]).x).toBeCloseTo(750, 6);
    expect(evalChar(2000, [ev]).x).toBe(1000);
  });

  it('move: two consecutive events do not revert', () => {
    const a = moveEvent(500, 1500, { x: 500, y: 600 }, { x: 1000, y: 600 }, 'a');
    const b = moveEvent(
      1500,
      2500,
      { x: 1000, y: 600 },
      { x: 1500, y: 600 },
      'b',
    );
    expect(evalChar(1000, [a, b]).x).toBeCloseTo(750, 6);
    expect(evalChar(2000, [a, b]).x).toBeCloseTo(1250, 6);
    expect(evalChar(2800, [a, b]).x).toBe(1500);
  });

  // --- scale ---
  it('scale: before=base, during=interpolated, after=final', () => {
    const ev = scaleEvent(500, 1500);
    expect(evalChar(100, [ev]).scaleX).toBeCloseTo(0.5, 6);
    expect(evalChar(1000, [ev]).scaleX).toBeCloseTo(0.75, 6);
    expect(evalChar(2000, [ev]).scaleX).toBeCloseTo(1, 6);
  });

  // --- opacity ---
  it('opacity: before=base, during=interpolated, after=final', () => {
    const ev = opacityEvent(500, 1500);
    expect(evalChar(100, [ev]).opacity).toBe(1);
    expect(evalChar(1000, [ev]).opacity).toBeCloseTo(0.5, 6);
    expect(evalChar(2000, [ev]).opacity).toBe(0);
  });

  it('opacity: two consecutive events do not revert', () => {
    const a = opacityEvent(500, 1500, 1, 0, 'a');
    const b = opacityEvent(1500, 2500, 0, 1, 'b');
    expect(evalChar(1000, [a, b]).opacity).toBeCloseTo(0.5, 6);
    expect(evalChar(2000, [a, b]).opacity).toBeCloseTo(0.5, 6);
    expect(evalChar(2800, [a, b]).opacity).toBe(1);
  });
});

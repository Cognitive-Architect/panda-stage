import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPresetEvents,
  applyPresetEvents,
  evaluateShotAtTime,
  ProjectSchema,
  type CreatePresetEventsOptions,
  type CreatePresetEventsParams,
} from '../../../../src/domain';
import type { Project, TimelineEvent } from '../../../../src/domain';
import { buildProject, IDS } from '../testProject';

type MoveEvent = Extract<TimelineEvent, { type: 'move' }>;
type ScaleEvent = Extract<TimelineEvent, { type: 'scale' }>;
type OpacityEvent = Extract<TimelineEvent, { type: 'opacity' }>;
type ShakeEvent = Extract<TimelineEvent, { type: 'shake' }>;
type ExpressionEvent = Extract<TimelineEvent, { type: 'expression' }>;

function moveEvent(
  presetId: 'enter-left' | 'enter-right' | 'move-to',
  params: CreatePresetEventsParams = {},
  options: CreatePresetEventsOptions = {},
): MoveEvent {
  return (
    createPresetEvents(PROJECT, SHOT_ID, CHAR_LAYER, presetId, params, options) as MoveEvent[]
  )[0]!;
}

function scaleEvent(
  presetId: 'scale-emphasis',
  params: CreatePresetEventsParams = {},
  options: CreatePresetEventsOptions = {},
): ScaleEvent {
  return (
    createPresetEvents(PROJECT, SHOT_ID, CHAR_LAYER, presetId, params, options) as ScaleEvent[]
  )[0]!;
}

function opacityEvent(
  presetId: 'fade-in' | 'fade-out',
  params: CreatePresetEventsParams = {},
  options: CreatePresetEventsOptions = {},
): OpacityEvent {
  return (
    createPresetEvents(PROJECT, SHOT_ID, CHAR_LAYER, presetId, params, options) as OpacityEvent[]
  )[0]!;
}

function shakeEvent(
  params: CreatePresetEventsParams = {},
  options: CreatePresetEventsOptions = {},
): ShakeEvent {
  return (
    createPresetEvents(PROJECT, SHOT_ID, CHAR_LAYER, 'shake', params, options) as ShakeEvent[]
  )[0]!;
}

function expressionEvent(
  params: CreatePresetEventsParams,
  options: CreatePresetEventsOptions = {},
): ExpressionEvent {
  return (
    createPresetEvents(PROJECT, SHOT_ID, CHAR_LAYER, 'expression-switch', params, options) as ExpressionEvent[]
  )[0]!;
}

const PROJECT: Project = buildProject();
const SHOT_ID = IDS.shot;
const CHAR_LAYER = IDS.layerChar;
const ASSET_LAYER = IDS.layerAsset;

describe('T05 createPresetEvents', () => {
  it('enter-left starts off-canvas (left) and ends at the layer position', () => {
    const event = moveEvent('enter-left');
    expect(event.type).toBe('move');
    expect(event.startMs).toBe(0);
    expect(event.endMs).toBe(800);
    expect(event.from.x).toBe(-300);
    expect(event.to).toEqual({ x: 500, y: 600 });
    expect(event.easing).toBe('ease-in-out');
  });

  it('enter-right starts off-canvas (right = width + margin)', () => {
    const event = moveEvent('enter-right');
    expect(event.from.x).toBe(1920 + 300);
    expect(event.to.x).toBe(500);
  });

  it('move-to uses the supplied target coordinates', () => {
    const event = moveEvent('move-to', { targetX: 1200, targetY: 700 });
    expect(event.from).toEqual({ x: 500, y: 600 });
    expect(event.to).toEqual({ x: 1200, y: 700 });
  });

  it('scale-emphasis scales around the current scale with the default factor', () => {
    const event = scaleEvent('scale-emphasis');
    expect(event.from).toEqual({ x: 0.5, y: 0.5 });
    expect(event.to).toEqual({ x: 0.65, y: 0.65 });
  });

  it('scale-emphasis honors a custom factor', () => {
    const event = scaleEvent('scale-emphasis', { scaleFactor: 2 });
    expect(event.to).toEqual({ x: 1, y: 1 });
  });

  it('shake defaults to 600ms with amplitude and frequency', () => {
    const event = shakeEvent();
    expect(event.type).toBe('shake');
    expect(event.startMs).toBe(0);
    expect(event.endMs).toBe(600);
    expect(event.amplitudeX).toBe(24);
    expect(event.amplitudeY).toBe(0);
    expect(event.frequencyHz).toBe(6);
  });

  it('fade-in goes 0 -> current opacity; fade-out reverses', () => {
    const fadeIn = opacityEvent('fade-in');
    expect(fadeIn.from).toBe(0);
    expect(fadeIn.to).toBe(1);
    const fadeOut = opacityEvent('fade-out');
    expect(fadeOut.from).toBe(1);
    expect(fadeOut.to).toBe(0);
  });

  it('expression-switch emits a valid event for a character expression', () => {
    const event = expressionEvent({ expressionId: IDS.expressionAngry });
    expect(event.type).toBe('expression');
    expect(event.expressionId).toBe(IDS.expressionAngry);
    expect(event.layerId).toBe(CHAR_LAYER);
  });

  it('expression-switch throws on a non-character layer', () => {
    expect(() =>
      createPresetEvents(PROJECT, SHOT_ID, ASSET_LAYER, 'expression-switch', {
        expressionId: IDS.expressionAngry,
      }),
    ).toThrow(/角色图层/);
  });

  it('expression-switch throws when the expression is not part of the character', () => {
    expect(() =>
      createPresetEvents(PROJECT, SHOT_ID, CHAR_LAYER, 'expression-switch', {
        expressionId: IDS.unknownExpression,
      }),
    ).toThrow(/表情/);
  });

  it('produces unique ids across calls via the provided generator', () => {
    const fixedIds = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ];
    let counter = 0;
    const createId = (): string => fixedIds[counter++]!;
    const a = createPresetEvents(
      PROJECT,
      SHOT_ID,
      CHAR_LAYER,
      'fade-in',
      {},
      { createId },
    );
    const b = createPresetEvents(
      PROJECT,
      SHOT_ID,
      CHAR_LAYER,
      'fade-in',
      {},
      { createId },
    );
    expect(a[0]!.id).not.toBe(b[0]!.id);
    expect(a[0]!.id).toBe(fixedIds[0]);
    expect(b[0]!.id).toBe(fixedIds[1]);
  });

  it('rounds times to integer milliseconds', () => {
    const event = opacityEvent('fade-in', { startMs: 10.6, durationMs: 250.4 });
    expect(Number.isInteger(event.startMs)).toBe(true);
    expect(Number.isInteger(event.endMs)).toBe(true);
    expect(event.startMs).toBe(11);
    expect(event.endMs).toBe(261);
  });

  it('keeps opacity values within 0..1', () => {
    const fadeIn = opacityEvent('fade-in');
    expect(fadeIn.from).toBeGreaterThanOrEqual(0);
    expect(fadeIn.to).toBeLessThanOrEqual(1);
  });
});

describe('T05 createPresetEvents — overlap detection (DEBT-CONFLICT-B25-001)', () => {
  /** Builds a project whose shot already carries the given timeline events. */
  function projectWith(existing: TimelineEvent[]): Project {
    const project = buildProject();
    project.shots[0]!.timelineEvents = existing;
    return project;
  }

  /**
   * Builds a fully valid timeline event for overlap detection. `createPresetEvents`
   * now evaluates the shot at `startMs`, so every pre-existing event must be a
   * schema-valid `TimelineEvent` (the evaluator reads `from`/`to`). Only the
   * kinds exercised by these overlap tests are supported here.
   */
  function existingEvent(
    type: TimelineEvent['type'],
    startMs: number,
    endMs: number,
    id = 'existing-1',
  ): TimelineEvent {
    const base = { id, layerId: IDS.layerChar, startMs, endMs };
    switch (type) {
      case 'move':
        return {
          ...base,
          type,
          from: { x: 0, y: 0 },
          to: { x: 0, y: 0 },
          easing: 'linear',
        } as TimelineEvent;
      case 'shake':
        return {
          ...base,
          type,
          amplitudeX: 10,
          amplitudeY: 0,
          frequencyHz: 5,
        } as TimelineEvent;
      case 'scale':
        return {
          ...base,
          type,
          from: { x: 1, y: 1 },
          to: { x: 1, y: 1 },
          easing: 'linear',
        } as TimelineEvent;
      default:
        throw new Error(`overlap fixture does not support timeline type: ${type}`);
    }
  }

  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('warns when a new move overlaps an existing move (same position property)', () => {
    const project = projectWith([existingEvent('move', 0, 1000)]);
    createPresetEvents(project, SHOT_ID, CHAR_LAYER, 'move-to', { startMs: 500 });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[DEBT-CONFLICT-B25-001]'),
    );
  });

  it('warns when a new move overlaps an existing shake (both position)', () => {
    const project = projectWith([existingEvent('shake', 0, 600)]);
    createPresetEvents(project, SHOT_ID, CHAR_LAYER, 'move-to', { startMs: 100 });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[DEBT-CONFLICT-B25-001]'),
    );
  });

  it('warns when a new scale overlaps an existing scale', () => {
    const project = projectWith([existingEvent('scale', 0, 1000)]);
    createPresetEvents(project, SHOT_ID, CHAR_LAYER, 'scale-emphasis', {
      startMs: 400,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[DEBT-CONFLICT-B25-001]'),
    );
  });

  it('does NOT warn for different properties (move vs scale)', () => {
    const project = projectWith([existingEvent('move', 0, 1000)]);
    createPresetEvents(project, SHOT_ID, CHAR_LAYER, 'scale-emphasis', {
      startMs: 0,
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does NOT warn when intervals just touch (endMs === other startMs)', () => {
    const project = projectWith([existingEvent('move', 0, 1000)]);
    createPresetEvents(project, SHOT_ID, CHAR_LAYER, 'move-to', { startMs: 1000 });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

/**
 * Issue #54 — Problem 1 regression coverage.
 *
 * When several preset events are chained on the same layer, each new event's
 * `from`/`to` must anchor to the layer's *real evaluated* state at its
 * `startMs` (which may already be mid-animation from earlier events), not to
 * the static `Layer` base-state. Every "existing event" here is produced
 * through the real factory chain (`createPresetEvents` → `applyPresetEvents`),
 * never by hand-writing a timeline event object.
 */
describe('T05 createPresetEvents — continuous chaining (Issue #54 P1, real factory chain)', () => {
  // Chained presets intentionally abut or overlap; suppress the
  // DEBT-CONFLICT-B25-001 overlap warning so the suite output stays clean.
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  /** Evaluates the layer on the shot of `project` at time `t`. */
  function evaluatedLayer(
    project: Project,
    layerId: string,
    t: number,
  ) {
    const shot = project.shots.find((candidate) => candidate.id === SHOT_ID)!;
    return evaluateShotAtTime(shot, t, project).layers.find(
      (candidate) => candidate.id === layerId,
    )!;
  }

  it('move → move: second event from equals first event to (no rebound)', () => {
    const a = createPresetEvents(PROJECT, SHOT_ID, CHAR_LAYER, 'move-to', {
      targetX: 1200,
      targetY: 700,
      startMs: 0,
      durationMs: 800,
    });
    const projectAfterA = applyPresetEvents(PROJECT, SHOT_ID, a);
    const b = createPresetEvents(projectAfterA, SHOT_ID, CHAR_LAYER, 'move-to', {
      targetX: 1400,
      targetY: 800,
      startMs: 800,
      durationMs: 800,
    });
    const aMove = a[0] as MoveEvent;
    const bMove = b[0] as MoveEvent;
    expect(bMove.from.x).toBe(aMove.to.x);
    expect(bMove.from.y).toBe(aMove.to.y);

    // Evaluator cross-check: at the boundary the layer sits at A's end value,
    // and the combined timeline is continuous (no snap-back).
    const combined = applyPresetEvents(projectAfterA, SHOT_ID, b);
    expect(evaluatedLayer(combined, CHAR_LAYER, 799).x).toBeCloseTo(
      aMove.to.x,
      2,
    );
    expect(evaluatedLayer(combined, CHAR_LAYER, 800).x).toBe(aMove.to.x);
    expect(evaluatedLayer(combined, CHAR_LAYER, 800).x).toBe(bMove.from.x);
  });

  it('scale → scale: second event from equals first event to (scaleX & scaleY)', () => {
    const a = createPresetEvents(PROJECT, SHOT_ID, CHAR_LAYER, 'scale-emphasis', {
      scaleFactor: 2,
      startMs: 0,
      durationMs: 800,
    });
    const projectAfterA = applyPresetEvents(PROJECT, SHOT_ID, a);
    const b = createPresetEvents(projectAfterA, SHOT_ID, CHAR_LAYER, 'scale-emphasis', {
      scaleFactor: 1.5,
      startMs: 800,
      durationMs: 800,
    });
    const aScale = a[0] as ScaleEvent;
    const bScale = b[0] as ScaleEvent;
    expect(bScale.from.x).toBe(aScale.to.x);
    expect(bScale.from.y).toBe(aScale.to.y);

    const combined = applyPresetEvents(projectAfterA, SHOT_ID, b);
    expect(evaluatedLayer(combined, CHAR_LAYER, 800).scaleX).toBe(aScale.to.x);
    expect(evaluatedLayer(combined, CHAR_LAYER, 800).scaleY).toBe(aScale.to.y);
  });

  it('opacity → opacity: second event from equals first event to', () => {
    // A fades out to 0; B fades out again starting after A. B's `from` must
    // read the real opacity at startMs (0), not the static Layer.opacity (1).
    const a = createPresetEvents(PROJECT, SHOT_ID, CHAR_LAYER, 'fade-out', {
      startMs: 0,
      durationMs: 800,
    });
    const projectAfterA = applyPresetEvents(PROJECT, SHOT_ID, a);
    const b = createPresetEvents(projectAfterA, SHOT_ID, CHAR_LAYER, 'fade-out', {
      startMs: 800,
      durationMs: 800,
    });
    const aOpacity = a[0] as OpacityEvent;
    const bOpacity = b[0] as OpacityEvent;
    expect(bOpacity.from).toBe(aOpacity.to);
    expect(bOpacity.from).toBe(evaluatedLayer(projectAfterA, CHAR_LAYER, 800).opacity);
  });

  it('opacity: fade-in `to` uses the real opacity at startMs, not static base', () => {
    // A fades out to 0; a subsequent fade-in must resolve its `to` to the real
    // state at startMs (0), not the static Layer.opacity (1).
    const a = createPresetEvents(PROJECT, SHOT_ID, CHAR_LAYER, 'fade-out', {
      startMs: 0,
      durationMs: 800,
    });
    const projectAfterA = applyPresetEvents(PROJECT, SHOT_ID, a);
    const b = createPresetEvents(projectAfterA, SHOT_ID, CHAR_LAYER, 'fade-in', {
      startMs: 800,
      durationMs: 800,
    });
    const bOpacity = b[0] as OpacityEvent;
    const realAt800 = evaluatedLayer(projectAfterA, CHAR_LAYER, 800).opacity;
    expect(bOpacity.to).toBe(realAt800);
    expect(realAt800).toBe(0);
  });

  it('enter-left after a prior move lands at the real position at startMs', () => {
    const a = createPresetEvents(PROJECT, SHOT_ID, CHAR_LAYER, 'move-to', {
      targetX: 1200,
      targetY: 700,
      startMs: 0,
      durationMs: 800,
    });
    const projectAfterA = applyPresetEvents(PROJECT, SHOT_ID, a);
    const b = createPresetEvents(projectAfterA, SHOT_ID, CHAR_LAYER, 'enter-left', {
      startMs: 800,
      durationMs: 800,
    });
    const bMove = b[0] as MoveEvent;
    const realAt800 = evaluatedLayer(projectAfterA, CHAR_LAYER, 800);
    expect(bMove.to.x).toBe(realAt800.x);
    expect(bMove.to.y).toBe(realAt800.y);
    expect(bMove.to.x).toBe(1200);
    expect(bMove.to.y).toBe(700);
    expect(bMove.from.x).toBe(-300); // still enters from off-canvas

    // Continuity is verified at B's end: the layer must arrive at the real
    // position (no snap-back to the static base after the prior move).
    const combined = applyPresetEvents(projectAfterA, SHOT_ID, b);
    const endMs = 800 + 800;
    expect(evaluatedLayer(combined, CHAR_LAYER, endMs).x).toBe(realAt800.x);
    expect(evaluatedLayer(combined, CHAR_LAYER, endMs).y).toBe(realAt800.y);
  });

  it('enter-right after a prior move lands at the real position at startMs', () => {
    const a = createPresetEvents(PROJECT, SHOT_ID, CHAR_LAYER, 'move-to', {
      targetX: 1200,
      targetY: 700,
      startMs: 0,
      durationMs: 800,
    });
    const projectAfterA = applyPresetEvents(PROJECT, SHOT_ID, a);
    const b = createPresetEvents(projectAfterA, SHOT_ID, CHAR_LAYER, 'enter-right', {
      startMs: 800,
      durationMs: 800,
    });
    const bMove = b[0] as MoveEvent;
    const realAt800 = evaluatedLayer(projectAfterA, CHAR_LAYER, 800);
    expect(bMove.to.x).toBe(realAt800.x);
    expect(bMove.to.y).toBe(realAt800.y);
    expect(bMove.to.x).toBe(1200);
    expect(bMove.to.y).toBe(700);
    expect(bMove.from.x).toBe(1920 + 300); // still enters from off-canvas

    // Continuity is verified at B's end: the layer must arrive at the real
    // position (no snap-back to the static base after the prior move).
    const combined = applyPresetEvents(projectAfterA, SHOT_ID, b);
    const endMs = 800 + 800;
    expect(evaluatedLayer(combined, CHAR_LAYER, endMs).x).toBe(realAt800.x);
    expect(evaluatedLayer(combined, CHAR_LAYER, endMs).y).toBe(realAt800.y);
  });

  it('no rebound across a time gap between two events (gap moment == A end)', () => {
    const a = createPresetEvents(PROJECT, SHOT_ID, CHAR_LAYER, 'move-to', {
      targetX: 1200,
      targetY: 700,
      startMs: 0,
      durationMs: 800,
    });
    const projectAfterA = applyPresetEvents(PROJECT, SHOT_ID, a);
    // 700ms gap (B starts at 1500, after A ends at 800).
    const b = createPresetEvents(projectAfterA, SHOT_ID, CHAR_LAYER, 'move-to', {
      targetX: 1400,
      targetY: 800,
      startMs: 1500,
      durationMs: 800,
    });
    const aMove = a[0] as MoveEvent;
    const bMove = b[0] as MoveEvent;
    expect(bMove.from.x).toBe(aMove.to.x);
    expect(bMove.from.y).toBe(aMove.to.y);

    const combined = applyPresetEvents(projectAfterA, SHOT_ID, b);
    // In the gap the layer holds A's end value, then B continues from there.
    expect(evaluatedLayer(combined, CHAR_LAYER, 1000).x).toBe(aMove.to.x);
    expect(evaluatedLayer(combined, CHAR_LAYER, 1000).y).toBe(aMove.to.y);
    expect(evaluatedLayer(combined, CHAR_LAYER, 1500).x).toBe(bMove.from.x);
  });

  it('startMs inside a prior event: second from is the interpolated state', () => {
    const a = createPresetEvents(PROJECT, SHOT_ID, CHAR_LAYER, 'move-to', {
      targetX: 1200,
      targetY: 700,
      startMs: 0,
      durationMs: 800,
    });
    const projectAfterA = applyPresetEvents(PROJECT, SHOT_ID, a);
    // B starts mid-A (at 400ms).
    const b = createPresetEvents(projectAfterA, SHOT_ID, CHAR_LAYER, 'move-to', {
      targetX: 1400,
      targetY: 800,
      startMs: 400,
      durationMs: 800,
    });
    const bMove = b[0] as MoveEvent;
    const realAt400 = evaluatedLayer(projectAfterA, CHAR_LAYER, 400);
    expect(bMove.from.x).toBe(realAt400.x);
    expect(bMove.from.y).toBe(realAt400.y);
  });

  it('factory → apply → evaluate survives JSON round-trip identically', () => {
    const a = createPresetEvents(PROJECT, SHOT_ID, CHAR_LAYER, 'move-to', {
      targetX: 1200,
      targetY: 700,
      startMs: 0,
      durationMs: 800,
    });
    const projectAfterA = applyPresetEvents(PROJECT, SHOT_ID, a);
    const b = createPresetEvents(projectAfterA, SHOT_ID, CHAR_LAYER, 'scale-emphasis', {
      scaleFactor: 2,
      startMs: 800,
      durationMs: 800,
    });
    const combined = applyPresetEvents(projectAfterA, SHOT_ID, b);
    const serialized = JSON.parse(JSON.stringify(combined)) as Project;
    for (const t of [0, 400, 800, 1200, 1500]) {
      const before = evaluatedLayer(combined, CHAR_LAYER, t);
      const after = evaluatedLayer(serialized, CHAR_LAYER, t);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
      expect(after.scaleX).toBeCloseTo(before.scaleX, 6);
      expect(after.scaleY).toBeCloseTo(before.scaleY, 6);
      expect(after.opacity).toBeCloseTo(before.opacity, 6);
    }
  });
});

/**
 * Issue #169 — the original acceptance shot contains stale, same-window
 * position events left by earlier enter applications. The regression must be
 * exercised through the real factory -> apply -> formal evaluator chain.
 */
describe('Issue #169 enter preset conflict with existing timeline events', () => {
  const ISSUE169_SHOT_ID = '32ea0805-7007-4461-985a-8e104c8c7774';
  const ISSUE169_LAYER_ID = 'ba2a8ae5-4682-4fbd-8358-cafd4c7fdef3';
  const TARGET_X = 410.0234444259751;
  const TARGET_Y = 628.5109153368794;

  function originalAcceptanceShape(): Project {
    const project = buildProject();
    const baseShot = project.shots[0]!;
    const layers = baseShot.layers.map((layer) =>
      layer.id === CHAR_LAYER
        ? {
            ...layer,
            id: ISSUE169_LAYER_ID,
            name: 'wanqiu',
            x: TARGET_X,
            y: TARGET_Y,
            flipX: true,
          }
        : layer,
    );
    const timelineEvents: TimelineEvent[] = [
      {
        id: '7feaf869-499b-4820-8326-2d7e9228ec78',
        layerId: ISSUE169_LAYER_ID,
        startMs: 0,
        endMs: 800,
        type: 'move',
        from: { x: -300, y: TARGET_Y },
        to: { x: TARGET_X, y: TARGET_Y },
        easing: 'ease-in-out',
      },
      {
        id: 'a512021e-9e8e-48cd-9033-161991dc3f9c',
        layerId: ISSUE169_LAYER_ID,
        startMs: 0,
        endMs: 800,
        type: 'move',
        from: { x: -300, y: TARGET_Y },
        to: { x: -300, y: TARGET_Y },
        easing: 'ease-in-out',
      },
      {
        id: '23c7f359-0638-4c6e-a224-081d3bb50f2f',
        layerId: ISSUE169_LAYER_ID,
        startMs: 0,
        endMs: 800,
        type: 'move',
        from: { x: -300, y: TARGET_Y },
        to: { x: -300, y: TARGET_Y },
        easing: 'ease-in-out',
      },
    ];

    return {
      ...project,
      shots: [
        {
          ...baseShot,
          id: ISSUE169_SHOT_ID,
          layers,
          timelineEvents,
        },
      ],
    };
  }

  function evaluatedTarget(project: Project, timeMs: number) {
    const shot = project.shots[0]!;
    return evaluateShotAtTime(shot, timeMs, project).layers.find(
      (layer) => layer.id === ISSUE169_LAYER_ID,
    )!;
  }

  it.each([
    ['enter-left', -300],
    ['enter-right', 2220],
  ] as const)(
    '%s derives a real destination and wins the original overlapping event conflict',
    (presetId, fromX) => {
      const project = originalAcceptanceShape();
      const event = createPresetEvents(
        project,
        ISSUE169_SHOT_ID,
        ISSUE169_LAYER_ID,
        presetId,
        { startMs: 0, durationMs: 800 },
        { createId: () => '00000000-0000-4000-8000-000000000099' },
      )[0] as MoveEvent;

      // The new event is created by the formal factory, not hand-authored.
      expect(event.from.x).toBe(fromX);
      expect(event.from.y).toBe(TARGET_Y);
      expect(event.to.x).toBe(TARGET_X);
      expect(event.to.y).toBe(TARGET_Y);

      const applied = applyPresetEvents(project, ISSUE169_SHOT_ID, [event]);
      const middle = evaluatedTarget(applied, 400).x;
      const end = evaluatedTarget(applied, 800).x;
      if (presetId === 'enter-left') {
        expect(middle).toBeGreaterThan(fromX);
        expect(middle).toBeLessThan(TARGET_X);
      } else {
        expect(middle).toBeLessThan(fromX);
        expect(middle).toBeGreaterThan(TARGET_X);
      }
      expect(end).toBeCloseTo(TARGET_X, 6);
    },
  );

  it('uses the authored destination when enter starts inside the ambiguous conflict window', () => {
    const project = originalAcceptanceShape();
    const enter = createPresetEvents(
      project,
      ISSUE169_SHOT_ID,
      ISSUE169_LAYER_ID,
      'enter-left',
      { startMs: 400, durationMs: 800 },
      { createId: () => '00000000-0000-4000-8000-000000000100' },
    )[0] as MoveEvent;

    // The pre-existing position events make the evaluated state at 400ms
    // non-unique. The proven contract is therefore the authored destination,
    // not an arbitrary interpolation from the stale winner.
    expect(enter.to).toEqual({ x: TARGET_X, y: TARGET_Y });
    const applied = applyPresetEvents(project, ISSUE169_SHOT_ID, [enter]);
    expect(evaluatedTarget(applied, 800).x).toBeGreaterThan(-300);
    expect(evaluatedTarget(applied, 800).x).toBeLessThan(TARGET_X);
    expect(evaluatedTarget(applied, 1200).x).toBeCloseTo(TARGET_X, 6);
  });

  it('keeps an enter destination across a gap instead of reverting to the authored base', () => {
    const project = buildProject();
    const priorMove = createPresetEvents(
      project,
      SHOT_ID,
      CHAR_LAYER,
      'move-to',
      { targetX: 1200, targetY: 700, startMs: 0, durationMs: 800 },
      { createId: () => '00000000-0000-4000-8000-000000000101' },
    );
    const afterPriorMove = applyPresetEvents(project, SHOT_ID, priorMove);
    const enter = createPresetEvents(
      afterPriorMove,
      SHOT_ID,
      CHAR_LAYER,
      'enter-left',
      { startMs: 1500, durationMs: 800 },
      { createId: () => '00000000-0000-4000-8000-000000000102' },
    )[0] as MoveEvent;

    // The 700ms gap must not make the factory fall back to the static layer
    // base (500, 600); it must retain the evaluated state from the prior move.
    expect(enter.to).toEqual({ x: 1200, y: 700 });
    const applied = applyPresetEvents(afterPriorMove, SHOT_ID, [enter]);
    const end = evaluateShotAtTime(
      applied.shots.find((shot) => shot.id === SHOT_ID)!,
      2300,
      applied,
    ).layers.find(
      (layer) => layer.id === CHAR_LAYER,
    )!;
    expect(end.x).toBe(1200);
    expect(end.y).toBe(700);
  });

  it('preserves the generated conflict semantics through schema serialization and reopen', () => {
    const project = originalAcceptanceShape();
    const enter = createPresetEvents(
      project,
      ISSUE169_SHOT_ID,
      ISSUE169_LAYER_ID,
      'enter-right',
      { startMs: 0, durationMs: 800 },
      { createId: () => '00000000-0000-4000-8000-000000000103' },
    );
    const applied = applyPresetEvents(project, ISSUE169_SHOT_ID, enter);
    const reopened = ProjectSchema.parse(JSON.parse(JSON.stringify(applied)));

    for (const timeMs of [0, 400, 800]) {
      expect(evaluatedTarget(reopened, timeMs).x).toBeCloseTo(
        evaluatedTarget(applied, timeMs).x,
        6,
      );
      expect(evaluatedTarget(reopened, timeMs).y).toBeCloseTo(
        evaluatedTarget(applied, timeMs).y,
        6,
      );
    }
  });
});

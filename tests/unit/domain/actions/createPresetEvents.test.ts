import { describe, expect, it } from 'vitest';
import {
  createPresetEvents,
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

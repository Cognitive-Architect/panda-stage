import { describe, expect, it } from 'vitest';
import { validatePresetApplication } from '../../../../src/domain';
import type { Project, TimelineEvent } from '../../../../src/domain';
import { buildProject, IDS } from '../testProject';

const PROJECT: Project = buildProject();
const SHOT_ID = IDS.shot;

function opacityEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 'ev-1',
    type: 'opacity',
    layerId: IDS.layerChar,
    startMs: 0,
    endMs: 500,
    from: 0,
    to: 1,
    easing: 'linear',
    ...overrides,
  } as TimelineEvent;
}

describe('T06 validatePresetApplication', () => {
  it('accepts a valid opacity event', () => {
    const result = validatePresetApplication(PROJECT, SHOT_ID, IDS.layerChar, [
      opacityEvent(),
    ]);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects events ending beyond the shot duration with a Chinese reason', () => {
    const result = validatePresetApplication(PROJECT, SHOT_ID, IDS.layerChar, [
      opacityEvent({ endMs: 3001 }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((message) => message.includes('超出镜头时长'))).toBe(
      true,
    );
  });

  it('rejects a duplicate event id', () => {
    const result = validatePresetApplication(PROJECT, SHOT_ID, IDS.layerChar, [
      opacityEvent({ id: 'dup' }),
      opacityEvent({ id: 'dup', endMs: 400 }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((message) => message.includes('事件 ID 重复'))).toBe(
      true,
    );
  });

  it('rejects an event whose layerId does not match the selected layer', () => {
    const result = validatePresetApplication(PROJECT, SHOT_ID, IDS.layerChar, [
      opacityEvent({ layerId: IDS.layerAsset }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((message) => message.includes('layerId'))).toBe(true);
  });

  it('rejects a background layer application', () => {
    const result = validatePresetApplication(PROJECT, SHOT_ID, IDS.layerBg, [
      opacityEvent({ layerId: IDS.layerBg }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((message) => message.includes('背景图层'))).toBe(
      true,
    );
  });

  it('rejects an expression event with an unknown expression', () => {
    const expr: TimelineEvent = {
      id: 'ev-x',
      type: 'expression',
      layerId: IDS.layerChar,
      startMs: 0,
      endMs: 500,
      expressionId: 'e-9',
    };
    const result = validatePresetApplication(PROJECT, SHOT_ID, IDS.layerChar, [expr]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((message) => message.includes('表情'))).toBe(true);
  });

  it('rejects an out-of-range opacity value', () => {
    const result = validatePresetApplication(PROJECT, SHOT_ID, IDS.layerChar, [
      opacityEvent({ from: -0.5, to: 1 }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((message) => message.includes('范围'))).toBe(true);
  });

  it('rejects when the shot does not exist', () => {
    const result = validatePresetApplication(PROJECT, 'missing', IDS.layerChar, [
      opacityEvent(),
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects a new event whose id collides with an existing shot event', () => {
    // Use a fresh project so we don't mutate the shared PROJECT fixture.
    const project = buildProject();
    const shot = project.shots.find((candidate) => candidate.id === SHOT_ID)!;
    shot.timelineEvents = [
      {
        id: 'existing-dup',
        type: 'opacity',
        layerId: IDS.layerChar,
        startMs: 0,
        endMs: 400,
        from: 0,
        to: 1,
        easing: 'linear',
      } as TimelineEvent,
    ];
    const result = validatePresetApplication(project, SHOT_ID, IDS.layerChar, [
      opacityEvent({ id: 'existing-dup' }),
    ]);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((message) => message.includes('事件 ID 重复')),
    ).toBe(true);
  });

  it('accepts unique ids that do not collide with existing shot events', () => {
    const project = buildProject();
    const shot = project.shots.find((candidate) => candidate.id === SHOT_ID)!;
    shot.timelineEvents = [
      {
        id: 'existing-1',
        type: 'opacity',
        layerId: IDS.layerChar,
        startMs: 0,
        endMs: 400,
        from: 0,
        to: 1,
        easing: 'linear',
      } as TimelineEvent,
    ];
    const result = validatePresetApplication(project, SHOT_ID, IDS.layerChar, [
      opacityEvent({ id: 'new-a' }),
      opacityEvent({ id: 'new-b', endMs: 350 }),
    ]);
    expect(result.ok).toBe(true);
  });
});

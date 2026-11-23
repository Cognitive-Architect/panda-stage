import { describe, expect, it } from 'vitest';
import exampleProject from '../../../demo-project/project-v1.example.json';
import {
  ExpressionEventSchema,
  FlipEventSchema,
  MoveEventSchema,
  OpacityEventSchema,
  ScaleEventSchema,
  ShakeEventSchema,
  TimelineEventSchema,
  VisibilityEventSchema,
} from '../../../src/domain';

const expectedTypes = [
  'move',
  'scale',
  'opacity',
  'shake',
  'expression',
  'flip',
  'visibility',
] as const;

describe('TimelineEvent discriminated union', () => {
  it('parses all seven MVP event variants from the real example', () => {
    const parsed = exampleProject.shots[0]!.timelineEvents.map((event) =>
      TimelineEventSchema.parse(event),
    );

    expect(parsed.map((event) => event.type)).toEqual(expectedTypes);
    expect(MoveEventSchema.parse(exampleProject.shots[0]!.timelineEvents[0])).toBeTruthy();
    expect(ScaleEventSchema.parse(exampleProject.shots[0]!.timelineEvents[1])).toBeTruthy();
    expect(OpacityEventSchema.parse(exampleProject.shots[0]!.timelineEvents[2])).toBeTruthy();
    expect(ShakeEventSchema.parse(exampleProject.shots[0]!.timelineEvents[3])).toBeTruthy();
    expect(ExpressionEventSchema.parse(exampleProject.shots[0]!.timelineEvents[4])).toBeTruthy();
    expect(FlipEventSchema.parse(exampleProject.shots[0]!.timelineEvents[5])).toBeTruthy();
    expect(VisibilityEventSchema.parse(exampleProject.shots[0]!.timelineEvents[6])).toBeTruthy();
  });

  it('rejects an unknown event type', () => {
    const input = {
      ...structuredClone(exampleProject.shots[0]!.timelineEvents[0]),
      type: 'teleport',
    };

    expect(TimelineEventSchema.safeParse(input).success).toBe(false);
  });

  it('rejects endMs before startMs', () => {
    const input = structuredClone(exampleProject.shots[0]!.timelineEvents[0]!);
    input.startMs = 500;
    input.endMs = 499;
    const result = TimelineEventSchema.safeParse(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ['endMs'] }),
        ]),
      );
    }
  });

  it('accepts a positive-duration character action event', () => {
    const actionEvent = {
      id: '60000000-0000-4000-8000-000000000021',
      type: 'character-action',
      layerId: '60000000-0000-4000-8000-000000000022',
      startMs: 250,
      endMs: 750,
      actionId: '60000000-0000-4000-8000-000000000023',
    };

    expect(TimelineEventSchema.parse(actionEvent)).toEqual(actionEvent);
    expect(TimelineEventSchema.safeParse({ ...actionEvent, endMs: 250 }).success).toBe(false);
  });

  it.each([-1, 1.5])('rejects invalid millisecond value %s', (startMs) => {
    const input = {
      ...structuredClone(exampleProject.shots[0]!.timelineEvents[0]),
      startMs,
    };

    expect(TimelineEventSchema.safeParse(input).success).toBe(false);
  });
});

import { z } from 'zod';
import {
  FiniteNumberSchema,
  IdSchema,
  MillisecondsSchema,
} from './common';

const TimelineEventBaseShape = {
  id: IdSchema,
  layerId: IdSchema,
  startMs: MillisecondsSchema,
  endMs: MillisecondsSchema,
};

const PointSchema = z
  .object({
    x: FiniteNumberSchema,
    y: FiniteNumberSchema,
  })
  .strict();

const ScaleSchema = z
  .object({
    x: FiniteNumberSchema.positive(),
    y: FiniteNumberSchema.positive(),
  })
  .strict();

const EasingSchema = z.enum(['linear', 'ease-in-out']);

const MoveEventV22Schema = z
  .object({
    ...TimelineEventBaseShape,
    type: z.literal('move'),
    from: PointSchema,
    to: PointSchema,
    easing: EasingSchema.default('linear'),
  })
  .strict();

const ScaleEventV22Schema = z
  .object({
    ...TimelineEventBaseShape,
    type: z.literal('scale'),
    from: ScaleSchema,
    to: ScaleSchema,
    easing: EasingSchema.default('linear'),
  })
  .strict();

const OpacityEventV22Schema = z
  .object({
    ...TimelineEventBaseShape,
    type: z.literal('opacity'),
    from: FiniteNumberSchema.min(0).max(1),
    to: FiniteNumberSchema.min(0).max(1),
    easing: EasingSchema.default('linear'),
  })
  .strict();

const ShakeEventV22Schema = z
  .object({
    ...TimelineEventBaseShape,
    type: z.literal('shake'),
    amplitudeX: FiniteNumberSchema.nonnegative(),
    amplitudeY: FiniteNumberSchema.nonnegative(),
    frequencyHz: FiniteNumberSchema.positive(),
  })
  .strict();

const ExpressionEventV22Schema = z
  .object({
    ...TimelineEventBaseShape,
    type: z.literal('expression'),
    expressionId: IdSchema,
  })
  .strict();

const FlipEventV22Schema = z
  .object({
    ...TimelineEventBaseShape,
    type: z.literal('flip'),
    axis: z.enum(['horizontal', 'vertical']),
    flipped: z.boolean(),
  })
  .strict();

const VisibilityEventV22Schema = z
  .object({
    ...TimelineEventBaseShape,
    type: z.literal('visibility'),
    visible: z.boolean(),
  })
  .strict();

export const MouthCueStateSchema = z.enum(['rest', 'open']);
export type MouthCueState = z.infer<typeof MouthCueStateSchema>;

export const MouthCueEventSchema = z
  .object({
    ...TimelineEventBaseShape,
    type: z.literal('mouth-cue'),
    state: MouthCueStateSchema,
  })
  .strict()
  .superRefine((event, context) => {
    if (event.endMs !== event.startMs) {
      context.addIssue({
        code: 'custom',
        message: 'Mouth cue event requires endMs to equal startMs.',
        path: ['endMs'],
      });
    }
  });

export const TimelineEventV22Schema = z
  .discriminatedUnion('type', [
    MoveEventV22Schema,
    ScaleEventV22Schema,
    OpacityEventV22Schema,
    ShakeEventV22Schema,
    ExpressionEventV22Schema,
    FlipEventV22Schema,
    VisibilityEventV22Schema,
  ])
  .superRefine((event, context) => {
    if (event.endMs < event.startMs) {
      context.addIssue({
        code: 'custom',
        message: 'Timeline event endMs must be greater than or equal to startMs.',
        path: ['endMs'],
      });
    }
  });

export const MoveEventSchema = MoveEventV22Schema;
export const ScaleEventSchema = ScaleEventV22Schema;
export const OpacityEventSchema = OpacityEventV22Schema;
export const ShakeEventSchema = ShakeEventV22Schema;
export const ExpressionEventSchema = ExpressionEventV22Schema;
export const FlipEventSchema = FlipEventV22Schema;
export const VisibilityEventSchema = VisibilityEventV22Schema;

/** Current (v23+) Timeline Event union; frozen v22 readers use `TimelineEventV22Schema`. */
export const TimelineEventSchema = z
  .discriminatedUnion('type', [
    MoveEventV22Schema,
    ScaleEventV22Schema,
    OpacityEventV22Schema,
    ShakeEventV22Schema,
    ExpressionEventV22Schema,
    FlipEventV22Schema,
    VisibilityEventV22Schema,
    MouthCueEventSchema,
  ])
  .superRefine((event, context) => {
    if (event.endMs < event.startMs) {
      context.addIssue({
        code: 'custom',
        message: 'Timeline event endMs must be greater than or equal to startMs.',
        path: ['endMs'],
      });
    }
  });

export type MoveEvent = z.infer<typeof MoveEventSchema>;
export type ScaleEvent = z.infer<typeof ScaleEventSchema>;
export type OpacityEvent = z.infer<typeof OpacityEventSchema>;
export type ShakeEvent = z.infer<typeof ShakeEventSchema>;
export type ExpressionEvent = z.infer<typeof ExpressionEventSchema>;
export type FlipEvent = z.infer<typeof FlipEventSchema>;
export type VisibilityEvent = z.infer<typeof VisibilityEventSchema>;
export type MouthCueEvent = z.infer<typeof MouthCueEventSchema>;
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

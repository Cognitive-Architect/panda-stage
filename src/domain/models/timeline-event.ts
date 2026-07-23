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

export const MoveEventSchema = z
  .object({
    ...TimelineEventBaseShape,
    type: z.literal('move'),
    from: PointSchema,
    to: PointSchema,
    easing: EasingSchema.default('linear'),
  })
  .strict();

export const ScaleEventSchema = z
  .object({
    ...TimelineEventBaseShape,
    type: z.literal('scale'),
    from: ScaleSchema,
    to: ScaleSchema,
    easing: EasingSchema.default('linear'),
  })
  .strict();

export const OpacityEventSchema = z
  .object({
    ...TimelineEventBaseShape,
    type: z.literal('opacity'),
    from: FiniteNumberSchema.min(0).max(1),
    to: FiniteNumberSchema.min(0).max(1),
    easing: EasingSchema.default('linear'),
  })
  .strict();

export const ShakeEventSchema = z
  .object({
    ...TimelineEventBaseShape,
    type: z.literal('shake'),
    amplitudeX: FiniteNumberSchema.nonnegative(),
    amplitudeY: FiniteNumberSchema.nonnegative(),
    frequencyHz: FiniteNumberSchema.positive(),
  })
  .strict();

export const ExpressionEventSchema = z
  .object({
    ...TimelineEventBaseShape,
    type: z.literal('expression'),
    expressionId: IdSchema,
  })
  .strict();

export const FlipEventSchema = z
  .object({
    ...TimelineEventBaseShape,
    type: z.literal('flip'),
    axis: z.enum(['horizontal', 'vertical']),
    flipped: z.boolean(),
  })
  .strict();

export const VisibilityEventSchema = z
  .object({
    ...TimelineEventBaseShape,
    type: z.literal('visibility'),
    visible: z.boolean(),
  })
  .strict();

export const TimelineEventSchema = z
  .discriminatedUnion('type', [
    MoveEventSchema,
    ScaleEventSchema,
    OpacityEventSchema,
    ShakeEventSchema,
    ExpressionEventSchema,
    FlipEventSchema,
    VisibilityEventSchema,
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
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

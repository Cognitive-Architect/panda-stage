import { z } from 'zod';
import { AnimationCurveSchema, AnimationInterpolationSchema } from './animationCore';
import { AnimationSourceRangeSchema } from './animationSourceRange';
import { AnimationPlaybackSchema } from './layer';
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
export const OpacityEventSchema = OpacityEventV22Schema.extend({
  easing: AnimationInterpolationSchema.default('linear'),
  curveToNext: AnimationCurveSchema.optional(),
});
export const ShakeEventSchema = ShakeEventV22Schema;
export const ExpressionEventSchema = ExpressionEventV22Schema;
export const FlipEventSchema = FlipEventV22Schema;
export const VisibilityEventSchema = VisibilityEventV22Schema;

const timelineEventOptionsBeforeOpacity = [
    MoveEventV22Schema,
    ScaleEventV22Schema,
    ShakeEventV22Schema,
    ExpressionEventV22Schema,
    FlipEventV22Schema,
    VisibilityEventV22Schema,
    MouthCueEventSchema,
] as const;

const TimelineEventV26Options = [...timelineEventOptionsBeforeOpacity, OpacityEventV22Schema] as const;

function validateRange(event: { startMs: number; endMs: number }, context: z.RefinementCtx) {
    if (event.endMs < event.startMs) {
      context.addIssue({
        code: 'custom',
        message: 'Timeline event endMs must be greater than or equal to startMs.',
        path: ['endMs'],
      });
    }
}

export const TimelineEventV26Schema = z.discriminatedUnion('type', TimelineEventV26Options)
  .superRefine(validateRange);

export const MouthPoseEventSchema = z.object({
  ...TimelineEventBaseShape,
  type: z.literal('mouth-pose'),
  poseId: IdSchema,
  origin: z.enum(['manual', 'generated']),
  dialogueId: IdSchema.optional(),
  generationId: IdSchema.optional(),
}).strict().superRefine((event, context) => {
  if (event.endMs <= event.startMs) {
    context.addIssue({ code: 'custom', path: ['endMs'], message: 'Mouth pose ranges must have positive duration.' });
  }
  if (event.origin === 'generated' && (!event.dialogueId || !event.generationId)) {
    context.addIssue({ code: 'custom', path: ['origin'], message: 'Generated mouth poses require dialogue and generation ids.' });
  }
});

const TimelineEventV27Options = [...TimelineEventV26Options, MouthPoseEventSchema] as const;

/** Frozen current-project timeline events before bounded Character actions. */
export const TimelineEventV27Schema = z.discriminatedUnion('type', TimelineEventV27Options)
  .superRefine(validateRange);

export const CharacterActionEventSchema = z.object({
  ...TimelineEventBaseShape,
  type: z.literal('character-action'),
  actionId: IdSchema,
}).strict().superRefine((event, context) => {
  if (event.endMs <= event.startMs) {
    context.addIssue({ code: 'custom', path: ['endMs'], message: 'Character action ranges must have positive duration.' });
  }
});

const TimelineEventV28Options = [
  ...TimelineEventV27Options,
  CharacterActionEventSchema,
] as const;

export const TimelineEventV28Schema = z.discriminatedUnion('type', TimelineEventV28Options).superRefine(validateRange);

export const GraphicFrameEventSchema = z.object({
  ...TimelineEventBaseShape,
  type: z.literal('graphic-frame'),
  animationId: IdSchema,
  sourceFrameIndex: z.number().int().nonnegative(),
}).strict().superRefine((event, context) => {
  if (event.endMs !== event.startMs) {
    context.addIssue({ code: 'custom', path: ['endMs'], message: 'Graphic frame switches are point events.' });
  }
});

export const TimelineEventV33Schema = z.discriminatedUnion('type', [
  ...TimelineEventV28Options,
  GraphicFrameEventSchema,
]).superRefine(validateRange);

const timelineEventV40Options = [
  ...timelineEventOptionsBeforeOpacity,
  OpacityEventSchema,
  MouthPoseEventSchema,
  CharacterActionEventSchema,
  GraphicFrameEventSchema,
] as const;

export const TimelineEventV40Schema = z.discriminatedUnion('type', timelineEventV40Options).superRefine(validateRange);

export const GraphicPlaybackEventSchema = z.object({
  ...TimelineEventBaseShape,
  type: z.literal('graphic-playback'),
  animationId: IdSchema,
  playbackStartMs: MillisecondsSchema,
  firstFrame: z.number().int().nonnegative(),
  range: AnimationSourceRangeSchema,
  playback: AnimationPlaybackSchema,
}).strict().superRefine((event, context) => {
  if (event.startMs >= event.endMs) {
    context.addIssue({ code: 'custom', path: ['endMs'], message: 'Graphic playback requires a nonempty range.' });
  }
  if (event.playbackStartMs > event.startMs) {
    context.addIssue({ code: 'custom', path: ['playbackStartMs'], message: 'Graphic playback must start by the start of the range.' });
  }
  if (event.firstFrame < event.range.firstFrame || event.firstFrame > event.range.lastFrame) {
    context.addIssue({ code: 'custom', path: ['firstFrame'], message: 'Graphic start frame must be inside its source range.' });
  }
});

export const TimelineEventSchema = z.discriminatedUnion('type', [
  ...timelineEventV40Options,
  GraphicPlaybackEventSchema,
]).superRefine(validateRange);

export type MoveEvent = z.infer<typeof MoveEventSchema>;
export type ScaleEvent = z.infer<typeof ScaleEventSchema>;
export type OpacityEvent = z.infer<typeof OpacityEventSchema>;
export type ShakeEvent = z.infer<typeof ShakeEventSchema>;
export type ExpressionEvent = z.infer<typeof ExpressionEventSchema>;
export type FlipEvent = z.infer<typeof FlipEventSchema>;
export type VisibilityEvent = z.infer<typeof VisibilityEventSchema>;
export type MouthCueEvent = z.infer<typeof MouthCueEventSchema>;
export type MouthPoseEvent = z.infer<typeof MouthPoseEventSchema>;
export type CharacterActionEvent = z.infer<typeof CharacterActionEventSchema>;
export type GraphicFrameEvent = z.infer<typeof GraphicFrameEventSchema>;
export type GraphicPlaybackEvent = z.infer<typeof GraphicPlaybackEventSchema>;
export type TimelineEventV27 = z.infer<typeof TimelineEventV27Schema>;
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

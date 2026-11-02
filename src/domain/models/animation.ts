import { z } from 'zod';
import { IdSchema, NameSchema } from './common';

export const ANIMATION_MAX_FRAMES = 24;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const AnimationFrameSchema = z
  .object({
    ordinal: z.number().int().nonnegative(),
    sourceFrameIndex: z.number().int().nonnegative(),
    assetId: IdSchema,
    sha256: Sha256Schema,
    sourceViewport: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().finite().positive(),
        height: z.number().finite().positive(),
      })
      .strict(),
    offset: z
      .object({ x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative() })
      .strict(),
    startMs: z.number().finite().nonnegative(),
    durationMs: z.number().finite().positive(),
    createdBySequenceImport: z.boolean(),
  })
  .strict();

export const AnimationDefinitionSchema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    source: z
      .object({
        basename: z.string().trim().min(1).max(260),
        sha256: Sha256Schema,
        renderTargetId: z.string().trim().min(1).max(180),
        targetKind: z.enum(['scene', 'timeline', 'graphic-symbol', 'unknown']),
        targetName: z.string().trim().min(1).max(500),
        startFrameIndex: z.number().int().nonnegative(),
        endFrameIndex: z.number().int().nonnegative(),
        sourceFps: z.number().finite().positive().max(1_000),
        canvas: z
          .object({
            width: z.number().finite().positive(),
            height: z.number().finite().positive(),
          })
          .strict(),
        anchor: z
          .object({ x: z.number().finite(), y: z.number().finite() })
          .strict(),
        documentCanvas: z
          .object({
            width: z.number().finite().positive(),
            height: z.number().finite().positive(),
          })
          .strict(),
      })
      .strict(),
    durationMs: z.number().finite().positive(),
    frames: z.array(AnimationFrameSchema).min(1).max(ANIMATION_MAX_FRAMES),
  })
  .strict()
  .superRefine((animation, context) => {
    const expectedCount =
      animation.source.endFrameIndex - animation.source.startFrameIndex + 1;
    if (
      animation.source.startFrameIndex > animation.source.endFrameIndex ||
      expectedCount !== animation.frames.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['frames'],
        message: 'Animation frames must cover the inclusive source range.',
      });
    }

    const frameDurationMs = 1_000 / animation.source.sourceFps;
    animation.frames.forEach((frame, index) => {
      if (frame.ordinal !== index) {
        context.addIssue({
          code: 'custom',
          path: ['frames', index, 'ordinal'],
          message: 'Animation frame ordinals must be contiguous from zero.',
        });
      }
      if (frame.sourceFrameIndex !== animation.source.startFrameIndex + index) {
        context.addIssue({
          code: 'custom',
          path: ['frames', index, 'sourceFrameIndex'],
          message: 'Animation source frame indices must match the inclusive range.',
        });
      }
      if (Math.abs(frame.startMs - index * frameDurationMs) > 0.001) {
        context.addIssue({
          code: 'custom',
          path: ['frames', index, 'startMs'],
          message: 'Animation frame start time must follow the source FPS.',
        });
      }
      if (Math.abs(frame.durationMs - frameDurationMs) > 0.001) {
        context.addIssue({
          code: 'custom',
          path: ['frames', index, 'durationMs'],
          message: 'Animation frame timing must follow the source FPS.',
        });
      }
      if (
        Math.abs(frame.offset.x - (frame.sourceViewport.x - animation.source.anchor.x)) > 0.001 ||
        Math.abs(frame.offset.y - (frame.sourceViewport.y - animation.source.anchor.y)) > 0.001 ||
        frame.offset.x + frame.sourceViewport.width > animation.source.canvas.width + 0.001 ||
        frame.offset.y + frame.sourceViewport.height > animation.source.canvas.height + 0.001
      ) {
        context.addIssue({
          code: 'custom',
          path: ['frames', index, 'offset'],
          message: 'Animation frame viewport must fit the common canvas at its trusted offset.',
        });
      }
    });

    const expectedDurationMs = animation.frames.length * frameDurationMs;
    if (Math.abs(animation.durationMs - expectedDurationMs) > 0.001) {
      context.addIssue({
        code: 'custom',
        path: ['durationMs'],
        message: 'Animation duration must equal frame count divided by source FPS.',
      });
    }
  });

export type AnimationFrame = z.infer<typeof AnimationFrameSchema>;
export type AnimationDefinition = z.infer<typeof AnimationDefinitionSchema>;

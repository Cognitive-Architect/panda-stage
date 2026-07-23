import { z } from 'zod';
import {
  PROJECT_FPS,
  PROJECT_HEIGHT,
  PROJECT_WIDTH,
} from '../constants';
import {
  FiniteNumberSchema,
  IdSchema,
  IsoDateTimeSchema,
  MillisecondsSchema,
  NameSchema,
  PositiveMillisecondsSchema,
  RelativeProjectPathSchema,
} from '../models/common';

const LegacyAssetSchema = z
  .discriminatedUnion('kind', [
    z
      .object({
        id: IdSchema,
        kind: z.literal('image'),
        name: NameSchema,
        relativePath: RelativeProjectPathSchema,
        mimeType: z.string().trim().min(1),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .strict(),
    z
      .object({
        id: IdSchema,
        kind: z.literal('audio'),
        name: NameSchema,
        relativePath: RelativeProjectPathSchema,
        mimeType: z.string().trim().min(1),
        durationMs: PositiveMillisecondsSchema,
      })
      .strict(),
  ]);

const LegacyLayerSchema = z
  .object({
    id: IdSchema,
    assetId: IdSchema,
    name: NameSchema,
    anchor: z.literal('center'),
    x: FiniteNumberSchema,
    y: FiniteNumberSchema,
    scaleX: FiniteNumberSchema.positive().default(1),
    scaleY: FiniteNumberSchema.positive().default(1),
    rotationDeg: FiniteNumberSchema.default(0),
    opacity: FiniteNumberSchema.min(0).max(1).default(1),
    visible: z.boolean().default(true),
    zIndex: z.number().int().nonnegative(),
  })
  .strict();

const LegacyMoveEventSchema = z
  .object({
    id: IdSchema,
    type: z.literal('move'),
    layerId: IdSchema,
    startMs: MillisecondsSchema,
    durationMs: PositiveMillisecondsSchema,
    from: z
      .object({ x: FiniteNumberSchema, y: FiniteNumberSchema })
      .strict(),
    to: z
      .object({ x: FiniteNumberSchema, y: FiniteNumberSchema })
      .strict(),
    easing: z.enum(['linear', 'ease-in-out']).default('linear'),
  })
  .strict();

const LegacyShotSchema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    durationMs: PositiveMillisecondsSchema,
    layers: z.array(LegacyLayerSchema),
    timelineEvents: z.array(LegacyMoveEventSchema),
  })
  .strict()
  .superRefine((shot, context) => {
    const layerIds = new Set(shot.layers.map((layer) => layer.id));
    shot.timelineEvents.forEach((event, eventIndex) => {
      if (!layerIds.has(event.layerId)) {
        context.addIssue({
          code: 'custom',
          path: ['timelineEvents', eventIndex, 'layerId'],
          message: `Legacy event references unknown layer: ${event.layerId}`,
        });
      }
      if (event.startMs + event.durationMs > shot.durationMs) {
        context.addIssue({
          code: 'custom',
          path: ['timelineEvents', eventIndex, 'durationMs'],
          message: 'Legacy event must end within the shot duration.',
        });
      }
    });
  });

const LegacyProjectShape = {
  id: IdSchema,
  name: NameSchema,
  width: z.literal(PROJECT_WIDTH),
  height: z.literal(PROJECT_HEIGHT),
  fps: z.literal(PROJECT_FPS),
  assets: z.array(LegacyAssetSchema),
  shots: z.array(LegacyShotSchema),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
};

function withReferenceValidation<T extends 0 | 1>(
  schemaVersion: T,
): z.ZodType<LegacyProject<T>> {
  return z
    .object({
      schemaVersion: z.literal(schemaVersion),
      ...LegacyProjectShape,
    })
    .strict()
    .superRefine((project, context) => {
      const imageAssetIds = new Set(
        project.assets
          .filter((asset) => asset.kind === 'image')
          .map((asset) => asset.id),
      );
      project.shots.forEach((shot, shotIndex) => {
        shot.layers.forEach((layer, layerIndex) => {
          if (!imageAssetIds.has(layer.assetId)) {
            context.addIssue({
              code: 'custom',
              path: ['shots', shotIndex, 'layers', layerIndex, 'assetId'],
              message: `Legacy layer references unknown image asset: ${layer.assetId}`,
            });
          }
        });
      });
    });
}

export const ProjectV0Schema = withReferenceValidation(0);
export const LegacyProbeProjectV1Schema = withReferenceValidation(1);

export type LegacyProject<T extends 0 | 1> = {
  schemaVersion: T;
  id: z.infer<typeof IdSchema>;
  name: string;
  width: typeof PROJECT_WIDTH;
  height: typeof PROJECT_HEIGHT;
  fps: typeof PROJECT_FPS;
  assets: z.infer<typeof LegacyAssetSchema>[];
  shots: z.infer<typeof LegacyShotSchema>[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectV0 = z.infer<typeof ProjectV0Schema>;
export type LegacyProbeProjectV1 = z.infer<
  typeof LegacyProbeProjectV1Schema
>;

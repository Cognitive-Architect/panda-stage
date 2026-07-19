import { z } from 'zod';
import {
  PROJECT_FPS,
  PROJECT_HEIGHT,
  PROJECT_SCHEMA_VERSION,
  PROJECT_WIDTH,
} from './constants';

const IdSchema = z.uuid();
const NameSchema = z.string().trim().min(1).max(200);
const IntegerMillisecondsSchema = z.number().int().nonnegative();
const DurationMillisecondsSchema = z.number().int().positive();
const FiniteNumberSchema = z.number().finite();

export const AssetSchema = z
  .object({
    id: IdSchema,
    kind: z.enum(['image', 'audio']),
    name: NameSchema,
    relativePath: z
      .string()
      .trim()
      .min(1)
      .refine((value) => !/^(?:[a-zA-Z]:[\\/]|[\\/])/.test(value), {
        message: 'Asset paths must be relative to the project directory.',
      })
      .refine(
        (value) =>
          !value
            .replaceAll('\\', '/')
            .split('/')
            .some((segment) => segment === '..'),
        { message: 'Asset paths cannot traverse outside the project directory.' },
      ),
    mimeType: z.string().trim().min(1),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    durationMs: DurationMillisecondsSchema.optional(),
  })
  .superRefine((asset, context) => {
    if (asset.kind === 'image' && (!asset.width || !asset.height)) {
      context.addIssue({
        code: 'custom',
        message: 'Image assets require positive width and height.',
      });
    }

    if (asset.kind === 'audio' && !asset.durationMs) {
      context.addIssue({
        code: 'custom',
        message: 'Audio assets require a positive durationMs.',
      });
    }
  });

export const LayerSchema = z.object({
  id: IdSchema,
  assetId: IdSchema,
  name: NameSchema,
  /** x/y always describe the visual center of the layer. */
  anchor: z.literal('center'),
  x: FiniteNumberSchema,
  y: FiniteNumberSchema,
  scaleX: FiniteNumberSchema.positive().default(1),
  scaleY: FiniteNumberSchema.positive().default(1),
  rotationDeg: FiniteNumberSchema.default(0),
  opacity: FiniteNumberSchema.min(0).max(1).default(1),
  visible: z.boolean().default(true),
  zIndex: z.number().int().nonnegative(),
});

export const MoveEventSchema = z.object({
  id: IdSchema,
  type: z.literal('move'),
  layerId: IdSchema,
  startMs: IntegerMillisecondsSchema,
  durationMs: DurationMillisecondsSchema,
  from: z.object({
    x: FiniteNumberSchema,
    y: FiniteNumberSchema,
  }),
  to: z.object({
    x: FiniteNumberSchema,
    y: FiniteNumberSchema,
  }),
  easing: z.enum(['linear', 'ease-in-out']).default('linear'),
});

export const TimelineEventSchema = MoveEventSchema;

export const ShotSchema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    durationMs: DurationMillisecondsSchema,
    layers: z.array(LayerSchema),
    timelineEvents: z.array(TimelineEventSchema),
  })
  .superRefine((shot, context) => {
    const layerIds = new Set<string>();
    const eventIds = new Set<string>();

    shot.layers.forEach((layer, index) => {
      if (layerIds.has(layer.id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate layer id: ${layer.id}`,
          path: ['layers', index, 'id'],
        });
      }
      layerIds.add(layer.id);
    });

    shot.timelineEvents.forEach((event, index) => {
      if (eventIds.has(event.id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate timeline event id: ${event.id}`,
          path: ['timelineEvents', index, 'id'],
        });
      }
      eventIds.add(event.id);

      if (!layerIds.has(event.layerId)) {
        context.addIssue({
          code: 'custom',
          message: `Timeline event references unknown layer: ${event.layerId}`,
          path: ['timelineEvents', index, 'layerId'],
        });
      }

      if (event.startMs + event.durationMs > shot.durationMs) {
        context.addIssue({
          code: 'custom',
          message: 'Timeline event must end within the shot duration.',
          path: ['timelineEvents', index, 'durationMs'],
        });
      }
    });
  });

const IsoDateTimeSchema = z.iso.datetime({ offset: true });

export const ProjectSchema = z
  .object({
    schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
    id: IdSchema,
    name: NameSchema,
    width: z.literal(PROJECT_WIDTH),
    height: z.literal(PROJECT_HEIGHT),
    fps: z.literal(PROJECT_FPS),
    assets: z.array(AssetSchema),
    shots: z.array(ShotSchema),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .superRefine((project, context) => {
    const assetsById = new Map(project.assets.map((asset) => [asset.id, asset]));
    const assetIds = new Set<string>();
    const shotIds = new Set<string>();

    project.assets.forEach((asset, index) => {
      if (assetIds.has(asset.id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate asset id: ${asset.id}`,
          path: ['assets', index, 'id'],
        });
      }
      assetIds.add(asset.id);
    });

    project.shots.forEach((shot, shotIndex) => {
      if (shotIds.has(shot.id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate shot id: ${shot.id}`,
          path: ['shots', shotIndex, 'id'],
        });
      }
      shotIds.add(shot.id);

      shot.layers.forEach((layer, layerIndex) => {
        const asset = assetsById.get(layer.assetId);
        if (!asset) {
          context.addIssue({
            code: 'custom',
            message: `Layer references unknown asset: ${layer.assetId}`,
            path: ['shots', shotIndex, 'layers', layerIndex, 'assetId'],
          });
        } else if (asset.kind !== 'image') {
          context.addIssue({
            code: 'custom',
            message: 'Layers can only reference image assets.',
            path: ['shots', shotIndex, 'layers', layerIndex, 'assetId'],
          });
        }
      });
    });
  });

export type Asset = z.infer<typeof AssetSchema>;
export type Layer = z.infer<typeof LayerSchema>;
export type MoveEvent = z.infer<typeof MoveEventSchema>;
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;
export type Shot = z.infer<typeof ShotSchema>;
export type Project = z.infer<typeof ProjectSchema>;

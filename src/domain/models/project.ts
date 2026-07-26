import { z } from 'zod';
import {
  PROJECT_FPS,
  PROJECT_HEIGHT,
  PROJECT_SCHEMA_VERSION,
  PROJECT_WIDTH,
} from '../constants';
import { validateProjectReferences } from '../validators/projectReferences';
import { AssetSchema, type Asset } from './asset';
import { CharacterSchema, VoiceProfileSchema } from './character';
import { IdSchema, IsoDateTimeSchema, NameSchema } from './common';
import type { Layer, LayerV3, LayerV4 } from './layer';
import {
  ShotSchema,
  ShotV2Schema,
  ShotV3Schema,
  ShotV4Schema,
} from './shot';
import { SubtitleStyleSchema } from './subtitle';

const CharacterExpressionV1Schema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    assetId: IdSchema,
  })
  .strict();

const CharacterV1Schema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    baseAssetId: IdSchema,
    defaultVoiceProfileId: IdSchema,
    expressions: z.array(CharacterExpressionV1Schema).min(1),
  })
  .strict();

const ProjectDataSchema = z
  .object({
    schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
    id: IdSchema,
    name: NameSchema,
    width: z.literal(PROJECT_WIDTH),
    height: z.literal(PROJECT_HEIGHT),
    fps: z.literal(PROJECT_FPS),
    assets: z.array(AssetSchema),
    characters: z.array(CharacterSchema),
    voiceProfiles: z.array(VoiceProfileSchema),
    subtitleStyles: z.array(SubtitleStyleSchema).min(1),
    shots: z.array(ShotSchema),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export const ProjectV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    id: IdSchema,
    name: NameSchema,
    width: z.literal(PROJECT_WIDTH),
    height: z.literal(PROJECT_HEIGHT),
    fps: z.literal(PROJECT_FPS),
    assets: z.array(AssetSchema),
    characters: z.array(CharacterV1Schema),
    voiceProfiles: z.array(VoiceProfileSchema),
    subtitleStyles: z.array(SubtitleStyleSchema).min(1),
    shots: z.array(ShotV2Schema),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export const ProjectV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    id: IdSchema,
    name: NameSchema,
    width: z.literal(PROJECT_WIDTH),
    height: z.literal(PROJECT_HEIGHT),
    fps: z.literal(PROJECT_FPS),
    assets: z.array(AssetSchema),
    characters: z.array(CharacterSchema),
    voiceProfiles: z.array(VoiceProfileSchema),
    subtitleStyles: z.array(SubtitleStyleSchema).min(1),
    shots: z.array(ShotV2Schema),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export const ProjectV3Schema = z
  .object({
    schemaVersion: z.literal(3),
    id: IdSchema,
    name: NameSchema,
    width: z.literal(PROJECT_WIDTH),
    height: z.literal(PROJECT_HEIGHT),
    fps: z.literal(PROJECT_FPS),
    assets: z.array(AssetSchema),
    characters: z.array(CharacterSchema),
    voiceProfiles: z.array(VoiceProfileSchema),
    subtitleStyles: z.array(SubtitleStyleSchema).min(1),
    shots: z.array(ShotV3Schema),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export const ProjectV4Schema = z
  .object({
    schemaVersion: z.literal(4),
    id: IdSchema,
    name: NameSchema,
    width: z.literal(PROJECT_WIDTH),
    height: z.literal(PROJECT_HEIGHT),
    fps: z.literal(PROJECT_FPS),
    assets: z.array(AssetSchema),
    characters: z.array(CharacterSchema),
    voiceProfiles: z.array(VoiceProfileSchema),
    subtitleStyles: z.array(SubtitleStyleSchema).min(1),
    shots: z.array(ShotV4Schema),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

const LEGACY_BACKGROUND_MIN_WIDTH_RATIO = 0.75;
const LEGACY_BACKGROUND_MIN_HEIGHT_RATIO = 0.75;

/**
 * V1/V2 had no background identity. Migration conservatively preserves a
 * single centered, direct-image layer that is large on both axes; ambiguous
 * shots migrate to null. Runtime background resolution never calls this
 * compatibility helper.
 */
export function inferLegacyBackgroundLayerId(
  assets: readonly Asset[],
  layers: readonly (Layer | LayerV3 | LayerV4)[],
): string | null {
  const imageAssets = new Map(
    assets
      .filter((asset) => asset.kind === 'image')
      .map((asset) => [asset.id, asset]),
  );
  const candidates = layers.filter((layer) => {
    if (
      layer.source.kind !== 'asset' ||
      layer.x !== PROJECT_WIDTH / 2 ||
      layer.y !== PROJECT_HEIGHT / 2
    ) {
      return false;
    }
    const asset = imageAssets.get(layer.source.assetId);
    if (!asset) return false;
    const displayedWidth = asset.width * layer.scaleX;
    const displayedHeight = asset.height * layer.scaleY;
    return (
      displayedWidth >=
        PROJECT_WIDTH * LEGACY_BACKGROUND_MIN_WIDTH_RATIO &&
      displayedHeight >=
        PROJECT_HEIGHT * LEGACY_BACKGROUND_MIN_HEIGHT_RATIO
    );
  });
  return candidates.length === 1 ? candidates[0]!.id : null;
}

function addBackgroundIdentity<T extends {
  assets: Asset[];
  shots: z.infer<typeof ShotV2Schema>[];
}>(project: T): Array<z.infer<typeof ShotSchema>> {
  return project.shots.map((shot) => ({
    ...shot,
    layers: shot.layers.map((layer) => ({
      ...layer,
      locked: false,
      flipX: false,
    })),
    backgroundLayerId: inferLegacyBackgroundLayerId(
      project.assets,
      shot.layers,
    ),
  }));
}

function migrateFormalProject(input: unknown): unknown {
  const version4 = ProjectV4Schema.safeParse(input);
  if (version4.success) {
    return {
      ...version4.data,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      shots: version4.data.shots.map((shot) => ({
        ...shot,
        layers: shot.layers.map((layer) => ({
          ...layer,
          flipX: false,
        })),
      })),
    };
  }

  const version3 = ProjectV3Schema.safeParse(input);
  if (version3.success) {
    return {
      ...version3.data,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      shots: version3.data.shots.map((shot) => ({
        ...shot,
        layers: shot.layers.map((layer) => ({
          ...layer,
          locked: false,
          flipX: false,
        })),
      })),
    };
  }

  const version2 = ProjectV2Schema.safeParse(input);
  if (version2.success) {
    return {
      ...version2.data,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      shots: addBackgroundIdentity(version2.data),
    };
  }

  const legacy = ProjectV1Schema.safeParse(input);
  if (!legacy.success) return input;
  return {
    ...legacy.data,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    shots: addBackgroundIdentity(legacy.data),
    characters: legacy.data.characters.map((character) => {
      const defaultExpression =
        character.expressions.find(
          (expression) => expression.assetId === character.baseAssetId,
        ) ?? character.expressions[0]!;
      return {
        ...character,
        baseAssetId: defaultExpression.assetId,
        defaultExpressionId: defaultExpression.id,
        defaultScale: 1,
        defaultFlipX: false,
      };
    }),
  };
}

export const ProjectSchema = z.preprocess(
  migrateFormalProject,
  ProjectDataSchema.superRefine(validateProjectReferences),
);

export type ProjectData = z.infer<typeof ProjectDataSchema>;
export type Project = z.infer<typeof ProjectSchema>;

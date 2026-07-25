import { z } from 'zod';
import {
  PROJECT_FPS,
  PROJECT_HEIGHT,
  PROJECT_SCHEMA_VERSION,
  PROJECT_WIDTH,
} from '../constants';
import { validateProjectReferences } from '../validators/projectReferences';
import { AssetSchema } from './asset';
import { CharacterSchema, VoiceProfileSchema } from './character';
import { IdSchema, IsoDateTimeSchema, NameSchema } from './common';
import { ShotSchema } from './shot';
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
    shots: z.array(ShotSchema),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

function migrateProjectV1(input: unknown): unknown {
  const legacy = ProjectV1Schema.safeParse(input);
  if (!legacy.success) return input;
  return {
    ...legacy.data,
    schemaVersion: PROJECT_SCHEMA_VERSION,
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
  migrateProjectV1,
  ProjectDataSchema.superRefine(validateProjectReferences),
);

export type ProjectData = z.infer<typeof ProjectDataSchema>;
export type Project = z.infer<typeof ProjectSchema>;

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

export const ProjectSchema = ProjectDataSchema.superRefine(
  validateProjectReferences,
);

export type ProjectData = z.infer<typeof ProjectDataSchema>;
export type Project = z.infer<typeof ProjectSchema>;

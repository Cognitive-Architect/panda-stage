import { z } from 'zod';
import {
  PROJECT_FPS,
  PROJECT_HEIGHT,
  PROJECT_SCHEMA_VERSION,
  PROJECT_WIDTH,
  SHOT_MIN_DURATION_MS,
} from '../constants';
import { validateProjectReferences } from '../validators/projectReferences';
import { AssetSchema, type Asset } from './asset';
import { AudioClipV7Schema } from './audio';
import {
  CharacterSchema,
  CharacterV8Schema,
  CharacterV6Schema,
  VoiceProfileSchema,
} from './character';
import { IdSchema, IsoDateTimeSchema, NameSchema } from './common';
import type { Layer, LayerV3, LayerV4 } from './layer';
import { LayerSchema } from './layer';
import {
  ShotSchema,
  ShotV2Schema,
  ShotV3Schema,
  ShotV4Schema,
  ShotV7Schema,
} from './shot';
import { SubtitleStyleSchema } from './subtitle';
import { DialogueV5Schema } from './dialogue';
import { TimelineEventSchema } from './timeline-event';

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
    characters: z.array(CharacterV6Schema),
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
    characters: z.array(CharacterV6Schema),
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
    characters: z.array(CharacterV6Schema),
    voiceProfiles: z.array(VoiceProfileSchema),
    subtitleStyles: z.array(SubtitleStyleSchema).min(1),
    shots: z.array(ShotV4Schema),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

/**
 * Historical v5 shot shape: role-less audio and mandatory Dialogue.audioClipId.
 * Kept so the v5 →
 * current migration entry recognises a project the v5 product wrote without
 * rewriting dialogue data (v5 dialogues already carry
 * a real audioClipId, which stays valid once `audioClipId` becomes optional).
 */
const ShotV5BaseShape = {
  id: IdSchema,
  name: NameSchema,
  durationMs: z.number().int().min(SHOT_MIN_DURATION_MS),
  defaultSubtitleStyleId: IdSchema,
  dialogues: z.array(DialogueV5Schema),
  audioClips: z.array(AudioClipV7Schema),
  timelineEvents: z.array(TimelineEventSchema).default([]),
  layers: z.array(LayerSchema),
  backgroundLayerId: IdSchema.nullable(),
};

export const ShotV5Schema = z.object(ShotV5BaseShape).strict();

/**
 * Historical v5 project shape. Matches exactly what the v5 product persisted,
 * including the mandatory `audioClipId` on each dialogue. Used as the explicit
 * v5 → current migration entry point so a project the v5 product saved can be
 * unambiguously recognised and migrated forward with explicit audio roles;
 * dialogue data is already valid under the optional-audioClipId schema.
 */
export const ProjectV5Schema = z
  .object({
    schemaVersion: z.literal(5),
    id: IdSchema,
    name: NameSchema,
    width: z.literal(PROJECT_WIDTH),
    height: z.literal(PROJECT_HEIGHT),
    fps: z.literal(PROJECT_FPS),
    assets: z.array(AssetSchema),
    characters: z.array(CharacterV6Schema),
    voiceProfiles: z.array(VoiceProfileSchema),
    subtitleStyles: z.array(SubtitleStyleSchema).min(1),
    shots: z.array(ShotV5Schema),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

/**
 * Historical v6 project shape. v6 is the last whole-image Character format;
 * it must remain independently parseable now that current Characters carry a
 * required visual mode and optional composite fields.
 */
export const ProjectV6Schema = z
  .object({
    schemaVersion: z.literal(6),
    id: IdSchema,
    name: NameSchema,
    width: z.literal(PROJECT_WIDTH),
    height: z.literal(PROJECT_HEIGHT),
    fps: z.literal(PROJECT_FPS),
    assets: z.array(AssetSchema),
    characters: z.array(CharacterV6Schema),
    voiceProfiles: z.array(VoiceProfileSchema),
    subtitleStyles: z.array(SubtitleStyleSchema).min(1),
    shots: z.array(ShotV7Schema),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export const ProjectV7Schema = ProjectDataSchema.extend({
  schemaVersion: z.literal(7),
  characters: z.array(CharacterV8Schema),
  shots: z.array(ShotV7Schema),
});

/** Strict persisted v8 envelope, before the optional composite Character Head. */
export const ProjectV8Schema = ProjectDataSchema.extend({
  schemaVersion: z.literal(8),
  characters: z.array(CharacterV8Schema),
});

function addAudioRoles<T extends {
  audioClips: z.infer<typeof AudioClipV7Schema>[];
}>(shot: T) {
  return {
    ...shot,
    audioClips: shot.audioClips.map((clip) => ({
      ...clip,
      role: 'dialogue' as const,
    })),
  };
}

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
    ...addAudioRoles(shot),
    layers: shot.layers.map((layer) => ({
      ...layer,
      locked: false,
      flipX: false,
    })),
    // Preserve timelineEvents authored against legacy schemas (the example
    // project ships v1 shots with expression events). Fall back to an empty
    // list only for shots that predate the field so they survive the strict
    // v5 schema (contract #4).
    timelineEvents: shot.timelineEvents ?? [],
    backgroundLayerId: inferLegacyBackgroundLayerId(
      project.assets,
      shot.layers,
    ),
  }));
}

export function migrateFormalProject(input: unknown): unknown {
  const version7 = ProjectV7Schema.safeParse(input);
  if (version7.success) {
    return {
      ...version7.data,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      shots: version7.data.shots.map(addAudioRoles),
    };
  }
  const version6 = ProjectV6Schema.safeParse(input);
  if (version6.success) {
    return {
      ...version6.data,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      shots: version6.data.shots.map(addAudioRoles),
      characters: version6.data.characters.map((character) => ({
        ...character,
        mode: 'single-image' as const,
      })),
    };
  }

  const version5 = ProjectV5Schema.safeParse(input);
  if (version5.success) {
    // v5 dialogues already carry a real audioClipId, which is still valid once
    // audioClipId becomes optional. Add roles without rewriting Dialogue data.
    return {
      ...version5.data,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      shots: version5.data.shots.map(addAudioRoles),
      characters: version5.data.characters.map((character) => ({
        ...character,
        mode: 'single-image' as const,
      })),
    };
  }

  const version4 = ProjectV4Schema.safeParse(input);
  if (version4.success) {
    return {
      ...version4.data,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      characters: version4.data.characters.map((character) => ({
        ...character,
        mode: 'single-image' as const,
      })),
      shots: version4.data.shots.map((shot) => ({
        ...addAudioRoles(shot),
        layers: shot.layers.map((layer) => ({
          ...layer,
          flipX: false,
        })),
        timelineEvents: shot.timelineEvents ?? [],
      })),
    };
  }

  const version3 = ProjectV3Schema.safeParse(input);
  if (version3.success) {
    return {
      ...version3.data,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      characters: version3.data.characters.map((character) => ({
        ...character,
        mode: 'single-image' as const,
      })),
      shots: version3.data.shots.map((shot) => ({
        ...addAudioRoles(shot),
        layers: shot.layers.map((layer) => ({
          ...layer,
          locked: false,
          flipX: false,
        })),
        timelineEvents: shot.timelineEvents ?? [],
      })),
    };
  }

  const version2 = ProjectV2Schema.safeParse(input);
  if (version2.success) {
    return {
      ...version2.data,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      characters: version2.data.characters.map((character) => ({
        ...character,
        mode: 'single-image' as const,
      })),
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
        mode: 'single-image' as const,
        baseAssetId: defaultExpression.assetId,
        defaultExpressionId: defaultExpression.id,
        defaultScale: 1,
        defaultFlipX: false,
      };
    }),
  };
}

// Current-project (schemaVersion === PROJECT_SCHEMA_VERSION) validator only.
// Persisted migration (v0-v8 -> v9) is owned exclusively by `migrateProject`
// in `../migrations`; this schema must never perform legacy migration.
export const ProjectSchema = ProjectDataSchema.superRefine(
  validateProjectReferences,
);

export type ProjectData = z.infer<typeof ProjectDataSchema>;
export type Project = z.infer<typeof ProjectSchema>;

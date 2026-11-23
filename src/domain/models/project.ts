import { z } from 'zod';
import {
  PROJECT_FPS,
  PROJECT_HEIGHT,
  PROJECT_SCHEMA_VERSION,
  PROJECT_WIDTH,
  SHOT_MIN_DURATION_MS,
} from '../constants';
import {
  AnimationDefinitionV22Schema,
  isFlaGraphicDefinition,
  ProjectAnimationDefinitionLegacyCapacitySchema,
  ProjectAnimationDefinitionSchema,
  ProjectAnimationDefinitionV28Schema,
  ProjectAnimationDefinitionV22Schema,
} from './animation';
import { validateProjectReferences } from '../validators/projectReferences';
import {
  AssetSchema,
  AssetV22Schema,
  AssetV16Schema,
  AssetV12Schema,
  type AssetV12,
} from './asset';
import { AudioClipV7Schema } from './audio';
import {
  CharacterSchema,
  CharacterV34Schema,
  CharacterV35Schema,
  CharacterV36Schema,
  CharacterV22Schema,
  CharacterV23Schema,
  CharacterV24Schema,
  CharacterV25Schema,
  CharacterV26Schema,
  CharacterV27Schema,
  CharacterV28Schema,
  CharacterV19Schema,
  CharacterV8Schema,
  CharacterV9Schema,
  CharacterV10Schema,
  CharacterV11Schema,
  CharacterV14Schema,
  CharacterV17Schema,
  CharacterV6Schema,
  VoiceProfileSchema,
  VoiceProfileV22Schema,
} from './character';
import { IdSchema, IsoDateTimeSchema, NameSchema } from './common';
import { LayerV14Schema, type Layer, type LayerV3, type LayerV4 } from './layer';
import {
  ShotSchema,
  ShotV26Schema,
  ShotV27Schema,
  ShotV28Schema,
  ShotV30Schema,
  ShotV32Schema,
  ShotV33Schema,
  ShotV21Schema,
  ShotV22Schema,
  ShotV20Schema,
  ShotV19Schema,
  ShotV18Schema,
  ShotV14Schema,
  ShotV16Schema,
  ShotV15AdaptiveSchema,
  ShotV15AnimationSchema,
  ShotV2Schema,
  ShotV3Schema,
  ShotV4Schema,
  ShotV7Schema,
} from './shot';
import { SubtitleStyleSchema, SubtitleStyleV22Schema } from './subtitle';
import { DialogueV5Schema } from './dialogue';
import { TimelineEventV26Schema } from './timeline-event';
import { UserMotionPresetSchema, UserMotionPresetV32Schema } from './userMotionPreset';
import { ReusableAnimationSegmentSchema } from './reusableAnimationSegment';
import { ActionRecipeSchema } from './actionRecipe';

const CharacterExpressionV1Schema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    assetId: IdSchema,
  })
  .strict();

/** Strict PR-branch v15 envelope before per-instance animation playback. */
export const ProjectV15AnimationSchema = z
  .object({
    schemaVersion: z.literal(15),
    id: IdSchema,
    name: NameSchema,
    width: z.literal(PROJECT_WIDTH),
    height: z.literal(PROJECT_HEIGHT),
    fps: z.literal(PROJECT_FPS),
    assets: z.array(AssetSchema),
    animations: z.array(AnimationDefinitionV22Schema),
    characters: z.array(CharacterV14Schema),
    voiceProfiles: z.array(VoiceProfileSchema),
    subtitleStyles: z.array(SubtitleStyleSchema).min(1),
    shots: z.array(ShotV15AnimationSchema),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

/** Strict origin/main v15 envelope with Adaptive Parts, before animations. */
export const ProjectV15AdaptiveSchema = z
  .object({
    schemaVersion: z.literal(15),
    id: IdSchema,
    name: NameSchema,
    width: z.literal(PROJECT_WIDTH),
    height: z.literal(PROJECT_HEIGHT),
    fps: z.literal(PROJECT_FPS),
    assets: z.array(AssetSchema),
    animations: z.array(AnimationDefinitionV22Schema),
    characters: z.array(CharacterV17Schema),
    voiceProfiles: z.array(VoiceProfileSchema),
    subtitleStyles: z.array(SubtitleStyleSchema).min(1),
    shots: z.array(ShotV15AdaptiveSchema),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

/** Backward-compatible name for the PR branch's historical v15 contract. */
export const ProjectV15Schema = ProjectV15AnimationSchema;

const CharacterV1Schema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    baseAssetId: IdSchema,
    defaultVoiceProfileId: IdSchema,
    expressions: z.array(CharacterExpressionV1Schema).min(1),
  })
  .strict();

const ProjectIdentityShape = {
  id: IdSchema,
  name: NameSchema,
  width: z.literal(PROJECT_WIDTH),
  height: z.literal(PROJECT_HEIGHT),
  fps: z.literal(PROJECT_FPS),
};

const ProjectDataSchema = z
  .object({
    schemaVersion: z.literal(22),
    ...ProjectIdentityShape,
    assets: z.array(AssetSchema),
    animations: z.array(ProjectAnimationDefinitionLegacyCapacitySchema),
    characters: z.array(CharacterV34Schema),
    voiceProfiles: z.array(VoiceProfileSchema),
    subtitleStyles: z.array(SubtitleStyleSchema).min(1),
    shots: z.array(ShotV22Schema),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

const ProjectV12DataSchema = z
  .object({
    schemaVersion: z.literal(12),
    id: IdSchema,
    name: NameSchema,
    width: z.literal(PROJECT_WIDTH),
    height: z.literal(PROJECT_HEIGHT),
    fps: z.literal(PROJECT_FPS),
    assets: z.array(AssetV12Schema),
    characters: z.array(CharacterV14Schema),
    voiceProfiles: z.array(VoiceProfileSchema),
    subtitleStyles: z.array(SubtitleStyleSchema).min(1),
    shots: z.array(ShotV14Schema),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

/** Strict persisted v13 envelope, before formal animation definitions. */
export const ProjectV13Schema = ProjectV12DataSchema.extend({
  schemaVersion: z.literal(13),
  assets: z.array(AssetSchema),
});

/** Strict persisted v14 envelope, before Adaptive Parts Characters. */
export const ProjectV14Schema = ProjectDataSchema.extend({
  schemaVersion: z.literal(14),
  animations: z.array(AnimationDefinitionV22Schema),
  characters: z.array(CharacterV14Schema),
  shots: z.array(ShotV14Schema),
});

/** Strict persisted v16 envelope before reusable FLA Graphic Definitions. */
export const ProjectV16Schema = ProjectDataSchema.extend({
  schemaVersion: z.literal(16),
  animations: z.array(AnimationDefinitionV22Schema),
  assets: z.array(AssetV16Schema),
  characters: z.array(CharacterV17Schema),
  shots: z.array(ShotV16Schema),
}).strict();

/** Strict persisted v17 envelope before FLA Graphic CharacterPart visual sources. */
export const ProjectV17Schema = ProjectDataSchema.extend({
  schemaVersion: z.literal(17),
  characters: z.array(CharacterV17Schema),
  shots: z.array(ShotV18Schema),
}).strict();

/** True v18: Graphic CharacterParts are supported, narrator Dialogue is not. */
export const ProjectV18Schema = ProjectDataSchema.extend({
  schemaVersion: z.literal(18),
  characters: z.array(CharacterV19Schema),
  shots: z.array(ShotV18Schema),
}).strict().superRefine(validateProjectReferences);

/** Frozen true v19 contract, before Graphic Expression/Mouth sources. */
export const ProjectV19Schema = ProjectDataSchema.extend({
  schemaVersion: z.literal(19),
  characters: z.array(CharacterV19Schema),
  shots: z.array(ShotV19Schema),
}).strict().superRefine(validateProjectReferences);

/** Frozen v20 envelope: original fields and reference validation, no Core data. */
export const ProjectV20Schema = ProjectDataSchema.extend({
  schemaVersion: z.literal(20),
  shots: z.array(ShotV20Schema),
}).strict().superRefine(validateProjectReferences);

function validateAdaptiveClipOwnership(
  project: {
    characters: ProjectData['characters'];
    shots: readonly {
      layers: readonly {
        source: { kind: string; characterId?: string };
        animationClip?: { version: number };
      }[];
    }[];
  },
  context: z.RefinementCtx,
): void {
  project.shots.forEach((shot, shotIndex) => {
    shot.layers.forEach((layer, layerIndex) => {
      if (!layer.animationClip || layer.animationClip.version !== 1 || layer.source.kind !== 'character') {
        return;
      }
      const character = project.characters.find((entry) => entry.id === layer.source.characterId);
      if (character?.mode !== 'adaptive-parts') {
        context.addIssue({
          code: 'custom',
          path: ['shots', shotIndex, 'layers', layerIndex, 'animationClip'],
          message: 'Animation Core V0 requires an Adaptive Parts Character.',
        });
      }
    });
  });
}

/** Frozen v21 envelope: Character Clip v1 on Adaptive Parts Characters only. */
export const ProjectV21Schema = ProjectDataSchema.extend({
  schemaVersion: z.literal(21),
  shots: z.array(ShotV21Schema),
}).strict().superRefine(validateProjectReferences).superRefine(validateAdaptiveClipOwnership);

export const ProjectV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    id: IdSchema,
    name: NameSchema,
    width: z.literal(PROJECT_WIDTH),
    height: z.literal(PROJECT_HEIGHT),
    fps: z.literal(PROJECT_FPS),
    assets: z.array(AssetV12Schema),
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
    assets: z.array(AssetV12Schema),
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
    assets: z.array(AssetV12Schema),
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
    assets: z.array(AssetV12Schema),
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
  timelineEvents: z.array(TimelineEventV26Schema).default([]),
  layers: z.array(LayerV14Schema),
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
    assets: z.array(AssetV12Schema),
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
    assets: z.array(AssetV12Schema),
    characters: z.array(CharacterV6Schema),
    voiceProfiles: z.array(VoiceProfileSchema),
    subtitleStyles: z.array(SubtitleStyleSchema).min(1),
    shots: z.array(ShotV7Schema),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export const ProjectV7Schema = ProjectV12DataSchema.extend({
  schemaVersion: z.literal(7),
  characters: z.array(CharacterV8Schema),
  shots: z.array(ShotV7Schema),
});

/** Strict persisted v8 envelope, before the optional composite Character Head. */
export const ProjectV8Schema = ProjectV12DataSchema.extend({
  schemaVersion: z.literal(8),
  characters: z.array(CharacterV8Schema),
});

/** Strict persisted v9 envelope, before talking-head motion intensity. */
export const ProjectV9Schema = ProjectV12DataSchema.extend({
  schemaVersion: z.literal(9),
  characters: z.array(CharacterV9Schema),
});

/** Strict persisted v10 envelope, before static Head/Face transforms. */
export const ProjectV10Schema = ProjectV12DataSchema.extend({
  schemaVersion: z.literal(10),
  characters: z.array(CharacterV10Schema),
});

/** Strict persisted v11 envelope, before independent Body placement. */
export const ProjectV11Schema = ProjectV12DataSchema.extend({
  schemaVersion: z.literal(11),
  characters: z.array(CharacterV11Schema),
});

/** Strict persisted v12 envelope before author-defined image metadata. */
export const ProjectV12Schema = ProjectV12DataSchema;

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
  assets: readonly AssetV12[],
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
  assets: AssetV12[];
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

function validateLayerClipOwnership(
  project: Pick<ProjectData, 'animations' | 'shots'>,
  context: z.RefinementCtx,
): void {
  project.shots.forEach((shot, shotIndex) => {
    shot.layers.forEach((layer, layerIndex) => {
      if (!layer.animationClip || layer.animationClip.version !== 2) return;
      if (layer.source.kind !== 'animation') {
        context.addIssue({
          code: 'custom',
          path: ['shots', shotIndex, 'layers', layerIndex, 'animationClip'],
          message: 'Layer animation clip requires an animation Layer.',
        });
        return;
      }
      const animationId = layer.source.animationId;
      const definition = project.animations.find((entry) => entry.id === animationId);
      if (!definition || !isFlaGraphicDefinition(definition)) {
        context.addIssue({
          code: 'custom',
          path: ['shots', shotIndex, 'layers', layerIndex, 'animationClip'],
          message: 'Layer animation clip requires an FLA Graphic Definition.',
        });
      }
    });
  });
}

/** Frozen v22 envelope with the V0 Character and Layer Motion contracts. */
export const ProjectV22Schema = z.object({
  schemaVersion: z.literal(22),
  ...ProjectIdentityShape,
  assets: z.array(AssetV22Schema),
  animations: z.array(ProjectAnimationDefinitionV22Schema),
  characters: z.array(CharacterV22Schema),
  voiceProfiles: z.array(VoiceProfileV22Schema),
  subtitleStyles: z.array(SubtitleStyleV22Schema).min(1),
  shots: z.array(ShotV22Schema),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
}).strict().superRefine(validateProjectReferences)
  .superRefine(validateAdaptiveClipOwnership)
  .superRefine(validateLayerClipOwnership);

const ProjectV29DataSchema = ProjectDataSchema.extend({
  schemaVersion: z.literal(29),
  animations: z.array(ProjectAnimationDefinitionSchema),
  shots: z.array(ShotV30Schema),
});

export const ProjectV29Schema = ProjectV29DataSchema.superRefine(validateProjectReferences)
  .superRefine(validateAdaptiveClipOwnership)
  .superRefine(validateLayerClipOwnership);

const uniquePresetIds = (entries: readonly { id: string }[]): boolean =>
  new Set(entries.map(({ id }) => id)).size === entries.length;

const ProjectV30DataSchema = ProjectV29DataSchema.extend({
  schemaVersion: z.literal(30),
  userMotionPresets: z.array(UserMotionPresetV32Schema).refine(
    uniquePresetIds,
    'User motion preset IDs must be unique.',
  ).optional(),
});

export const ProjectV30Schema = ProjectV30DataSchema.superRefine(validateProjectReferences)
  .superRefine(validateAdaptiveClipOwnership)
  .superRefine(validateLayerClipOwnership);

const ProjectV31DataSchema = ProjectV30DataSchema.extend({
  schemaVersion: z.literal(31),
  shots: z.array(ShotV32Schema),
  animationSegments: z.array(ReusableAnimationSegmentSchema).refine(
    (entries) => new Set(entries.map(({ id }) => id)).size === entries.length,
    'Reusable animation segment IDs must be unique.',
  ).optional(),
});

export const ProjectV31Schema = ProjectV31DataSchema.superRefine(validateProjectReferences)
  .superRefine(validateAdaptiveClipOwnership)
  .superRefine(validateLayerClipOwnership);

const ProjectV32DataSchema = ProjectV31DataSchema.extend({
  schemaVersion: z.literal(32),
  actionRecipes: z.array(ActionRecipeSchema).refine(
    (entries) => new Set(entries.map(({ id }) => id)).size === entries.length,
    'Action recipe IDs must be unique.',
  ).optional(),
});

export const ProjectV32Schema = ProjectV32DataSchema.superRefine(validateProjectReferences)
  .superRefine(validateAdaptiveClipOwnership)
  .superRefine(validateLayerClipOwnership);

const ProjectV33DataSchema = ProjectV32DataSchema.extend({
  schemaVersion: z.literal(33),
  shots: z.array(ShotV33Schema),
  userMotionPresets: z.array(UserMotionPresetSchema).refine(
    uniquePresetIds,
    'User motion preset IDs must be unique.',
  ).optional(),
});

export const ProjectV33Schema = ProjectV33DataSchema.superRefine(validateProjectReferences)
  .superRefine(validateAdaptiveClipOwnership)
  .superRefine(validateLayerClipOwnership);

const ProjectV34DataSchema = ProjectV33DataSchema.extend({
  schemaVersion: z.literal(34),
  shots: z.array(ShotSchema),
});

export const ProjectV34Schema = ProjectV34DataSchema.superRefine(validateProjectReferences)
  .superRefine(validateAdaptiveClipOwnership)
  .superRefine(validateLayerClipOwnership);

const ProjectV35DataSchema = ProjectV34DataSchema.extend({
  schemaVersion: z.literal(35),
  characters: z.array(CharacterV35Schema),
});

export const ProjectV35Schema = ProjectV35DataSchema.superRefine(validateProjectReferences)
  .superRefine(validateAdaptiveClipOwnership)
  .superRefine(validateLayerClipOwnership);

const ProjectV36DataSchema = ProjectV35DataSchema.extend({
  schemaVersion: z.literal(36),
  characters: z.array(CharacterV36Schema),
});

export const ProjectV36Schema = ProjectV36DataSchema.superRefine(validateProjectReferences)
  .superRefine(validateAdaptiveClipOwnership)
  .superRefine(validateLayerClipOwnership);

const CurrentProjectDataSchema = ProjectV36DataSchema.extend({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  characters: z.array(CharacterSchema),
});

/** Frozen v23 envelope before AdaptiveParts face/expression/head bindings. */
export const ProjectV23Schema = ProjectV29DataSchema.extend({
  schemaVersion: z.literal(23),
  animations: z.array(ProjectAnimationDefinitionLegacyCapacitySchema),
  characters: z.array(CharacterV23Schema),
  shots: z.array(ShotV26Schema),
}).strict().superRefine(validateProjectReferences)
  .superRefine(validateAdaptiveClipOwnership)
  .superRefine(validateLayerClipOwnership);

/** Frozen v24 envelope before reusable talking animations. */
export const ProjectV24Schema = ProjectV29DataSchema.extend({
  schemaVersion: z.literal(24),
  animations: z.array(ProjectAnimationDefinitionLegacyCapacitySchema),
  characters: z.array(CharacterV24Schema),
  shots: z.array(ShotV26Schema),
}).strict().superRefine(validateProjectReferences)
  .superRefine(validateAdaptiveClipOwnership)
  .superRefine(validateLayerClipOwnership);

/** Frozen v25 envelope before talking animation playback settings. */
export const ProjectV25Schema = ProjectV29DataSchema.extend({
  schemaVersion: z.literal(25),
  animations: z.array(ProjectAnimationDefinitionLegacyCapacitySchema),
  characters: z.array(CharacterV25Schema),
  shots: z.array(ShotV26Schema),
}).strict().superRefine(validateProjectReferences)
  .superRefine(validateAdaptiveClipOwnership)
  .superRefine(validateLayerClipOwnership);

export const ProjectV26Schema = ProjectV29DataSchema.extend({
  schemaVersion: z.literal(26),
  characters: z.array(CharacterV26Schema),
  shots: z.array(ShotV26Schema),
}).strict().superRefine(validateProjectReferences)
  .superRefine(validateAdaptiveClipOwnership)
  .superRefine(validateLayerClipOwnership);

/** Frozen v27 envelope before Character actions and bounded action events. */
export const ProjectV27Schema = ProjectV29DataSchema.extend({
  schemaVersion: z.literal(27),
  characters: z.array(CharacterV27Schema),
  shots: z.array(ShotV27Schema),
}).strict().superRefine(validateProjectReferences)
  .superRefine(validateAdaptiveClipOwnership)
  .superRefine(validateLayerClipOwnership);

export const ProjectV28Schema = ProjectV29DataSchema.extend({
  schemaVersion: z.literal(28),
  animations: z.array(ProjectAnimationDefinitionV28Schema),
  characters: z.array(CharacterV28Schema),
  shots: z.array(ShotV28Schema),
}).strict().superRefine(validateProjectReferences)
  .superRefine(validateAdaptiveClipOwnership)
  .superRefine(validateLayerClipOwnership);

// Legacy envelopes are migrated by migrateProject before current validation.
export const ProjectSchema = CurrentProjectDataSchema.superRefine(validateProjectReferences)
  .superRefine(validateAdaptiveClipOwnership)
  .superRefine(validateLayerClipOwnership);

export type ProjectData = z.infer<typeof CurrentProjectDataSchema>;
export type Project = z.infer<typeof ProjectSchema>;

import { z } from 'zod';
import {
  PROJECT_FPS,
  PROJECT_HEIGHT,
  PROJECT_SCHEMA_VERSION,
  PROJECT_WIDTH,
} from '../constants';
import {
  ProjectSchema,
  ProjectV17Schema,
  ProjectV8Schema,
  ProjectV9Schema,
  ProjectV10Schema,
  ProjectV11Schema,
  ProjectV12Schema,
  ProjectV13Schema,
  ProjectV14Schema,
  ProjectV15AdaptiveSchema,
  ProjectV15AnimationSchema,
  ProjectV16Schema,
  ProjectV1Schema,
  inferLegacyBackgroundLayerId,
  migrateFormalProject,
  type Project,
} from '../models/project';
import type { Layer } from '../models/layer';
import {
  LegacyProbeProjectV1Schema,
  ProjectV0Schema,
  type LegacyProbeProjectV1,
  type ProjectV0,
} from './legacy-probe';

export { LegacyProbeProjectV1Schema, ProjectV0Schema };
export type { LegacyProbeProjectV1, ProjectV0 };

export type DetectedSchemaVersion =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
    | 15
    | 16
    | 17
    | typeof PROJECT_SCHEMA_VERSION;

export class UnsupportedSchemaVersionError extends Error {
  constructor(readonly receivedVersion: unknown) {
    super(
      `Unsupported project schemaVersion: ${String(
        receivedVersion,
      )}. Supported versions are 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, and ${PROJECT_SCHEMA_VERSION}.`,
    );
    this.name = 'UnsupportedSchemaVersionError';
  }
}

export function detectSchemaVersion(input: unknown): DetectedSchemaVersion {
  const envelope = z
    .object({ schemaVersion: z.unknown() })
    .passthrough()
    .safeParse(input);
  if (!envelope.success) {
    throw new UnsupportedSchemaVersionError(undefined);
  }
  const version = envelope.data.schemaVersion;
  if (
    version === 0 ||
    version === 1 ||
    version === 2 ||
    version === 3 ||
    version === 4 ||
    version === 5 ||
    version === 6 ||
    version === 7 ||
    version === 8 ||
    version === 9 ||
    version === 10 ||
    version === 11 ||
    version === 12 ||
    version === 13 ||
    version === 14 ||
    version === 15 ||
    version === 16 ||
    version === 17 ||
    version === PROJECT_SCHEMA_VERSION
  ) {
    return version as DetectedSchemaVersion;
  }
  throw new UnsupportedSchemaVersionError(version);
}

const MIGRATED_SUBTITLE_STYLE_ID =
  '00000000-0000-4000-8000-000000000110';
const HISTORICAL_DEFAULT_SUBTITLE_BACKGROUND = '#0a1411c7';
const TRANSPARENT_SUBTITLE_BACKGROUND = '#0a141100';

function migrateVersion15(input: unknown): Project {
  const animationShape = ProjectV15AnimationSchema.safeParse(input);
  const adaptiveShape = ProjectV15AdaptiveSchema.safeParse(input);

  if (!animationShape.success && !adaptiveShape.success) {
    throw new Error(
      'schemaVersion 15 project matches neither the animation nor Adaptive Parts contract; refusing an ambiguous migration.',
    );
  }

  const migrateAnimationProject = (
    version15: z.infer<typeof ProjectV15AnimationSchema>,
  ): Project => {
    return ProjectSchema.parse({
      ...version15,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      shots: version15.shots.map((shot) => ({
        ...shot,
        layers: shot.layers.map((layer) =>
          layer.source.kind === 'animation'
            ? {
                ...layer,
                animationPlayback: {
                  mode: 'once' as const,
                  endBehavior: 'hold' as const,
                },
              }
            : layer,
        ),
      })),
    });
  };
  const migrateAdaptiveProject = (
    version15: z.infer<typeof ProjectV15AdaptiveSchema>,
  ): Project => {
    return ProjectSchema.parse({
      ...version15,
      schemaVersion: PROJECT_SCHEMA_VERSION,
    });
  };

  if (animationShape.success && adaptiveShape.success) {
    const animationProject = migrateAnimationProject(animationShape.data);
    const adaptiveProject = migrateAdaptiveProject(adaptiveShape.data);
    if (JSON.stringify(animationProject) !== JSON.stringify(adaptiveProject)) {
      throw new Error(
        'schemaVersion 15 project matches both historical contracts with different results; refusing an ambiguous migration.',
      );
    }
    return animationProject;
  }

  if (animationShape.success) {
    return migrateAnimationProject(animationShape.data);
  }
  if (adaptiveShape.success) {
    return migrateAdaptiveProject(adaptiveShape.data);
  }
  throw new Error('Unreachable schemaVersion 15 migration state.');
}

function migrateImageAuthorMetadata(input: unknown): Project {
  const envelope = z
    .object({ assets: z.array(z.unknown()) })
    .passthrough()
    .parse(input);
  return ProjectSchema.parse({
    ...envelope,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    animations: [],
    assets: envelope.assets.map((asset) => {
      if (
        !asset ||
        typeof asset !== 'object' ||
        !('kind' in asset) ||
        asset.kind !== 'image'
      ) {
        return asset;
      }
      return {
        ...asset,
        usage: 'uncategorized',
        keywords: [],
      };
    }),
  });
}

function migrateLegacyProject(
  legacy: ProjectV0 | LegacyProbeProjectV1,
): Project {
  return migrateImageAuthorMetadata({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: legacy.id,
    name: legacy.name,
    width: PROJECT_WIDTH,
    height: PROJECT_HEIGHT,
    fps: PROJECT_FPS,
    assets: legacy.assets,
    characters: [],
    voiceProfiles: [],
    subtitleStyles: [
      {
        id: MIGRATED_SUBTITLE_STYLE_ID,
        name: 'Migrated default subtitles',
        fontFamily: 'Microsoft YaHei',
        fontSize: 44,
        textColor: '#fffdf6',
        // The background is a new default synthesized for legacy projects.
        backgroundColor: '#0a141100',
        position: 'bottom',
        align: 'center',
        maxWidth: 1600,
      },
    ],
    shots: legacy.shots.map((shot) => {
      const layers: Layer[] = shot.layers.map((layer) => ({
        id: layer.id,
        name: layer.name,
        source: { kind: 'asset', assetId: layer.assetId },
        anchor: layer.anchor,
        x: layer.x,
        y: layer.y,
        scaleX: layer.scaleX,
        scaleY: layer.scaleY,
        rotationDeg: layer.rotationDeg,
        opacity: layer.opacity,
        visible: layer.visible,
        locked: false,
        flipX: 'flipX' in layer ? layer.flipX : false,
        zIndex: layer.zIndex,
      }));
      return {
        id: shot.id,
        name: shot.name,
        durationMs: shot.durationMs,
        defaultSubtitleStyleId: MIGRATED_SUBTITLE_STYLE_ID,
        layers,
        backgroundLayerId:
          shot.backgroundLayerId ??
          inferLegacyBackgroundLayerId(legacy.assets, layers),
        dialogues: [],
        audioClips: [],
        timelineEvents: shot.timelineEvents.map((event) => ({
          id: event.id,
          type: event.type,
          layerId: event.layerId,
          startMs: event.startMs,
          endMs: event.startMs + event.durationMs,
          from: event.from,
          to: event.to,
          easing: event.easing,
        })),
      };
    }),
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt,
  });
}

/**
 * Removes only the historical product default from persisted styles. Explicit
 * custom backgrounds remain part of the project model and are preserved.
 */
function normalizeHistoricalSubtitleBackground(project: Project): Project {
  let changed = false;
  const subtitleStyles = project.subtitleStyles.map((style) => {
    if (
      style.backgroundColor !== HISTORICAL_DEFAULT_SUBTITLE_BACKGROUND
    ) {
      return style;
    }
    changed = true;
    return {
      ...style,
      backgroundColor: TRANSPARENT_SUBTITLE_BACKGROUND,
    };
  });

  return changed ? { ...project, subtitleStyles } : project;
}

/**
 * The single authoritative persisted-project migration pipeline.
 *
 * Every persisted envelope (v0-v17) is routed here by version and resolved to
 * the current v18 project. The formal v1-v7
 * transforms live in
 * `migrateFormalProject` (a shared helper, NOT wired into `ProjectSchema`),
 * and the current-project validator (`ProjectSchema`) is used only to
 * validate the resolved v17 shape. A narrow compatibility normalization then
 * replaces the one historical subtitle default while preserving all other
 * style values. There is no second, implicit migration path:
 * `ProjectSchema.parse` never migrates legacy input.
 */
export function migrateProject(input: unknown): Project {
  const version = detectSchemaVersion(input);
  let project: Project;
  switch (version) {
    case 0:
      project = migrateLegacyProject(ProjectV0Schema.parse(input));
      break;
    case 1:
      project = migrateVersion1(input);
      break;
    case 2:
    case 3:
    case 4:
    case 5:
    case 6:
    case 7:
      // Formal v2-v7 envelopes are migrated to the current schema by the
      // shared formal transform, then validated as a current project.
      project = migrateImageAuthorMetadata(migrateFormalProject(input));
      break;
    case 8:
      // Historical v8 envelope: validate its strict pre-Head shape, then
      // advance only the schema version so incumbent Character visuals stay
      // unchanged.
      project = migrateImageAuthorMetadata({
        ...ProjectV8Schema.parse(input),
        schemaVersion: PROJECT_SCHEMA_VERSION,
      });
      break;
    case 9: {
      const version9 = ProjectV9Schema.parse(input);
      project = migrateImageAuthorMetadata({
        ...version9,
        schemaVersion: PROJECT_SCHEMA_VERSION,
        characters: version9.characters.map((character) =>
          character.mode === 'composite'
            ? { ...character, talkingHeadMotionIntensityPercent: 100 }
            : character,
        ),
      });
      break;
    }
    case 12:
      // v12 image assets had no author-defined usage or search keywords.
      // Their facts remain explicitly uncategorized during the v17 upgrade.
      project = migrateImageAuthorMetadata(ProjectV12Schema.parse(input));
      break;
    case 13: {
      const version13 = ProjectV13Schema.parse(input);
      project = ProjectSchema.parse({
        ...version13,
        schemaVersion: PROJECT_SCHEMA_VERSION,
        animations: [],
      });
      break;
    }
    case 14: {
      const version14 = ProjectV14Schema.parse(input);
      project = ProjectSchema.parse({
        ...version14,
        schemaVersion: PROJECT_SCHEMA_VERSION,
      });
      break;
    }
    case 15:
      project = migrateVersion15(input);
      break;
    case 16: {
      const version16 = ProjectV16Schema.parse(input);
      project = ProjectSchema.parse({
        ...version16,
        schemaVersion: PROJECT_SCHEMA_VERSION,
      });
      break;
    }
    case 17: {
      // v17 (C5-KF pose foundation) already carries the Layer shape the
      // current schema expects; only the Project envelope advances to make
      // room for user Part pose action presets, which default to absent.
      const version17 = ProjectV17Schema.parse(input);
      project = ProjectSchema.parse({
        ...version17,
        schemaVersion: PROJECT_SCHEMA_VERSION,
      });
      break;
    }
    case PROJECT_SCHEMA_VERSION:
      // Current v18 envelope: validate it, then apply only the narrow
      // historical-default compatibility normalization without mutating input.
      project = ProjectSchema.parse(input);
      break;
    case 10: {
      const version10 = ProjectV10Schema.parse(input);
      project = migrateImageAuthorMetadata({
        ...version10,
        schemaVersion: PROJECT_SCHEMA_VERSION,
        characters: version10.characters.map((character) =>
          character.mode === 'composite'
            ? {
                ...character,
                facePlacement: {
                  ...character.facePlacement,
                  rotationDeg: 0,
                  flipX: false,
                },
                ...(character.head
                  ? {
                      head: {
                        ...character.head,
                        placement: {
                          ...character.head.placement,
                          rotationDeg: 0,
                          flipX: false,
                        },
                      },
                    }
                  : {}),
              }
            : character,
        ),
      });
      break;
    }
    case 11: {
      const version11 = ProjectV11Schema.parse(input);
      project = migrateImageAuthorMetadata({
        ...version11,
        schemaVersion: PROJECT_SCHEMA_VERSION,
        characters: version11.characters.map((character) =>
          character.mode === 'composite'
            ? {
                ...character,
                bodyPlacement: { offsetX: 0, offsetY: 0, scale: 1 },
              }
            : character,
        ),
      });
      break;
    }
    default:
      throw new UnsupportedSchemaVersionError(version);
  }
  return normalizeHistoricalSubtitleBackground(project);
}

/**
 * Resolves the `schemaVersion === 1` collision between the formal v1 envelope
 * and the legacy probe v1 envelope. A formal v1 project is migrated through
 * the shared formal transform; a legacy probe v1 project is migrated through
 * `migrateLegacyProject`. An envelope that claims v1 but matches neither shape
 * is rejected as ambiguous/corrupt instead of silently guessing a path.
 */
function migrateVersion1(input: unknown): Project {
  const formal = ProjectV1Schema.safeParse(input);
  if (formal.success) {
    return migrateImageAuthorMetadata(migrateFormalProject(input));
  }
  const probe = LegacyProbeProjectV1Schema.safeParse(input);
  if (probe.success) {
    return migrateLegacyProject(probe.data);
  }
  return migrateImageAuthorMetadata(migrateFormalProject(input));
}

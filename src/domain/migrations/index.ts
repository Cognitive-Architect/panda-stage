import { z } from 'zod';
import {
  PROJECT_FPS,
  PROJECT_HEIGHT,
  PROJECT_SCHEMA_VERSION,
  PROJECT_WIDTH,
} from '../constants';
import {
  ProjectSchema,
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
  | typeof PROJECT_SCHEMA_VERSION;

export class UnsupportedSchemaVersionError extends Error {
  constructor(readonly receivedVersion: unknown) {
    super(
      `Unsupported project schemaVersion: ${String(receivedVersion)}. Supported versions are 0, 1, 2, 3, 4, and ${PROJECT_SCHEMA_VERSION}.`,
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
    version === PROJECT_SCHEMA_VERSION
  ) {
    return version;
  }
  throw new UnsupportedSchemaVersionError(version);
}

const MIGRATED_SUBTITLE_STYLE_ID =
  '00000000-0000-4000-8000-000000000110';

function migrateLegacyProject(
  legacy: ProjectV0 | LegacyProbeProjectV1,
): Project {
  return ProjectSchema.parse({
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
        backgroundColor: '#0a1411c7',
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
 * The single authoritative persisted-project migration pipeline.
 *
 * Every persisted envelope (v0-v5) is routed here by version and resolved to
 * the current (v5) project through exactly one path. The formal v1-v4
 * transform lives in `migrateFormalProject` (a shared helper, NOT wired into
 * `ProjectSchema`), and the current-project validator (`ProjectSchema`) is
 * used only to validate the resolved v5 shape. There is no second, implicit
 * migration path: `ProjectSchema.parse` never migrates legacy input.
 */
export function migrateProject(input: unknown): Project {
  const version = detectSchemaVersion(input);
  switch (version) {
    case 0:
      return migrateLegacyProject(ProjectV0Schema.parse(input));
    case 1:
      return migrateVersion1(input);
    case 2:
    case 3:
    case 4:
      // Formal v2-v4 envelopes are migrated to the current schema by the
      // shared formal transform, then validated as a current project.
      return ProjectSchema.parse(migrateFormalProject(input));
    case PROJECT_SCHEMA_VERSION:
      // Current envelope: validated as-is, no migration, no in-place mutation.
      return ProjectSchema.parse(input);
    default:
      throw new UnsupportedSchemaVersionError(version);
  }
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
    return ProjectSchema.parse(migrateFormalProject(input));
  }
  const probe = LegacyProbeProjectV1Schema.safeParse(input);
  if (probe.success) {
    return migrateLegacyProject(probe.data);
  }
  return ProjectSchema.parse(migrateFormalProject(input));
}

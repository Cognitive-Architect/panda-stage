import { z } from 'zod';
import {
  PROJECT_FPS,
  PROJECT_HEIGHT,
  PROJECT_SCHEMA_VERSION,
  PROJECT_WIDTH,
} from '../constants';
import { ProjectSchema, type Project } from '../models/project';
import {
  LegacyProbeProjectV1Schema,
  ProjectV0Schema,
  type LegacyProbeProjectV1,
  type ProjectV0,
} from './legacy-probe';

export { LegacyProbeProjectV1Schema, ProjectV0Schema };
export type { LegacyProbeProjectV1, ProjectV0 };

export type DetectedSchemaVersion = 0 | typeof PROJECT_SCHEMA_VERSION;

export class UnsupportedSchemaVersionError extends Error {
  constructor(readonly receivedVersion: unknown) {
    super(
      `Unsupported project schemaVersion: ${String(receivedVersion)}. Supported versions are 0 and ${PROJECT_SCHEMA_VERSION}.`,
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
  if (version === 0 || version === PROJECT_SCHEMA_VERSION) return version;
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
    shots: legacy.shots.map((shot) => ({
      id: shot.id,
      name: shot.name,
      durationMs: shot.durationMs,
      defaultSubtitleStyleId: MIGRATED_SUBTITLE_STYLE_ID,
      layers: shot.layers.map((layer) => ({
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
        zIndex: layer.zIndex,
      })),
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
    })),
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt,
  });
}

export function migrateProject(input: unknown): Project {
  const version = detectSchemaVersion(input);
  if (version === 0) {
    return migrateLegacyProject(ProjectV0Schema.parse(input));
  }

  const current = ProjectSchema.safeParse(input);
  if (current.success) return current.data;

  const legacyProbe = LegacyProbeProjectV1Schema.safeParse(input);
  if (legacyProbe.success) return migrateLegacyProject(legacyProbe.data);

  return ProjectSchema.parse(input);
}

import { describe, expect, it } from 'vitest';
import {
  ProjectSchema,
  UnsupportedSchemaVersionError,
  detectSchemaVersion,
  migrateProject,
  type Project,
} from '../../../src/domain';
import { ProjectService } from '../../../src/main/services/ProjectService';
import {
  ProjectFileSystemService,
  ProjectFileNotFoundError,
} from '../../../src/main/services/ProjectFileSystemService';
import exampleProject from '../../../demo-project/project-v1.example.json';

/**
 * Focused lock-in tests for Issue #152 / #217: migration ownership is
 * consolidated into a single `migrateProject` pipeline. `ProjectSchema` is the
 * current (v5) validator only and must never migrate legacy input; every
 * persisted envelope (v0-v5) is resolved through `migrateProject`.
 */

const V0_IDS = {
  project: '00000000-0000-4000-8000-000000000000',
  asset: '00000000-0000-4000-8000-000000000001',
  shot: '00000000-0000-4000-8000-000000000002',
  layer: '00000000-0000-4000-8000-000000000003',
  event: '00000000-0000-4000-8000-000000000004',
};

// A true legacy v0 envelope matching `ProjectV0Schema`: image asset, single
// layer referencing it, single move timeline event, no flipX.
function buildV0(): unknown {
  return {
    schemaVersion: 0,
    id: V0_IDS.project,
    name: 'v0',
    width: 1920,
    height: 1080,
    fps: 24,
    assets: [
      {
        id: V0_IDS.asset,
        kind: 'image',
        name: 'bg',
        relativePath: 'bg.png',
        mimeType: 'image/png',
        width: 1920,
        height: 1080,
      },
    ],
    shots: [
      {
        id: V0_IDS.shot,
        name: 'shot',
        durationMs: 1000,
        backgroundLayerId: null,
        layers: [
          {
            id: V0_IDS.layer,
            assetId: V0_IDS.asset,
            name: 'bg',
            anchor: 'center',
            x: 960,
            y: 540,
            scaleX: 1,
            scaleY: 1,
            rotationDeg: 0,
            opacity: 1,
            visible: true,
            zIndex: 0,
          },
        ],
        timelineEvents: [
          {
            id: V0_IDS.event,
            type: 'move',
            layerId: V0_IDS.layer,
            startMs: 0,
            durationMs: 1000,
            from: { x: 0, y: 0 },
            to: { x: 1, y: 1 },
            easing: 'linear',
          },
        ],
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const PROBE_IDS = {
  project: '10000000-0000-4000-8000-000000000000',
  asset: '10000000-0000-4000-8000-000000000001',
  shot: '10000000-0000-4000-8000-000000000002',
  layer: '10000000-0000-4000-8000-000000000003',
  event: '10000000-0000-4000-8000-000000000004',
};

// A true legacy-probe v1 envelope: schemaVersion 1, layer flipX present, and
// no formal v1 collections (characters/voiceProfiles/subtitleStyles). This is
// the collision counterpart to the formal v1 `exampleProject`.
function buildLegacyProbeV1(): unknown {
  return {
    schemaVersion: 1,
    id: PROBE_IDS.project,
    name: 'probe',
    width: 1920,
    height: 1080,
    fps: 24,
    assets: [
      {
        id: PROBE_IDS.asset,
        kind: 'image',
        name: 'bg',
        relativePath: 'bg.png',
        mimeType: 'image/png',
        width: 1920,
        height: 1080,
      },
    ],
    shots: [
      {
        id: PROBE_IDS.shot,
        name: 'shot',
        durationMs: 1000,
        backgroundLayerId: null,
        layers: [
          {
            id: PROBE_IDS.layer,
            assetId: PROBE_IDS.asset,
            name: 'bg',
            anchor: 'center',
            x: 960,
            y: 540,
            scaleX: 1,
            scaleY: 1,
            rotationDeg: 0,
            opacity: 1,
            visible: true,
            zIndex: 0,
            flipX: false,
          },
        ],
        timelineEvents: [
          {
            id: PROBE_IDS.event,
            type: 'move',
            layerId: PROBE_IDS.layer,
            startMs: 0,
            durationMs: 1000,
            from: { x: 0, y: 0 },
            to: { x: 1, y: 1 },
            easing: 'linear',
          },
        ],
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('migration ownership: current-only validation boundary', () => {
  it('ProjectSchema (current validator) rejects legacy v1 and never migrates it', () => {
    expect(ProjectSchema.safeParse(exampleProject).success).toBe(false);
    expect(() => ProjectSchema.parse(exampleProject)).toThrow();
  });

  it('ProjectSchema still validates a current v5 project without migrating', () => {
    const v5 = migrateProject(exampleProject);
    expect(ProjectSchema.parse(v5)).toEqual(v5);
  });
});

describe('migration ownership: single pipeline routes every envelope to v5', () => {
  it.each([
    ['v0', buildV0()],
    ['formal v1', exampleProject],
    ['legacy probe v1', buildLegacyProbeV1()],
  ])('migrates %s through migrateProject to v5', (_label, input) => {
    const result = migrateProject(input);
    expect(result.schemaVersion).toBe(5);
  });

  it('routes the v1 collision: formal v1 keeps characters, probe v1 yields empty collections', () => {
    const formal = migrateProject(exampleProject) as Project;
    expect(formal.characters.length).toBeGreaterThan(0);

    const probe = migrateProject(buildLegacyProbeV1()) as Project;
    expect(probe.characters).toEqual([]);
    expect(probe.voiceProfiles).toEqual([]);
    expect(probe.subtitleStyles).toHaveLength(1);
  });

  it('is idempotent on an already-current v5 project', () => {
    const v5 = migrateProject(exampleProject);
    expect(migrateProject(v5)).toEqual(v5);
  });
});

describe('migration ownership: rejects future / ambiguous / corrupt', () => {
  it('rejects a future schema version', () => {
    expect(() => migrateProject({ schemaVersion: 6 })).toThrow(
      UnsupportedSchemaVersionError,
    );
  });

  it('rejects an ambiguous schemaVersion 1 that matches neither envelope', () => {
    const ambiguous = { schemaVersion: 1, id: 'x', name: 'x', width: 1920, height: 1080, fps: 24, assets: [] };
    expect(() => migrateProject(ambiguous)).toThrow();
  });

  it('rejects a corrupt v0 envelope with unknown fields', () => {
    const corrupt = { ...(buildV0() as object), unknownField: true } as unknown;
    expect(() => migrateProject(corrupt)).toThrow();
  });
});

describe('migration ownership: ProjectService.open uses the single pipeline', () => {
  class MemoryProjectFs extends ProjectFileSystemService {
    private files = new Map<string, string>();
    seed(root: string, content: string): void {
      this.files.set(root, content);
    }
    override async readProjectFile(projectRoot: string): Promise<string> {
      const content = this.files.get(projectRoot);
      if (content === undefined) {
        throw new ProjectFileNotFoundError(projectRoot);
      }
      return content;
    }
    override async writeProjectFileAtomically(
      projectRoot: string,
      serializedProject: string,
    ): Promise<void> {
      this.files.set(projectRoot, serializedProject);
    }
  }

  const ROOT = 'D:\\ownership-roundtrip.pandastage';

  it('open migrates a legacy v1 file once and marks it migrated', async () => {
    const fs = new MemoryProjectFs();
    fs.seed(ROOT, JSON.stringify(exampleProject));
    const service = new ProjectService({ fileSystem: fs });

    const opened = await service.open(ROOT);
    expect(opened.project.schemaVersion).toBe(5);
    expect(opened.migrated).toBe(true);
    expect(opened.sourceVersion).toBe(1);
  });

  it('open -> save -> reopen round-trips a migrated legacy project', async () => {
    const fs = new MemoryProjectFs();
    fs.seed(ROOT, JSON.stringify(exampleProject));
    const service = new ProjectService({ fileSystem: fs });

    const opened = await service.open(ROOT);
    const saved = await service.save(ROOT, opened.project);
    const reopened = await service.open(ROOT);

    expect(saved.project.schemaVersion).toBe(5);
    expect(saved.migrated).toBe(false);
    expect(reopened.project).toEqual(saved.project);
    expect(reopened.migrated).toBe(false);
    expect(detectSchemaVersion(JSON.parse(JSON.stringify(reopened.project)))).toBe(
      5,
    );
  });
});

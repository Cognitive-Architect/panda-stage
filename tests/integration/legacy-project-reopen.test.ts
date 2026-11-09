import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectService } from '../../src/main/services/ProjectService';
import { PROJECT_SCHEMA_VERSION, ProjectSchema } from '../../src/domain';
import { buildProject, legacyShots } from '../unit/domain/testProject';

const temporaryParents: string[] = [];

async function temporaryParent(): Promise<string> {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'panda-legacy-reopen-'));
  temporaryParents.push(parent);
  return parent;
}

afterEach(async () => {
  await Promise.all(
    temporaryParents.splice(0).map((parent) =>
      rm(parent, { recursive: true, force: true }),
    ),
  );
});

const STATIC_CAMERA = { mode: 'static', keyframes: [] };

/**
 * Rewrites the persisted `project.json` of a real project into the v13 shape:
 * no project-local Shot template list, no animation definition list, no
 * user Part pose presets and no persisted per-Shot camera track.
 */
function downgradeToV13(project: Record<string, unknown>): Record<string, unknown> {
  const {
    shotTemplates: _shotTemplates,
    partPosePresets: _partPosePresets,
    animations: _animations,
    ...rest
  } = project;
  void _shotTemplates;
  void _partPosePresets;
  void _animations;
  return {
    ...rest,
    schemaVersion: 13,
    shots: legacyShots(
      (rest.shots as Array<{ camera: unknown }>).map((shot) => shot),
    ),
  };
}

describe('Issue #1042 / Fix A: a legacy project migrates, saves and reopens', () => {
  it('opens a v13 project, persists it as v18 and reopens it unchanged', async () => {
    const parent = await temporaryParent();
    const projectRoot = path.join(parent, 'legacy-v13.pandastage');
    const service = new ProjectService();

    const created = await service.create(projectRoot, { name: '旧工程重开' });

    // Seed a real, populated Shot through the formal save path, then rewrite
    // the persisted document into the v13 envelope.
    const seeded = ProjectSchema.parse({
      ...buildProject(),
      id: created.project.id,
      name: created.project.name,
    });
    await service.save(projectRoot, seeded);

    const projectFile = path.join(projectRoot, 'project.json');
    const current = JSON.parse(await readFile(projectFile, 'utf8')) as Record<
      string,
      unknown
    >;
    const legacy = downgradeToV13(current);
    await writeFile(projectFile, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8');

    // 1. Open: the migration runs and the historical static camera appears.
    const opened = await service.open(projectRoot);
    expect(opened.migrated).toBe(true);
    expect(opened.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(opened.project.shots).toHaveLength(seeded.shots.length);
    for (const [index, shot] of opened.project.shots.entries()) {
      expect(shot.camera).toEqual(STATIC_CAMERA);
      const source = seeded.shots[index]!;
      expect(shot.id).toBe(source.id);
      expect(shot.name).toBe(source.name);
      expect(shot.durationMs).toBe(source.durationMs);
      expect(shot.layers).toEqual(source.layers);
      expect(shot.backgroundLayerId).toBe(source.backgroundLayerId);
      expect(shot.dialogues).toEqual(source.dialogues);
      expect(shot.timelineEvents).toEqual(source.timelineEvents);
    }
    expect(opened.project.shotTemplates).toEqual([]);

    // 2. Save the migrated project, then reopen: no second migration, no loss.
    await service.save(projectRoot, opened.project);
    const reopened = await service.open(projectRoot);

    expect(reopened.migrated).toBe(false);
    expect(reopened.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(reopened.project.shots).toEqual(opened.project.shots);
    expect(reopened.project.shots[0]!.camera).toEqual(STATIC_CAMERA);
  });
});

import {
  mkdtemp,
  readFile,
  readdir,
  rm,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  projectDurationMs,
  ShotService,
  type Project,
} from '../../src/domain';
import {
  ProjectFileSystemService,
} from '../../src/main/services/ProjectFileSystemService';
import { ProjectService } from '../../src/main/services/ProjectService';
import { saveCurrentProject } from '../../src/renderer/features/recovery/saveCurrentProject';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import type {
  ProjectOperationResponse,
  ProjectSaveRequest,
} from '../../src/shared/project-api';

const temporaryParents: string[] = [];

async function projectRoot(): Promise<string> {
  const parent = await mkdtemp(
    path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-stage-day20-'),
  );
  temporaryParents.push(parent);
  return path.join(parent, '五 镜头 M2 🐼.pandastage');
}

function shotService(): ShotService {
  let counter = 0;
  return new ShotService({
    createId: () =>
      `d2030000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    now: () => new Date('2026-07-25T12:45:00.000Z'),
  });
}

function api(projectService: ProjectService) {
  return {
    save: async (
      request: ProjectSaveRequest,
    ): Promise<ProjectOperationResponse> => {
      try {
        return {
          ok: true,
          value: await projectService.save(
            request.projectRoot,
            request.project,
            request.revision,
          ),
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'SAVE_FAILED',
            message:
              error instanceof Error ? error.message : 'Save failed.',
            projectRoot: request.projectRoot,
          },
        };
      }
    },
  };
}

function fiveShots(project: Project): Project {
  const service = shotService();
  const durations = [500, 1_000, 1_500, 2_000, 2_500];
  let next = project;
  durations.forEach((durationMs, index) => {
    next = service.create(next, {
      name: `M2 镜头 ${index + 1}`,
      durationMs,
    });
  });
  return next;
}

afterEach(async () => {
  await Promise.all(
    temporaryParents.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('Day 20 five-shot persistence', () => {
  it('persists five names, durations, IDs, order, and total duration across save and reopen', async () => {
    const root = await projectRoot();
    const projectService = new ProjectService({
      createId: (() => {
        let counter = 0;
        return () =>
          `d2040000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
      })(),
      now: () => new Date('2026-07-25T12:44:00.000Z'),
    });
    const created = await projectService.create(root, {
      name: 'M2 five shot project',
    });
    const service = shotService();
    let configured = fiveShots(created.project);
    configured = service.rename(
      configured,
      configured.shots[2]!.id,
      'M2 中场',
    );
    configured = service.move(
      configured,
      configured.shots[4]!.id,
      0,
    );

    await projectService.save(root, configured, 1);
    const reopened = await projectService.open(root);

    expect(reopened.project.shots).toEqual(configured.shots);
    expect(reopened.project.shots.map((shot) => shot.name)).toEqual([
      'M2 镜头 5',
      'M2 镜头 1',
      'M2 镜头 2',
      'M2 中场',
      'M2 镜头 4',
    ]);
    expect(reopened.project.shots.map((shot) => shot.durationMs)).toEqual([
      2_500,
      500,
      1_000,
      1_500,
      2_000,
    ]);
    expect(new Set(reopened.project.shots.map((shot) => shot.id)).size).toBe(
      5,
    );
    expect(projectDurationMs(reopened.project)).toBe(7_500);
  });

  it('keeps Renderer order dirty, preserves formal JSON, and removes tmp files when save fails', async () => {
    const root = await projectRoot();
    const bootstrap = new ProjectService({
      createId: (() => {
        let counter = 0;
        return () =>
          `d2050000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
      })(),
    });
    const created = await bootstrap.create(root, {
      name: 'M2 failed-save project',
    });
    const formal = fiveShots(created.project);
    await bootstrap.save(root, formal, 1);
    const formalSource = await readFile(
      path.join(root, 'project.json'),
      'utf8',
    );
    const service = shotService();
    const reordered = service.move(formal, formal.shots[4]!.id, 0);
    const editor = new EditorProjectStore();
    editor.open(root, formal);
    editor.updateProject(reordered);
    const failing = new ProjectService({
      fileSystem: new ProjectFileSystemService({
        afterTemporarySync: () => {
          throw new Error('Injected M2 atomic save failure.');
        },
      }),
    });

    const failed = await saveCurrentProject(api(failing), editor);

    expect(failed).toMatchObject({
      ok: false,
      error: { code: 'SAVE_FAILED' },
    });
    expect(editor.getSnapshot()).toMatchObject({
      dirty: true,
      revision: 1,
    });
    expect(
      editor.getSnapshot()!.project.shots.map((shot) => shot.id),
    ).toEqual(reordered.shots.map((shot) => shot.id));
    expect(await readFile(path.join(root, 'project.json'), 'utf8')).toBe(
      formalSource,
    );
    expect(
      (await readdir(root)).filter((name) => name.endsWith('.tmp')),
    ).toEqual([]);

    const saved = await saveCurrentProject(api(bootstrap), editor);
    expect(saved).toMatchObject({
      ok: true,
      acknowledgement: 'current',
    });
    expect(editor.getSnapshot()?.dirty).toBe(false);
    expect((await bootstrap.open(root)).project.shots).toEqual(
      reordered.shots,
    );
  });
});

import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectSchema, type Project } from '../../src/domain';
import {
  ProjectFileSystemService,
} from '../../src/main/services/ProjectFileSystemService';
import {
  ProjectService,
  ProjectServiceError,
} from '../../src/main/services/ProjectService';
import { ProjectOperationCoordinator } from '../../src/main/services/ProjectOperationCoordinator';
import { AutosaveService } from '../../src/main/services/AutosaveService';
import { RecoveryService } from '../../src/main/services/RecoveryService';
import { saveCurrentProject } from '../../src/renderer/features/recovery/saveCurrentProject';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import type {
  ProjectOperationResponse,
  ProjectSaveRequest,
} from '../../src/shared/project-api';

const temporaryParents: string[] = [];

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function createRoot(): Promise<string> {
  const parent = await mkdtemp(
    path.join(os.tmpdir(), 'panda-stage-project-save-cas-'),
  );
  temporaryParents.push(parent);
  return path.join(parent, '角色 保存 CAS 🐼.pandastage');
}

function revision(project: Project, value: number): Project {
  return ProjectSchema.parse({
    ...project,
    name: `Revision ${value}`,
    updatedAt: `2026-07-25T08:${String(value).padStart(2, '0')}:00.000Z`,
  });
}

function quietClock() {
  return {
    setInterval: () => 1 as unknown as ReturnType<typeof setInterval>,
    clearInterval: () => undefined,
  };
}

function responseApi(projectService: ProjectService) {
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
        const normalized = error as ProjectServiceError;
        return {
          ok: false,
          error: {
            code: normalized.code,
            message: normalized.message,
            projectRoot: normalized.projectRoot,
            ...(normalized.currentProject
              ? { currentProject: normalized.currentProject }
              : {}),
            ...(normalized.currentRevision !== undefined
              ? { currentRevision: normalized.currentRevision }
              : {}),
          },
        };
      }
    },
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryParents.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('generic project save Main-side CAS', () => {
  it('rejects revision 5 at the atomic replace boundary after Main and Renderer advance to revision 6', async () => {
    const root = await createRoot();
    const bootstrap = new ProjectService({
      createId: () => '19500000-0000-4000-8000-000000000001',
      now: () => new Date('2026-07-25T08:00:00.000Z'),
    });
    const created = await bootstrap.create(root, { name: 'CAS project' });
    const revisionFive = revision(created.project, 5);
    const revisionSix = revision(created.project, 6);
    await bootstrap.save(root, revisionFive, 5);

    let recoveryTime = 4_102_444_800_000;
    const recovery = new RecoveryService({
      nowMs: () => recoveryTime++,
    });
    const coordinator = new ProjectOperationCoordinator();
    const autosave = new AutosaveService({
      recoveryService: recovery,
      coordinator,
      clock: quietClock(),
    });
    autosave.track({
      projectRoot: root,
      project: revisionFive,
      dirty: true,
      revision: 5,
    });
    await autosave.tick(root);

    const enteredCommitBoundary = deferred();
    const releaseCommitBoundary = deferred();
    const onProjectSaved = vi.fn();
    const service = new ProjectService({
      coordinator,
      getCurrentProjectSnapshot: (projectRoot) =>
        autosave.getProjectSnapshot(projectRoot),
      fileSystem: new ProjectFileSystemService({
        beforeAtomicReplace: async () => {
          enteredCommitBoundary.resolve();
          await releaseCommitBoundary.promise;
        },
      }),
      onProjectSaved,
    });
    const renderer = new EditorProjectStore();
    renderer.open(root, created.project);
    for (let value = 1; value <= 5; value += 1) {
      renderer.updateProject(
        value === 5 ? revisionFive : revision(created.project, value),
      );
    }

    const saving = saveCurrentProject(responseApi(service), renderer);
    await enteredCommitBoundary.promise;
    renderer.updateProject(revisionSix);
    autosave.update({
      projectRoot: root,
      project: revisionSix,
      dirty: true,
      revision: 6,
    });
    await writeFile(
      path.join(root, 'project.json'),
      `${JSON.stringify(revisionSix, null, 2)}\n`,
      'utf8',
    );
    const latestRecovery = await recovery.writeRecovery(root, revisionSix);
    releaseCommitBoundary.resolve();
    const result = await saving;

    expect(result).toMatchObject({
      ok: false,
      savedRevision: 5,
      error: {
        code: 'PROJECT_SAVE_STALE_REVISION',
        currentRevision: 6,
        currentProject: { name: 'Revision 6' },
      },
    });
    expect(
      JSON.parse(await readFile(path.join(root, 'project.json'), 'utf8')),
    ).toMatchObject({ name: 'Revision 6' });
    expect(
      JSON.parse(await readFile(latestRecovery.recoveryFilePath, 'utf8')),
    ).toMatchObject({ project: { name: 'Revision 6' } });
    expect(autosave.getProjectSnapshot(root)).toMatchObject({
      project: { name: 'Revision 6' },
      dirty: true,
      revision: 6,
    });
    expect(renderer.getSnapshot()).toMatchObject({
      project: { name: 'Revision 6' },
      dirty: true,
      revision: 6,
    });
    expect(onProjectSaved).not.toHaveBeenCalled();
    expect(
      (await readdir(root)).filter((name) => name.endsWith('.tmp')),
    ).toEqual([]);
  });

  it('commits a matching authoritative revision and only then cleans recovery and marks the session saved', async () => {
    const root = await createRoot();
    const bootstrap = new ProjectService({
      createId: () => '19500000-0000-4000-8000-000000000002',
    });
    const created = await bootstrap.create(root, { name: 'normal save' });
    const revisionSix = revision(created.project, 6);
    const recovery = new RecoveryService({
      nowMs: () => 4_102_444_800_100,
    });
    const coordinator = new ProjectOperationCoordinator();
    const autosave = new AutosaveService({
      recoveryService: recovery,
      coordinator,
      clock: quietClock(),
    });
    autosave.track({
      projectRoot: root,
      project: revisionSix,
      dirty: true,
      revision: 6,
    });
    await autosave.tick(root);
    const service = new ProjectService({
      coordinator,
      getCurrentProjectSnapshot: (projectRoot) =>
        autosave.getProjectSnapshot(projectRoot),
      onProjectSaved: async (projectRoot, project, savedRevision) => {
        await recovery.cleanupAfterFormalSave(projectRoot, project.id);
        autosave.markFormalSaved(
          projectRoot,
          project,
          savedRevision!,
        );
      },
    });

    await expect(service.save(root, revisionSix, 6)).resolves.toMatchObject({
      project: { name: 'Revision 6' },
    });
    expect(autosave.getProjectSnapshot(root)).toMatchObject({
      project: { name: 'Revision 6' },
      dirty: false,
      revision: 6,
    });
    expect(await readdir(path.join(root, 'recovery'))).toEqual([]);
    expect(
      (await readdir(root)).filter((name) => name.endsWith('.tmp')),
    ).toEqual([]);
  });
});

import { createHash } from 'node:crypto';
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Project } from '../../src/domain';
import {
  AutosaveService,
  type AutosaveClock,
} from '../../src/main/services/AutosaveService';
import { ProjectService } from '../../src/main/services/ProjectService';
import {
  RecoveryFileSystemService,
} from '../../src/main/services/RecoveryFileSystemService';
import {
  RecoveryService,
} from '../../src/main/services/RecoveryService';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';

const temporaryParents: string[] = [];
const FIXED_NOW = '2026-07-24T00:00:00.000Z';
const PROJECT_IDS = [
  'a0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000002',
];
const RECOVERY_TIME = 4_102_444_800_000;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function newProjectRoot(): Promise<string> {
  const parent = await mkdtemp(
    path.join(os.tmpdir(), 'panda-stage-day13-'),
  );
  temporaryParents.push(parent);
  return path.join(parent, '崩溃 恢复 project 🐼.pandastage');
}

async function createProject(projectRoot: string): Promise<{
  service: ProjectService;
  project: Project;
}> {
  let idIndex = 0;
  const service = new ProjectService({
    now: () => new Date(FIXED_NOW),
    createId: () => PROJECT_IDS[idIndex++]!,
  });
  const created = await service.create(projectRoot, {
    name: 'Formal project',
  });
  return { service, project: created.project };
}

const inertClock: AutosaveClock = {
  setInterval: () =>
    1 as unknown as ReturnType<typeof setInterval>,
  clearInterval: () => undefined,
};

afterEach(async () => {
  await Promise.all(
    temporaryParents.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('crash recovery lifecycle', () => {
  it('restores the latest autosave after a simulated crash without overwriting the formal project', async () => {
    const projectRoot = await newProjectRoot();
    const { project: formalProject } = await createProject(projectRoot);
    const formalFilePath = path.join(projectRoot, 'project.json');
    const formalHashBeforeRecovery = sha256(
      await readFile(formalFilePath, 'utf8'),
    );
    const recoveryTime = RECOVERY_TIME;
    const recoveryService = new RecoveryService({
      nowMs: () => recoveryTime,
    });
    const latestProject = {
      ...formalProject,
      name: 'Latest unsaved edit',
      updatedAt: '2026-07-24T00:00:00.000Z',
    };
    const processBeforeCrash = new AutosaveService({
      recoveryService,
      clock: inertClock,
    });
    processBeforeCrash.track({
      projectRoot,
      project: formalProject,
      dirty: false,
      revision: 0,
    });
    processBeforeCrash.update({
      projectRoot,
      project: latestProject,
      dirty: true,
      revision: 1,
    });
    await processBeforeCrash.tick(projectRoot);

    // Simulate abrupt termination by abandoning the in-memory service without
    // deleting or acknowledging its recovery file, then construct fresh
    // services as a restarted process would.
    const restartedRecoveryService = new RecoveryService();
    const restartedProjectService = new ProjectService();
    const reopened = await restartedProjectService.open(projectRoot);
    const candidate = await restartedRecoveryService.detectLatest(
      projectRoot,
      reopened.project,
    );

    expect(candidate).not.toBeNull();
    expect(candidate?.project).toEqual(latestProject);
    expect(candidate?.project.name).toBe('Latest unsaved edit');
    expect(candidate?.savedAtMs).toBe(recoveryTime);
    expect(path.basename(candidate!.recoveryFilePath)).toBe(
      `${formalProject.id}.${recoveryTime}.recovery.json`,
    );
    expect(sha256(await readFile(formalFilePath, 'utf8'))).toBe(
      formalHashBeforeRecovery,
    );

    const restored = await restartedRecoveryService.restore(
      projectRoot,
      candidate!.recoveryFilePath,
      formalProject.id,
    );
    expect(restored.project).toEqual(latestProject);
    const store = new EditorProjectStore();
    store.open(projectRoot, reopened.project);
    store.restore(restored.project);
    expect(store.getSnapshot()).toMatchObject({
      dirty: true,
      project: { name: 'Latest unsaved edit' },
    });
    expect(sha256(await readFile(formalFilePath, 'utf8'))).toBe(
      formalHashBeforeRecovery,
    );
    console.info(
      `DAY13_CRASH_RECOVERY_EVIDENCE candidate=${path.basename(candidate!.recoveryFilePath)} formalBefore=${formalHashBeforeRecovery} formalAfterRestore=${sha256(await readFile(formalFilePath, 'utf8'))} dirty=${String(store.getSnapshot()!.dirty)}`,
    );

    await restartedRecoveryService.ignore(
      projectRoot,
      candidate!.recoveryFilePath,
      formalProject.id,
    );
    await expect(access(candidate!.recoveryFilePath)).resolves.toBeUndefined();

    const saveService = new ProjectService({
      onProjectSaved: (root, project) =>
        restartedRecoveryService.cleanupAfterFormalSave(root, project.id),
    });
    await saveService.save(projectRoot, store.getSnapshot()!.project);

    expect(
      await restartedRecoveryService.detectLatest(
        projectRoot,
        store.getSnapshot()!.project,
      ),
    ).toBeNull();
    expect(await readdir(path.join(projectRoot, 'recovery'))).toEqual([]);
    expect(sha256(await readFile(formalFilePath, 'utf8'))).not.toBe(
      formalHashBeforeRecovery,
    );
  });

  it('keeps only the latest recovery snapshot for a project', async () => {
    const projectRoot = await newProjectRoot();
    const { project } = await createProject(projectRoot);
    let recoveryTime = RECOVERY_TIME;
    const recoveryService = new RecoveryService({
      nowMs: () => recoveryTime,
    });

    await recoveryService.writeRecovery(projectRoot, {
      ...project,
      name: 'First unsaved edit',
    });
    recoveryTime += 30_000;
    const latest = await recoveryService.writeRecovery(projectRoot, {
      ...project,
      name: 'Second unsaved edit',
    });

    expect(await readdir(path.join(projectRoot, 'recovery'))).toEqual([
      path.basename(latest.recoveryFilePath),
    ]);
    expect(
      (
        await recoveryService.detectLatest(projectRoot, project)
      )?.project.name,
    ).toBe('Second unsaved edit');
  });

  it('skips a corrupt recovery without changing the formal project', async () => {
    const projectRoot = await newProjectRoot();
    const { project } = await createProject(projectRoot);
    const formalFilePath = path.join(projectRoot, 'project.json');
    const formalHash = sha256(await readFile(formalFilePath, 'utf8'));
    const corruptPath = path.join(
      projectRoot,
      'recovery',
      `${project.id}.${RECOVERY_TIME}.recovery.json`,
    );
    await writeFile(corruptPath, '{"schemaVersion":1,', 'utf8');

    const candidate = await new RecoveryService().detectLatest(
      projectRoot,
      project,
    );

    expect(candidate).toBeNull();
    expect(sha256(await readFile(formalFilePath, 'utf8'))).toBe(formalHash);
    await expect(access(corruptPath)).resolves.toBeUndefined();
    await expect(
      new RecoveryService().restore(
        projectRoot,
        corruptPath,
        project.id,
      ),
    ).rejects.toMatchObject({
      code: 'RECOVERY_INVALID',
      projectRoot,
    });
    expect(sha256(await readFile(formalFilePath, 'utf8'))).toBe(formalHash);
  });

  it('does not offer a valid recovery that is older than project.json', async () => {
    const projectRoot = await newProjectRoot();
    const { project } = await createProject(projectRoot);
    const recoveryService = new RecoveryService({
      nowMs: () => 0,
    });
    const recovery = await recoveryService.writeRecovery(projectRoot, {
      ...project,
      name: 'Old snapshot',
    });

    expect(
      await recoveryService.detectLatest(projectRoot, project),
    ).toBeNull();
    await expect(access(recovery.recoveryFilePath)).resolves.toBeUndefined();
  });

  it('does not offer or restore a recovery for another project identity', async () => {
    const projectRoot = await newProjectRoot();
    const { project } = await createProject(projectRoot);
    const formalFilePath = path.join(projectRoot, 'project.json');
    const formalHash = sha256(await readFile(formalFilePath, 'utf8'));
    const recoveryService = new RecoveryService({
      nowMs: () => RECOVERY_TIME,
    });
    const otherProject = {
      ...project,
      id: 'b0000000-0000-4000-8000-000000000001',
      name: 'Another project',
    };
    const otherRecovery = await recoveryService.writeRecovery(
      projectRoot,
      otherProject,
    );

    expect(
      await recoveryService.detectLatest(projectRoot, project),
    ).toBeNull();
    await expect(
      recoveryService.restore(
        projectRoot,
        otherRecovery.recoveryFilePath,
        project.id,
      ),
    ).rejects.toMatchObject({
      code: 'RECOVERY_PROJECT_MISMATCH',
      projectRoot,
    });
    expect(sha256(await readFile(formalFilePath, 'utf8'))).toBe(formalHash);
  });

  it('preserves the previous recovery and removes temporary files when a write fails', async () => {
    const projectRoot = await newProjectRoot();
    const { project } = await createProject(projectRoot);
    let recoveryTime = RECOVERY_TIME;
    const recoveryService = new RecoveryService({
      nowMs: () => recoveryTime,
    });
    const previous = await recoveryService.writeRecovery(projectRoot, {
      ...project,
      name: 'Previous recovery',
    });
    const previousHash = sha256(
      await readFile(previous.recoveryFilePath, 'utf8'),
    );
    recoveryTime += 30_000;
    const injectedFailure = Object.assign(
      new Error('Injected recovery disk failure.'),
      { code: 'EIO' },
    );
    const failingService = new RecoveryService({
      nowMs: () => recoveryTime,
      fileSystem: new RecoveryFileSystemService({
        afterTemporarySync: () => {
          throw injectedFailure;
        },
      }),
    });

    await expect(
      failingService.writeRecovery(projectRoot, {
        ...project,
        name: 'Must not replace previous recovery',
      }),
    ).rejects.toMatchObject({
      code: 'RECOVERY_WRITE_FAILED',
      projectRoot,
    });

    expect(sha256(await readFile(previous.recoveryFilePath, 'utf8'))).toBe(
      previousHash,
    );
    const entries = await readdir(path.join(projectRoot, 'recovery'));
    expect(entries).toEqual([path.basename(previous.recoveryFilePath)]);
    expect(entries.some((entry) => entry.endsWith('.tmp'))).toBe(false);
  });

  it('does not create a missing project root while writing recovery', async () => {
    const sourceRoot = await newProjectRoot();
    const { project } = await createProject(sourceRoot);
    const missingRoot = await newProjectRoot();

    await expect(
      new RecoveryService().writeRecovery(missingRoot, project),
    ).rejects.toMatchObject({
      code: 'RECOVERY_WRITE_FAILED',
      projectRoot: path.resolve(missingRoot),
    });
    await expect(access(missingRoot)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

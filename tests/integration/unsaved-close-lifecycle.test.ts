import {
  mkdtemp,
  readFile,
  readdir,
  rm,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AutosaveService,
  type AutosaveClock,
} from '../../src/main/services/AutosaveService';
import { ProjectFileSystemService } from '../../src/main/services/ProjectFileSystemService';
import { ProjectOperationCoordinator } from '../../src/main/services/ProjectOperationCoordinator';
import { ProjectService } from '../../src/main/services/ProjectService';
import { RecoveryService } from '../../src/main/services/RecoveryService';
import { RecoveryFileSystemService } from '../../src/main/services/RecoveryFileSystemService';
import { UnsavedCloseController } from '../../src/main/services/UnsavedCloseController';
import { UnsavedCloseGuard } from '../../src/main/windows/unsaved-close-guard';

const temporaryDirectories: string[] = [];
const IDS = [
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000002',
];
const inertClock: AutosaveClock = {
  setInterval: () =>
    1 as unknown as ReturnType<typeof setInterval>,
  clearInterval: () => undefined,
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function projectRoot(): Promise<string> {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'panda-close-'));
  temporaryDirectories.push(parent);
  return path.join(parent, '关闭测试 中文.pandastage');
}

describe('unsaved close integration lifecycle', () => {
  it('opens dirty state, cancels once, then saves and closes', async () => {
    const root = await projectRoot();
    let idIndex = 0;
    const coordinator = new ProjectOperationCoordinator();
    const autosave = new AutosaveService({
      recoveryService: new RecoveryService(),
      coordinator,
      clock: inertClock,
    });
    const projects = new ProjectService({
      coordinator,
      createId: () => IDS[idIndex++]!,
      onProjectSaved: (_root, project, revision) => {
        autosave.markFormalSaved(root, project, revision!);
      },
    });
    const created = await projects.create(root, { name: '关闭前' });
    const dirtyProject = {
      ...created.project,
      name: '保存后退出',
    };
    autosave.track({
      projectRoot: root,
      project: created.project,
      dirty: false,
      revision: 0,
    });
    autosave.update({
      projectRoot: root,
      project: dirtyProject,
      dirty: true,
      revision: 1,
    });
    const choices = ['cancel', 'save'] as const;
    let choiceIndex = 0;
    const closeWindow = vi.fn();
    const controller = new UnsavedCloseController({
      getDirtyProject: () => autosave.getDirtyProjectSnapshot(),
      prompt: async () => choices[choiceIndex++]!,
      save: async (snapshot) => {
        await projects.save(
          snapshot.projectRoot,
          snapshot.project,
          snapshot.revision,
        );
      },
      discard: (snapshot) =>
        autosave.discard(snapshot.projectRoot, snapshot.project.id),
      reportSaveFailure: vi.fn(),
      reportDiscardFailure: vi.fn(),
    });
    const guard = new UnsavedCloseGuard({
      controller,
      closeWindow,
      quitApplication: vi.fn(),
    });

    guard.handleWindowClose({ preventDefault: vi.fn() });
    await guard.waitForIdle();
    expect(closeWindow).not.toHaveBeenCalled();
    expect(autosave.getDirtyProjectSnapshot()).not.toBeNull();

    guard.handleWindowClose({ preventDefault: vi.fn() });
    await guard.waitForIdle();
    expect(closeWindow).toHaveBeenCalledOnce();
    expect(autosave.getDirtyProjectSnapshot()).toBeNull();
    expect(
      JSON.parse(
        await readFile(path.join(root, 'project.json'), 'utf8'),
      ),
    ).toMatchObject({ name: '保存后退出' });
    await autosave.stopAll();
  });

  it('keeps the window and formal file unchanged when save before close fails', async () => {
    const root = await projectRoot();
    let idIndex = 0;
    const creator = new ProjectService({
      createId: () => IDS[idIndex++]!,
    });
    const created = await creator.create(root, { name: '原正式项目' });
    const before = await readFile(path.join(root, 'project.json'), 'utf8');
    const injected = Object.assign(new Error('Injected close save fault.'), {
      code: 'EIO',
    });
    const failingProjects = new ProjectService({
      fileSystem: new ProjectFileSystemService({
        beforeTemporaryWrite: () => {
          throw injected;
        },
      }),
    });
    const dirtySnapshot = {
      projectRoot: root,
      project: { ...created.project, name: '不得错误关闭' },
      dirty: true,
      revision: 1,
    };
    const reportSaveFailure = vi.fn();
    const closeWindow = vi.fn();
    const controller = new UnsavedCloseController({
      getDirtyProject: () => dirtySnapshot,
      prompt: async () => 'save',
      save: async (snapshot) => {
        await failingProjects.save(
          snapshot.projectRoot,
          snapshot.project,
          snapshot.revision,
        );
      },
      discard: vi.fn(),
      reportSaveFailure,
      reportDiscardFailure: vi.fn(),
    });
    const guard = new UnsavedCloseGuard({
      controller,
      closeWindow,
      quitApplication: vi.fn(),
    });

    guard.handleWindowClose({ preventDefault: vi.fn() });
    await guard.waitForIdle();

    expect(closeWindow).not.toHaveBeenCalled();
    expect(reportSaveFailure).toHaveBeenCalledWith(
      dirtySnapshot,
      expect.objectContaining({ code: 'SAVE_FAILED' }),
    );
    expect(await readFile(path.join(root, 'project.json'), 'utf8')).toBe(
      before,
    );
  });

  it('clears existing recovery before allowing discard close without changing formal bytes', async () => {
    const root = await projectRoot();
    const projects = new ProjectService({ createId: () => IDS[0]! });
    const created = await projects.create(root, { name: 'Formal' });
    const before = await readFile(path.join(root, 'project.json'), 'utf8');
    const recovery = new RecoveryService({
      nowMs: () => 4_102_444_800_000,
    });
    const autosave = new AutosaveService({
      recoveryService: recovery,
      clock: inertClock,
    });
    autosave.track({
      projectRoot: root,
      project: { ...created.project, name: 'Dirty' },
      dirty: true,
      revision: 1,
    });
    await autosave.tick(root);
    const controller = new UnsavedCloseController({
      getDirtyProject: () => autosave.getDirtyProjectSnapshot(),
      prompt: async () => 'discard',
      save: vi.fn(),
      discard: (snapshot) =>
        autosave.discard(snapshot.projectRoot, snapshot.project.id),
      reportSaveFailure: vi.fn(),
      reportDiscardFailure: vi.fn(),
    });

    await expect(controller.requestClose()).resolves.toBe('allow-close');
    expect(await readFile(path.join(root, 'project.json'), 'utf8')).toBe(
      before,
    );
    expect(await readdir(path.join(root, 'recovery'))).toEqual([]);
    await expect(
      recovery.detectLatest(root, created.project),
    ).resolves.toBeNull();
    expect(autosave.trackedProjectCount()).toBe(0);
    await autosave.tick(root);
    expect(await readdir(path.join(root, 'recovery'))).toEqual([]);
  });

  it('waits for an in-flight autosave, then removes its recovery before discard close', async () => {
    const root = await projectRoot();
    const projects = new ProjectService({ createId: () => IDS[0]! });
    const created = await projects.create(root, { name: 'Formal' });
    let releaseWrite!: () => void;
    let markWriteEntered!: () => void;
    const writeEntered = new Promise<void>((resolve) => {
      markWriteEntered = resolve;
    });
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const recovery = new RecoveryService({
      nowMs: () => 4_102_444_800_000,
      fileSystem: new RecoveryFileSystemService({
        afterTemporarySync: async () => {
          markWriteEntered();
          await writeGate;
        },
      }),
    });
    const autosave = new AutosaveService({
      recoveryService: recovery,
      clock: inertClock,
    });
    autosave.track({
      projectRoot: root,
      project: { ...created.project, name: 'Dirty' },
      dirty: true,
      revision: 1,
    });
    const tick = autosave.tick(root);
    await writeEntered;
    const controller = new UnsavedCloseController({
      getDirtyProject: () => autosave.getDirtyProjectSnapshot(),
      prompt: async () => 'discard',
      save: vi.fn(),
      discard: (snapshot) =>
        autosave.discard(snapshot.projectRoot, snapshot.project.id),
      reportSaveFailure: vi.fn(),
      reportDiscardFailure: vi.fn(),
    });
    let settled = false;
    const close = controller.requestClose().finally(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseWrite();

    await tick;
    await expect(close).resolves.toBe('allow-close');
    expect(await readdir(path.join(root, 'recovery'))).toEqual([]);
  });

  it('keeps the window open when discard cleanup deletion fails', async () => {
    const root = await projectRoot();
    const projects = new ProjectService({ createId: () => IDS[0]! });
    const created = await projects.create(root, { name: 'Formal' });
    const before = await readFile(path.join(root, 'project.json'), 'utf8');
    const recovery = new RecoveryService({
      nowMs: () => 4_102_444_800_000,
      fileSystem: new RecoveryFileSystemService({
        beforeRemoveFile: () => {
          throw Object.assign(new Error('Injected deletion failure.'), {
            code: 'EACCES',
          });
        },
      }),
    });
    const autosave = new AutosaveService({
      recoveryService: recovery,
      clock: inertClock,
    });
    autosave.track({
      projectRoot: root,
      project: { ...created.project, name: 'Dirty' },
      dirty: true,
      revision: 1,
    });
    await autosave.tick(root);
    const reportDiscardFailure = vi.fn();
    const closeWindow = vi.fn();
    const controller = new UnsavedCloseController({
      getDirtyProject: () => autosave.getDirtyProjectSnapshot(),
      prompt: async () => 'discard',
      save: vi.fn(),
      discard: (snapshot) =>
        autosave.discard(snapshot.projectRoot, snapshot.project.id),
      reportSaveFailure: vi.fn(),
      reportDiscardFailure,
    });
    const guard = new UnsavedCloseGuard({
      controller,
      closeWindow,
      quitApplication: vi.fn(),
    });

    guard.handleWindowClose({ preventDefault: vi.fn() });
    await guard.waitForIdle();

    expect(closeWindow).not.toHaveBeenCalled();
    expect(reportDiscardFailure).toHaveBeenCalledOnce();
    expect(autosave.getDirtyProjectSnapshot()).not.toBeNull();
    expect(await readFile(path.join(root, 'project.json'), 'utf8')).toBe(
      before,
    );
  });
});

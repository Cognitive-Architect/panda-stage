import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectSchema, type Project } from '../../src/domain';
import {
  AutosaveService,
  type AutosaveClock,
} from '../../src/main/services/AutosaveService';
import { ProjectService } from '../../src/main/services/ProjectService';
import { RecoveryService } from '../../src/main/services/RecoveryService';
import {
  ProjectSessionController,
  ProjectSessionSwitchError,
  type ProjectSessionApi,
} from '../../src/renderer/features/recovery/ProjectSessionController';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';

const temporaryParents: string[] = [];
const FIXED_NOW = '2026-07-31T00:00:00.000Z';
const RECOVERY_TIME = 4_102_444_800_000;
const PROJECT_ID = 'd0000000-0000-4000-8000-000000000001';

const inertClock: AutosaveClock = {
  setInterval: () => 1 as unknown as ReturnType<typeof setInterval>,
  clearInterval: () => undefined,
};

afterEach(async () => {
  await Promise.all(
    temporaryParents.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function newProjectRoot(): Promise<string> {
  const parent = await mkdtemp(
    path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-stage-close-'),
  );
  temporaryParents.push(parent);
  return path.join(parent, '关闭 确认 project 🐼.pandastage');
}

interface Harness {
  autosave: AutosaveService;
  controller: ProjectSessionController;
  recoveryService: RecoveryService;
  store: EditorProjectStore;
  projectRoot: string;
  project: Project;
  stop: ReturnType<typeof vi.fn>;
  ignore: ReturnType<typeof vi.fn>;
  failNextStop: (fail: boolean) => void;
}

async function createHarness(): Promise<Harness> {
  const projectRoot = await newProjectRoot();
  const projectService = new ProjectService({
    now: () => new Date(FIXED_NOW),
    createId: () => PROJECT_ID,
  });
  const created = await projectService.create(projectRoot, {
    name: '关闭确认项目',
  });
  const recoveryService = new RecoveryService({
    nowMs: () => RECOVERY_TIME,
  });
  const autosave = new AutosaveService({
    recoveryService,
    clock: inertClock,
  });
  const ignore = vi.fn();
  let stopFails = false;
  const stop = vi.fn(async (root: string) => {
    if (stopFails) {
      return {
        ok: false as const,
        error: {
          code: 'RECOVERY_READ_FAILED' as const,
          message: '无法停止自动保存。',
          projectRoot: root,
        },
      };
    }
    await autosave.stop(root);
    return { ok: true as const };
  });
  const api: ProjectSessionApi = {
    open: vi.fn(async (root: string) => ({
      ok: true as const,
      value: {
        projectRoot: root,
        projectFilePath: path.join(root, 'project.json'),
        project: created.project,
        migrated: false,
        sourceVersion: 1 as const,
      },
    })),
    openRecent: vi.fn(),
    track: vi.fn(async (request) => {
      autosave.track(request);
      return { ok: true as const };
    }),
    stop,
    detect: vi.fn(async () => ({
      ok: true as const,
      candidate: null,
    })),
    confirmSwitch: vi.fn(),
  };
  const store = new EditorProjectStore();
  const controller = new ProjectSessionController(api, store);
  return {
    autosave,
    controller,
    recoveryService,
    store,
    projectRoot,
    project: created.project,
    stop,
    ignore,
    failNextStop: (fail: boolean) => {
      stopFails = fail;
    },
  };
}

/**
 * A freshly created project has no shots, so the smallest honest unsaved edit
 * is a rename of the project itself.
 */
function dirtyProject(project: Project, draftName: string): Project {
  return ProjectSchema.parse({
    ...structuredClone(project),
    name: draftName,
  });
}

describe('in-app close project lifecycle', () => {
  it('closes without saving and retains the recovery record', async () => {
    const harness = await createHarness();
    await harness.controller.switchProject(harness.projectRoot);
    harness.store.updateProject(
      dirtyProject(harness.project, '未保存的项目名'),
    );
    const dirtySnapshot = harness.store.getSnapshot();
    expect(dirtySnapshot?.dirty).toBe(true);
    harness.autosave.update(dirtySnapshot!);
    // Autosave writes the crash-recovery file the user would later recover.
    await harness.autosave.tick(harness.projectRoot);
    const beforeClose = await harness.recoveryService.detectLatest(
      harness.projectRoot,
      harness.project,
    );
    expect(beforeClose?.project.name).toBe('未保存的项目名');

    const snapshot = await harness.controller.closeProject();

    // Exactly one Main Process call: stop autosave tracking.
    expect(harness.stop).toHaveBeenCalledTimes(1);
    expect(harness.stop).toHaveBeenCalledWith(harness.projectRoot);
    expect(snapshot).toEqual({
      trackedProjectRoot: null,
      recoveryCandidate: null,
    });
    expect(harness.store.getSnapshot()).toBeNull();

    // Ruling 4: the recovery record survives an in-app unsaved close, so the
    // next open of this project can still offer the recovery candidate.
    const afterClose = await harness.recoveryService.detectLatest(
      harness.projectRoot,
      harness.project,
    );
    expect(afterClose).not.toBeNull();
    expect(afterClose?.projectId).toBe(harness.project.id);
    expect(afterClose?.project.name).toBe('未保存的项目名');
    expect(afterClose?.recoveryFilePath).toBe(
      beforeClose?.recoveryFilePath,
    );
    expect(harness.ignore).not.toHaveBeenCalled();
  });

  it('surfaces the retained recovery candidate when the project reopens', async () => {
    const harness = await createHarness();
    await harness.controller.switchProject(harness.projectRoot);
    harness.store.updateProject(
      dirtyProject(harness.project, '关闭前的项目草稿'),
    );
    harness.autosave.update(harness.store.getSnapshot()!);
    await harness.autosave.tick(harness.projectRoot);
    await harness.controller.closeProject();

    const candidate = await harness.recoveryService.detectLatest(
      harness.projectRoot,
      harness.project,
    );
    expect(candidate?.project.name).toBe('关闭前的项目草稿');

    // Reopening goes through the same single session controller.
    const reopened = await harness.controller.switchProject(
      harness.projectRoot,
    );
    expect(reopened.trackedProjectRoot).toBe(harness.projectRoot);
    expect(harness.store.getSnapshot()?.dirty).toBe(false);
    const stillThere = await harness.recoveryService.detectLatest(
      harness.projectRoot,
      harness.project,
    );
    expect(stillThere?.recoveryFilePath).toBe(candidate?.recoveryFilePath);
  });

  it('closes a clean project and stops tracking exactly once', async () => {
    const harness = await createHarness();
    await harness.controller.switchProject(harness.projectRoot);
    expect(harness.store.getSnapshot()?.dirty).toBe(false);

    await harness.controller.closeProject();

    expect(harness.stop).toHaveBeenCalledTimes(1);
    expect(harness.store.getSnapshot()).toBeNull();
    expect(harness.controller.getSnapshot().trackedProjectRoot).toBeNull();

    // A second close is a no-op: nothing is tracked, so nothing is stopped.
    await harness.controller.closeProject();
    expect(harness.stop).toHaveBeenCalledTimes(1);
  });

  it('keeps the project open when autosave cannot be stopped', async () => {
    const harness = await createHarness();
    await harness.controller.switchProject(harness.projectRoot);
    harness.store.updateProject(
      dirtyProject(harness.project, '停止失败的项目草稿'),
    );
    harness.failNextStop(true);

    await expect(harness.controller.closeProject()).rejects.toThrow(
      ProjectSessionSwitchError,
    );

    const snapshot = harness.store.getSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.projectRoot).toBe(harness.projectRoot);
    expect(snapshot?.dirty).toBe(true);
    expect(snapshot?.project.name).toBe('停止失败的项目草稿');
    expect(harness.controller.getSnapshot().trackedProjectRoot).toBe(
      harness.projectRoot,
    );

    // Retrying after the failure clears succeeds.
    harness.failNextStop(false);
    await harness.controller.closeProject();
    expect(harness.store.getSnapshot()).toBeNull();
  });

  it('reports a distinct error code for a failed close', async () => {
    const harness = await createHarness();
    await harness.controller.switchProject(harness.projectRoot);
    harness.failNextStop(true);

    await expect(
      harness.controller.closeProject(),
    ).rejects.toMatchObject({
      name: 'ProjectSessionSwitchError',
      code: 'CLOSE_STOP_FAILED',
      message: '无法停止自动保存。',
    });
  });
});

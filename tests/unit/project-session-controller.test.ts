import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectSchema, type Project } from '../../src/domain';
import {
  AutosaveService,
  type AutosaveClock,
} from '../../src/main/services/AutosaveService';
import type { RecoveryService } from '../../src/main/services/RecoveryService';
import {
  ProjectSessionController,
  type ProjectSessionApi,
} from '../../src/renderer/features/recovery/ProjectSessionController';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import type { RecoveryCandidate } from '../../src/shared/recovery-api';
import exampleProject from '../../demo-project/project-v1.example.json';

const PROJECT_A_ROOT = 'D:\\projects\\a.pandastage';
const PROJECT_A_ALIAS =
  'D:\\projects\\temp\\..\\a.pandastage';
const PROJECT_B_ROOT = 'D:\\projects\\b.pandastage';
const PROJECT_A = ProjectSchema.parse(exampleProject);
const PROJECT_B = ProjectSchema.parse({
  ...structuredClone(exampleProject),
  id: 'c0000000-0000-4000-8000-000000000001',
  name: 'Project B',
});
const inertClock: AutosaveClock = {
  setInterval: () =>
    1 as unknown as ReturnType<typeof setInterval>,
  clearInterval: () => undefined,
};

function operationError(projectRoot: string, message: string) {
  return {
    ok: false as const,
    error: {
      code: 'OPEN_FAILED' as const,
      message,
      projectRoot,
    },
  };
}

function recoveryError(projectRoot: string, message: string) {
  return {
    ok: false as const,
    error: {
      code: 'RECOVERY_READ_FAILED' as const,
      message,
      projectRoot,
    },
  };
}

function candidate(
  projectRoot: string,
  project: Project,
): RecoveryCandidate {
  return {
    projectRoot,
    recoveryFilePath: `${projectRoot}\\recovery\\${project.id}.4102444800000.recovery.json`,
    projectId: project.id,
    savedAtMs: 4_102_444_800_000,
    project,
  };
}

interface Harness {
  autosave: AutosaveService;
  controller: ProjectSessionController;
  store: EditorProjectStore;
  writeRecovery: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  track: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  detect: ReturnType<typeof vi.fn>;
  trackFailures: Set<string>;
  stopFailures: Set<string>;
  detectFailures: Set<string>;
  candidates: Map<string, RecoveryCandidate | null>;
}

function createHarness(): Harness {
  const writeRecovery = vi.fn().mockResolvedValue({});
  const autosave = new AutosaveService({
    recoveryService: {
      writeRecovery,
    } as unknown as RecoveryService,
    clock: inertClock,
  });
  const documents = new Map([
    [PROJECT_A_ROOT, PROJECT_A],
    [PROJECT_B_ROOT, PROJECT_B],
  ]);
  const trackFailures = new Set<string>();
  const stopFailures = new Set<string>();
  const detectFailures = new Set<string>();
  const candidates = new Map<string, RecoveryCandidate | null>();
  const open = vi.fn(async (projectRoot: string) => {
    const normalizedRoot =
      projectRoot === PROJECT_A_ALIAS ? PROJECT_A_ROOT : projectRoot;
    const project = documents.get(normalizedRoot);
    if (!project) return operationError(projectRoot, 'Project not found.');
    return {
      ok: true as const,
      value: {
        projectRoot: normalizedRoot,
        projectFilePath: `${normalizedRoot}\\project.json`,
        project,
        migrated: false,
        sourceVersion: 1 as const,
      },
    };
  });
  const stop = vi.fn(async (projectRoot: string) => {
    await autosave.stop(projectRoot);
    if (stopFailures.has(projectRoot)) {
      return recoveryError(projectRoot, 'Injected stop failure.');
    }
    return { ok: true as const };
  });
  const track = vi.fn(async (request) => {
    if (trackFailures.has(request.projectRoot)) {
      return recoveryError(
        request.projectRoot,
        'Injected track failure.',
      );
    }
    autosave.track(request);
    return { ok: true as const };
  });
  const detect = vi.fn(async (projectRoot: string) => {
    if (detectFailures.has(projectRoot)) {
      return recoveryError(
        projectRoot,
        'Injected detect failure.',
      );
    }
    return {
      ok: true as const,
      candidate: candidates.get(projectRoot) ?? null,
    };
  });
  const api: ProjectSessionApi = {
    open,
    track,
    stop,
    detect,
  };
  const store = new EditorProjectStore();
  const controller = new ProjectSessionController(api, store);
  return {
    autosave,
    controller,
    store,
    writeRecovery,
    open,
    track,
    stop,
    detect,
    trackFailures,
    stopFailures,
    detectFailures,
    candidates,
  };
}

async function openDirtyProjectA(harness: Harness): Promise<void> {
  await harness.controller.switchProject(PROJECT_A_ROOT);
  harness.store.updateProject({
    ...PROJECT_A,
    name: 'Unsaved A',
  });
  harness.autosave.update(harness.store.getSnapshot()!);
}

describe('ProjectSessionController transactional switching', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  it('keeps the old dirty project and autosave when opening the new path fails', async () => {
    await openDirtyProjectA(harness);
    const oldSnapshot = harness.store.getSnapshot();

    await expect(
      harness.controller.switchProject('D:\\missing.pandastage'),
    ).rejects.toMatchObject({ code: 'OPEN_FAILED' });

    expect(harness.store.getSnapshot()).toBe(oldSnapshot);
    expect(harness.controller.getSnapshot().trackedProjectRoot).toBe(
      PROJECT_A_ROOT,
    );
    expect(harness.autosave.trackedProjectCount()).toBe(1);
    await harness.autosave.tick(PROJECT_A_ROOT);
    expect(harness.writeRecovery).toHaveBeenCalledWith(
      PROJECT_A_ROOT,
      expect.objectContaining({ name: 'Unsaved A' }),
    );
  });

  it('rolls back a failed new-project track without stopping the old session', async () => {
    await openDirtyProjectA(harness);
    const oldSnapshot = harness.store.getSnapshot();
    harness.trackFailures.add(PROJECT_B_ROOT);

    await expect(
      harness.controller.switchProject(PROJECT_B_ROOT),
    ).rejects.toMatchObject({ code: 'TRACK_FAILED' });

    expect(harness.store.getSnapshot()).toBe(oldSnapshot);
    expect(harness.autosave.trackedProjectCount()).toBe(1);
    expect(harness.stop).toHaveBeenCalledWith(PROJECT_B_ROOT);
    expect(harness.stop).not.toHaveBeenCalledWith(PROJECT_A_ROOT);
  });

  it('removes the temporary session when recovery detection fails', async () => {
    await openDirtyProjectA(harness);
    const oldSnapshot = harness.store.getSnapshot();
    harness.detectFailures.add(PROJECT_B_ROOT);

    await expect(
      harness.controller.switchProject(PROJECT_B_ROOT),
    ).rejects.toMatchObject({ code: 'DETECT_FAILED' });

    expect(harness.store.getSnapshot()).toBe(oldSnapshot);
    expect(harness.autosave.trackedProjectCount()).toBe(1);
    expect(harness.stop).toHaveBeenCalledWith(PROJECT_B_ROOT);
    expect(harness.stop).not.toHaveBeenCalledWith(PROJECT_A_ROOT);
  });

  it('commits store, timer, tracked root, and candidate together on success', async () => {
    await harness.controller.switchProject(PROJECT_A_ROOT);
    const projectBCandidate = candidate(PROJECT_B_ROOT, PROJECT_B);
    harness.candidates.set(PROJECT_B_ROOT, projectBCandidate);

    const switched = await harness.controller.switchProject(
      PROJECT_B_ROOT,
    );

    expect(harness.autosave.trackedProjectCount()).toBe(1);
    expect(harness.stop).toHaveBeenCalledWith(PROJECT_A_ROOT);
    expect(harness.store.getSnapshot()).toMatchObject({
      projectRoot: PROJECT_B_ROOT,
      project: { id: PROJECT_B.id },
      dirty: false,
    });
    expect(switched).toEqual({
      trackedProjectRoot: PROJECT_B_ROOT,
      recoveryCandidate: projectBCandidate,
    });
  });

  it('restores the old autosave session when stopping it reports failure', async () => {
    await openDirtyProjectA(harness);
    const oldSnapshot = harness.store.getSnapshot();
    harness.stopFailures.add(PROJECT_A_ROOT);

    await expect(
      harness.controller.switchProject(PROJECT_B_ROOT),
    ).rejects.toMatchObject({ code: 'STOP_FAILED' });

    expect(harness.store.getSnapshot()).toBe(oldSnapshot);
    expect(harness.autosave.trackedProjectCount()).toBe(1);
    expect(harness.controller.getSnapshot().trackedProjectRoot).toBe(
      PROJECT_A_ROOT,
    );
    await harness.autosave.tick(PROJECT_A_ROOT);
    expect(harness.writeRecovery).toHaveBeenCalledWith(
      PROJECT_A_ROOT,
      expect.objectContaining({ name: 'Unsaved A' }),
    );
  });

  it('blocks reopening the current dirty path without duplicating or stopping its timer', async () => {
    await openDirtyProjectA(harness);
    const oldSnapshot = harness.store.getSnapshot();

    await expect(
      harness.controller.switchProject('d:/projects/a.pandastage/'),
    ).rejects.toMatchObject({ code: 'CURRENT_PROJECT_DIRTY' });

    expect(harness.store.getSnapshot()).toBe(oldSnapshot);
    expect(harness.autosave.trackedProjectCount()).toBe(1);
    expect(harness.open).toHaveBeenCalledTimes(1);
    expect(harness.stop).not.toHaveBeenCalled();
  });

  it('blocks a dirty same-project dot-segment alias after Main normalizes it', async () => {
    harness.candidates.set(
      PROJECT_A_ROOT,
      candidate(PROJECT_A_ROOT, PROJECT_A),
    );
    await openDirtyProjectA(harness);
    const oldSnapshot = harness.store.getSnapshot();
    const oldSessionSnapshot = harness.controller.getSnapshot();

    await expect(
      harness.controller.switchProject(PROJECT_A_ALIAS),
    ).rejects.toMatchObject({ code: 'CURRENT_PROJECT_DIRTY' });

    expect(harness.open).toHaveBeenCalledWith(PROJECT_A_ALIAS);
    expect(harness.store.getSnapshot()).toBe(oldSnapshot);
    expect(harness.controller.getSnapshot().trackedProjectRoot).toBe(
      PROJECT_A_ROOT,
    );
    expect(harness.controller.getSnapshot()).toBe(oldSessionSnapshot);
    expect(harness.autosave.trackedProjectCount()).toBe(1);
    expect(harness.track).toHaveBeenCalledTimes(1);
    expect(harness.stop).not.toHaveBeenCalled();
  });

  it('re-detects a clean same-project dot-segment alias without replacing its session', async () => {
    await harness.controller.switchProject(PROJECT_A_ROOT);
    const projectACandidate = candidate(PROJECT_A_ROOT, PROJECT_A);
    harness.candidates.set(PROJECT_A_ROOT, projectACandidate);

    const reopened = await harness.controller.switchProject(
      PROJECT_A_ALIAS,
    );

    expect(harness.open).toHaveBeenCalledWith(PROJECT_A_ALIAS);
    expect(harness.track).toHaveBeenCalledTimes(1);
    expect(harness.stop).not.toHaveBeenCalled();
    expect(harness.detect).toHaveBeenCalledTimes(2);
    expect(harness.autosave.trackedProjectCount()).toBe(1);
    expect(harness.store.getSnapshot()).toMatchObject({
      projectRoot: PROJECT_A_ROOT,
      dirty: false,
    });
    expect(reopened).toEqual({
      trackedProjectRoot: PROJECT_A_ROOT,
      recoveryCandidate: projectACandidate,
    });
  });
});

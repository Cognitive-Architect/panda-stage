import { describe, expect, it, vi } from 'vitest';
import {
  EditorShellSession,
  getEditorShellState,
} from '../../src/renderer/shell/EditorShell';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { migrateProject } from '../../src/domain';
import type { RecoveryAcknowledgeResponse } from '../../src/shared/recovery-api';
import exampleProject from '../../demo-project/project-v1.example.json';

function createHarness() {
  const store = new EditorProjectStore();
  const controller = {
    getSnapshot: vi.fn(() => ({
      trackedProjectRoot: store.getSnapshot()?.projectRoot ?? null,
      recoveryCandidate: null,
    })),
    switchProject: vi.fn(async () => ({
      trackedProjectRoot: 'D:\\projects\\shell.pandastage',
      recoveryCandidate: null,
    })),
    switchRecentProject: vi.fn(async () => ({
      trackedProjectRoot: 'D:\\projects\\shell.pandastage',
      recoveryCandidate: null,
    })),
    closeProject: vi.fn(async () => {
      store.clear();
      return {
        trackedProjectRoot: null,
        recoveryCandidate: null,
      };
    }),
    clearRecoveryCandidate: vi.fn(() => ({
      trackedProjectRoot: 'D:\\projects\\shell.pandastage',
      recoveryCandidate: null,
    })),
    dispose: vi.fn(async () => undefined),
  };
  const createController = vi.fn(() => controller);
  const update = vi.fn(
    async (): Promise<RecoveryAcknowledgeResponse> => ({ ok: true }),
  );
  const unsubscribes: ReturnType<typeof vi.fn>[] = [];
  let activeSubscriptions = 0;
  let maximumActiveSubscriptions = 0;
  const onError = vi.fn(() => {
    activeSubscriptions += 1;
    maximumActiveSubscriptions = Math.max(
      maximumActiveSubscriptions,
      activeSubscriptions,
    );
    let active = true;
    const unsubscribe = vi.fn(() => {
      if (!active) return;
      active = false;
      activeSubscriptions -= 1;
    });
    unsubscribes.push(unsubscribe);
    return unsubscribe;
  });
  const session = new EditorShellSession({
    store,
    sessionApi: {
      open: vi.fn(),
      openRecent: vi.fn(),
      track: vi.fn(),
      stop: vi.fn(),
      detect: vi.fn(),
      confirmSwitch: vi.fn(),
    },
    autosaveApi: { update, onError },
    recoveryApi: {
      restore: vi.fn(),
      ignore: vi.fn(),
    },
    projectSaveApi: {
      save: vi.fn(),
    },
    createController,
  });
  return {
    store,
    session,
    controller,
    createController,
    update,
    onError,
    unsubscribes,
    getActiveSubscriptions: () => activeSubscriptions,
    getMaximumActiveSubscriptions: () => maximumActiveSubscriptions,
  };
}

describe('EditorShell ProjectSessionController ownership', () => {
  it('constructs one controller across rerenders and store state changes', () => {
    const harness = createHarness();

    harness.session.getSnapshot();
    harness.session.getSnapshot();
    expect(getEditorShellState(harness.store.getSnapshot())).toBe(
      'no-project',
    );
    harness.store.open(
      'D:\\projects\\shell.pandastage',
      migrateProject(exampleProject),
    );
    expect(getEditorShellState(harness.store.getSnapshot())).toBe('editor');

    expect(harness.createController).toHaveBeenCalledTimes(1);
  });

  it('deduplicates autosave snapshots and owns one onError source', async () => {
    const harness = createHarness();
    harness.store.open(
      'D:\\projects\\shell.pandastage',
      migrateProject(exampleProject),
    );
    const snapshot = harness.store.getSnapshot();

    harness.session.activateAutosaveErrors(vi.fn());
    harness.session.activateAutosaveErrors(vi.fn());
    await harness.session.syncAutosave(snapshot);
    await harness.session.syncAutosave(snapshot);

    expect(harness.onError).toHaveBeenCalledTimes(1);
    expect(harness.update).toHaveBeenCalledTimes(1);
  });

  it('flushes a pending autosave before switching projects', async () => {
    const harness = createHarness();
    harness.store.open(
      'D:\\projects\\shell.pandastage',
      migrateProject(exampleProject),
    );

    let release!: (response: { ok: true }) => void;
    const pendingUpdate = new Promise<{ ok: true }>((resolve) => {
      release = resolve;
    });
    harness.update.mockImplementationOnce(() => pendingUpdate);

    const snapshot = harness.store.getSnapshot();
    const updatePromise = harness.session.syncAutosave(snapshot);
    const switchPromise = harness.session.switchProject(
      'D:\\projects\\next.pandastage',
    );

    await Promise.resolve();
    expect(harness.controller.switchProject).not.toHaveBeenCalled();

    release({ ok: true });
    await expect(updatePromise).resolves.toEqual({ ok: true });
    await expect(switchPromise).resolves.toEqual({
      trackedProjectRoot: 'D:\\projects\\shell.pandastage',
      recoveryCandidate: null,
    });
    expect(harness.controller.switchProject).toHaveBeenCalledWith(
      'D:\\projects\\next.pandastage',
    );
  });

  it('does not switch after an autosave update failure', async () => {
    const harness = createHarness();
    harness.store.open(
      'D:\\projects\\shell.pandastage',
      migrateProject(exampleProject),
    );
    const failure = new Error('Injected autosave update failure.');
    harness.update.mockRejectedValueOnce(failure);

    const updatePromise = harness.session.syncAutosave(
      harness.store.getSnapshot(),
    );
    const switchPromise = harness.session.switchProject(
      'D:\\projects\\next.pandastage',
    );

    await expect(updatePromise).rejects.toThrow(failure);
    await expect(switchPromise).rejects.toThrow(failure);
    expect(harness.controller.switchProject).not.toHaveBeenCalled();
  });

  it('retries the same autosave snapshot until Main acknowledges it', async () => {
    const harness = createHarness();
    harness.store.open(
      'D:\\projects\\shell.pandastage',
      migrateProject(exampleProject),
    );
    const snapshot = harness.store.getSnapshot();
    harness.update
      .mockRejectedValueOnce(new Error('Injected update rejection.'))
      .mockResolvedValueOnce({ ok: true });

    await expect(harness.session.syncAutosave(snapshot)).rejects.toThrow(
      'Injected update rejection.',
    );
    await expect(harness.session.syncAutosave(snapshot)).resolves.toEqual({
      ok: true,
    });
    await expect(harness.session.syncAutosave(snapshot)).resolves.toBeNull();

    expect(harness.update).toHaveBeenCalledTimes(2);
  });

  it('does not treat an explicit Main rejection as an autosave acknowledgement', async () => {
    const harness = createHarness();
    const projectRoot = 'D:\\projects\\shell.pandastage';
    harness.store.open(projectRoot, migrateProject(exampleProject));
    const snapshot = harness.store.getSnapshot();
    harness.update
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'RECOVERY_WRITE_FAILED',
          message: 'Injected Main rejection.',
          projectRoot,
        },
      })
      .mockResolvedValueOnce({ ok: true });

    await expect(harness.session.syncAutosave(snapshot)).resolves.toMatchObject({
      ok: false,
    });
    await expect(
      harness.session.prepareForNativeClose(harness.store.getSnapshot),
    ).resolves.toBeUndefined();

    expect(harness.update).toHaveBeenCalledTimes(2);
  });

  it('acknowledges revisions created while native-close synchronization is in flight', async () => {
    const harness = createHarness();
    const project = migrateProject(exampleProject);
    harness.store.open('D:\\projects\\shell.pandastage', project);
    let markFirstUpdateStarted!: () => void;
    let releaseFirstUpdate!: () => void;
    const firstUpdateStarted = new Promise<void>((resolve) => {
      markFirstUpdateStarted = resolve;
    });
    const firstUpdateGate = new Promise<void>((resolve) => {
      releaseFirstUpdate = resolve;
    });
    harness.update.mockImplementationOnce(async () => {
      markFirstUpdateStarted();
      await firstUpdateGate;
      return { ok: true };
    });

    const prepare = harness.session.prepareForNativeClose(
      harness.store.getSnapshot,
    );
    await firstUpdateStarted;
    harness.store.updateProject({
      ...project,
      name: 'Edited during native-close synchronization',
    });
    releaseFirstUpdate();
    await prepare;

    expect(harness.update).toHaveBeenCalledTimes(2);
    expect(harness.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ revision: 0, dirty: false }),
    );
    expect(harness.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ revision: 1, dirty: true }),
    );
  });

  it('survives StrictMode setup -> cleanup -> setup -> final cleanup', async () => {
    const harness = createHarness();

    harness.session.activateAutosaveErrors(vi.fn());
    expect(harness.onError).toHaveBeenCalledTimes(1);
    expect(harness.getActiveSubscriptions()).toBe(1);

    harness.session.deactivateAutosaveErrors();
    const simulatedCleanup =
      harness.session.scheduleControllerDisposal();
    expect(harness.unsubscribes[0]).toHaveBeenCalledTimes(1);
    expect(harness.getActiveSubscriptions()).toBe(0);

    harness.session.activateAutosaveErrors(vi.fn());
    await simulatedCleanup;
    expect(harness.onError).toHaveBeenCalledTimes(2);
    expect(harness.getActiveSubscriptions()).toBe(1);
    expect(harness.getMaximumActiveSubscriptions()).toBe(1);
    expect(harness.controller.dispose).not.toHaveBeenCalled();

    harness.session.deactivateAutosaveErrors();
    await harness.session.scheduleControllerDisposal();

    expect(harness.unsubscribes[1]).toHaveBeenCalledTimes(1);
    expect(harness.getActiveSubscriptions()).toBe(0);
    expect(harness.controller.dispose).toHaveBeenCalledTimes(1);
    expect(harness.createController).toHaveBeenCalledTimes(1);
  });

  it('routes the in-app close through the same single controller', async () => {
    const harness = createHarness();
    harness.store.open(
      'D:\\projects\\shell.pandastage',
      migrateProject(exampleProject),
    );
    expect(getEditorShellState(harness.store.getSnapshot())).toBe('editor');

    const snapshot = await harness.session.closeProject();

    expect(harness.controller.closeProject).toHaveBeenCalledTimes(1);
    expect(snapshot).toEqual({
      trackedProjectRoot: null,
      recoveryCandidate: null,
    });
    // Closing a project must not dispose or replace the owned controller.
    expect(harness.controller.dispose).not.toHaveBeenCalled();
    expect(harness.createController).toHaveBeenCalledTimes(1);
    expect(getEditorShellState(harness.store.getSnapshot())).toBe(
      'no-project',
    );
  });
});

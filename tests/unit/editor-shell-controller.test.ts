import { describe, expect, it, vi } from 'vitest';
import {
  EditorShellSession,
  getEditorShellState,
} from '../../src/renderer/shell/EditorShell';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { ProjectSchema } from '../../src/domain';
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
  const update = vi.fn(async () => ({ ok: true as const }));
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
      ProjectSchema.parse(exampleProject),
    );
    expect(getEditorShellState(harness.store.getSnapshot())).toBe('editor');

    expect(harness.createController).toHaveBeenCalledTimes(1);
  });

  it('deduplicates autosave snapshots and owns one onError source', async () => {
    const harness = createHarness();
    harness.store.open(
      'D:\\projects\\shell.pandastage',
      ProjectSchema.parse(exampleProject),
    );
    const snapshot = harness.store.getSnapshot();

    harness.session.activateAutosaveErrors(vi.fn());
    harness.session.activateAutosaveErrors(vi.fn());
    await harness.session.syncAutosave(snapshot);
    await harness.session.syncAutosave(snapshot);

    expect(harness.onError).toHaveBeenCalledTimes(1);
    expect(harness.update).toHaveBeenCalledTimes(1);
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
      ProjectSchema.parse(exampleProject),
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

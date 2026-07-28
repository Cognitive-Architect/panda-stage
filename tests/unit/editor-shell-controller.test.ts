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
    clearRecoveryCandidate: vi.fn(() => ({
      trackedProjectRoot: 'D:\\projects\\shell.pandastage',
      recoveryCandidate: null,
    })),
    dispose: vi.fn(async () => undefined),
  };
  const createController = vi.fn(() => controller);
  const update = vi.fn(async () => ({ ok: true as const }));
  const unsubscribe = vi.fn();
  const onError = vi.fn(() => unsubscribe);
  const session = new EditorShellSession({
    store,
    sessionApi: {
      open: vi.fn(),
      openRecent: vi.fn(),
      track: vi.fn(),
      stop: vi.fn(),
      detect: vi.fn(),
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
    unsubscribe,
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

    harness.session.subscribeToAutosaveErrors(vi.fn());
    harness.session.subscribeToAutosaveErrors(vi.fn());
    await harness.session.syncAutosave(snapshot);
    await harness.session.syncAutosave(snapshot);

    expect(harness.onError).toHaveBeenCalledTimes(1);
    expect(harness.update).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes and disposes exactly once on final unmount', async () => {
    const harness = createHarness();
    harness.session.subscribeToAutosaveErrors(vi.fn());

    await harness.session.dispose();
    await harness.session.dispose();

    expect(harness.unsubscribe).toHaveBeenCalledTimes(1);
    expect(harness.controller.dispose).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject } from '../../src/domain';
import { AutosaveService } from '../../src/main/services/AutosaveService';
import { UnsavedCloseController } from '../../src/main/services/UnsavedCloseController';
import { UnsavedCloseGuard } from '../../src/main/windows/unsaved-close-guard';
import { EditorShellSession } from '../../src/renderer/shell/EditorShell';
import {
  EditorProjectStore,
  type EditorProjectSnapshot,
} from '../../src/renderer/stores/EditorProjectStore';

const PROJECT_ROOT = 'D:\\projects\\autosave-close.pandastage';

const inertClock = {
  setInterval: () => 1 as unknown as ReturnType<typeof setInterval>,
  clearInterval: () => undefined,
};

describe('autosave/native close boundary', () => {
  it('does not allow a Renderer revision rejected before Main acknowledgement to close natively', async () => {
    const store = new EditorProjectStore();
    const project = migrateProject(exampleProject);
    store.open(PROJECT_ROOT, project);
    for (let revision = 1; revision <= 5; revision += 1) {
      store.updateProject({ ...project, name: `Saved revision ${revision}` });
    }
    store.markSaved(store.getSnapshot()!.project, 5);

    const mainAutosave = new AutosaveService({
      recoveryService: {
        writeRecovery: vi.fn(),
      } as never,
      clock: inertClock,
    });
    mainAutosave.track({
      projectRoot: PROJECT_ROOT,
      project,
      dirty: false,
      revision: 5,
    });

    const controller = {
      getSnapshot: () => ({
        trackedProjectRoot: PROJECT_ROOT,
        recoveryCandidate: null,
      }),
      switchProject: vi.fn(),
      switchRecentProject: vi.fn(),
      closeProject: vi.fn(),
      clearRecoveryCandidate: vi.fn(),
      dispose: vi.fn(),
    };
    const syncFailure = new Error('Injected AUTOSAVE_UPDATE failure.');
    let rejectNextUpdate = true;
    const update = vi.fn(async (snapshot: EditorProjectSnapshot) => {
      if (rejectNextUpdate) {
        rejectNextUpdate = false;
        throw syncFailure;
      }
      mainAutosave.update(snapshot);
      return { ok: true as const };
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
      autosaveApi: {
        update,
        onError: vi.fn(() => vi.fn()),
      },
      recoveryApi: {
        restore: vi.fn(),
        ignore: vi.fn(),
      },
      projectSaveApi: {
        save: vi.fn(),
      },
      createController: () => controller,
    });

    store.updateProject({ ...project, name: 'Renderer revision 6' });
    const rendererSnapshot = store.getSnapshot();
    await expect(session.syncAutosave(rendererSnapshot)).rejects.toThrow(
      syncFailure,
    );

    expect(rendererSnapshot).toMatchObject({ dirty: true, revision: 6 });
    expect(mainAutosave.getProjectSnapshot(PROJECT_ROOT)).toMatchObject({
      dirty: false,
      revision: 5,
    });

    const prompt = vi.fn(async () => 'cancel' as const);
    const closeController = new UnsavedCloseController({
      getDirtyProject: () => mainAutosave.getDirtyProjectSnapshot(),
      prompt,
      save: vi.fn(),
      discard: vi.fn(),
      reportSaveFailure: vi.fn(),
      reportDiscardFailure: vi.fn(),
    });
    const event = { preventDefault: vi.fn() };
    const closeWindow = vi.fn();
    const reportRendererSyncFailure = vi.fn();
    const guard = new UnsavedCloseGuard({
      controller: closeController,
      synchronizeRenderer: async () => {
        try {
          await session.prepareForNativeClose(store.getSnapshot);
          return { ok: true as const };
        } catch (error) {
          return {
            ok: false as const,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      reportRendererSyncFailure,
      closeWindow,
      quitApplication: vi.fn(),
    });

    guard.handleWindowClose(event);
    await guard.waitForIdle();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledTimes(2);
    expect(mainAutosave.getProjectSnapshot(PROJECT_ROOT)).toMatchObject({
      dirty: true,
      revision: 6,
    });
    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({ dirty: true, revision: 6 }),
      'close',
    );
    expect(reportRendererSyncFailure).not.toHaveBeenCalled();
    expect(closeWindow).not.toHaveBeenCalled();
    await mainAutosave.stopAll();
  });
});

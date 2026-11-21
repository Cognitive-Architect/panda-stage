import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject } from '../../src/domain';
import { AutosaveService } from '../../src/main/services/AutosaveService';
import { ProjectService } from '../../src/main/services/ProjectService';
import { RecoveryService } from '../../src/main/services/RecoveryService';
import { UnsavedCloseController } from '../../src/main/services/UnsavedCloseController';
import { RendererCloseSynchronizer } from '../../src/main/windows/renderer-close-synchronizer';
import {
  UnsavedCloseGuard,
  promptRendererSyncFailureAction,
} from '../../src/main/windows/unsaved-close-guard';
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

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

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

  it('allows explicit force quit on Renderer sync timeout without deleting existing recovery or formal files', async () => {
    const base = process.env.RUNNER_TEMP ?? os.tmpdir();
    const parent = await mkdtemp(path.join(base, 'panda-close-escape-'));
    temporaryDirectories.push(parent);
    const root = path.join(parent, 'escape-test.pandastage');

    const projects = new ProjectService({
      createId: () => 'c1000000-0000-4000-8000-000000000001',
    });
    const created = await projects.create(root, { name: 'Formal Baseline' });
    const formalBefore = await readFile(
      path.join(root, 'project.json'),
      'utf8',
    );
    const recovery = new RecoveryService({
      nowMs: () => 4_102_444_800_000,
    });
    const autosave = new AutosaveService({
      recoveryService: recovery,
      clock: inertClock,
    });
    autosave.track({
      projectRoot: root,
      project: { ...created.project, name: 'Autosaved Dirty' },
      dirty: true,
      revision: 1,
    });
    await autosave.tick(root);
    const recoveryEntriesBefore = await readdir(path.join(root, 'recovery'));
    expect(recoveryEntriesBefore.length).toBeGreaterThan(0);

    const send = vi.fn();
    let requestCounter = 0;
    const synchronizer = new RendererCloseSynchronizer({
      getWindow: () => ({
        isDestroyed: () => false,
        webContents: { id: 42, send: vi.fn() },
      }),
      send,
      createRequestId: () => `req-${++requestCounter}`,
      timeoutMs: 25,
    });

    const controller = new UnsavedCloseController({
      getDirtyProject: () => autosave.getDirtyProjectSnapshot(),
      prompt: vi.fn(),
      save: vi.fn(),
      discard: vi.fn(),
      reportSaveFailure: vi.fn(),
      reportDiscardFailure: vi.fn(),
    });
    const responses = [0, 1];
    const showMessageBox = vi.fn(async () => ({
      response: responses.shift()!,
    }));
    const closeWindow = vi.fn();
    const quitApplication = vi.fn();
    const forceQuitApplication = vi.fn();
    const guard = new UnsavedCloseGuard({
      controller,
      synchronizeRenderer: () => synchronizer.synchronize(),
      reportRendererSyncFailure: () =>
        promptRendererSyncFailureAction(showMessageBox),
      closeWindow,
      quitApplication,
      forceQuitApplication,
    });

    // 1st attempt: Renderer times out -> user chooses "继续编辑".
    guard.handleWindowClose({ preventDefault: vi.fn() });
    await guard.waitForIdle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(forceQuitApplication).not.toHaveBeenCalled();
    expect(closeWindow).not.toHaveBeenCalled();
    expect(quitApplication).not.toHaveBeenCalled();

    // 2nd explicit attempt: Renderer still hung -> user chooses "强制退出".
    guard.handleBeforeQuit({ preventDefault: vi.fn() });
    await guard.waitForIdle();
    expect(send).toHaveBeenCalledTimes(2);
    expect(showMessageBox).toHaveBeenCalledTimes(2);
    expect(forceQuitApplication).toHaveBeenCalledOnce();
    expect(closeWindow).not.toHaveBeenCalled();
    expect(quitApplication).not.toHaveBeenCalled();

    // Existing recovery records and formal project.json must remain intact.
    expect(await readdir(path.join(root, 'recovery'))).toEqual(
      recoveryEntriesBefore,
    );
    expect(await readFile(path.join(root, 'project.json'), 'utf8')).toBe(
      formalBefore,
    );
    await expect(
      recovery.detectLatest(root, created.project),
    ).resolves.not.toBeNull();

    synchronizer.dispose();
    await autosave.stopAll();
  });
});

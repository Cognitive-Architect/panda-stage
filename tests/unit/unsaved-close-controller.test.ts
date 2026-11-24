import { describe, expect, it, vi } from 'vitest';
import { migrateProject } from '../../src/domain';
import {
  UnsavedCloseController,
  createUnsavedCloseDialogOptions,
} from '../../src/main/services/UnsavedCloseController';
import {
  UnsavedCloseGuard,
  createCloseSyncFailureDialogOptions,
  promptRendererSyncFailureAction,
} from '../../src/main/windows/unsaved-close-guard';
import type { AutosaveTrackRequest } from '../../src/shared/recovery-api';
import exampleProject from '../../demo-project/project-v1.example.json';

const dirtyProject: AutosaveTrackRequest = {
  projectRoot: 'D:\\projects\\dirty.pandastage',
  project: migrateProject(exampleProject),
  dirty: true,
  revision: 4,
};
const synchronizeRenderer = async () => ({ ok: true as const });

function controller(
  choice: 'save' | 'discard' | 'cancel',
  options: {
    saveError?: Error;
    discardError?: Error;
    promptGate?: Promise<void>;
  } = {},
) {
  const save = vi.fn(async () => {
    if (options.saveError) throw options.saveError;
  });
  const prompt = vi.fn(async () => {
    await options.promptGate;
    return choice;
  });
  const reportSaveFailure = vi.fn();
  const discard = vi.fn(async () => {
    if (options.discardError) throw options.discardError;
  });
  const reportDiscardFailure = vi.fn();
  return {
    value: new UnsavedCloseController({
      getDirtyProject: () => dirtyProject,
      prompt,
      save,
      discard,
      reportSaveFailure,
      reportDiscardFailure,
    }),
    prompt,
    save,
    reportSaveFailure,
    discard,
    reportDiscardFailure,
  };
}

describe('UnsavedCloseController', () => {
  it('exposes clear save, discard, and cancel choices', () => {
    expect(
      createUnsavedCloseDialogOptions('我的项目').buttons,
    ).toEqual(['保存并退出', '不保存', '取消']);
    expect(
      createUnsavedCloseDialogOptions('我的项目').cancelId,
    ).toBe(2);
    expect(
      createUnsavedCloseDialogOptions('我的项目', 'switch').buttons,
    ).toEqual(['保存并切换', '不保存并切换', '取消']);
  });

  it.each([
    ['save', 'saved'],
    ['discard', 'discarded'],
    ['cancel', 'cancelled'],
  ] as const)(
    'reuses the unsaved guard for project switching: %s',
    async (choice, outcome) => {
      const harness = controller(choice);

      await expect(
        harness.value.requestSwitch(dirtyProject),
      ).resolves.toBe(outcome);
      expect(harness.prompt).toHaveBeenCalledWith(
        dirtyProject,
        'switch',
      );
    },
  );

  it.each([
    ['save', 'save-failed', { saveError: new Error('save') }],
    [
      'discard',
      'discard-failed',
      { discardError: new Error('discard') },
    ],
  ] as const)(
    'blocks switching when %s fails',
    async (choice, outcome, options) => {
      const harness = controller(choice, options);

      await expect(
        harness.value.requestSwitch(dirtyProject),
      ).resolves.toBe(outcome);
    },
  );

  it('saves the exact dirty revision before allowing close', async () => {
    const harness = controller('save');

    await expect(harness.value.requestClose()).resolves.toBe(
      'allow-close',
    );
    expect(harness.save).toHaveBeenCalledWith(dirtyProject);
  });

  it('allows a clean project to close without prompting', async () => {
    const prompt = vi.fn();
    const value = new UnsavedCloseController({
      getDirtyProject: () => null,
      prompt,
      save: vi.fn(),
      discard: vi.fn(),
      reportSaveFailure: vi.fn(),
      reportDiscardFailure: vi.fn(),
    });

    await expect(value.requestClose()).resolves.toBe('allow-close');
    expect(prompt).not.toHaveBeenCalled();
  });

  it('keeps a clean Main mirror open when Renderer synchronization fails', async () => {
    const prompt = vi.fn();
    const value = new UnsavedCloseController({
      getDirtyProject: () => null,
      prompt,
      save: vi.fn(),
      discard: vi.fn(),
      reportSaveFailure: vi.fn(),
      reportDiscardFailure: vi.fn(),
    });
    const closeWindow = vi.fn();
    const reportRendererSyncFailure = vi.fn();
    const event = { preventDefault: vi.fn() };
    const guard = new UnsavedCloseGuard({
      controller: value,
      synchronizeRenderer: vi.fn(async () => ({
        ok: false as const,
        error: 'Injected Renderer synchronization failure.',
      })),
      reportRendererSyncFailure,
      closeWindow,
      quitApplication: vi.fn(),
    });

    guard.handleWindowClose(event);
    await guard.waitForIdle();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(reportRendererSyncFailure).toHaveBeenCalledWith(
      'Injected Renderer synchronization failure.',
      'window',
    );
    expect(prompt).not.toHaveBeenCalled();
    expect(closeWindow).not.toHaveBeenCalled();
  });

  it('waits for authorized pending-work cleanup before synchronizing and closing', async () => {
    let releasePendingWork!: () => void;
    const pendingWorkGate = new Promise<void>((resolve) => {
      releasePendingWork = resolve;
    });
    const order: string[] = [];
    const harness = controller('discard');
    const closeWindow = vi.fn();
    const guard = new UnsavedCloseGuard({
      controller: harness.value,
      confirmPendingWork: vi.fn(async () => {
        order.push('pending-work');
        await pendingWorkGate;
        return true;
      }),
      synchronizeRenderer: vi.fn(async () => {
        order.push('renderer-sync');
        return { ok: true as const };
      }),
      closeWindow,
      quitApplication: vi.fn(),
    });

    guard.handleWindowClose({ preventDefault: vi.fn() });
    await Promise.resolve();
    expect(order).toEqual(['pending-work']);
    expect(closeWindow).not.toHaveBeenCalled();

    releasePendingWork();
    await guard.waitForIdle();

    expect(order).toEqual(['pending-work', 'renderer-sync']);
    expect(closeWindow).toHaveBeenCalledOnce();
  });

  it('leaves the window open when pending work is kept running', async () => {
    const harness = controller('discard');
    const closeWindow = vi.fn();
    const synchronize = vi.fn(synchronizeRenderer);
    const guard = new UnsavedCloseGuard({
      controller: harness.value,
      confirmPendingWork: vi.fn(async () => false),
      synchronizeRenderer: synchronize,
      closeWindow,
      quitApplication: vi.fn(),
    });

    guard.handleWindowClose({ preventDefault: vi.fn() });
    await guard.waitForIdle();

    expect(synchronize).not.toHaveBeenCalled();
    expect(closeWindow).not.toHaveBeenCalled();
    expect(harness.prompt).not.toHaveBeenCalled();
  });

  it('allows discard without saving', async () => {
    const harness = controller('discard');

    await expect(harness.value.requestClose()).resolves.toBe(
      'allow-close',
    );
    expect(harness.save).not.toHaveBeenCalled();
    expect(harness.discard).toHaveBeenCalledWith(dirtyProject);
  });

  it('keeps the window open and reports a discard failure', async () => {
    const injected = new Error('Injected cleanup failure.');
    const harness = controller('discard', { discardError: injected });
    const closeWindow = vi.fn();
    const guard = new UnsavedCloseGuard({
      controller: harness.value,
      synchronizeRenderer,
      closeWindow,
      quitApplication: vi.fn(),
    });

    guard.handleWindowClose({ preventDefault: vi.fn() });
    await guard.waitForIdle();

    expect(closeWindow).not.toHaveBeenCalled();
    expect(harness.reportDiscardFailure).toHaveBeenCalledWith(
      dirtyProject,
      injected,
      'close',
    );
  });

  it('keeps the application open when the user cancels', async () => {
    const harness = controller('cancel');
    const closeWindow = vi.fn();
    const event = { preventDefault: vi.fn() };
    const guard = new UnsavedCloseGuard({
      controller: harness.value,
      synchronizeRenderer,
      closeWindow,
      quitApplication: vi.fn(),
    });

    guard.handleWindowClose(event);
    await guard.waitForIdle();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(closeWindow).not.toHaveBeenCalled();
    expect(harness.save).not.toHaveBeenCalled();
  });

  it('keeps the window open and reports a save failure', async () => {
    const injected = new Error('Injected disk failure.');
    const harness = controller('save', { saveError: injected });
    const closeWindow = vi.fn();
    const guard = new UnsavedCloseGuard({
      controller: harness.value,
      synchronizeRenderer,
      closeWindow,
      quitApplication: vi.fn(),
    });

    guard.handleWindowClose({ preventDefault: vi.fn() });
    await guard.waitForIdle();

    expect(closeWindow).not.toHaveBeenCalled();
    expect(harness.reportSaveFailure).toHaveBeenCalledWith(
      dirtyProject,
      injected,
      'close',
    );
  });

  it('prevents application quit until an approved choice and suppresses re-entry', async () => {
    let releasePrompt!: () => void;
    const promptGate = new Promise<void>((resolve) => {
      releasePrompt = resolve;
    });
    const harness = controller('discard', { promptGate });
    const quitApplication = vi.fn();
    const guard = new UnsavedCloseGuard({
      controller: harness.value,
      synchronizeRenderer,
      closeWindow: vi.fn(),
      quitApplication,
    });
    const firstEvent = { preventDefault: vi.fn() };
    const repeatedEvent = { preventDefault: vi.fn() };

    guard.handleBeforeQuit(firstEvent);
    guard.handleBeforeQuit(repeatedEvent);
    await Promise.resolve();
    expect(harness.prompt).toHaveBeenCalledOnce();
    expect(quitApplication).not.toHaveBeenCalled();
    releasePrompt();
    await guard.waitForIdle();

    expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
    expect(repeatedEvent.preventDefault).toHaveBeenCalledOnce();
    expect(quitApplication).toHaveBeenCalledOnce();
  });

  it('runs modify, cancel close, then save close as one complete lifecycle', async () => {
    let currentDirtyProject: AutosaveTrackRequest | null = dirtyProject;
    const choices: Array<'save' | 'cancel'> = ['cancel', 'save'];
    const save = vi.fn(async (snapshot: AutosaveTrackRequest) => {
      expect(snapshot.revision).toBe(4);
      currentDirtyProject = null;
    });
    const value = new UnsavedCloseController({
      getDirtyProject: () => currentDirtyProject,
      prompt: vi.fn(async () => choices.shift()!),
      save,
      discard: vi.fn(),
      reportSaveFailure: vi.fn(),
      reportDiscardFailure: vi.fn(),
    });
    const closeWindow = vi.fn();
    const guard = new UnsavedCloseGuard({
      controller: value,
      synchronizeRenderer,
      closeWindow,
      quitApplication: vi.fn(),
    });

    guard.handleWindowClose({ preventDefault: vi.fn() });
    await guard.waitForIdle();
    expect(closeWindow).not.toHaveBeenCalled();

    guard.handleWindowClose({ preventDefault: vi.fn() });
    await guard.waitForIdle();
    expect(save).toHaveBeenCalledOnce();
    expect(closeWindow).toHaveBeenCalledOnce();
  });

  it('builds an actionable native close-failure dialog defaulting to continue editing', async () => {
    const options = createCloseSyncFailureDialogOptions();
    expect(options.title).toBe('Panda Stage 暂时无法正常关闭');
    expect(options.message).toBe('编辑器没有响应，部分未保存内容可能尚未同步。');
    expect(options.detail).toContain('未保存的修改可能丢失');
    expect(options.buttons).toEqual(['继续编辑', '强制退出']);
    expect(options.defaultId).toBe(0);
    expect(options.cancelId).toBe(0);

    await expect(
      promptRendererSyncFailureAction(async () => ({ response: 0 })),
    ).resolves.toBe('continue');
    await expect(
      promptRendererSyncFailureAction(async () => ({ response: 1 })),
    ).resolves.toBe('force-quit');
  });

  it.each(['window', 'application'] as const)(
    'keeps the app open without retry loop when user chooses continue on %s close failure',
    async (intent) => {
      const value = new UnsavedCloseController({
        getDirtyProject: () => null,
        prompt: vi.fn(),
        save: vi.fn(),
        discard: vi.fn(),
        reportSaveFailure: vi.fn(),
        reportDiscardFailure: vi.fn(),
      });
      let shouldFailSync = true;
      const synchronize = vi.fn(async () =>
        shouldFailSync
          ? {
              ok: false as const,
              error: 'Renderer close synchronization timed out.',
            }
          : { ok: true as const },
      );
      const reportRendererSyncFailure = vi.fn(async () => 'continue' as const);
      const closeWindow = vi.fn();
      const quitApplication = vi.fn();
      const forceQuitApplication = vi.fn();
      const guard = new UnsavedCloseGuard({
        controller: value,
        synchronizeRenderer: synchronize,
        reportRendererSyncFailure,
        closeWindow,
        quitApplication,
        forceQuitApplication,
      });

      const trigger = () => {
        const event = { preventDefault: vi.fn() };
        if (intent === 'window') {
          guard.handleWindowClose(event);
        } else {
          guard.handleBeforeQuit(event);
        }
        return event;
      };

      const firstEvent = trigger();
      await guard.waitForIdle();

      expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
      expect(synchronize).toHaveBeenCalledTimes(1);
      expect(reportRendererSyncFailure).toHaveBeenCalledTimes(1);
      expect(closeWindow).not.toHaveBeenCalled();
      expect(quitApplication).not.toHaveBeenCalled();
      expect(forceQuitApplication).not.toHaveBeenCalled();

      // Next explicit close after recovery proceeds normally without stuck state.
      shouldFailSync = false;
      trigger();
      await guard.waitForIdle();

      expect(synchronize).toHaveBeenCalledTimes(2);
      expect(reportRendererSyncFailure).toHaveBeenCalledTimes(1);
      if (intent === 'window') {
        expect(closeWindow).toHaveBeenCalledOnce();
        expect(quitApplication).not.toHaveBeenCalled();
      } else {
        expect(quitApplication).toHaveBeenCalledOnce();
        expect(closeWindow).not.toHaveBeenCalled();
      }
      expect(forceQuitApplication).not.toHaveBeenCalled();
    },
  );

  it.each(['window', 'application'] as const)(
    'force-quits directly and bypasses guard re-entry on %s close failure',
    async (intent) => {
      const value = new UnsavedCloseController({
        getDirtyProject: () => dirtyProject,
        prompt: vi.fn(),
        save: vi.fn(),
        discard: vi.fn(),
        reportSaveFailure: vi.fn(),
        reportDiscardFailure: vi.fn(),
      });
      const synchronize = vi.fn(async () => {
        throw new Error('Injected IPC exception.');
      });
      const reportRendererSyncFailure = vi.fn(
        async () => 'force-quit' as const,
      );
      const closeWindow = vi.fn();
      const quitApplication = vi.fn();
      const forceQuitApplication = vi.fn(() => {
        // Simulate any synchronous close/quit event arriving during exit.
        const followUpClose = { preventDefault: vi.fn() };
        const followUpQuit = { preventDefault: vi.fn() };
        guard.handleWindowClose(followUpClose);
        guard.handleBeforeQuit(followUpQuit);
        expect(followUpClose.preventDefault).not.toHaveBeenCalled();
        expect(followUpQuit.preventDefault).not.toHaveBeenCalled();
      });
      const guard = new UnsavedCloseGuard({
        controller: value,
        synchronizeRenderer: synchronize,
        reportRendererSyncFailure,
        closeWindow,
        quitApplication,
        forceQuitApplication,
      });

      const event = { preventDefault: vi.fn() };
      if (intent === 'window') {
        guard.handleWindowClose(event);
      } else {
        guard.handleBeforeQuit(event);
      }
      await guard.waitForIdle();

      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(synchronize).toHaveBeenCalledOnce();
      expect(reportRendererSyncFailure).toHaveBeenCalledWith(
        'Injected IPC exception.',
        intent,
      );
      expect(forceQuitApplication).toHaveBeenCalledOnce();
      expect(closeWindow).not.toHaveBeenCalled();
      expect(quitApplication).not.toHaveBeenCalled();
    },
  );

  it('converges pending-work exceptions onto the same failure decision exit', async () => {
    const value = new UnsavedCloseController({
      getDirtyProject: () => null,
      prompt: vi.fn(),
      save: vi.fn(),
      discard: vi.fn(),
      reportSaveFailure: vi.fn(),
      reportDiscardFailure: vi.fn(),
    });
    const reportRendererSyncFailure = vi.fn(async () => 'force-quit' as const);
    const forceQuitApplication = vi.fn();
    const guard = new UnsavedCloseGuard({
      controller: value,
      confirmPendingWork: vi.fn(async () => {
        throw new Error('Injected pending-work confirmation failure.');
      }),
      synchronizeRenderer: vi.fn(),
      reportRendererSyncFailure,
      closeWindow: vi.fn(),
      quitApplication: vi.fn(),
      forceQuitApplication,
    });

    guard.handleWindowClose({ preventDefault: vi.fn() });
    await guard.waitForIdle();

    expect(reportRendererSyncFailure).toHaveBeenCalledWith(
      'Injected pending-work confirmation failure.',
      'window',
    );
    expect(forceQuitApplication).toHaveBeenCalledOnce();
  });

  it('shows at most one failure dialog when close and quit events re-enter during sync or dialog', async () => {
    let releaseSync!: () => void;
    const syncGate = new Promise<void>((resolve) => {
      releaseSync = resolve;
    });
    let releaseDialog!: () => void;
    const dialogGate = new Promise<void>((resolve) => {
      releaseDialog = resolve;
    });
    const value = new UnsavedCloseController({
      getDirtyProject: () => null,
      prompt: vi.fn(),
      save: vi.fn(),
      discard: vi.fn(),
      reportSaveFailure: vi.fn(),
      reportDiscardFailure: vi.fn(),
    });
    const synchronize = vi.fn(async () => {
      await syncGate;
      return {
        ok: false as const,
        error: 'Renderer close synchronization timed out.',
      };
    });
    const reportRendererSyncFailure = vi.fn(async () => {
      await dialogGate;
      return 'continue' as const;
    });
    const guard = new UnsavedCloseGuard({
      controller: value,
      synchronizeRenderer: synchronize,
      reportRendererSyncFailure,
      closeWindow: vi.fn(),
      quitApplication: vi.fn(),
      forceQuitApplication: vi.fn(),
    });

    const firstWindowClose = { preventDefault: vi.fn() };
    const secondWindowClose = { preventDefault: vi.fn() };
    const duringSyncQuit = { preventDefault: vi.fn() };
    const duringDialogWindowClose = { preventDefault: vi.fn() };
    const duringDialogQuit = { preventDefault: vi.fn() };

    guard.handleWindowClose(firstWindowClose);
    guard.handleWindowClose(secondWindowClose);
    guard.handleBeforeQuit(duringSyncQuit);
    expect(synchronize).toHaveBeenCalledOnce();
    expect(reportRendererSyncFailure).not.toHaveBeenCalled();

    releaseSync();
    await Promise.resolve();
    await Promise.resolve();
    expect(reportRendererSyncFailure).toHaveBeenCalledOnce();

    guard.handleWindowClose(duringDialogWindowClose);
    guard.handleBeforeQuit(duringDialogQuit);
    expect(synchronize).toHaveBeenCalledOnce();
    expect(reportRendererSyncFailure).toHaveBeenCalledOnce();

    releaseDialog();
    await guard.waitForIdle();

    expect(firstWindowClose.preventDefault).toHaveBeenCalledOnce();
    expect(secondWindowClose.preventDefault).toHaveBeenCalledOnce();
    expect(duringSyncQuit.preventDefault).toHaveBeenCalledOnce();
    expect(duringDialogWindowClose.preventDefault).toHaveBeenCalledOnce();
    expect(duringDialogQuit.preventDefault).toHaveBeenCalledOnce();
    expect(synchronize).toHaveBeenCalledOnce();
    expect(reportRendererSyncFailure).toHaveBeenCalledOnce();
  });
});

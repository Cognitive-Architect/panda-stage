import { describe, expect, it, vi } from 'vitest';
import { ProjectSchema } from '../../src/domain';
import {
  UnsavedCloseController,
  createUnsavedCloseDialogOptions,
} from '../../src/main/services/UnsavedCloseController';
import { UnsavedCloseGuard } from '../../src/main/windows/unsaved-close-guard';
import type { AutosaveTrackRequest } from '../../src/shared/recovery-api';
import exampleProject from '../../demo-project/project-v1.example.json';

const dirtyProject: AutosaveTrackRequest = {
  projectRoot: 'D:\\projects\\dirty.pandastage',
  project: ProjectSchema.parse(exampleProject),
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
});

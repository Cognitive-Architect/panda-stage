import type { BrowserWindow, MessageBoxOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import {
  confirmPendingExportWork,
  type ExportCloseConfirmationDependencies,
} from '../../src/main/windows/export-close-confirmation';

const windowStub = {} as BrowserWindow;

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('confirmPendingExportWork', () => {
  it('cancels a running Main Job and waits for cleanup before allowing the window close', async () => {
    const completion = deferred();
    let finished = false;
    const cancelJob = vi.fn(() => true);
    const waitForJob = vi.fn(() => completion.promise);
    const showMessageBox = vi.fn(async () => ({ response: 0 }));
    const dependencies: ExportCloseConfirmationDependencies = {
      getPreparation: () => null,
      getExportService: () => ({
        getActiveJobId: () => 'job-running',
        canCancelJob: () => true,
        cancelJob,
        getJob: () => ({ phase: 'rendering' }),
        waitForJob,
      }),
      showMessageBox,
    };

    const pending = confirmPendingExportWork(windowStub, dependencies).then(
      (result) => {
        finished = true;
        return result;
      },
    );
    await Promise.resolve();

    expect(cancelJob).toHaveBeenCalledWith('job-running');
    expect(waitForJob).toHaveBeenCalledWith('job-running');
    expect(finished).toBe(false);
    completion.resolve();
    await expect(pending).resolves.toBe(true);
    expect(finished).toBe(true);
  });

  it('does not cancel a committing Job and keeps the window open until the atomic finish settles', async () => {
    const completion = deferred();
    let finished = false;
    const cancelJob = vi.fn(() => false);
    const waitForJob = vi.fn(() => completion.promise);
    const options: MessageBoxOptions[] = [];
    const dependencies: ExportCloseConfirmationDependencies = {
      getPreparation: () => null,
      getExportService: () => ({
        getActiveJobId: () => 'job-committing',
        canCancelJob: () => false,
        cancelJob,
        getJob: () => ({ phase: 'committing' }),
        waitForJob,
      }),
      showMessageBox: async (_window, nextOptions) => {
        options.push(nextOptions);
        return { response: 0 };
      },
    };

    const pending = confirmPendingExportWork(windowStub, dependencies).then(
      (result) => {
        finished = true;
        return result;
      },
    );
    await Promise.resolve();

    expect(options[0]?.title).toBe('\u89c6\u9891\u6b63\u5728\u6536\u5c3e');
    expect(cancelJob).not.toHaveBeenCalled();
    expect(waitForJob).toHaveBeenCalledWith('job-committing');
    expect(finished).toBe(false);
    completion.resolve();
    await expect(pending).resolves.toBe(true);
    expect(finished).toBe(true);
  });
});

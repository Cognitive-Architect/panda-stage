import type {
  BrowserWindow,
  MessageBoxOptions,
  MessageBoxReturnValue,
} from 'electron';

export interface ExportClosePreparation {
  hasActivePreparation(): boolean;
  cancelActivePreparationAndWait(): Promise<boolean>;
}

export interface ExportCloseService {
  getActiveJobId(): string | null;
  canCancelJob(jobId: string): boolean;
  cancelJob(jobId: string): boolean;
  getJob(jobId: string): { phase?: string | null } | null;
  waitForJob(jobId: string): Promise<void>;
}

export interface ExportCloseConfirmationDependencies {
  getPreparation(): ExportClosePreparation | null;
  getExportService(): ExportCloseService | null;
  showMessageBox(
    window: BrowserWindow,
    options: MessageBoxOptions,
  ): Promise<Pick<MessageBoxReturnValue, 'response'>>;
}

export async function confirmPendingExportWork(
  window: BrowserWindow,
  dependencies: ExportCloseConfirmationDependencies,
): Promise<boolean> {
  const preparation = dependencies.getPreparation();
  if (preparation?.hasActivePreparation()) {
    const choice = await dependencies.showMessageBox(window, {
      type: 'warning',
      title: '\u6b63\u5728\u51c6\u5907\u5bfc\u51fa',
      message:
        '\u5173\u95ed\u7a97\u53e3\u4f1a\u53d6\u6d88\u5f53\u524d\u68c0\u67e5\uff0c\u5e76\u7b49\u5f85\u4e34\u65f6\u7d20\u6750\u6e05\u7406\u5b8c\u6210\u3002',
      buttons: [
        '\u53d6\u6d88\u68c0\u67e5\u5e76\u5173\u95ed',
        '\u7ee7\u7eed\u68c0\u67e5',
      ],
      defaultId: 1,
      cancelId: 1,
    });
    if (choice.response !== 0) return false;
    await preparation.cancelActivePreparationAndWait();
  }

  const service = dependencies.getExportService();
  const jobId = service?.getActiveJobId();
  if (!service || !jobId) return true;
  const canCancel = service.canCancelJob(jobId);
  const choice = await dependencies.showMessageBox(window, {
    type: 'warning',
    title: canCancel
      ? '\u6b63\u5728\u5bfc\u51fa\u89c6\u9891'
      : '\u89c6\u9891\u6b63\u5728\u6536\u5c3e',
    message: canCancel
      ? '\u5173\u95ed\u7a97\u53e3\u4f1a\u53d6\u6d88\u5bfc\u51fa\uff0c\u5e76\u7b49\u5f85\u4e34\u65f6\u6587\u4ef6\u6e05\u7406\u5b8c\u6210\u3002'
      : '\u5bfc\u51fa\u5df2\u7ecf\u8fdb\u5165\u4e0d\u53ef\u53d6\u6d88\u7684\u6700\u540e\u9636\u6bb5\uff0c\u5173\u95ed\u7a97\u53e3\u4f1a\u7b49\u5f85\u4efb\u52a1\u5b8c\u6210\u3002',
    buttons: [
      canCancel
        ? '\u53d6\u6d88\u5bfc\u51fa\u5e76\u6e05\u7406\u540e\u5173\u95ed'
        : '\u7b49\u5f85\u4fdd\u5b58\u5b8c\u6210\u540e\u5173\u95ed',
      '\u4fdd\u6301\u7a97\u53e3\u6253\u5f00',
    ],
    defaultId: 1,
    cancelId: 1,
  });
  if (choice.response !== 0) return false;
  if (canCancel && !service.cancelJob(jobId)) {
    const latest = service.getJob(jobId);
    if (latest?.phase === 'committing') {
      await dependencies.showMessageBox(window, {
        type: 'info',
        title: '\u6b63\u5728\u4fdd\u5b58\u89c6\u9891',
        message:
          '\u6700\u540e\u4fdd\u5b58\u5df2\u7ecf\u5f00\u59cb\uff0c\u6b64\u523b\u65e0\u6cd5\u53d6\u6d88\u3002\u7a97\u53e3\u4f1a\u7b49\u5f85\u4fdd\u5b58\u5b8c\u6210\u3002',
        buttons: ['\u77e5\u9053\u4e86'],
        defaultId: 0,
      });
    }
  }
  await service.waitForJob(jobId);
  return true;
}

import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron';
import type { UnsavedCloseController } from '../services/UnsavedCloseController';
import type { RendererCloseSyncResult } from './renderer-close-synchronizer';

export interface PreventableCloseEvent {
  preventDefault(): void;
}

export type RendererSyncFailureAction = 'continue' | 'force-quit';

export interface UnsavedCloseGuardDependencies {
  controller: UnsavedCloseController;
  closeWindow: () => void;
  quitApplication: () => void;
  forceQuitApplication?: () => void;
  synchronizeRenderer: () => Promise<RendererCloseSyncResult>;
  confirmPendingWork?: (intent: CloseIntent) => Promise<boolean>;
  reportRendererSyncFailure?: (
    error: string,
    intent: CloseIntent,
  ) =>
    | void
    | RendererSyncFailureAction
    | Promise<void | RendererSyncFailureAction>;
}

export type CloseIntent = 'window' | 'application';

export function createCloseSyncFailureDialogOptions(): MessageBoxOptions {
  return {
    type: 'warning',
    buttons: ['继续编辑', '强制退出'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'Panda Stage 暂时无法正常关闭',
    message: '编辑器没有响应，部分未保存内容可能尚未同步。',
    detail:
      '选择“继续编辑”将保留当前窗口，稍后可手动保存或重试关闭；选择“强制退出”会立即关闭应用，未保存的修改可能丢失。',
  };
}

export async function promptRendererSyncFailureAction(
  showMessageBox: (
    options: MessageBoxOptions,
  ) => Promise<Pick<MessageBoxReturnValue, 'response'>>,
): Promise<RendererSyncFailureAction> {
  const result = await showMessageBox(createCloseSyncFailureDialogOptions());
  return result.response === 1 ? 'force-quit' : 'continue';
}

export class UnsavedCloseGuard {
  private approved = false;
  private resolution: Promise<void> | null = null;

  constructor(
    private readonly dependencies: UnsavedCloseGuardDependencies,
  ) {}

  handleWindowClose(event: PreventableCloseEvent): void {
    this.handle(event, 'window');
  }

  handleBeforeQuit(event: PreventableCloseEvent): void {
    this.handle(event, 'application');
  }

  waitForIdle(): Promise<void> {
    return this.resolution ?? Promise.resolve();
  }

  private handle(
    event: PreventableCloseEvent,
    intent: CloseIntent,
  ): void {
    if (this.approved) {
      return;
    }
    event.preventDefault();
    if (this.resolution) return;
    const resolution = this.resolveClose(intent)
      .finally(() => {
        if (this.resolution === resolution) this.resolution = null;
      });
    this.resolution = resolution;
  }

  private async resolveClose(intent: CloseIntent): Promise<void> {
    try {
      if (this.dependencies.confirmPendingWork) {
        const mayContinue = await this.dependencies.confirmPendingWork(intent);
        if (!mayContinue) return;
      }
    } catch (error) {
      await this.handleRendererSyncFailure(
        error instanceof Error ? error.message : String(error),
        intent,
      );
      return;
    }

    let synchronized: RendererCloseSyncResult;
    try {
      synchronized = await this.dependencies.synchronizeRenderer();
    } catch (error) {
      synchronized = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (!synchronized.ok) {
      await this.handleRendererSyncFailure(synchronized.error, intent);
      return;
    }
    if (!this.dependencies.controller.hasDirtyProject()) {
      this.approveClose(intent);
      return;
    }
    const outcome = await this.dependencies.controller.requestClose();
    if (outcome === 'allow-close') this.approveClose(intent);
  }

  private async handleRendererSyncFailure(
    error: string,
    intent: CloseIntent,
  ): Promise<void> {
    let action: RendererSyncFailureAction | void;
    try {
      action = await this.dependencies.reportRendererSyncFailure?.(
        error,
        intent,
      );
    } catch (reportError) {
      console.error(
        'Reporting renderer close synchronization failure threw an error.',
        reportError,
      );
      return;
    }
    if (action === 'force-quit') {
      this.forceQuit();
    }
  }

  private forceQuit(): void {
    this.approved = true;
    if (this.dependencies.forceQuitApplication) {
      this.dependencies.forceQuitApplication();
      return;
    }
    this.dependencies.quitApplication();
  }

  private approveClose(intent: CloseIntent): void {
    this.approved = true;
    if (intent === 'application') {
      this.dependencies.quitApplication();
    } else {
      this.dependencies.closeWindow();
    }
  }
}

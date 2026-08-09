import type { UnsavedCloseController } from '../services/UnsavedCloseController';
import type { RendererCloseSyncResult } from './renderer-close-synchronizer';

export interface PreventableCloseEvent {
  preventDefault(): void;
}

export interface UnsavedCloseGuardDependencies {
  controller: UnsavedCloseController;
  closeWindow: () => void;
  quitApplication: () => void;
  synchronizeRenderer: () => Promise<RendererCloseSyncResult>;
  reportRendererSyncFailure?: (
    error: string,
    intent: CloseIntent,
  ) => void | Promise<void>;
}

export type CloseIntent = 'window' | 'application';

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
      await this.dependencies.reportRendererSyncFailure?.(
        synchronized.error,
        intent,
      );
      return;
    }
    if (!this.dependencies.controller.hasDirtyProject()) {
      this.approveClose(intent);
      return;
    }
    const outcome = await this.dependencies.controller.requestClose();
    if (outcome === 'allow-close') this.approveClose(intent);
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

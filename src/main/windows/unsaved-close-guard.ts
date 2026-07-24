import type { UnsavedCloseController } from '../services/UnsavedCloseController';

export interface PreventableCloseEvent {
  preventDefault(): void;
}

export interface UnsavedCloseGuardDependencies {
  controller: UnsavedCloseController;
  closeWindow: () => void;
  quitApplication: () => void;
}

type CloseIntent = 'window' | 'application';

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
    if (this.approved || !this.dependencies.controller.hasDirtyProject()) {
      return;
    }
    event.preventDefault();
    if (this.resolution) return;
    const resolution = this.dependencies.controller
      .requestClose()
      .then((outcome) => {
        if (outcome !== 'allow-close') return;
        this.approved = true;
        if (intent === 'application') {
          this.dependencies.quitApplication();
        } else {
          this.dependencies.closeWindow();
        }
      })
      .finally(() => {
        if (this.resolution === resolution) this.resolution = null;
      });
    this.resolution = resolution;
  }
}

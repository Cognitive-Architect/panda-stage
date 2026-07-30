import type { MessageBoxOptions } from 'electron';
import type { AutosaveTrackRequest } from '../../shared/recovery-api';
import type {
  UnsavedCloseChoice,
  UnsavedCloseOutcome,
  UnsavedChangesIntent,
  UnsavedChangesResolution,
} from '../../shared/close-guard';

export interface UnsavedCloseControllerDependencies {
  getDirtyProject: () => AutosaveTrackRequest | null;
  prompt: (
    project: AutosaveTrackRequest,
    intent: UnsavedChangesIntent,
  ) => Promise<UnsavedCloseChoice>;
  save: (project: AutosaveTrackRequest) => Promise<void>;
  discard: (project: AutosaveTrackRequest) => Promise<void>;
  reportSaveFailure: (
    project: AutosaveTrackRequest,
    error: unknown,
    intent: UnsavedChangesIntent,
  ) => void | Promise<void>;
  reportDiscardFailure: (
    project: AutosaveTrackRequest,
    error: unknown,
    intent: UnsavedChangesIntent,
  ) => void | Promise<void>;
}

export function createUnsavedCloseDialogOptions(
  projectName: string,
  intent: UnsavedChangesIntent = 'close',
): MessageBoxOptions {
  const switching = intent === 'switch';
  return {
    type: 'warning',
    buttons: [
      switching ? '保存并切换' : '保存并退出',
      switching ? '不保存并切换' : '不保存',
      '取消',
    ],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    title: '有未保存的修改',
    message: `“${projectName}”包含未保存的修改。`,
    detail: switching
      ? '保存后切换、不保存直接切换，或取消并继续编辑当前项目。'
      : '保存后退出、不保存直接退出，或取消并继续编辑。',
  };
}

export class UnsavedCloseController {
  private inFlight: Promise<UnsavedChangesResolution> | null = null;

  constructor(
    private readonly dependencies: UnsavedCloseControllerDependencies,
  ) {}

  hasDirtyProject(): boolean {
    return this.dependencies.getDirtyProject() !== null;
  }

  async requestClose(): Promise<UnsavedCloseOutcome> {
    const resolution = await this.request(
      this.dependencies.getDirtyProject(),
      'close',
    );
    return resolution === 'clean' ||
      resolution === 'saved' ||
      resolution === 'discarded'
      ? 'allow-close'
      : resolution === 'cancelled'
        ? 'cancelled'
        : resolution;
  }

  requestSwitch(
    project: AutosaveTrackRequest,
  ): Promise<Exclude<UnsavedChangesResolution, 'clean'>> {
    return this.request(project, 'switch').then((resolution) => {
      if (resolution === 'clean') {
        throw new Error('A project-switch guard requires a dirty project.');
      }
      return resolution;
    });
  }

  private request(
    project: AutosaveTrackRequest | null,
    intent: UnsavedChangesIntent,
  ): Promise<UnsavedChangesResolution> {
    if (this.inFlight) return this.inFlight;
    const operation = this.run(project, intent).finally(() => {
      if (this.inFlight === operation) this.inFlight = null;
    });
    this.inFlight = operation;
    return operation;
  }

  private async run(
    project: AutosaveTrackRequest | null,
    intent: UnsavedChangesIntent,
  ): Promise<UnsavedChangesResolution> {
    if (!project) return 'clean';
    const choice = await this.dependencies.prompt(project, intent);
    if (choice === 'cancel') return 'cancelled';
    if (choice === 'discard') {
      try {
        await this.dependencies.discard(project);
        return 'discarded';
      } catch (error) {
        await this.dependencies.reportDiscardFailure(
          project,
          error,
          intent,
        );
        return 'discard-failed';
      }
    }
    try {
      await this.dependencies.save(project);
      return 'saved';
    } catch (error) {
      await this.dependencies.reportSaveFailure(project, error, intent);
      return 'save-failed';
    }
  }
}

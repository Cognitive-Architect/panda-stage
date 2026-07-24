import type { MessageBoxOptions } from 'electron';
import type { AutosaveTrackRequest } from '../../shared/recovery-api';
import type {
  UnsavedCloseChoice,
  UnsavedCloseOutcome,
} from '../../shared/close-guard';

export interface UnsavedCloseControllerDependencies {
  getDirtyProject: () => AutosaveTrackRequest | null;
  prompt: (
    project: AutosaveTrackRequest,
  ) => Promise<UnsavedCloseChoice>;
  save: (project: AutosaveTrackRequest) => Promise<void>;
  reportSaveFailure: (
    project: AutosaveTrackRequest,
    error: unknown,
  ) => void | Promise<void>;
}

export function createUnsavedCloseDialogOptions(
  projectName: string,
): MessageBoxOptions {
  return {
    type: 'warning',
    buttons: ['保存并退出', '不保存', '取消'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    title: '有未保存的修改',
    message: `“${projectName}”包含未保存的修改。`,
    detail: '保存后退出、不保存直接退出，或取消并继续编辑。',
  };
}

export class UnsavedCloseController {
  private inFlight: Promise<UnsavedCloseOutcome> | null = null;

  constructor(
    private readonly dependencies: UnsavedCloseControllerDependencies,
  ) {}

  hasDirtyProject(): boolean {
    return this.dependencies.getDirtyProject() !== null;
  }

  requestClose(): Promise<UnsavedCloseOutcome> {
    if (this.inFlight) return this.inFlight;
    const operation = this.run().finally(() => {
      if (this.inFlight === operation) this.inFlight = null;
    });
    this.inFlight = operation;
    return operation;
  }

  private async run(): Promise<UnsavedCloseOutcome> {
    const project = this.dependencies.getDirtyProject();
    if (!project) return 'allow-close';
    const choice = await this.dependencies.prompt(project);
    if (choice === 'cancel') return 'cancelled';
    if (choice === 'discard') return 'allow-close';
    try {
      await this.dependencies.save(project);
      return 'allow-close';
    } catch (error) {
      await this.dependencies.reportSaveFailure(project, error);
      return 'save-failed';
    }
  }
}

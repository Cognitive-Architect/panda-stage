import { ProjectSchema } from '../../../domain';
import type {
  ProjectOperationResponse,
} from '../../../shared/project-api';
import type {
  AutosaveTrackRequest,
  RecoveryAcknowledgeResponse,
  RecoveryCandidate,
  RecoveryDetectResponse,
} from '../../../shared/recovery-api';
import { EditorProjectStore } from '../../stores/EditorProjectStore';

export interface ProjectSessionApi {
  open(projectRoot: string): Promise<ProjectOperationResponse>;
  track(
    request: AutosaveTrackRequest,
  ): Promise<RecoveryAcknowledgeResponse>;
  stop(projectRoot: string): Promise<RecoveryAcknowledgeResponse>;
  detect(projectRoot: string): Promise<RecoveryDetectResponse>;
}

export interface ProjectSessionSnapshot {
  trackedProjectRoot: string | null;
  recoveryCandidate: RecoveryCandidate | null;
}

export class ProjectSessionSwitchError extends Error {
  constructor(
    readonly code:
      | 'CURRENT_PROJECT_DIRTY'
      | 'OPEN_FAILED'
      | 'TRACK_FAILED'
      | 'DETECT_FAILED'
      | 'STOP_FAILED'
      | 'ROLLBACK_FAILED',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ProjectSessionSwitchError';
  }
}

export class ProjectSessionController {
  private snapshot: ProjectSessionSnapshot = {
    trackedProjectRoot: null,
    recoveryCandidate: null,
  };

  constructor(
    private readonly api: ProjectSessionApi,
    private readonly store: EditorProjectStore,
  ) {}

  getSnapshot(): ProjectSessionSnapshot {
    return this.snapshot;
  }

  async switchProject(
    rawProjectRoot: string,
  ): Promise<ProjectSessionSnapshot> {
    const requestedRoot = rawProjectRoot.trim();
    const currentEditor = this.store.getSnapshot();
    if (
      currentEditor &&
      this.sameRoot(currentEditor.projectRoot, requestedRoot)
    ) {
      if (currentEditor.dirty) {
        throw new ProjectSessionSwitchError(
          'CURRENT_PROJECT_DIRTY',
          `Cannot reopen ${currentEditor.projectRoot}: the current project has unsaved changes.`,
        );
      }
      const detected = await this.api.detect(currentEditor.projectRoot);
      if (!detected.ok) {
        throw new ProjectSessionSwitchError(
          'DETECT_FAILED',
          detected.error.message,
        );
      }
      this.snapshot = {
        trackedProjectRoot: currentEditor.projectRoot,
        recoveryCandidate: detected.candidate,
      };
      return this.snapshot;
    }

    let temporaryProjectRoot: string | null = null;
    let temporaryTracked = false;
    let oldStopAttempted = false;
    try {
      const opened = await this.api.open(requestedRoot);
      if (!opened.ok) {
        throw new ProjectSessionSwitchError(
          'OPEN_FAILED',
          opened.error.message,
        );
      }
      const preparedProject = ProjectSchema.parse(opened.value.project);
      if (
        currentEditor &&
        this.sameRoot(
          currentEditor.projectRoot,
          opened.value.projectRoot,
        )
      ) {
        if (currentEditor.dirty) {
          throw new ProjectSessionSwitchError(
            'CURRENT_PROJECT_DIRTY',
            `Cannot reopen ${currentEditor.projectRoot}: the current project has unsaved changes.`,
          );
        }
        const detected = await this.api.detect(
          currentEditor.projectRoot,
        );
        if (!detected.ok) {
          throw new ProjectSessionSwitchError(
            'DETECT_FAILED',
            detected.error.message,
          );
        }
        this.snapshot = {
          trackedProjectRoot: currentEditor.projectRoot,
          recoveryCandidate: detected.candidate,
        };
        return this.snapshot;
      }
      temporaryProjectRoot = opened.value.projectRoot;
      temporaryTracked = true;
      const tracked = await this.api.track({
        projectRoot: temporaryProjectRoot,
        project: preparedProject,
        dirty: false,
        revision: 0,
      });
      if (!tracked.ok) {
        throw new ProjectSessionSwitchError(
          'TRACK_FAILED',
          tracked.error.message,
        );
      }

      const detected = await this.api.detect(temporaryProjectRoot);
      if (!detected.ok) {
        throw new ProjectSessionSwitchError(
          'DETECT_FAILED',
          detected.error.message,
        );
      }

      const oldProjectRoot = this.snapshot.trackedProjectRoot;
      if (oldProjectRoot) {
        oldStopAttempted = true;
        const stopped = await this.api.stop(oldProjectRoot);
        if (!stopped.ok) {
          throw new ProjectSessionSwitchError(
            'STOP_FAILED',
            stopped.error.message,
          );
        }
      }

      this.store.open(temporaryProjectRoot, preparedProject);
      this.snapshot = {
        trackedProjectRoot: temporaryProjectRoot,
        recoveryCandidate: detected.candidate,
      };
      temporaryTracked = false;
      return this.snapshot;
    } catch (error) {
      const rollbackFailures: string[] = [];
      if (temporaryTracked && temporaryProjectRoot) {
        try {
          const rollback = await this.api.stop(temporaryProjectRoot);
          if (!rollback.ok) {
            rollbackFailures.push(rollback.error.message);
          }
        } catch (rollbackError) {
          rollbackFailures.push(
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError),
          );
        }
      }
      if (oldStopAttempted && currentEditor) {
        try {
          const restored = await this.api.track(currentEditor);
          if (!restored.ok) {
            rollbackFailures.push(restored.error.message);
          }
        } catch (rollbackError) {
          rollbackFailures.push(
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError),
          );
        }
      }
      if (rollbackFailures.length > 0) {
        throw new ProjectSessionSwitchError(
          'ROLLBACK_FAILED',
          `Project switch failed and rollback was incomplete: ${rollbackFailures.join('; ')}`,
          { cause: error },
        );
      }
      throw error;
    }
  }

  clearRecoveryCandidate(): ProjectSessionSnapshot {
    this.snapshot = {
      ...this.snapshot,
      recoveryCandidate: null,
    };
    return this.snapshot;
  }

  async dispose(): Promise<void> {
    if (!this.snapshot.trackedProjectRoot) return;
    await this.api.stop(this.snapshot.trackedProjectRoot);
  }

  private sameRoot(left: string, right: string): boolean {
    const normalize = (value: string) =>
      value.trim().replaceAll('/', '\\').replace(/\\+$/u, '').toLowerCase();
    return normalize(left) === normalize(right);
  }
}

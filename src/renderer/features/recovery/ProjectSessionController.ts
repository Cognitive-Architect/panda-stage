import { migrateProject } from '../../../domain';
import type {
  ProjectOperationResponse,
  ProjectSwitchGuardRequest,
  ProjectSwitchGuardResponse,
} from '../../../shared/project-api';
import type { RecentProjectsOpenResponse } from '../../../shared/recent-projects-api';
import type {
  AutosaveTrackRequest,
  RecoveryAcknowledgeResponse,
  RecoveryCandidate,
  RecoveryDetectResponse,
} from '../../../shared/recovery-api';
import {
  EditorProjectStore,
} from '../../stores/EditorProjectStore';

export interface ProjectSessionApi {
  open(projectRoot: string): Promise<ProjectOperationResponse>;
  openRecent(
    projectRoot: string,
    expectedProjectId: string,
  ): Promise<RecentProjectsOpenResponse>;
  track(
    request: AutosaveTrackRequest,
  ): Promise<RecoveryAcknowledgeResponse>;
  stop(projectRoot: string): Promise<RecoveryAcknowledgeResponse>;
  detect(projectRoot: string): Promise<RecoveryDetectResponse>;
  confirmSwitch(
    request: ProjectSwitchGuardRequest,
  ): Promise<ProjectSwitchGuardResponse>;
}

export interface ProjectSessionSnapshot {
  trackedProjectRoot: string | null;
  recoveryCandidate: RecoveryCandidate | null;
}

export class ProjectSessionSwitchError extends Error {
  constructor(
    readonly code:
      | 'CURRENT_PROJECT_DIRTY'
      | 'SWITCH_CANCELLED'
      | 'SWITCH_SAVE_FAILED'
      | 'SWITCH_DISCARD_FAILED'
      | 'OPEN_FAILED'
      | 'TRACK_FAILED'
      | 'DETECT_FAILED'
      | 'STOP_FAILED'
      | 'CLOSE_STOP_FAILED'
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
  private readonly ignoredRecoveryFiles = new Set<string>();

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
    return this.switchWith(rawProjectRoot, async (projectRoot) => {
      const response = await this.api.open(projectRoot);
      return response.ok
        ? { ok: true as const, document: response.value }
        : response;
    });
  }

  async switchRecentProject(
    rawProjectRoot: string,
    expectedProjectId: string,
  ): Promise<ProjectSessionSnapshot> {
    return this.switchWith(rawProjectRoot, (projectRoot) =>
      this.api.openRecent(projectRoot, expectedProjectId),
    );
  }

  private async switchWith(
    rawProjectRoot: string,
    open: (
      projectRoot: string,
    ) => Promise<
      | { ok: true; document: { projectRoot: string; project: unknown } }
      | { ok: false; error: { message: string } }
    >,
  ): Promise<ProjectSessionSnapshot> {
    const requestedRoot = rawProjectRoot.trim();
    const currentEditor = this.store.getSnapshot();
    if (
      currentEditor &&
      this.sameRoot(currentEditor.projectRoot, requestedRoot)
    ) {
      const detected = await this.api.detect(currentEditor.projectRoot);
      if (!detected.ok) {
        throw new ProjectSessionSwitchError(
          'DETECT_FAILED',
          detected.error.message,
        );
      }
      this.snapshot = {
        trackedProjectRoot: currentEditor.projectRoot,
        recoveryCandidate: this.visibleRecoveryCandidate(
          detected.candidate,
        ),
      };
      return this.snapshot;
    }

    let temporaryProjectRoot: string | null = null;
    let temporaryTracked = false;
    let oldStopAttempted = false;
    let discardedCurrentSession = false;
    let currentForRollback = currentEditor;
    try {
      const opened = await open(requestedRoot);
      if (!opened.ok) {
        throw new ProjectSessionSwitchError(
          'OPEN_FAILED',
          opened.error.message,
          { cause: opened.error },
        );
      }
      // Persisted document ingestion routes through the single migration
      // pipeline; the real document is already v6 (migrated by ProjectService
      // on open), but a legacy envelope is migrated here too.
      const preparedProject = migrateProject(opened.document.project);
      if (
        currentEditor &&
        this.sameRoot(
          currentEditor.projectRoot,
          opened.document.projectRoot,
        )
      ) {
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
          recoveryCandidate: this.visibleRecoveryCandidate(
            detected.candidate,
          ),
        };
        return this.snapshot;
      }

      temporaryProjectRoot = opened.document.projectRoot;
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

      if (currentEditor?.dirty) {
        const guarded = await this.api.confirmSwitch({
          ...currentEditor,
          dirty: true,
        });
        if (guarded.outcome === 'cancelled') {
          throw new ProjectSessionSwitchError(
            'SWITCH_CANCELLED',
            'Project switch was cancelled.',
          );
        }
        if (guarded.outcome === 'save-failed') {
          throw new ProjectSessionSwitchError(
            'SWITCH_SAVE_FAILED',
            'The current project could not be saved, so the switch was cancelled.',
          );
        }
        if (guarded.outcome === 'discard-failed') {
          throw new ProjectSessionSwitchError(
            'SWITCH_DISCARD_FAILED',
            'The current project recovery state could not be discarded, so the switch was cancelled.',
          );
        }
        if (guarded.outcome === 'saved') {
          this.store.markSaved(
            currentEditor.project,
            currentEditor.revision,
          );
          currentForRollback = this.store.getSnapshot();
        } else {
          discardedCurrentSession = true;
        }
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
        recoveryCandidate: this.visibleRecoveryCandidate(
          detected.candidate,
        ),
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
      if (
        (oldStopAttempted || discardedCurrentSession) &&
        currentForRollback
      ) {
        try {
          const restored = await this.api.track(currentForRollback);
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

  /**
   * Closes the currently tracked project without closing the window.
   *
   * This is an additive lifecycle method: it does not change `switchProject`,
   * `switchRecentProject`, or `dispose`. It performs exactly one Main Process
   * call — the existing `autosave.stop` — which clears the autosave timer and
   * drains the in-flight write. It deliberately never asks the Main Process to
   * discard, so the recovery file that autosave already produced stays on disk
   * and can surface as a recovery candidate the next time the project opens.
   *
   * Saving is the caller's decision: the shell saves before calling this when
   * the user picks "save and close", and skips saving when the user picks
   * "close without saving".
   */
  async closeProject(): Promise<ProjectSessionSnapshot> {
    const trackedProjectRoot = this.snapshot.trackedProjectRoot;
    if (trackedProjectRoot) {
      const stopped = await this.api.stop(trackedProjectRoot);
      if (!stopped.ok) {
        // Keep the session intact so the user can retry or keep editing.
        throw new ProjectSessionSwitchError(
          'CLOSE_STOP_FAILED',
          stopped.error.message,
        );
      }
    }
    this.store.clear();
    this.snapshot = {
      trackedProjectRoot: null,
      recoveryCandidate: null,
    };
    return this.snapshot;
  }

  clearRecoveryCandidate(ignored = false): ProjectSessionSnapshot {
    if (ignored && this.snapshot.recoveryCandidate) {
      this.ignoredRecoveryFiles.add(
        this.recoveryKey(this.snapshot.recoveryCandidate),
      );
    }
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

  private visibleRecoveryCandidate(
    candidate: RecoveryCandidate | null,
  ): RecoveryCandidate | null {
    if (!candidate) return null;
    return this.ignoredRecoveryFiles.has(this.recoveryKey(candidate))
      ? null
      : candidate;
  }

  private recoveryKey(candidate: RecoveryCandidate): string {
    return `${candidate.projectRoot}\u0000${candidate.recoveryFilePath}`;
  }
}

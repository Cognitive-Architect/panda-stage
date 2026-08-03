import path from 'node:path';
import { ProjectSchema, type Project } from '../../domain';
import {
  AUTOSAVE_INTERVAL_MS,
  type AutosaveTrackRequest,
  type RecoveryError,
} from '../../shared/recovery-api';
import {
  RecoveryService,
  RecoveryServiceError,
} from './RecoveryService';
import { ProjectOperationCoordinator } from './ProjectOperationCoordinator';

type IntervalHandle = ReturnType<typeof setInterval>;

export interface AutosaveClock {
  setInterval(callback: () => void, intervalMs: number): IntervalHandle;
  clearInterval(handle: IntervalHandle): void;
}

interface AutosaveSession {
  projectRoot: string;
  project: Project;
  savedProject: Project;
  savedRevision: number;
  dirty: boolean;
  revision: number;
  lastSavedRevision: number;
  timer: IntervalHandle;
  inFlight: Promise<void> | null;
  recoveryCleanup: Promise<void> | null;
  discarding: boolean;
}

export interface AutosaveServiceOptions {
  recoveryService: RecoveryService;
  clock?: AutosaveClock;
  onError?: (error: RecoveryError) => void;
  coordinator?: ProjectOperationCoordinator;
}

const defaultClock: AutosaveClock = {
  setInterval: (callback, intervalMs) =>
    setInterval(callback, intervalMs),
  clearInterval: (handle) => clearInterval(handle),
};

export class AutosaveService {
  private readonly recoveryService: RecoveryService;
  private readonly clock: AutosaveClock;
  private readonly onError: (error: RecoveryError) => void;
  private readonly sessions = new Map<string, AutosaveSession>();
  private readonly coordinator: ProjectOperationCoordinator;

  constructor(options: AutosaveServiceOptions) {
    this.recoveryService = options.recoveryService;
    this.clock = options.clock ?? defaultClock;
    this.onError = options.onError ?? (() => undefined);
    this.coordinator =
      options.coordinator ?? new ProjectOperationCoordinator();
  }

  track(rawRequest: AutosaveTrackRequest): void {
    const request = this.parseRequest(rawRequest);
    const projectRoot = path.resolve(request.projectRoot);
    const existing = this.sessions.get(projectRoot);
    if (existing) {
      this.applyUpdate(existing, request);
      return;
    }

    const session: AutosaveSession = {
      projectRoot,
      project: request.project,
      savedProject: request.project,
      savedRevision: request.revision,
      dirty: request.dirty,
      revision: request.revision,
      lastSavedRevision: request.dirty
        ? request.revision - 1
        : request.revision,
      timer: this.clock.setInterval(() => {
        void this.tick(projectRoot).catch((error: unknown) => {
          this.onError(this.toRecoveryError(projectRoot, error));
        });
      }, AUTOSAVE_INTERVAL_MS),
      inFlight: null,
      recoveryCleanup: null,
      discarding: false,
    };
    this.sessions.set(projectRoot, session);
  }

  update(rawRequest: AutosaveTrackRequest): void {
    const request = this.parseRequest(rawRequest);
    const projectRoot = path.resolve(request.projectRoot);
    const session = this.sessions.get(projectRoot);
    if (!session) {
      throw new Error(`Autosave session is not tracked: ${projectRoot}`);
    }
    this.applyUpdate(session, request);
  }

  async tick(rawProjectRoot: string): Promise<void> {
    const projectRoot = path.resolve(rawProjectRoot);
    const session = this.sessions.get(projectRoot);
    if (!session || !session.dirty || session.discarding) return;
    if (session.revision <= session.lastSavedRevision) return;
    if (session.inFlight) return session.inFlight;

    const write = this.coordinator
      .runExclusive(projectRoot, async () => {
        const current = this.sessions.get(projectRoot);
        if (!current || !current.dirty || current.discarding) return;
        if (current.revision <= current.lastSavedRevision) return;
        const revision = current.revision;
        const project = structuredClone(current.project);
        await this.recoveryService.writeRecovery(projectRoot, project);
        const latest = this.sessions.get(projectRoot);
        if (!latest) return;
        latest.lastSavedRevision = Math.max(
          latest.lastSavedRevision,
          revision,
        );
      })
      .finally(() => {
        const current = this.sessions.get(projectRoot);
        if (current?.inFlight === write) current.inFlight = null;
      });
    session.inFlight = write;
    return write;
  }

  async stop(rawProjectRoot: string): Promise<void> {
    const projectRoot = path.resolve(rawProjectRoot);
    const session = this.sessions.get(projectRoot);
    if (!session) return;
    this.clock.clearInterval(session.timer);
    await session.inFlight?.catch(() => undefined);
    const recoveryCleanup = session.recoveryCleanup;
    if (recoveryCleanup) {
      try {
        await recoveryCleanup;
      } catch (error) {
        session.timer = this.createTimer(projectRoot);
        throw error;
      }
    }
    this.sessions.delete(projectRoot);
  }

  async discard(
    rawProjectRoot: string,
    expectedProjectId: string,
  ): Promise<void> {
    const projectRoot = path.resolve(rawProjectRoot);
    const session = this.sessions.get(projectRoot);
    if (!session) return;
    if (session.project.id !== expectedProjectId) {
      throw new RecoveryServiceError(
        'RECOVERY_PROJECT_MISMATCH',
        projectRoot,
        'Cannot discard recovery for a different project identity.',
      );
    }

    session.discarding = true;
    this.clock.clearInterval(session.timer);
    try {
      await session.inFlight;
      await this.coordinator.runExclusive(projectRoot, async () => {
        await this.recoveryService.cleanupAfterFormalSave(
          projectRoot,
          expectedProjectId,
        );
        await this.recoveryService.assertDiscarded(
          projectRoot,
          session.project,
        );
      });
      this.sessions.delete(projectRoot);
    } catch (error) {
      session.discarding = false;
      session.timer = this.createTimer(projectRoot);
      throw error;
    }
  }

  async stopAll(): Promise<void> {
    const roots = [...this.sessions.keys()];
    await Promise.all(roots.map((root) => this.stop(root)));
  }

  async waitForIdle(rawProjectRoot: string): Promise<void> {
    const session = this.sessions.get(path.resolve(rawProjectRoot));
    await session?.inFlight;
  }

  trackedProjectCount(): number {
    return this.sessions.size;
  }

  getDirtyProjectSnapshot(): AutosaveTrackRequest | null {
    for (const session of this.sessions.values()) {
      if (!session.dirty) continue;
      return {
        projectRoot: session.projectRoot,
        project: structuredClone(session.project),
        dirty: true,
        revision: session.revision,
      };
    }
    return null;
  }

  getProjectSnapshot(
    rawProjectRoot: string,
  ): AutosaveTrackRequest | null {
    const session = this.sessions.get(path.resolve(rawProjectRoot));
    if (!session) return null;
    return {
      projectRoot: session.projectRoot,
      project: structuredClone(session.project),
      dirty: session.dirty,
      revision: session.revision,
    };
  }

  markFormalSaved(
    rawProjectRoot: string,
    rawProject: Project,
    revision: number,
  ): void {
    const projectRoot = path.resolve(rawProjectRoot);
    const session = this.sessions.get(projectRoot);
    if (!session) return;
    const project = ProjectSchema.parse(rawProject);
    if (session.project.id !== project.id) {
      throw new Error(
        `Formal save project identity mismatch at ${projectRoot}.`,
      );
    }
    if (!Number.isInteger(revision) || revision < 0) {
      throw new Error(
        `Formal save revision must be a non-negative integer at ${projectRoot}.`,
      );
    }
    if (
      revision < session.revision ||
      (revision === session.revision &&
        !projectsEqual(session.project, project))
    ) {
      session.savedProject = project;
      session.savedRevision = revision;
      session.lastSavedRevision = Math.max(
        session.lastSavedRevision,
        revision,
      );
      return;
    }
    session.project = project;
    session.savedProject = project;
    session.savedRevision = revision;
    session.dirty = false;
    session.revision = revision;
    session.lastSavedRevision = Math.max(
      session.lastSavedRevision,
      revision,
    );
  }

  private parseRequest(
    rawRequest: AutosaveTrackRequest,
  ): AutosaveTrackRequest {
    return {
      ...rawRequest,
      project: ProjectSchema.parse(rawRequest.project),
    };
  }

  private createTimer(projectRoot: string): IntervalHandle {
    return this.clock.setInterval(() => {
      void this.tick(projectRoot).catch((error: unknown) => {
        this.onError(this.toRecoveryError(projectRoot, error));
      });
    }, AUTOSAVE_INTERVAL_MS);
  }

  private applyUpdate(
    session: AutosaveSession,
    request: AutosaveTrackRequest,
  ): void {
    if (session.project.id !== request.project.id) {
      throw new Error(
        `Autosave project identity mismatch at ${session.projectRoot}.`,
      );
    }
    if (request.revision < session.revision) {
      throw new Error(
        `Autosave revision cannot move backwards at ${session.projectRoot}.`,
      );
    }
    const wasDirty = session.dirty;
    session.project = request.project;
    session.dirty = request.dirty;
    session.revision = request.revision;
    if (
      wasDirty &&
      !request.dirty &&
      projectsEqual(request.project, session.savedProject)
    ) {
      this.scheduleRecoveryCleanup(session);
    }
  }

  /**
   * A history undo can make the live editor exactly match the last formal
   * project save without going through ProjectService.save. In that case the
   * recovery snapshot is no longer unsaved work and must be removed before a
   * later A → B → A detection can offer it again.
   *
   * The cleanup is queued through the same per-project coordinator as writes
   * and is awaited by stop(), so a project switch cannot race it.
   */
  private scheduleRecoveryCleanup(session: AutosaveSession): void {
    const previous = session.recoveryCleanup ?? Promise.resolve();
    const cleanup = previous.then(() =>
      this.coordinator.runExclusive(session.projectRoot, async () => {
        await this.recoveryService.cleanupAfterFormalSave?.(
          session.projectRoot,
          session.savedProject.id,
        );
      }),
    );
    const tracked = cleanup.finally(() => {
      if (session.recoveryCleanup === tracked) {
        session.recoveryCleanup = null;
      }
    });
    session.recoveryCleanup = tracked;
    void tracked.catch((error: unknown) => {
      this.onError(this.toRecoveryError(session.projectRoot, error));
    });
  }

  private toRecoveryError(
    projectRoot: string,
    error: unknown,
  ): RecoveryError {
    const normalized =
      error instanceof RecoveryServiceError
        ? error
        : new RecoveryServiceError(
            'RECOVERY_WRITE_FAILED',
            projectRoot,
            `Autosave failed for ${projectRoot}: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
    return {
      code: normalized.code,
      message: normalized.message,
      projectRoot: normalized.projectRoot,
    };
  }
}

function projectsEqual(left: Project, right: Project): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

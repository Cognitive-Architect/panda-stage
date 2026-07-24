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
  dirty: boolean;
  revision: number;
  lastSavedRevision: number;
  timer: IntervalHandle;
  inFlight: Promise<void> | null;
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
    if (!session || !session.dirty) return;
    if (session.revision <= session.lastSavedRevision) return;
    if (session.inFlight) return session.inFlight;

    const write = this.coordinator
      .runExclusive(projectRoot, async () => {
        const current = this.sessions.get(projectRoot);
        if (!current || !current.dirty) return;
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
    this.sessions.delete(projectRoot);
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
    if (revision < session.revision) {
      session.lastSavedRevision = Math.max(
        session.lastSavedRevision,
        revision,
      );
      return;
    }
    session.project = project;
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
    session.project = request.project;
    session.dirty = request.dirty;
    session.revision = request.revision;
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

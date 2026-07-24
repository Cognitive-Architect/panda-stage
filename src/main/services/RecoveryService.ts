import path from 'node:path';
import { ProjectSchema, type Project } from '../../domain';
import {
  RECOVERY_SCHEMA_VERSION,
  RecoveryCandidateSchema,
  RecoveryEnvelopeSchema,
  type RecoveryCandidate,
  type RecoveryErrorCode,
} from '../../shared/recovery-api';
import { RecoveryFileSystemService } from './RecoveryFileSystemService';

const RECOVERY_FILE_PATTERN =
  /^(?<projectId>[0-9a-f-]{36})\.(?<savedAtMs>\d+)\.recovery\.json$/iu;

export interface RecoveryServiceOptions {
  fileSystem?: RecoveryFileSystemService;
  nowMs?: () => number;
}

export class RecoveryServiceError extends Error {
  constructor(
    readonly code: RecoveryErrorCode,
    readonly projectRoot: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RecoveryServiceError';
  }
}

export class RecoveryService {
  private readonly fileSystem: RecoveryFileSystemService;
  private readonly nowMs: () => number;

  constructor(options: RecoveryServiceOptions = {}) {
    this.fileSystem = options.fileSystem ?? new RecoveryFileSystemService();
    this.nowMs = options.nowMs ?? Date.now;
  }

  async writeRecovery(
    rawProjectRoot: string,
    rawProject: Project,
  ): Promise<RecoveryCandidate> {
    const projectRoot = path.resolve(rawProjectRoot);
    const project = ProjectSchema.parse(rawProject);
    const savedAtMs = Math.trunc(this.nowMs());
    const envelope = RecoveryEnvelopeSchema.parse({
      schemaVersion: RECOVERY_SCHEMA_VERSION,
      projectId: project.id,
      savedAtMs,
      project,
    });
    const fileName = this.fileName(project.id, savedAtMs);

    try {
      const recoveryFilePath =
        await this.fileSystem.writeRecoveryAtomically(
          projectRoot,
          fileName,
          `${JSON.stringify(envelope, null, 2)}\n`,
        );
      await this.removeOlderRecoveries(projectRoot, project.id, fileName);
      return RecoveryCandidateSchema.parse({
        projectRoot,
        recoveryFilePath,
        projectId: project.id,
        savedAtMs,
        project,
      });
    } catch (error) {
      throw this.mapError(
        'RECOVERY_WRITE_FAILED',
        projectRoot,
        'write recovery snapshot',
        error,
      );
    }
  }

  async detectLatest(
    rawProjectRoot: string,
    rawFormalProject: Project,
  ): Promise<RecoveryCandidate | null> {
    const projectRoot = path.resolve(rawProjectRoot);
    const formalProject = ProjectSchema.parse(rawFormalProject);
    try {
      const formalModifiedAtMs =
        await this.fileSystem.projectModifiedAtMs(projectRoot);
      const names = await this.fileSystem.listRecoveryFiles(projectRoot);
      let latest: RecoveryCandidate | null = null;

      for (const name of names) {
        const match = RECOVERY_FILE_PATTERN.exec(name);
        if (match?.groups?.projectId !== formalProject.id) continue;
        const filePath = path.join(
          this.fileSystem.recoveryDirectory(projectRoot),
          name,
        );
        const candidate = await this.tryReadCandidate(
          projectRoot,
          filePath,
          formalProject.id,
        );
        if (
          candidate &&
          candidate.savedAtMs > formalModifiedAtMs &&
          (!latest || candidate.savedAtMs > latest.savedAtMs)
        ) {
          latest = candidate;
        }
      }
      return latest;
    } catch (error) {
      throw this.mapError(
        'RECOVERY_READ_FAILED',
        projectRoot,
        'detect recovery snapshots',
        error,
      );
    }
  }

  async restore(
    rawProjectRoot: string,
    rawRecoveryFilePath: string,
    expectedProjectId: string,
  ): Promise<RecoveryCandidate> {
    const projectRoot = path.resolve(rawProjectRoot);
    const recoveryFilePath = this.assertRecoveryPath(
      projectRoot,
      rawRecoveryFilePath,
    );
    try {
      const candidate = await this.readCandidate(
        projectRoot,
        recoveryFilePath,
      );
      if (candidate.projectId !== expectedProjectId) {
        throw new RecoveryServiceError(
          'RECOVERY_PROJECT_MISMATCH',
          projectRoot,
          `Cannot restore recovery at ${recoveryFilePath}: recovery project ID ${candidate.projectId} does not match current project ID ${expectedProjectId}.`,
        );
      }
      return candidate;
    } catch (error) {
      if (error instanceof RecoveryServiceError) throw error;
      throw this.mapError(
        'RECOVERY_INVALID',
        projectRoot,
        'restore recovery snapshot',
        error,
      );
    }
  }

  async ignore(
    rawProjectRoot: string,
    rawRecoveryFilePath: string,
    expectedProjectId: string,
  ): Promise<void> {
    await this.restore(
      rawProjectRoot,
      rawRecoveryFilePath,
      expectedProjectId,
    );
  }

  async cleanupAfterFormalSave(
    rawProjectRoot: string,
    projectId: string,
  ): Promise<void> {
    const projectRoot = path.resolve(rawProjectRoot);
    const names = await this.fileSystem.listRecoveryFiles(projectRoot);
    await Promise.all(
      names
        .filter(
          (name) =>
            RECOVERY_FILE_PATTERN.exec(name)?.groups?.projectId === projectId,
        )
        .map((name) =>
          this.fileSystem.removeFile(
            path.join(this.fileSystem.recoveryDirectory(projectRoot), name),
          ),
        ),
    );
  }

  async assertDiscarded(
    rawProjectRoot: string,
    rawProject: Project,
  ): Promise<void> {
    const projectRoot = path.resolve(rawProjectRoot);
    const project = ProjectSchema.parse(rawProject);
    try {
      const names = await this.fileSystem.listRecoveryFiles(projectRoot);
      const artifacts = names.filter((name) => name.includes(project.id));
      const latest = await this.detectLatest(projectRoot, project);
      if (artifacts.length > 0 || latest !== null) {
        throw new Error(
          `Recovery artifacts remain: ${artifacts.join(', ') || latest?.recoveryFilePath}`,
        );
      }
    } catch (error) {
      throw this.mapError(
        'RECOVERY_CLEANUP_FAILED',
        projectRoot,
        'verify discarded recovery snapshots',
        error,
      );
    }
  }

  private fileName(projectId: string, savedAtMs: number): string {
    return `${projectId}.${savedAtMs}.recovery.json`;
  }

  private async removeOlderRecoveries(
    projectRoot: string,
    projectId: string,
    currentFileName: string,
  ): Promise<void> {
    const names = await this.fileSystem.listRecoveryFiles(projectRoot);
    await Promise.all(
      names
        .filter(
          (name) =>
            name !== currentFileName &&
            RECOVERY_FILE_PATTERN.exec(name)?.groups?.projectId === projectId,
        )
        .map((name) =>
          this.fileSystem.removeFile(
            path.join(this.fileSystem.recoveryDirectory(projectRoot), name),
          ),
        ),
    );
  }

  private assertRecoveryPath(
    projectRoot: string,
    rawRecoveryFilePath: string,
  ): string {
    const recoveryFilePath = path.resolve(rawRecoveryFilePath);
    const recoveryDirectory = path.resolve(
      this.fileSystem.recoveryDirectory(projectRoot),
    );
    if (
      path.dirname(recoveryFilePath) !== recoveryDirectory ||
      !RECOVERY_FILE_PATTERN.test(path.basename(recoveryFilePath))
    ) {
      throw new RecoveryServiceError(
        'RECOVERY_INVALID',
        projectRoot,
        `Recovery path is outside the project recovery directory: ${recoveryFilePath}`,
      );
    }
    return recoveryFilePath;
  }

  private async tryReadCandidate(
    projectRoot: string,
    recoveryFilePath: string,
    expectedProjectId: string,
  ): Promise<RecoveryCandidate | null> {
    try {
      const candidate = await this.readCandidate(
        projectRoot,
        recoveryFilePath,
      );
      return candidate.projectId === expectedProjectId ? candidate : null;
    } catch {
      return null;
    }
  }

  private async readCandidate(
    projectRoot: string,
    recoveryFilePath: string,
  ): Promise<RecoveryCandidate> {
    let raw: unknown;
    try {
      raw = JSON.parse(await this.fileSystem.readText(recoveryFilePath));
    } catch (error) {
      throw new RecoveryServiceError(
        'RECOVERY_INVALID',
        projectRoot,
        `Recovery file is not valid JSON: ${recoveryFilePath}`,
        { cause: error },
      );
    }
    const envelope = RecoveryEnvelopeSchema.parse(raw);
    return RecoveryCandidateSchema.parse({
      projectRoot,
      recoveryFilePath,
      projectId: envelope.projectId,
      savedAtMs: envelope.savedAtMs,
      project: envelope.project,
    });
  }

  private mapError(
    code: RecoveryErrorCode,
    projectRoot: string,
    action: string,
    error: unknown,
  ): RecoveryServiceError {
    if (error instanceof RecoveryServiceError) return error;
    return new RecoveryServiceError(
      code,
      projectRoot,
      `Cannot ${action} for ${projectRoot}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

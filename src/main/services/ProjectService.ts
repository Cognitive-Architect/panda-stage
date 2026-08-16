import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import {
  PROJECT_FPS,
  PROJECT_HEIGHT,
  PROJECT_SCHEMA_VERSION,
  PROJECT_WIDTH,
  ProjectSchema,
  UnsupportedSchemaVersionError,
  detectSchemaVersion,
  migrateProject,
  type DetectedSchemaVersion,
  type Project,
} from '../../domain';
import {
  PROJECT_ROOT_EXTENSION,
  ProjectCreateMetadataSchema,
  projectNameIssue,
  type ProjectCreateMetadata,
  type ProjectDocument,
  type ProjectErrorCode,
} from '../../shared/project-api';
import {
  AtomicWriteCommitRejectedError,
  ProjectFileNotFoundError,
  ProjectFileSystemService,
  ProjectRootAlreadyExistsError,
} from './ProjectFileSystemService';
import { ProjectOperationCoordinator } from './ProjectOperationCoordinator';
import { PathService } from './PathService';

export interface ProjectServiceOptions {
  fileSystem?: ProjectFileSystemService;
  now?: () => Date;
  createId?: () => string;
  onProjectSaved?: (
    projectRoot: string,
    project: Project,
    revision?: number,
  ) => void | Promise<void>;
  onPostSaveError?: (error: unknown) => void;
  coordinator?: ProjectOperationCoordinator;
  pathService?: PathService;
  getCurrentProjectSnapshot?: (
    projectRoot: string,
  ) => ProjectRevisionSnapshot | null;
}

export interface ProjectRevisionSnapshot {
  project: Project;
  revision: number;
}

export interface ProjectTransaction {
  projectRoot: string;
  existingDocument: ProjectDocument;
  save(
    project: Project,
    revision?: number,
    commitGuard?: () => void,
  ): Promise<ProjectDocument>;
}

export class ProjectServiceError extends Error {
  readonly currentProject: Project | undefined;
  readonly currentRevision: number | undefined;

  constructor(
    readonly code: ProjectErrorCode,
    readonly projectRoot: string,
    message: string,
    options: ErrorOptions & {
      currentProject?: Project;
      currentRevision?: number;
    } = {},
  ) {
    super(message, options);
    this.name = 'ProjectServiceError';
    this.currentProject = options.currentProject;
    this.currentRevision = options.currentRevision;
  }
}

export class ProjectService {
  private readonly fileSystem: ProjectFileSystemService;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly onProjectSaved:
    | ((
        projectRoot: string,
        project: Project,
        revision?: number,
      ) => void | Promise<void>)
    | null;
  private readonly onPostSaveError: (error: unknown) => void;
  private readonly coordinator: ProjectOperationCoordinator;
  private readonly pathService: PathService;
  private readonly getCurrentProjectSnapshot:
    | ((projectRoot: string) => ProjectRevisionSnapshot | null)
    | null;

  constructor(options: ProjectServiceOptions = {}) {
    this.fileSystem = options.fileSystem ?? new ProjectFileSystemService();
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
    this.onProjectSaved = options.onProjectSaved ?? null;
    this.onPostSaveError = options.onPostSaveError ?? (() => undefined);
    this.coordinator =
      options.coordinator ?? new ProjectOperationCoordinator();
    this.pathService = options.pathService ?? new PathService();
    this.getCurrentProjectSnapshot =
      options.getCurrentProjectSnapshot ?? null;
  }

  async create(
    rawProjectRoot: string,
    rawMetadata: ProjectCreateMetadata,
  ): Promise<ProjectDocument> {
    const projectRoot = this.resolveProjectRoot(rawProjectRoot);
    let treeCreated = false;
    try {
      const metadata = ProjectCreateMetadataSchema.parse(rawMetadata);
      await this.fileSystem.createProjectTree(projectRoot);
      treeCreated = true;
      const timestamp = this.now().toISOString();
      const project = ProjectSchema.parse({
        schemaVersion: PROJECT_SCHEMA_VERSION,
        id: this.createId(),
        name: metadata.name,
        width: PROJECT_WIDTH,
        height: PROJECT_HEIGHT,
        fps: PROJECT_FPS,
        assets: [],
        characters: [],
        voiceProfiles: [],
        subtitleStyles: [
          {
            id: this.createId(),
            name: 'Default subtitles',
            fontFamily: 'Microsoft YaHei',
            fontSize: 44,
            textColor: '#fffdf6',
            backgroundColor: '#0a1411c7',
            position: 'bottom',
            align: 'center',
            maxWidth: 1600,
          },
        ],
        shots: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await this.fileSystem.writeProjectFileAtomically(
        projectRoot,
        this.serialize(project),
      );
      return this.document(
        projectRoot,
        project,
        false,
        PROJECT_SCHEMA_VERSION,
      );
    } catch (error) {
      if (treeCreated) {
        await this.fileSystem
          .removeNewProjectRoot(projectRoot)
          .catch(() => undefined);
      }
      throw this.mapError('create', projectRoot, error);
    }
  }

  /**
   * Creates a project inside `rawParentDirectory` from a bare project name.
   *
   * The Renderer is never allowed to assemble the final project root, so this
   * method owns the path join, the containment check, and the `.pandastage`
   * suffix. The actual tree creation and duplicate rejection are delegated to
   * {@link ProjectService.create}, which keeps a single creation code path.
   *
   * @param rawParentDirectory - Directory that will contain the project root.
   * @param rawProjectName - Bare project name without the `.pandastage` suffix.
   * @param rawMetadata - Project metadata used to seed `project.json`.
   * @returns The freshly created project document.
   */
  async createAt(
    rawParentDirectory: string,
    rawProjectName: string,
    rawMetadata: ProjectCreateMetadata,
  ): Promise<ProjectDocument> {
    return this.create(
      this.resolveNewProjectRoot(rawParentDirectory, rawProjectName),
      rawMetadata,
    );
  }

  async open(rawProjectRoot: string): Promise<ProjectDocument> {
    const projectRoot = this.resolveProjectRoot(rawProjectRoot);
    let serialized: string;
    try {
      serialized = await this.fileSystem.readProjectFile(projectRoot);
    } catch (error) {
      throw this.mapError('open', projectRoot, error);
    }

    let input: unknown;
    try {
      input = JSON.parse(serialized);
    } catch (error) {
      throw new ProjectServiceError(
        'INVALID_JSON',
        projectRoot,
        `Cannot open project at ${projectRoot}: project.json contains invalid JSON.`,
        { cause: error },
      );
    }

    try {
      const sourceVersion = detectSchemaVersion(input);
      // Single authoritative pipeline for every persisted envelope (v0-v5).
      // Current (v5) input is validated as-is; legacy input is migrated.
      const project = migrateProject(input);
      return this.document(
        projectRoot,
        project,
        sourceVersion !== PROJECT_SCHEMA_VERSION,
        sourceVersion,
      );
    } catch (error) {
      throw this.mapError('open', projectRoot, error);
    }
  }

  async save(
    rawProjectRoot: string,
    rawProject: Project,
    revision?: number,
  ): Promise<ProjectDocument> {
    const projectRoot = this.resolveProjectRoot(rawProjectRoot);
    return this.coordinator.runExclusive(projectRoot, () =>
      this.saveExclusive(
        projectRoot,
        rawProject,
        revision,
        undefined,
        undefined,
        true,
      ),
    );
  }

  async transact<T>(
    rawProjectRoot: string,
    operation: (transaction: ProjectTransaction) => Promise<T>,
  ): Promise<T> {
    const projectRoot = this.resolveProjectRoot(rawProjectRoot);
    return this.coordinator.runExclusive(projectRoot, async () => {
      const existingDocument = await this.open(projectRoot);
      return operation({
        projectRoot,
        existingDocument,
        save: (project, revision, commitGuard) =>
          this.saveExclusive(
            projectRoot,
            project,
            revision,
            existingDocument,
            commitGuard,
            false,
          ),
      });
    });
  }

  private async saveExclusive(
    projectRoot: string,
    rawProject: Project,
    revision?: number,
    knownExistingDocument?: ProjectDocument,
    commitGuard?: () => void,
    enforceAuthoritativeSnapshot = false,
  ): Promise<ProjectDocument> {
    const existingDocument =
      knownExistingDocument ?? (await this.open(projectRoot));
    let project: Project;
    try {
      project = ProjectSchema.parse(rawProject);
    } catch (error) {
      throw this.mapError('save', projectRoot, error);
    }

    if (existingDocument.project.id !== project.id) {
      throw new ProjectServiceError(
        'PROJECT_ID_MISMATCH',
        projectRoot,
        `Cannot save project at ${projectRoot}: project identity mismatch; the existing project ID is ${existingDocument.project.id}, but the incoming project ID is ${project.id}.`,
      );
    }

    const authoritativeGuard =
      enforceAuthoritativeSnapshot &&
      revision !== undefined &&
      this.getCurrentProjectSnapshot
        ? () =>
            this.assertAuthoritativeSaveSnapshot(
              projectRoot,
              project,
              revision,
            )
        : null;
    authoritativeGuard?.();
    const combinedCommitGuard =
      authoritativeGuard || commitGuard
        ? () => {
            authoritativeGuard?.();
            commitGuard?.();
          }
        : undefined;

    try {
      await this.fileSystem.writeProjectFileAtomically(
        projectRoot,
        this.serialize(project),
        combinedCommitGuard,
      );
      try {
        await this.onProjectSaved?.(projectRoot, project, revision);
      } catch (error) {
        this.onPostSaveError(error);
      }
      return this.document(
        projectRoot,
        project,
        false,
        PROJECT_SCHEMA_VERSION,
      );
    } catch (error) {
      if (error instanceof AtomicWriteCommitRejectedError) {
        if (error.cause instanceof ProjectServiceError) {
          throw error.cause;
        }
        throw error;
      }
      throw this.mapError('save', projectRoot, error);
    }
  }

  private assertAuthoritativeSaveSnapshot(
    projectRoot: string,
    project: Project,
    revision: number,
  ): void {
    const snapshot = this.getCurrentProjectSnapshot?.(projectRoot);
    if (!snapshot) {
      throw new ProjectServiceError(
        'PROJECT_SAVE_STALE_REVISION',
        projectRoot,
        `Cannot save revision ${revision} at ${projectRoot}: Main Process has no authoritative project snapshot. Refresh or reopen the project and retry.`,
      );
    }
    const currentProject = ProjectSchema.parse(snapshot.project);
    if (currentProject.id !== project.id) {
      throw new ProjectServiceError(
        'PROJECT_ID_MISMATCH',
        projectRoot,
        `Cannot save project at ${projectRoot}: Main Process is tracking a different project identity.`,
        {
          currentProject,
          currentRevision: snapshot.revision,
        },
      );
    }
    if (
      snapshot.revision !== revision ||
      !projectsEqual(currentProject, project)
    ) {
      throw new ProjectServiceError(
        'PROJECT_SAVE_STALE_REVISION',
        projectRoot,
        `Cannot save revision ${revision} at ${projectRoot}: the authoritative revision is ${snapshot.revision}. Refresh and retry without discarding newer changes.`,
        {
          currentProject,
          currentRevision: snapshot.revision,
        },
      );
    }
  }

  /**
   * Joins a trusted parent directory with an untrusted bare project name.
   *
   * Path traversal (`..`), embedded separators, Windows reserved device names,
   * and forbidden characters are rejected before the join. After the join the
   * resulting basename is compared against the expected directory name, which
   * proves the project root stays directly inside the parent directory.
   */
  private resolveNewProjectRoot(
    rawParentDirectory: string,
    rawProjectName: string,
  ): string {
    const trimmedParent = rawParentDirectory.trim();
    if (!trimmedParent) {
      throw new ProjectServiceError(
        'INVALID_PROJECT_ROOT',
        rawParentDirectory,
        'Cannot create project: the parent directory must not be empty.',
      );
    }
    const parentDirectory = this.pathService.resolve(trimmedParent);
    const projectName = rawProjectName.trim();
    const issue = projectNameIssue(projectName);
    if (issue) {
      throw new ProjectServiceError(
        'INVALID_PROJECT_ROOT',
        parentDirectory,
        `Cannot create project in ${parentDirectory}: the project name is rejected (${issue}).`,
      );
    }
    const expectedDirectoryName = `${projectName}${PROJECT_ROOT_EXTENSION}`;
    const projectRoot = this.pathService.join(
      parentDirectory,
      expectedDirectoryName,
    );
    if (
      this.pathService.basename(projectRoot) !== expectedDirectoryName ||
      !this.pathService.same(
        this.pathService.dirname(projectRoot),
        parentDirectory,
      )
    ) {
      throw new ProjectServiceError(
        'INVALID_PROJECT_ROOT',
        parentDirectory,
        `Cannot create project in ${parentDirectory}: the project name escapes the selected parent directory.`,
      );
    }
    return projectRoot;
  }

  private resolveProjectRoot(rawProjectRoot: string): string {
    const trimmedRoot = rawProjectRoot.trim();
    const projectRoot = this.pathService.resolve(trimmedRoot || '.');
    if (
      !trimmedRoot ||
      !this.pathService
        .basename(projectRoot)
        .toLowerCase()
        .endsWith('.pandastage')
    ) {
      throw new ProjectServiceError(
        'INVALID_PROJECT_ROOT',
        projectRoot,
        `Project path must end with .pandastage: ${projectRoot}`,
      );
    }
    return projectRoot;
  }

  private document(
    projectRoot: string,
    project: Project,
    migrated: boolean,
    sourceVersion: DetectedSchemaVersion,
  ): ProjectDocument {
    return {
      projectRoot,
      projectFilePath: this.fileSystem.projectFilePath(projectRoot),
      project,
      migrated,
      sourceVersion,
    };
  }

  private serialize(project: Project): string {
    return `${JSON.stringify(project, null, 2)}\n`;
  }

  private mapError(
    operation: 'create' | 'open' | 'save',
    projectRoot: string,
    error: unknown,
  ): ProjectServiceError {
    if (error instanceof ProjectServiceError) return error;
    if (error instanceof ProjectRootAlreadyExistsError) {
      return new ProjectServiceError(
        'PROJECT_ALREADY_EXISTS',
        projectRoot,
        `Cannot create project at ${projectRoot}: the target directory already exists.`,
        { cause: error },
      );
    }
    if (error instanceof ProjectFileNotFoundError) {
      return new ProjectServiceError(
        operation === 'open'
          ? 'PROJECT_FILE_NOT_FOUND'
          : 'PROJECT_NOT_FOUND',
        projectRoot,
        `Cannot ${operation} project at ${projectRoot}: project.json does not exist.`,
        { cause: error },
      );
    }
    if (error instanceof UnsupportedSchemaVersionError) {
      return new ProjectServiceError(
        'UNSUPPORTED_VERSION',
        projectRoot,
        `Cannot open project at ${projectRoot}: ${error.message}`,
        { cause: error },
      );
    }
    if (error instanceof ZodError) {
      return new ProjectServiceError(
        'INVALID_PROJECT',
        projectRoot,
        `Cannot ${operation} project at ${projectRoot}: project data failed schema validation (${error.issues[0]?.path.join('.') || 'root'}).`,
        { cause: error },
      );
    }

    const nodeCode = (error as NodeJS.ErrnoException).code;
    if (nodeCode === 'ENOENT' || nodeCode === 'ENOTDIR') {
      return new ProjectServiceError(
        'PROJECT_NOT_FOUND',
        projectRoot,
        `Cannot ${operation} project at ${projectRoot}: the project directory or project.json does not exist.`,
        { cause: error },
      );
    }
    if (nodeCode === 'EACCES' || nodeCode === 'EPERM' || nodeCode === 'EROFS') {
      return new ProjectServiceError(
        'PROJECT_NOT_WRITABLE',
        projectRoot,
        `Cannot ${operation} project at ${projectRoot}: the project directory is not writable.`,
        { cause: error },
      );
    }
    const code: ProjectErrorCode =
      operation === 'create'
        ? 'CREATE_FAILED'
        : operation === 'open'
          ? 'OPEN_FAILED'
          : 'SAVE_FAILED';
    return new ProjectServiceError(
      code,
      projectRoot,
      `Cannot ${operation} project at ${projectRoot}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function projectsEqual(left: Project, right: Project): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

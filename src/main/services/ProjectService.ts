import { randomUUID } from 'node:crypto';
import path from 'node:path';
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
  type Project,
} from '../../domain';
import {
  ProjectCreateMetadataSchema,
  type ProjectCreateMetadata,
  type ProjectDocument,
  type ProjectErrorCode,
} from '../../shared/project-api';
import {
  ProjectFileSystemService,
  ProjectRootAlreadyExistsError,
} from './ProjectFileSystemService';
import { ProjectOperationCoordinator } from './ProjectOperationCoordinator';

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
}

export class ProjectServiceError extends Error {
  constructor(
    readonly code: ProjectErrorCode,
    readonly projectRoot: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ProjectServiceError';
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

  constructor(options: ProjectServiceOptions = {}) {
    this.fileSystem = options.fileSystem ?? new ProjectFileSystemService();
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
    this.onProjectSaved = options.onProjectSaved ?? null;
    this.onPostSaveError = options.onPostSaveError ?? (() => undefined);
    this.coordinator =
      options.coordinator ?? new ProjectOperationCoordinator();
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
      return this.document(projectRoot, project, false, 1);
    } catch (error) {
      if (treeCreated) {
        await this.fileSystem
          .removeNewProjectRoot(projectRoot)
          .catch(() => undefined);
      }
      throw this.mapError('create', projectRoot, error);
    }
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
      const currentProject = ProjectSchema.safeParse(input);
      const project = currentProject.success
        ? currentProject.data
        : migrateProject(input);
      return this.document(
        projectRoot,
        project,
        !currentProject.success,
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
      this.saveExclusive(projectRoot, rawProject, revision),
    );
  }

  private async saveExclusive(
    projectRoot: string,
    rawProject: Project,
    revision?: number,
  ): Promise<ProjectDocument> {
    const existingDocument = await this.open(projectRoot);
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

    try {
      await this.fileSystem.writeProjectFileAtomically(
        projectRoot,
        this.serialize(project),
      );
      try {
        await this.onProjectSaved?.(projectRoot, project, revision);
      } catch (error) {
        this.onPostSaveError(error);
      }
      return this.document(projectRoot, project, false, 1);
    } catch (error) {
      throw this.mapError('save', projectRoot, error);
    }
  }

  private resolveProjectRoot(rawProjectRoot: string): string {
    const trimmedRoot = rawProjectRoot.trim();
    const projectRoot = path.resolve(trimmedRoot);
    if (
      !trimmedRoot ||
      !path.basename(projectRoot).toLowerCase().endsWith('.pandastage')
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
    sourceVersion: 0 | 1,
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

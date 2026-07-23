import { randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';

export const PROJECT_FILE_NAME = 'project.json' as const;
export const PROJECT_DIRECTORIES = [
  'assets',
  'cache',
  'exports',
  'recovery',
] as const;

export interface AtomicWriteContext {
  targetPath: string;
  temporaryPath: string;
}

export interface ProjectFileSystemFaultInjector {
  beforeTemporaryWrite?(context: AtomicWriteContext): void | Promise<void>;
  afterTemporarySync?(context: AtomicWriteContext): void | Promise<void>;
  beforeAtomicReplace?(context: AtomicWriteContext): void | Promise<void>;
}

export class ProjectRootAlreadyExistsError extends Error {
  constructor(readonly projectRoot: string, options?: ErrorOptions) {
    super(`Project directory already exists: ${projectRoot}`, options);
    this.name = 'ProjectRootAlreadyExistsError';
  }
}

export class ProjectFileSystemService {
  constructor(
    private readonly faults: ProjectFileSystemFaultInjector = {},
  ) {}

  projectFilePath(projectRoot: string): string {
    return path.join(projectRoot, PROJECT_FILE_NAME);
  }

  async createProjectTree(projectRoot: string): Promise<void> {
    try {
      await mkdir(projectRoot, { recursive: false });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new ProjectRootAlreadyExistsError(projectRoot, { cause: error });
      }
      throw error;
    }

    try {
      await Promise.all(
        PROJECT_DIRECTORIES.map((directory) =>
          mkdir(path.join(projectRoot, directory), { recursive: false }),
        ),
      );
    } catch (error) {
      await rm(projectRoot, { recursive: true, force: true }).catch(
        () => undefined,
      );
      throw error;
    }
  }

  async assertProjectRoot(projectRoot: string): Promise<void> {
    const rootStats = await stat(projectRoot);
    if (!rootStats.isDirectory()) {
      throw Object.assign(new Error('Project root is not a directory.'), {
        code: 'ENOTDIR',
      });
    }
  }

  async readProjectFile(projectRoot: string): Promise<string> {
    await this.assertProjectRoot(projectRoot);
    return readFile(this.projectFilePath(projectRoot), 'utf8');
  }

  async removeNewProjectRoot(projectRoot: string): Promise<void> {
    await rm(projectRoot, { recursive: true, force: true });
  }

  async writeProjectFileAtomically(
    projectRoot: string,
    serializedProject: string,
  ): Promise<void> {
    await this.assertProjectRoot(projectRoot);
    const targetPath = this.projectFilePath(projectRoot);
    const temporaryPath = path.join(
      projectRoot,
      `.${PROJECT_FILE_NAME}.${randomUUID()}.tmp`,
    );
    const context = { targetPath, temporaryPath };
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    let temporaryFileExists = false;

    try {
      await this.faults.beforeTemporaryWrite?.(context);
      handle = await open(temporaryPath, 'wx', 0o600);
      temporaryFileExists = true;
      await handle.writeFile(serializedProject, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await this.faults.afterTemporarySync?.(context);
      await this.faults.beforeAtomicReplace?.(context);
      await rename(temporaryPath, targetPath);
      temporaryFileExists = false;
    } finally {
      await handle?.close().catch(() => undefined);
      if (temporaryFileExists) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
      }
    }
  }
}

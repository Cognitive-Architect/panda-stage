import { randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  type FileHandle,
} from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_FILE_NAME } from './ProjectFileSystemService';

export const RECOVERY_DIRECTORY_NAME = 'recovery' as const;

export interface RecoveryWriteContext {
  targetPath: string;
  temporaryPath: string;
}

export interface RecoveryFileSystemFaultInjector {
  beforeTemporaryWrite?(
    context: RecoveryWriteContext,
  ): void | Promise<void>;
  afterTemporarySync?(context: RecoveryWriteContext): void | Promise<void>;
  beforeAtomicReplace?(context: RecoveryWriteContext): void | Promise<void>;
}

export class RecoveryFileSystemService {
  constructor(
    private readonly faults: RecoveryFileSystemFaultInjector = {},
  ) {}

  recoveryDirectory(projectRoot: string): string {
    return path.join(projectRoot, RECOVERY_DIRECTORY_NAME);
  }

  projectFilePath(projectRoot: string): string {
    return path.join(projectRoot, PROJECT_FILE_NAME);
  }

  async listRecoveryFiles(projectRoot: string): Promise<string[]> {
    try {
      return await readdir(this.recoveryDirectory(projectRoot));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async readText(filePath: string): Promise<string> {
    return readFile(filePath, 'utf8');
  }

  async projectModifiedAtMs(projectRoot: string): Promise<number> {
    const fileStats = await stat(this.projectFilePath(projectRoot));
    return Math.trunc(fileStats.mtimeMs);
  }

  async removeFile(filePath: string): Promise<void> {
    await rm(filePath, { force: true });
  }

  async writeRecoveryAtomically(
    projectRoot: string,
    fileName: string,
    serializedRecovery: string,
  ): Promise<string> {
    const projectRootStats = await stat(projectRoot);
    if (!projectRootStats.isDirectory()) {
      throw Object.assign(new Error('Project root is not a directory.'), {
        code: 'ENOTDIR',
      });
    }
    await stat(this.projectFilePath(projectRoot));
    const directory = this.recoveryDirectory(projectRoot);
    await mkdir(directory, { recursive: true });
    const targetPath = path.join(directory, fileName);
    const temporaryPath = path.join(
      directory,
      `.${fileName}.${randomUUID()}.tmp`,
    );
    const context = { targetPath, temporaryPath };
    let handle: FileHandle | null = null;
    let temporaryFileExists = false;

    try {
      await this.faults.beforeTemporaryWrite?.(context);
      handle = await open(temporaryPath, 'wx', 0o600);
      temporaryFileExists = true;
      await handle.writeFile(serializedRecovery, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await this.faults.afterTemporarySync?.(context);
      await this.faults.beforeAtomicReplace?.(context);
      await rename(temporaryPath, targetPath);
      temporaryFileExists = false;
      return targetPath;
    } finally {
      await handle?.close().catch(() => undefined);
      if (temporaryFileExists) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
      }
    }
  }
}

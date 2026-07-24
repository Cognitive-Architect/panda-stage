import { createReadStream, createWriteStream } from 'node:fs';
import {
  link,
  mkdir,
  open,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';

export interface AssetCopyContext {
  sourcePath: string;
  temporaryPath: string;
  targetPath: string;
}

export interface AssetImportFileSystemFaultInjector {
  beforeCopy?(context: AssetCopyContext): void | Promise<void>;
  afterTemporarySync?(context: AssetCopyContext): void | Promise<void>;
  beforeFinalize?(context: AssetCopyContext): void | Promise<void>;
  beforeRollbackRemove?(filePath: string): void | Promise<void>;
}

export class AssetImportFileSystemCleanupError extends Error {
  constructor(
    readonly residualPaths: readonly string[],
    options?: ErrorOptions,
  ) {
    super(
      `Asset copy cleanup left residual paths: ${residualPaths.join(', ')}`,
      options,
    );
    this.name = 'AssetImportFileSystemCleanupError';
  }
}

export class AssetImportFileSystemService {
  constructor(
    private readonly faults: AssetImportFileSystemFaultInjector = {},
  ) {}

  assetsDirectory(projectRoot: string): string {
    return path.join(projectRoot, 'assets');
  }

  assetPath(projectRoot: string, fileName: string): string {
    if (
      !fileName ||
      path.basename(fileName) !== fileName ||
      /[\\/]/u.test(fileName)
    ) {
      throw new Error(`Unsafe asset target file name: ${fileName}`);
    }
    return path.join(this.assetsDirectory(projectRoot), fileName);
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      return (await stat(filePath)).isFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  async copyIntoAssetsAtomically(
    projectRoot: string,
    sourcePath: string,
    targetFileName: string,
  ): Promise<string> {
    const directory = this.assetsDirectory(projectRoot);
    await mkdir(directory, { recursive: true });
    const targetPath = this.assetPath(projectRoot, targetFileName);
    const temporaryPath = path.join(
      directory,
      `.asset-import.${randomUUID()}.tmp`,
    );
    const context = { sourcePath, temporaryPath, targetPath };
    let temporaryFileExists = false;
    let targetFileExists = false;
    try {
      await this.faults.beforeCopy?.(context);
      temporaryFileExists = true;
      await pipeline(
        createReadStream(sourcePath),
        createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 }),
      );
      const handle = await open(temporaryPath, 'r+');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.faults.afterTemporarySync?.(context);
      await this.faults.beforeFinalize?.(context);
      await link(temporaryPath, targetPath);
      targetFileExists = true;
      await rm(temporaryPath, { force: true });
      temporaryFileExists = false;
      return targetPath;
    } catch (error) {
      const residualPaths: string[] = [];
      if (targetFileExists) {
        try {
          await rm(targetPath, { force: true });
          targetFileExists = false;
        } catch {
          residualPaths.push(targetPath);
        }
      }
      if (temporaryFileExists) {
        try {
          await rm(temporaryPath, { force: true });
          temporaryFileExists = false;
        } catch {
          residualPaths.push(temporaryPath);
        }
      }
      if (residualPaths.length > 0) {
        throw new AssetImportFileSystemCleanupError(residualPaths, {
          cause: error,
        });
      }
      throw error;
    }
  }

  async rollbackImportedFile(filePath: string): Promise<void> {
    await this.faults.beforeRollbackRemove?.(filePath);
    await rm(filePath, { force: true });
  }
}

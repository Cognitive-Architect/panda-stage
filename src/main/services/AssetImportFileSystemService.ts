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
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      return targetPath;
    } finally {
      if (temporaryFileExists) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
      }
    }
  }

  async rollbackImportedFile(filePath: string): Promise<void> {
    await this.faults.beforeRollbackRemove?.(filePath);
    await rm(filePath, { force: true });
  }
}

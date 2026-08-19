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

export type AssetCopyCleanupKind = 'target' | 'temporary';

export interface AssetImportFileSystemFaultInjector {
  beforeCopy?(context: AssetCopyContext): void | Promise<void>;
  afterTemporarySync?(context: AssetCopyContext): void | Promise<void>;
  beforeFinalize?(context: AssetCopyContext): void | Promise<void>;
  beforeCommitTemporaryRemove?(
    context: AssetCopyContext,
  ): void | Promise<void>;
  beforeCopyCleanupRemove?(
    filePath: string,
    kind: AssetCopyCleanupKind,
    context: AssetCopyContext,
  ): void | Promise<void>;
  beforeRollbackRemove?(filePath: string): void | Promise<void>;
  beforeFlaTemporaryWrite?(
    context: AssetCommitFileContext,
  ): void | Promise<void>;
  afterFlaTemporarySync?(
    context: AssetCommitFileContext,
  ): void | Promise<void>;
  beforeFlaFinalize?(
    context: AssetCommitFileContext,
  ): void | Promise<void>;
  afterFlaFinalize?(
    context: AssetCommitFileContext,
  ): void | Promise<void>;
  beforeFlaCleanupRemove?(
    filePath: string,
    kind: AssetCopyCleanupKind,
  ): void | Promise<void>;
}

export interface AssetCommitFileContext {
  projectRoot: string;
  temporaryPath: string;
  targetPath: string;
  byteLength: number;
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
      await this.faults.beforeCommitTemporaryRemove?.(context);
      await rm(temporaryPath, { force: true });
      temporaryFileExists = false;
      return targetPath;
    } catch (error) {
      const residualPaths: string[] = [];
      if (targetFileExists) {
        try {
          await this.faults.beforeCopyCleanupRemove?.(
            targetPath,
            'target',
            context,
          );
          await rm(targetPath, { force: true });
          targetFileExists = false;
        } catch {
          residualPaths.push(targetPath);
        }
      }
      if (temporaryFileExists) {
        try {
          await this.faults.beforeCopyCleanupRemove?.(
            temporaryPath,
            'temporary',
            context,
          );
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

  /**
   * Writes Panda-owned encoded bytes to a unique temporary file below the
   * project assets directory and flushes the file before it is returned.
   * Callers must record the path in a recovery journal before invoking this
   * method.
   */
  async writeFlaCommitTemporary(
    projectRoot: string,
    bytes: Uint8Array,
    temporaryFileName: string,
  ): Promise<string> {
    const directory = this.assetsDirectory(projectRoot);
    await mkdir(directory, { recursive: true });
    const temporaryPath = this.assetPath(projectRoot, temporaryFileName);
    const context: AssetCommitFileContext = {
      projectRoot,
      temporaryPath,
      targetPath: '',
      byteLength: bytes.byteLength,
    };
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    let temporaryFileExists = false;
    try {
      await this.faults.beforeFlaTemporaryWrite?.(context);
      handle = await open(temporaryPath, 'wx', 0o600);
      temporaryFileExists = true;
      const buffer = Buffer.from(bytes);
      const { bytesWritten } = await handle.write(
        buffer,
        0,
        buffer.byteLength,
        0,
      );
      if (bytesWritten !== buffer.byteLength) {
        throw new Error('FLA asset staging wrote fewer bytes than expected.');
      }
      await handle.sync();
      await handle.close();
      handle = null;
      await this.faults.afterFlaTemporarySync?.(context);
      return temporaryPath;
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (temporaryFileExists) {
        try {
          await rm(temporaryPath, { force: true });
        } catch (cleanupError) {
          throw new AssetImportFileSystemCleanupError([temporaryPath], {
            cause: cleanupError,
          });
        }
      }
      throw error;
    }
  }

  /**
   * Finalizes one staged FLA payload without replacing an existing file.
   * Hard-linking makes an existing target an explicit collision rather than an
   * overwrite and leaves the temporary path available until the final cleanup
   * succeeds.
   */
  async finalizeFlaCommitTemporary(
    projectRoot: string,
    temporaryFileName: string,
    targetFileName: string,
  ): Promise<{ temporaryPath: string; targetPath: string }> {
    const temporaryPath = this.assetPath(projectRoot, temporaryFileName);
    const targetPath = this.assetPath(projectRoot, targetFileName);
    const context: AssetCommitFileContext = {
      projectRoot,
      temporaryPath,
      targetPath,
      byteLength: 0,
    };
    await this.faults.beforeFlaFinalize?.(context);
    await link(temporaryPath, targetPath);
    try {
      await rm(temporaryPath, { force: true });
    } catch (error) {
      throw new AssetImportFileSystemCleanupError(
        [temporaryPath, targetPath],
        { cause: error },
      );
    }
    await this.faults.afterFlaFinalize?.(context);
    return { temporaryPath, targetPath };
  }

  async removeFlaCommitFile(
    projectRoot: string,
    fileName: string,
    kind: AssetCopyCleanupKind,
  ): Promise<void> {
    const filePath = this.assetPath(projectRoot, fileName);
    await this.faults.beforeFlaCleanupRemove?.(filePath, kind);
    await rm(filePath, { force: true });
  }
}

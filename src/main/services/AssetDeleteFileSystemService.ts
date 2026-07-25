import { randomUUID } from 'node:crypto';
import { rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

export type AssetDeleteFileKind = 'asset' | 'thumbnail';

export interface StagedAssetDeleteFile {
  kind: AssetDeleteFileKind;
  originalPath: string;
  stagedPath: string;
}

export interface AssetDeleteFileSystemFaultInjector {
  beforeStage?(
    filePath: string,
    kind: AssetDeleteFileKind,
  ): void | Promise<void>;
  beforeRollback?(
    entry: StagedAssetDeleteFile,
  ): void | Promise<void>;
  beforeFinalize?(
    entry: StagedAssetDeleteFile,
  ): void | Promise<void>;
}

export class AssetDeleteFileSystemService {
  constructor(
    private readonly faults: AssetDeleteFileSystemFaultInjector = {},
  ) {}

  async stage(
    filePath: string,
    kind: AssetDeleteFileKind,
    required: boolean,
  ): Promise<StagedAssetDeleteFile | null> {
    const resolvedPath = path.resolve(filePath);
    if (!(await this.fileExists(resolvedPath))) {
      if (required) {
        throw new Error(`Asset file does not exist: ${resolvedPath}`);
      }
      return null;
    }
    await this.faults.beforeStage?.(resolvedPath, kind);
    const stagedPath = path.join(
      path.dirname(resolvedPath),
      `.${path.basename(resolvedPath)}.${randomUUID()}.asset-delete`,
    );
    await rename(resolvedPath, stagedPath);
    return { kind, originalPath: resolvedPath, stagedPath };
  }

  async rollback(
    entries: readonly StagedAssetDeleteFile[],
  ): Promise<string[]> {
    const residualPaths: string[] = [];
    for (const entry of [...entries].reverse()) {
      try {
        await this.faults.beforeRollback?.(entry);
        await rename(entry.stagedPath, entry.originalPath);
      } catch {
        residualPaths.push(entry.stagedPath);
      }
    }
    return residualPaths;
  }

  async finalize(
    entries: readonly StagedAssetDeleteFile[],
  ): Promise<string[]> {
    const residualPaths: string[] = [];
    for (const entry of entries) {
      try {
        await this.faults.beforeFinalize?.(entry);
        await rm(entry.stagedPath, { force: true });
      } catch {
        residualPaths.push(entry.stagedPath);
      }
    }
    return residualPaths;
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      return (await stat(filePath)).isFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
}

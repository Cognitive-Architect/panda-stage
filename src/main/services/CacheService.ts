import { randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';

export const THUMBNAIL_CACHE_DIRECTORY =
  'asset-thumbnails' as const;
export const THUMBNAIL_SCHEMA_VERSION = 1 as const;
export const THUMBNAIL_MAX_EDGE = 256 as const;

const CACHE_KEY_PATTERN =
  /^v1-max256-[a-f0-9]{64}\.png$/u;

export interface CacheWriteContext {
  projectRoot: string;
  targetPath: string;
  temporaryPath: string;
}

export interface CacheServiceFaultInjector {
  beforeDirectoryCreate?(projectRoot: string): void | Promise<void>;
  beforeWrite?(context: CacheWriteContext): void | Promise<void>;
  beforeCommit?(context: CacheWriteContext): void | Promise<void>;
}

export interface CacheWriteResult {
  filePath: string;
  relativePath: string;
  cacheHit: boolean;
}

export class CacheService {
  private readonly activeWrites = new Map<
    string,
    Promise<CacheWriteResult>
  >();

  constructor(
    private readonly faults: CacheServiceFaultInjector = {},
  ) {}

  thumbnailKey(sha256: string): string {
    if (!/^[a-f0-9]{64}$/u.test(sha256)) {
      throw new Error('Thumbnail cache requires a lowercase SHA-256 hash.');
    }
    return `v${THUMBNAIL_SCHEMA_VERSION}-max${THUMBNAIL_MAX_EDGE}-${sha256}.png`;
  }

  thumbnailPath(projectRoot: string, cacheKey: string): string {
    this.assertCacheKey(cacheKey);
    return path.join(
      projectRoot,
      'cache',
      THUMBNAIL_CACHE_DIRECTORY,
      cacheKey,
    );
  }

  thumbnailRelativePath(cacheKey: string): string {
    this.assertCacheKey(cacheKey);
    return `cache/${THUMBNAIL_CACHE_DIRECTORY}/${cacheKey}`;
  }

  async hasThumbnail(
    projectRoot: string,
    cacheKey: string,
  ): Promise<boolean> {
    try {
      return (
        await stat(this.thumbnailPath(projectRoot, cacheKey))
      ).isFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  async removeThumbnail(
    projectRoot: string,
    cacheKey: string,
  ): Promise<void> {
    await rm(this.thumbnailPath(projectRoot, cacheKey), { force: true });
  }

  ensureThumbnail(
    projectRoot: string,
    cacheKey: string,
    writeTemporary: (temporaryPath: string) => Promise<void>,
  ): Promise<CacheWriteResult> {
    const targetPath = this.thumbnailPath(projectRoot, cacheKey);
    const existing = this.activeWrites.get(targetPath);
    if (existing) return existing;
    const write = this.ensureThumbnailExclusive(
      projectRoot,
      cacheKey,
      writeTemporary,
    ).finally(() => {
      this.activeWrites.delete(targetPath);
    });
    this.activeWrites.set(targetPath, write);
    return write;
  }

  private async ensureThumbnailExclusive(
    projectRoot: string,
    cacheKey: string,
    writeTemporary: (temporaryPath: string) => Promise<void>,
  ): Promise<CacheWriteResult> {
    const targetPath = this.thumbnailPath(projectRoot, cacheKey);
    const relativePath = this.thumbnailRelativePath(cacheKey);
    if (await this.hasThumbnail(projectRoot, cacheKey)) {
      return { filePath: targetPath, relativePath, cacheHit: true };
    }

    await this.faults.beforeDirectoryCreate?.(projectRoot);
    const directory = path.dirname(targetPath);
    await mkdir(directory, { recursive: true });
    const temporaryPath = path.join(
      directory,
      `.${cacheKey}.${randomUUID()}.tmp.png`,
    );
    const context = { projectRoot, targetPath, temporaryPath };
    let temporaryExists = false;
    try {
      await this.faults.beforeWrite?.(context);
      temporaryExists = true;
      await writeTemporary(temporaryPath);
      const handle = await open(temporaryPath, 'r+');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.faults.beforeCommit?.(context);
      await rename(temporaryPath, targetPath);
      temporaryExists = false;
      return { filePath: targetPath, relativePath, cacheHit: false };
    } finally {
      if (temporaryExists) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
      }
    }
  }

  private assertCacheKey(cacheKey: string): void {
    if (!CACHE_KEY_PATTERN.test(cacheKey)) {
      throw new Error(`Unsafe thumbnail cache key: ${cacheKey}`);
    }
  }
}

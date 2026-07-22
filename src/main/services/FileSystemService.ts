import { access, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FRAME_NAME_PATTERN = /^frame_\d{6}\.png$/;
export const CLEANUP_MAX_RETRIES = 3 as const;
export const CLEANUP_RETRY_DELAY_MS = 75 as const;

export interface FrameFileSystem {
  createJobDirectory(jobId: string): Promise<string>;
  writeFrame(
    jobDirectory: string,
    fileName: string,
    pngBytes: Uint8Array,
  ): Promise<void>;
  listFrameFiles(jobDirectory: string): Promise<string[]>;
  cleanupJobDirectory(jobDirectory: string): Promise<void>;
  assertReadableProjectDirectory(projectDirectory: string): Promise<string>;
}

export class FileSystemService implements FrameFileSystem {
  readonly rootDirectory: string;

  constructor(
    rootDirectory = path.join(
      os.tmpdir(),
      'panda-stage',
      'frame-jobs',
    ),
  ) {
    this.rootDirectory = path.resolve(rootDirectory);
  }

  async createJobDirectory(jobId: string): Promise<string> {
    const jobDirectory = this.resolveJobDirectory(jobId);
    await mkdir(this.rootDirectory, { recursive: true });
    await mkdir(jobDirectory, { recursive: false });
    return jobDirectory;
  }

  async writeFrame(
    jobDirectory: string,
    fileName: string,
    pngBytes: Uint8Array,
  ): Promise<void> {
    const safeDirectory = this.assertWithinRoot(jobDirectory);
    if (!FRAME_NAME_PATTERN.test(fileName)) {
      throw new Error(`Invalid frame file name: ${fileName}`);
    }
    const framePath = this.assertWithinRoot(path.join(safeDirectory, fileName));
    await writeFile(framePath, pngBytes, { flag: 'wx' });
  }

  async listFrameFiles(jobDirectory: string): Promise<string[]> {
    const safeDirectory = this.assertWithinRoot(jobDirectory);
    const entries = await readdir(safeDirectory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && FRAME_NAME_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  }

  async cleanupJobDirectory(jobDirectory: string): Promise<void> {
    const safeDirectory = this.assertWithinRoot(jobDirectory);
    if (safeDirectory === this.rootDirectory) {
      throw new Error('Refusing to remove the frame-job root directory.');
    }
    try {
      await rm(safeDirectory, {
        recursive: true,
        force: true,
        maxRetries: CLEANUP_MAX_RETRIES,
        retryDelay: CLEANUP_RETRY_DELAY_MS,
      });
    } catch (error) {
      throw new Error(
        `无法清理导出临时目录 ${safeDirectory}；已重试 ${CLEANUP_MAX_RETRIES} 次，请关闭占用该目录的程序后重试。`,
        { cause: error },
      );
    }
  }

  async assertReadableProjectDirectory(
    projectDirectory: string,
  ): Promise<string> {
    const resolvedDirectory = path.resolve(projectDirectory);
    try {
      const projectStats = await stat(resolvedDirectory);
      if (!projectStats.isDirectory()) {
        throw new Error('not a directory');
      }
      await access(resolvedDirectory, constants.R_OK);
      return resolvedDirectory;
    } catch (error) {
      throw new Error(`项目目录不存在或无法读取：${resolvedDirectory}。`, {
        cause: error,
      });
    }
  }

  private resolveJobDirectory(jobId: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
      throw new Error(`Invalid export Job ID: ${jobId}`);
    }
    return this.assertWithinRoot(path.join(this.rootDirectory, jobId));
  }

  private assertWithinRoot(targetPath: string): string {
    const resolvedTarget = path.resolve(targetPath);
    const rootPrefix = `${this.rootDirectory}${path.sep}`;
    if (
      resolvedTarget !== this.rootDirectory &&
      !resolvedTarget.startsWith(rootPrefix)
    ) {
      throw new Error(`Path escapes the frame-job root: ${resolvedTarget}`);
    }
    return resolvedTarget;
  }
}

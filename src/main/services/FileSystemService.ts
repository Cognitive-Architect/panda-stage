import { randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

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
  prepareFinalOutput(outputPath: string, overwrite: boolean): Promise<string>;
  createFinalOutputStagingPath(jobId: string, outputPath: string): string;
  commitFinalOutput(
    stagingPath: string,
    outputPath: string,
    overwrite: boolean,
  ): Promise<void>;
  cleanupFinalOutputStaging(stagingPath: string): Promise<void>;
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

  async prepareFinalOutput(
    outputPath: string,
    overwrite: boolean,
  ): Promise<string> {
    const resolvedOutputPath = path.resolve(outputPath);
    const outputDirectory = path.dirname(resolvedOutputPath);
    try {
      const directoryStats = await stat(outputDirectory);
      if (!directoryStats.isDirectory()) throw new Error('not a directory');
      await access(outputDirectory, constants.W_OK);
      const outputStats = await stat(resolvedOutputPath).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        },
      );
      if (outputStats && !outputStats.isFile()) {
        throw new Error('output target is not a file');
      }
      if (outputStats && !overwrite) {
        throw new Error('output target already exists');
      }
      return resolvedOutputPath;
    } catch (error) {
      const reason =
        error instanceof Error && error.message === 'output target already exists'
          ? '正式输出已存在且未允许覆盖'
          : '正式输出目录不存在、不可写或目标不是文件';
      throw new Error(`${reason}：${resolvedOutputPath}。`, { cause: error });
    }
  }

  createFinalOutputStagingPath(jobId: string, outputPath: string): string {
    if (!/^[0-9a-f-]{36}$/iu.test(jobId)) {
      throw new Error(`Invalid export Job ID: ${jobId}`);
    }
    const resolvedOutputPath = path.resolve(outputPath);
    const outputDirectory = path.dirname(resolvedOutputPath);
    const outputBaseName = path.basename(
      resolvedOutputPath,
      path.extname(resolvedOutputPath),
    );
    return path.join(
      outputDirectory,
      `.${outputBaseName}.panda-stage-${jobId}-${randomUUID()}.mp4`,
    );
  }

  async commitFinalOutput(
    stagingPath: string,
    outputPath: string,
    overwrite: boolean,
  ): Promise<void> {
    const resolvedStagingPath = path.resolve(stagingPath);
    const resolvedOutputPath = path.resolve(outputPath);
    if (path.dirname(resolvedStagingPath) !== path.dirname(resolvedOutputPath)) {
      throw new Error('最终输出暂存文件必须与正式输出位于同一目录。');
    }
    if (!overwrite) {
      const outputExists = await stat(resolvedOutputPath).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return false;
          throw error;
        },
      );
      if (outputExists) {
        throw new Error(`正式输出在提交前已存在：${resolvedOutputPath}。`);
      }
    }
    try {
      await rename(resolvedStagingPath, resolvedOutputPath);
    } catch (error) {
      throw new Error(
        `已通过探测，但无法将本 Job 暂存文件提交为正式输出：${resolvedOutputPath}。`,
        { cause: error },
      );
    }
  }

  async cleanupFinalOutputStaging(stagingPath: string): Promise<void> {
    const resolvedStagingPath = path.resolve(stagingPath);
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= CLEANUP_MAX_RETRIES; attempt += 1) {
      try {
        await rm(resolvedStagingPath, { force: true });
        return;
      } catch (error) {
        lastError = error;
        if (attempt < CLEANUP_MAX_RETRIES) {
          await delay(CLEANUP_RETRY_DELAY_MS);
        }
      }
    }
    throw new Error(
      `无法清理最终输出暂存文件 ${resolvedStagingPath}；已重试 ${CLEANUP_MAX_RETRIES} 次。`,
      { cause: lastError },
    );
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

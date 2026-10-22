import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  access,
  link,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const FRAME_NAME_PATTERN = /^frame_\d{6}\.png$/;
const execFileAsync = promisify(execFile);
const WINDOWS_VOLUME_INFO_SCRIPT = [
  "$volumes = @(Get-Volume -FilePath $env:PANDA_STAGE_EXPORT_VOLUME_PATH -ErrorAction Stop)",
  'if ($volumes.Count -ne 1) { exit 21 }',
  "[Console]::Out.Write($volumes[0].DriveType.ToString() + '|' + $volumes[0].FileSystem)",
].join('; ');

export interface FileSystemServiceOptions {
  inspectWindowsVolume?: (directoryPath: string) => Promise<{
    driveType: string;
    fileSystem: string;
  }>;
}

export const CLEANUP_MAX_RETRIES = 3 as const;
export const CLEANUP_RETRY_DELAY_MS = 75 as const;

export interface FrameFileSystem {
  createJobDirectory(jobId: string): Promise<string>;
  writeFrame(
    jobDirectory: string,
    fileName: string,
    pngBytes: Uint8Array,
  ): Promise<void>;
  writeFrozenAudio(
    jobDirectory: string,
    fileName: string,
    bytes: Uint8Array,
  ): Promise<string>;
  listFrameFiles(jobDirectory: string): Promise<string[]>;
  cleanupJobDirectory(jobDirectory: string): Promise<void>;
  assertReadableProjectDirectory(projectDirectory: string): Promise<string>;
  prepareFinalOutput(outputPath: string, overwrite: boolean): Promise<string>;
  prepareFormalOutput(outputPath: string): Promise<string>;
  createFinalOutputStagingPath(jobId: string, outputPath: string): string;
  commitFinalOutput(
    stagingPath: string,
    outputPath: string,
    overwrite: boolean,
  ): Promise<void>;
  commitFormalOutputNoReplace(
    stagingPath: string,
    outputPath: string,
  ): Promise<void>;
  assertFormalOutputLocation(outputPath: string): Promise<void>;
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
    private readonly options: FileSystemServiceOptions = {},
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

  async writeFrozenAudio(
    jobDirectory: string,
    fileName: string,
    bytes: Uint8Array,
  ): Promise<string> {
    const safeDirectory = this.assertWithinRoot(jobDirectory);
    if (!/^audio-[0-9a-f-]{36}\.(?:mp3|wav)$/iu.test(fileName)) {
      throw new Error('Invalid frozen audio file name.');
    }
    const audioPath = this.assertWithinRoot(path.join(safeDirectory, fileName));
    await writeFile(audioPath, bytes, { flag: 'wx' });
    return audioPath;
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

  async prepareFormalOutput(outputPath: string): Promise<string> {
    const resolvedOutputPath = await this.prepareFinalOutput(outputPath, false);
    await this.assertFormalOutputLocation(resolvedOutputPath);
    return resolvedOutputPath;
  }

  async assertFormalOutputLocation(outputPath: string): Promise<void> {
    const resolvedOutputPath = path.resolve(outputPath);
    const outputDirectory = await realpath(path.dirname(resolvedOutputPath));
    if (
      !this.options.inspectWindowsVolume &&
      process.platform !== 'win32'
    ) {
      throw new Error(
        'Formal MP4 export supports only local NTFS folders on Windows.',
      );
    }

    const inspectVolume =
      this.options.inspectWindowsVolume ?? inspectWindowsVolumeWithPowerShell;
    let volume: { driveType: string; fileSystem: string };
    try {
      volume = await inspectVolume(outputDirectory);
    } catch (error) {
      throw new Error(
        'The output volume could not be verified as local NTFS.',
        { cause: error },
      );
    }
    if (
      volume.driveType !== 'Fixed' ||
      volume.fileSystem.toLocaleUpperCase('en-US') !== 'NTFS'
    ) {
      throw new Error(
        'Formal MP4 export supports only local NTFS folders on Windows.',
      );
    }
  }

  createFinalOutputStagingPath(jobId: string, outputPath: string): string {
    if (!/^[0-9a-f-]{36}$/iu.test(jobId)) {
      throw new Error(`Invalid export Job ID: ${jobId}`);
    }
    const resolvedOutputPath = path.resolve(outputPath);
    const outputDirectory = path.dirname(resolvedOutputPath);
    return path.join(
      outputDirectory,
      `.panda-stage-export-${jobId}-${randomUUID()}.mp4`,
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

  async commitFormalOutputNoReplace(
    stagingPath: string,
    outputPath: string,
  ): Promise<void> {
    const resolvedStagingPath = path.resolve(stagingPath);
    const resolvedOutputPath = path.resolve(outputPath);
    if (path.dirname(resolvedStagingPath) !== path.dirname(resolvedOutputPath)) {
      throw new Error(
        'Formal MP4 staging and target must be in the same directory.',
      );
    }
    await this.assertFormalOutputLocation(resolvedOutputPath);
    try {
      await link(resolvedStagingPath, resolvedOutputPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST' || code === 'EPERM' && await pathExists(resolvedOutputPath)) {
        throw new Error(
          `The formal MP4 target was created before commit; choose a new filename: ${resolvedOutputPath}`,
          { cause: error },
        );
      }
      throw new Error(
        `The formal MP4 could not be committed without replacement: ${resolvedOutputPath}`,
        { cause: error },
      );
    }

    try {
      await this.cleanupFinalOutputStaging(resolvedStagingPath);
    } catch (error) {
      throw new Error(
        `The MP4 was committed, but its temporary link could not be removed: ${resolvedStagingPath}`,
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

async function inspectWindowsVolumeWithPowerShell(
  directoryPath: string,
): Promise<{ driveType: string; fileSystem: string }> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      WINDOWS_VOLUME_INFO_SCRIPT,
    ],
    {
      env: {
        ...process.env,
        PANDA_STAGE_EXPORT_VOLUME_PATH: directoryPath,
      },
      windowsHide: true,
      timeout: 5_000,
      maxBuffer: 1_024,
    },
  );
  const [driveType, fileSystem, extra] = stdout.trim().split('|');
  if (!driveType || !fileSystem || extra !== undefined) {
    throw new Error('Windows returned incomplete volume details.');
  }
  return { driveType, fileSystem };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

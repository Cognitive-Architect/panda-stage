import { spawn } from 'node:child_process';
import { access, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  EncodePngSequenceRequestSchema,
  VideoProbeExpectationSchema,
  type EncodePngSequenceRequest,
  type VideoProbeExpectation,
  type VideoProbeResult,
} from '../../shared/ffmpeg-types';
import { formatFrameFileName } from '../../shared/export-types';

const FRAME_FILE_PATTERN = /^frame_(\d{6})\.png$/;
const MAX_CAPTURED_OUTPUT_CHARS = 256_000;

export type FFmpegErrorCode =
  | 'EXECUTABLE_NOT_FOUND'
  | 'ENCODER_UNAVAILABLE'
  | 'FRAME_SEQUENCE_INVALID'
  | 'OUTPUT_NOT_WRITABLE'
  | 'PROCESS_FAILED'
  | 'PROCESS_CANCELLED'
  | 'PROBE_FAILED'
  | 'PROBE_MISMATCH';

export interface ProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface ProcessRunOptions {
  cwd?: string;
  signal?: AbortSignal;
}

export interface ProcessRunner {
  run(
    executable: string,
    args: readonly string[],
    options?: ProcessRunOptions,
  ): Promise<ProcessResult>;
}

export interface FFmpegDiagnostics {
  executable: string;
  args: readonly string[];
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  stderr?: string;
  cause?: unknown;
}

export class FFmpegAdapterError extends Error {
  constructor(
    readonly code: FFmpegErrorCode,
    message: string,
    readonly diagnostics: FFmpegDiagnostics,
  ) {
    super(message, { cause: diagnostics.cause });
    this.name = 'FFmpegAdapterError';
  }
}

export interface FFmpegValidationResult {
  executable: string;
  versionLine: string;
  hasLibx264: true;
}

export interface EncodePngSequenceResult {
  outputPath: string;
  frameCount: number;
  elapsedMs: number;
  args: readonly string[];
  versionLine: string;
  stderr: string;
}

export interface FFmpegAdapterOptions {
  ffmpegPath?: string;
  ffprobePath?: string;
  runner?: ProcessRunner;
}

function appendBounded(current: string, chunk: Buffer | string): string {
  const combined = `${current}${chunk.toString()}`;
  return combined.length <= MAX_CAPTURED_OUTPUT_CHARS
    ? combined
    : combined.slice(-MAX_CAPTURED_OUTPUT_CHARS);
}

export class NodeProcessRunner implements ProcessRunner {
  run(
    executable: string,
    args: readonly string[],
    options: ProcessRunOptions = {},
  ): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;

      const child = spawn(executable, [...args], {
        cwd: options.cwd,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const finishReject = (error: Error) => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener('abort', abort);
        reject(error);
      };
      const abort = () => {
        if (!settled) child.kill('SIGTERM');
      };

      if (options.signal?.aborted) {
        abort();
      } else {
        options.signal?.addEventListener('abort', abort, { once: true });
      }
      child.stdout.on('data', (chunk: Buffer) => {
        stdout = appendBounded(stdout, chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = appendBounded(stderr, chunk);
      });
      child.once('error', finishReject);
      child.once('close', (code, signal) => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener('abort', abort);
        resolve({ code, signal, stdout, stderr });
      });
    });
  }
}

function executableFromEnvironment(
  explicitPath: string | undefined,
  environmentName: string,
  fallback: string,
): string {
  return explicitPath?.trim() || process.env[environmentName]?.trim() || fallback;
}

function parseVersionLine(output: string): string | null {
  const line = output
    .split(/\r?\n/u)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.startsWith('ffmpeg version '));
  return line || null;
}

function parseRational(rawValue: unknown): number {
  if (typeof rawValue !== 'string') return Number.NaN;
  const [numeratorRaw, denominatorRaw] = rawValue.split('/');
  const numerator = Number(numeratorRaw);
  const denominator = Number(denominatorRaw);
  return denominator ? numerator / denominator : Number.NaN;
}

function technicalTail(stderr: string): string {
  return stderr.trim().slice(-8_000);
}

export class FFmpegAdapter {
  readonly ffmpegPath: string;
  readonly ffprobePath: string;
  private readonly runner: ProcessRunner;

  constructor(options: FFmpegAdapterOptions = {}) {
    this.ffmpegPath = executableFromEnvironment(
      options.ffmpegPath,
      'PANDA_STAGE_FFMPEG_PATH',
      process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
    );
    this.ffprobePath = executableFromEnvironment(
      options.ffprobePath,
      'PANDA_STAGE_FFPROBE_PATH',
      process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe',
    );
    this.runner = options.runner ?? new NodeProcessRunner();
  }

  async getVersion(signal?: AbortSignal): Promise<string> {
    const args = ['-version'];
    const result = await this.runProcess(this.ffmpegPath, args, { signal });
    if (signal?.aborted) {
      throw this.cancelledError(
        this.ffmpegPath,
        args,
        result.code,
        result.signal,
        result.stderr,
      );
    }
    const versionLine = parseVersionLine(`${result.stdout}\n${result.stderr}`);
    if (result.code !== 0 || !versionLine) {
      throw new FFmpegAdapterError(
        'PROCESS_FAILED',
        'FFmpeg 版本检查失败，请确认开发环境中的可执行文件有效。',
        {
          executable: this.ffmpegPath,
          args,
          exitCode: result.code,
          signal: result.signal,
          stderr: technicalTail(result.stderr),
        },
      );
    }
    return versionLine;
  }

  async validateExecutable(signal?: AbortSignal): Promise<FFmpegValidationResult> {
    const versionLine = await this.getVersion(signal);
    const args = ['-hide_banner', '-encoders'];
    const result = await this.runProcess(this.ffmpegPath, args, { signal });
    if (signal?.aborted) {
      throw this.cancelledError(
        this.ffmpegPath,
        args,
        result.code,
        result.signal,
        result.stderr,
      );
    }
    const encoderOutput = `${result.stdout}\n${result.stderr}`;
    if (result.code !== 0 || !/\blibx264\b/u.test(encoderOutput)) {
      throw new FFmpegAdapterError(
        'ENCODER_UNAVAILABLE',
        '当前 FFmpeg 不包含 libx264，无法生成符合要求的 H.264 视频。',
        {
          executable: this.ffmpegPath,
          args,
          exitCode: result.code,
          signal: result.signal,
          stderr: technicalTail(result.stderr),
        },
      );
    }
    return { executable: this.ffmpegPath, versionLine, hasLibx264: true };
  }

  async encodePngSequence(
    rawRequest: EncodePngSequenceRequest,
    signal?: AbortSignal,
  ): Promise<EncodePngSequenceResult> {
    const request = EncodePngSequenceRequestSchema.parse(rawRequest);
    const framesDirectory = path.resolve(request.framesDirectory);
    const outputPath = path.resolve(request.outputPath);
    const frameCount = await this.inspectFrameSequence(framesDirectory);
    await this.assertOutputWritable(outputPath);
    if (signal?.aborted) {
      throw this.cancelledError(this.ffmpegPath, [], null, 'SIGTERM');
    }
    const validation = await this.validateExecutable(signal);
    if (signal?.aborted) {
      throw this.cancelledError(this.ffmpegPath, [], null, 'SIGTERM');
    }
    const args = this.buildEncodeArguments({
      ...request,
      framesDirectory,
      outputPath,
      frameCount,
    });
    const startedAt = performance.now();
    const result = await this.runProcess(this.ffmpegPath, args, { signal });
    if (signal?.aborted) {
      throw this.cancelledError(
        this.ffmpegPath,
        args,
        result.code,
        result.signal,
        result.stderr,
      );
    }
    if (result.code !== 0) {
      throw this.mapEncodeFailure(args, result);
    }
    const outputStats = await stat(outputPath).catch(() => null);
    if (!outputStats?.isFile() || outputStats.size === 0) {
      throw new FFmpegAdapterError(
        'PROCESS_FAILED',
        'FFmpeg 已退出，但没有生成可用的视频文件。',
        {
          executable: this.ffmpegPath,
          args,
          exitCode: result.code,
          signal: result.signal,
          stderr: technicalTail(result.stderr),
        },
      );
    }
    return {
      outputPath,
      frameCount,
      elapsedMs: Math.round(performance.now() - startedAt),
      args,
      versionLine: validation.versionLine,
      stderr: technicalTail(result.stderr),
    };
  }

  async probeVideo(videoPath: string): Promise<VideoProbeResult> {
    const resolvedVideoPath = path.resolve(videoPath);
    const args = [
      '-v',
      'error',
      '-count_frames',
      '-show_streams',
      '-show_format',
      '-of',
      'json',
      resolvedVideoPath,
    ];
    const result = await this.runProcess(this.ffprobePath, args);
    if (result.code !== 0) {
      throw new FFmpegAdapterError(
        'PROBE_FAILED',
        '无法读取导出视频的媒体信息。',
        {
          executable: this.ffprobePath,
          args,
          exitCode: result.code,
          signal: result.signal,
          stderr: technicalTail(result.stderr),
        },
      );
    }

    let raw: unknown;
    try {
      raw = JSON.parse(result.stdout);
    } catch (error) {
      throw new FFmpegAdapterError(
        'PROBE_FAILED',
        'ffprobe 返回了无法解析的媒体信息。',
        { executable: this.ffprobePath, args, cause: error },
      );
    }
    const container = raw as {
      streams?: Array<Record<string, unknown>>;
      format?: Record<string, unknown>;
    };
    const streams = Array.isArray(container.streams) ? container.streams : [];
    const video = streams.find((stream) => stream.codec_type === 'video');
    if (!video) {
      throw new FFmpegAdapterError(
        'PROBE_FAILED',
        '导出文件中没有视频流。',
        { executable: this.ffprobePath, args },
      );
    }
    const durationSeconds = Number(
      video.duration ?? container.format?.duration ?? Number.NaN,
    );
    const frameCountRaw = video.nb_read_frames ?? video.nb_frames;
    const frameCount = Number(frameCountRaw);
    return {
      codecName: String(video.codec_name ?? ''),
      pixelFormat: String(video.pix_fmt ?? ''),
      width: Number(video.width),
      height: Number(video.height),
      fps: parseRational(video.avg_frame_rate ?? video.r_frame_rate),
      frameCount: Number.isInteger(frameCount) ? frameCount : null,
      durationSeconds,
      hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
      raw,
    };
  }

  assertProbeMatches(
    probe: VideoProbeResult,
    rawExpectation: VideoProbeExpectation,
  ): void {
    const expected = VideoProbeExpectationSchema.parse(rawExpectation);
    const failures: string[] = [];
    if (probe.codecName !== expected.codecName)
      failures.push(`codec=${probe.codecName}`);
    if (probe.pixelFormat !== expected.pixelFormat)
      failures.push(`pix_fmt=${probe.pixelFormat}`);
    if (probe.width !== expected.width || probe.height !== expected.height)
      failures.push(`size=${probe.width}x${probe.height}`);
    if (!Number.isFinite(probe.fps) || Math.abs(probe.fps - expected.fps) > 0.001)
      failures.push(`fps=${probe.fps}`);
    if (probe.frameCount !== expected.frameCount)
      failures.push(`frames=${probe.frameCount}`);
    if (
      !Number.isFinite(probe.durationSeconds) ||
      Math.abs(probe.durationSeconds - expected.durationSeconds) >
        expected.durationToleranceSeconds
    )
      failures.push(`duration=${probe.durationSeconds}`);
    if (expected.requireSilent && probe.hasAudio) failures.push('audio=present');
    if (failures.length > 0) {
      throw new FFmpegAdapterError(
        'PROBE_MISMATCH',
        `导出视频参数不符合要求：${failures.join('，')}。`,
        { executable: this.ffprobePath, args: [] },
      );
    }
  }

  private buildEncodeArguments(request: {
    framesDirectory: string;
    outputPath: string;
    fps: number;
    overwrite: boolean;
    frameCount: number;
  }): readonly string[] {
    return [
      request.overwrite ? '-y' : '-n',
      '-hide_banner',
      '-loglevel',
      'info',
      '-framerate',
      String(request.fps),
      '-start_number',
      '0',
      '-i',
      path.join(request.framesDirectory, 'frame_%06d.png'),
      '-frames:v',
      String(request.frameCount),
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(request.fps),
      '-movflags',
      '+faststart',
      request.outputPath,
    ];
  }

  private async inspectFrameSequence(framesDirectory: string): Promise<number> {
    let entries;
    try {
      entries = await readdir(framesDirectory, { withFileTypes: true });
    } catch (error) {
      throw new FFmpegAdapterError(
        'FRAME_SEQUENCE_INVALID',
        '找不到待编码的 PNG 帧目录。',
        { executable: this.ffmpegPath, args: [], cause: error },
      );
    }
    const indices = entries
      .filter((entry) => entry.isFile() && FRAME_FILE_PATTERN.test(entry.name))
      .map((entry) => Number(FRAME_FILE_PATTERN.exec(entry.name)?.[1]))
      .sort((left, right) => left - right);
    if (indices.length === 0) {
      throw new FFmpegAdapterError(
        'FRAME_SEQUENCE_INVALID',
        '帧目录中没有可编码的 PNG 文件。',
        { executable: this.ffmpegPath, args: [] },
      );
    }
    for (let index = 0; index < indices.length; index += 1) {
      if (indices[index] !== index) {
        throw new FFmpegAdapterError(
          'FRAME_SEQUENCE_INVALID',
          `PNG 帧序列不连续，缺少 ${formatFrameFileName(index)}。`,
          { executable: this.ffmpegPath, args: [] },
        );
      }
    }
    return indices.length;
  }

  private async assertOutputWritable(outputPath: string): Promise<void> {
    const outputDirectory = path.dirname(outputPath);
    try {
      const directoryStats = await stat(outputDirectory);
      if (!directoryStats.isDirectory()) throw new Error('not a directory');
      await access(outputDirectory, constants.W_OK);
    } catch (error) {
      throw new FFmpegAdapterError(
        'OUTPUT_NOT_WRITABLE',
        '视频输出目录不存在或不可写。',
        { executable: this.ffmpegPath, args: [], cause: error },
      );
    }
  }

  private async runProcess(
    executable: string,
    args: readonly string[],
    options?: ProcessRunOptions,
  ): Promise<ProcessResult> {
    try {
      return await this.runner.run(executable, args, options);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        throw new FFmpegAdapterError(
          'EXECUTABLE_NOT_FOUND',
          `找不到媒体工具：${path.basename(executable)}。请配置开发环境路径。`,
          { executable, args, cause: error },
        );
      }
      throw new FFmpegAdapterError(
        'PROCESS_FAILED',
        '无法启动媒体编码进程。',
        { executable, args, cause: error },
      );
    }
  }

  private mapEncodeFailure(
    args: readonly string[],
    result: ProcessResult,
  ): FFmpegAdapterError {
    const stderr = technicalTail(result.stderr);
    if (/unknown encoder ['"]?libx264/iu.test(stderr)) {
      return new FFmpegAdapterError(
        'ENCODER_UNAVAILABLE',
        '当前 FFmpeg 不包含 libx264，无法生成符合要求的 H.264 视频。',
        {
          executable: this.ffmpegPath,
          args,
          exitCode: result.code,
          signal: result.signal,
          stderr,
        },
      );
    }
    if (/no such file|could find no file/iu.test(stderr)) {
      return new FFmpegAdapterError(
        'FRAME_SEQUENCE_INVALID',
        'FFmpeg 读取帧序列时发现文件缺失。',
        {
          executable: this.ffmpegPath,
          args,
          exitCode: result.code,
          signal: result.signal,
          stderr,
        },
      );
    }
    if (/permission denied|access is denied/iu.test(stderr)) {
      return new FFmpegAdapterError(
        'OUTPUT_NOT_WRITABLE',
        'FFmpeg 无法写入视频输出文件。',
        {
          executable: this.ffmpegPath,
          args,
          exitCode: result.code,
          signal: result.signal,
          stderr,
        },
      );
    }
    return new FFmpegAdapterError(
      'PROCESS_FAILED',
      `视频编码失败（FFmpeg 退出码 ${result.code ?? 'unknown'}）。`,
      {
        executable: this.ffmpegPath,
        args,
        exitCode: result.code,
        signal: result.signal,
        stderr,
      },
    );
  }

  private cancelledError(
    executable: string,
    args: readonly string[],
    exitCode: number | null,
    signal: NodeJS.Signals | null,
    stderr = '',
  ): FFmpegAdapterError {
    return new FFmpegAdapterError(
      'PROCESS_CANCELLED',
      '视频编码已取消。',
      {
        executable,
        args,
        exitCode,
        signal,
        stderr: technicalTail(stderr),
      },
    );
  }
}

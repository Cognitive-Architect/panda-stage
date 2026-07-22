import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, readdir, rename, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  EncodePngSequenceRequestSchema,
  MuxProbeExpectationSchema,
  MuxSingleAudioRequestSchema,
  VideoProbeExpectationSchema,
  type AudioProbeResult,
  type AudioTimingResult,
  type EncodePngSequenceRequest,
  type MuxProbeExpectation,
  type MuxSingleAudioRequest,
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
  | 'VIDEO_INPUT_INVALID'
  | 'AUDIO_INPUT_INVALID'
  | 'OUTPUT_ALREADY_EXISTS'
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
  getActiveProcesses?(): readonly ActiveProcessDiagnostic[];
  getTotalProcessesStarted?(): number;
}

export interface ActiveProcessDiagnostic {
  executable: string;
  args: readonly string[];
  pid: number | null;
}

export interface FFmpegDiagnostics {
  executable: string;
  args: readonly string[];
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  stderr?: string;
  cause?: unknown;
  cleanupError?: unknown;
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

export interface FFmpegAudioValidationResult {
  executable: string;
  versionLine: string;
  hasAac: true;
}

export interface EncodePngSequenceResult {
  outputPath: string;
  frameCount: number;
  elapsedMs: number;
  args: readonly string[];
  versionLine: string;
  stderr: string;
}

export interface MuxSingleAudioResult {
  outputPath: string;
  videoPath: string;
  audioPath: string;
  startMs: number;
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
  private readonly activeProcesses = new Map<
    object,
    ActiveProcessDiagnostic
  >();
  private totalProcessesStarted = 0;

  getActiveProcesses(): readonly ActiveProcessDiagnostic[] {
    return [...this.activeProcesses.values()].map((process) => ({
      ...process,
      args: [...process.args],
    }));
  }

  getTotalProcessesStarted(): number {
    return this.totalProcessesStarted;
  }

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
      this.totalProcessesStarted += 1;
      this.activeProcesses.set(child, {
        executable,
        args: [...args],
        pid: child.pid ?? null,
      });
      const finishReject = (error: Error) => {
        if (settled) return;
        settled = true;
        this.activeProcesses.delete(child);
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
        this.activeProcesses.delete(child);
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

function createTemporaryOutputPath(outputPath: string): string {
  const outputDirectory = path.dirname(outputPath);
  const outputBaseName = path.basename(outputPath, path.extname(outputPath));
  return path.join(
    outputDirectory,
    `.${outputBaseName}.panda-stage-${randomUUID()}.mp4`,
  );
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

  getActiveProcessCount(): number {
    return this.runner.getActiveProcesses?.().length ?? 0;
  }

  getProcessDiagnostics(): {
    active: readonly ActiveProcessDiagnostic[];
    totalStarted: number;
  } {
    return {
      active: this.runner.getActiveProcesses?.() ?? [],
      totalStarted: this.runner.getTotalProcessesStarted?.() ?? 0,
    };
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

  async validateAudioMuxExecutable(
    signal?: AbortSignal,
  ): Promise<FFmpegAudioValidationResult> {
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
    if (result.code !== 0 || !/^\s*A\S*\s+aac\s/imu.test(encoderOutput)) {
      throw new FFmpegAdapterError(
        'ENCODER_UNAVAILABLE',
        '当前 FFmpeg 不包含 AAC 编码器，无法合成带声音的视频。',
        {
          executable: this.ffmpegPath,
          args,
          exitCode: result.code,
          signal: result.signal,
          stderr: technicalTail(result.stderr),
        },
      );
    }
    return { executable: this.ffmpegPath, versionLine, hasAac: true };
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
    await this.assertOverwriteAllowed(outputPath, request.overwrite);
    if (signal?.aborted) {
      throw this.cancelledError(this.ffmpegPath, [], null, 'SIGTERM');
    }
    const validation = await this.validateExecutable(signal);
    if (signal?.aborted) {
      throw this.cancelledError(this.ffmpegPath, [], null, 'SIGTERM');
    }
    const temporaryOutputPath = createTemporaryOutputPath(outputPath);
    const args = this.buildEncodeArguments({
      ...request,
      framesDirectory,
      outputPath: temporaryOutputPath,
      frameCount,
    });
    const startedAt = performance.now();
    let result: ProcessResult;
    try {
      result = await this.runProcess(this.ffmpegPath, args, { signal });
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
      const outputStats = await stat(temporaryOutputPath).catch(() => null);
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
      if (signal?.aborted) {
        throw this.cancelledError(
          this.ffmpegPath,
          args,
          result.code,
          result.signal,
          result.stderr,
        );
      }
      await this.commitTemporaryOutput(
        temporaryOutputPath,
        outputPath,
        request.overwrite,
        args,
        result,
      );
    } catch (error) {
      await this.cleanupTemporaryOutput(temporaryOutputPath, error);
      throw error;
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

  async muxSingleAudio(
    rawRequest: MuxSingleAudioRequest,
    signal?: AbortSignal,
  ): Promise<MuxSingleAudioResult> {
    const request = MuxSingleAudioRequestSchema.parse(rawRequest);
    const videoPath = path.resolve(request.videoPath);
    const audioPath = path.resolve(request.audioPath);
    const outputPath = path.resolve(request.outputPath);
    await this.assertReadableInput(videoPath, 'video');
    await this.assertReadableInput(audioPath, 'audio');
    await this.assertOutputWritable(outputPath);
    await this.assertOverwriteAllowed(outputPath, request.overwrite);
    if (signal?.aborted) {
      throw this.cancelledError(this.ffmpegPath, [], null, 'SIGTERM');
    }
    const audioProbe = await this.probeAudioFile(audioPath, signal);
    if (signal?.aborted) {
      throw this.cancelledError(this.ffmpegPath, [], null, 'SIGTERM');
    }
    const validation = await this.validateAudioMuxExecutable(signal);
    if (signal?.aborted) {
      throw this.cancelledError(this.ffmpegPath, [], null, 'SIGTERM');
    }
    const temporaryOutputPath = createTemporaryOutputPath(outputPath);
    const args = this.buildMuxAudioArguments({
      videoPath,
      audioPath,
      startMs: request.startMs,
      channels: audioProbe.channels,
      outputPath: temporaryOutputPath,
      overwrite: request.overwrite,
    });
    const startedAt = performance.now();
    let result: ProcessResult;
    try {
      result = await this.runProcess(this.ffmpegPath, args, { signal });
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
        throw this.mapMuxFailure(args, result, audioPath);
      }
      const outputStats = await stat(temporaryOutputPath).catch(() => null);
      if (!outputStats?.isFile() || outputStats.size === 0) {
        throw new FFmpegAdapterError(
          'PROCESS_FAILED',
          'FFmpeg 已退出，但没有生成可用的含声视频文件。',
          {
            executable: this.ffmpegPath,
            args,
            exitCode: result.code,
            signal: result.signal,
            stderr: technicalTail(result.stderr),
          },
        );
      }
      if (signal?.aborted) {
        throw this.cancelledError(
          this.ffmpegPath,
          args,
          result.code,
          result.signal,
          result.stderr,
        );
      }
      await this.commitTemporaryOutput(
        temporaryOutputPath,
        outputPath,
        request.overwrite,
        args,
        result,
      );
    } catch (error) {
      await this.cleanupTemporaryOutput(temporaryOutputPath, error);
      throw error;
    }
    return {
      outputPath,
      videoPath,
      audioPath,
      startMs: request.startMs,
      elapsedMs: Math.round(performance.now() - startedAt),
      args,
      versionLine: validation.versionLine,
      stderr: technicalTail(result.stderr),
    };
  }

  async probeVideo(
    videoPath: string,
    signal?: AbortSignal,
  ): Promise<VideoProbeResult> {
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
    if (signal?.aborted) {
      throw this.cancelledError(this.ffprobePath, args, null, 'SIGTERM');
    }
    const result = await this.runProcess(this.ffprobePath, args, { signal });
    if (signal?.aborted) {
      throw this.cancelledError(
        this.ffprobePath,
        args,
        result.code,
        result.signal,
        result.stderr,
      );
    }
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
    const audio = streams.find((stream) => stream.codec_type === 'audio');
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
      hasAudio: Boolean(audio),
      audioCodecName: audio ? String(audio.codec_name ?? '') : null,
      audioSampleRate: audio ? Number(audio.sample_rate) : null,
      audioChannels: audio ? Number(audio.channels) : null,
      audioStartSeconds: audio ? Number(audio.start_time ?? Number.NaN) : null,
      audioDurationSeconds: audio
        ? Number(audio.duration ?? container.format?.duration ?? Number.NaN)
        : null,
      formatDurationSeconds: Number(container.format?.duration ?? Number.NaN),
      raw,
    };
  }

  async probeAudioFile(
    audioPath: string,
    signal?: AbortSignal,
  ): Promise<AudioProbeResult> {
    const resolvedAudioPath = path.resolve(audioPath);
    await this.assertReadableInput(resolvedAudioPath, 'audio');
    const args = [
      '-v',
      'error',
      '-show_streams',
      '-show_format',
      '-of',
      'json',
      resolvedAudioPath,
    ];
    if (signal?.aborted) {
      throw this.cancelledError(this.ffprobePath, args, null, 'SIGTERM');
    }
    const result = await this.runProcess(this.ffprobePath, args, { signal });
    if (signal?.aborted) {
      throw this.cancelledError(
        this.ffprobePath,
        args,
        result.code,
        result.signal,
        result.stderr,
      );
    }
    if (result.code !== 0) {
      throw new FFmpegAdapterError(
        'AUDIO_INPUT_INVALID',
        `无法读取音频文件：${path.basename(resolvedAudioPath)}。`,
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
        'AUDIO_INPUT_INVALID',
        `音频文件信息无法解析：${path.basename(resolvedAudioPath)}。`,
        { executable: this.ffprobePath, args, cause: error },
      );
    }
    const container = raw as {
      streams?: Array<Record<string, unknown>>;
      format?: Record<string, unknown>;
    };
    const streams = Array.isArray(container.streams) ? container.streams : [];
    const audio = streams.find((stream) => stream.codec_type === 'audio');
    if (!audio) {
      throw new FFmpegAdapterError(
        'AUDIO_INPUT_INVALID',
        `文件中没有可解码的音频流：${path.basename(resolvedAudioPath)}。`,
        { executable: this.ffprobePath, args },
      );
    }
    const channels = Number(audio.channels);
    if (!Number.isInteger(channels) || channels <= 0) {
      throw new FFmpegAdapterError(
        'AUDIO_INPUT_INVALID',
        `音频文件的声道信息无效：${path.basename(resolvedAudioPath)}。`,
        { executable: this.ffprobePath, args },
      );
    }
    return {
      codecName: String(audio.codec_name ?? ''),
      sampleRate: Number(audio.sample_rate),
      channels,
      durationSeconds: Number(
        audio.duration ?? container.format?.duration ?? Number.NaN,
      ),
      raw,
    };
  }

  async analyzeAudioTiming(
    mediaPath: string,
    signal?: AbortSignal,
  ): Promise<AudioTimingResult> {
    const resolvedMediaPath = path.resolve(mediaPath);
    const args = [
      '-hide_banner',
      '-nostats',
      '-i',
      resolvedMediaPath,
      '-map',
      '0:a:0',
      '-af',
      'silencedetect=noise=-50dB:d=0.05',
      '-f',
      'null',
      '-',
    ];
    if (signal?.aborted) {
      throw this.cancelledError(this.ffmpegPath, args, null, 'SIGTERM');
    }
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
      throw new FFmpegAdapterError(
        'PROBE_FAILED',
        '无法分析输出视频中的音频起点。',
        {
          executable: this.ffmpegPath,
          args,
          exitCode: result.code,
          signal: result.signal,
          stderr: technicalTail(result.stderr),
        },
      );
    }
    const stderr = technicalTail(result.stderr);
    const silenceStartsSeconds = Array.from(
      result.stderr.matchAll(/silence_start:\s*([0-9]+(?:\.[0-9]+)?)/giu),
      (match) => Number(match[1]),
    );
    const silenceEndsSeconds = Array.from(
      result.stderr.matchAll(/silence_end:\s*([0-9]+(?:\.[0-9]+)?)/giu),
      (match) => Number(match[1]),
    );
    const hasLeadingSilence =
      (silenceStartsSeconds[0] ?? Number.POSITIVE_INFINITY) <= 0.001 &&
      Number.isFinite(silenceEndsSeconds[0]);
    return {
      leadingSilenceEndSeconds: hasLeadingSilence
        ? (silenceEndsSeconds[0] ?? 0)
        : 0,
      silenceStartsSeconds,
      silenceEndsSeconds,
      stderr,
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

  assertMuxProbeMatches(
    probe: VideoProbeResult,
    rawExpectation: MuxProbeExpectation,
  ): void {
    const expected = MuxProbeExpectationSchema.parse(rawExpectation);
    const failures: string[] = [];
    if (probe.codecName !== expected.videoCodecName)
      failures.push(`video_codec=${probe.codecName}`);
    if (probe.pixelFormat !== expected.pixelFormat)
      failures.push(`pix_fmt=${probe.pixelFormat}`);
    if (probe.width !== expected.width || probe.height !== expected.height)
      failures.push(`size=${probe.width}x${probe.height}`);
    if (!Number.isFinite(probe.fps) || Math.abs(probe.fps - expected.fps) > 0.001)
      failures.push(`fps=${probe.fps}`);
    if (probe.frameCount !== expected.frameCount)
      failures.push(`frames=${probe.frameCount}`);
    if (probe.audioCodecName !== expected.audioCodecName)
      failures.push(`audio_codec=${probe.audioCodecName}`);
    if (probe.audioSampleRate !== expected.audioSampleRate)
      failures.push(`sample_rate=${probe.audioSampleRate}`);
    if (probe.audioChannels !== expected.audioChannels)
      failures.push(`channels=${probe.audioChannels}`);
    if (
      !Number.isFinite(probe.durationSeconds) ||
      Math.abs(probe.durationSeconds - expected.videoDurationSeconds) >
        expected.durationToleranceSeconds
    )
      failures.push(`video_duration=${probe.durationSeconds}`);
    if (
      !Number.isFinite(probe.audioDurationSeconds) ||
      Math.abs(
        (probe.audioDurationSeconds ?? Number.NaN) -
          expected.audioDurationSeconds,
      ) > expected.durationToleranceSeconds
    )
      failures.push(`audio_duration=${probe.audioDurationSeconds}`);
    if (
      !Number.isFinite(probe.formatDurationSeconds) ||
      Math.abs(
        probe.formatDurationSeconds - expected.formatDurationSeconds,
      ) > expected.durationToleranceSeconds
    )
      failures.push(`format_duration=${probe.formatDurationSeconds}`);
    if (failures.length > 0) {
      throw new FFmpegAdapterError(
        'PROBE_MISMATCH',
        `含声视频参数不符合要求：${failures.join('，')}。`,
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

  private buildMuxAudioArguments(request: {
    videoPath: string;
    audioPath: string;
    startMs: number;
    channels: number;
    outputPath: string;
    overwrite: boolean;
  }): readonly string[] {
    const channelDelays = Array.from(
      { length: request.channels },
      () => request.startMs,
    ).join('|');
    return [
      request.overwrite ? '-y' : '-n',
      '-hide_banner',
      '-loglevel',
      'info',
      '-i',
      request.videoPath,
      '-i',
      request.audioPath,
      '-filter_complex',
      `[1:a:0]adelay=${channelDelays}[delayed_audio]`,
      '-map',
      '0:v:0',
      '-map',
      '[delayed_audio]',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
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

  private async assertReadableInput(
    inputPath: string,
    inputKind: 'video' | 'audio',
  ): Promise<void> {
    try {
      const inputStats = await stat(inputPath);
      if (!inputStats.isFile()) throw new Error('not a file');
      await access(inputPath, constants.R_OK);
    } catch (error) {
      const isAudio = inputKind === 'audio';
      throw new FFmpegAdapterError(
        isAudio ? 'AUDIO_INPUT_INVALID' : 'VIDEO_INPUT_INVALID',
        `${isAudio ? '音频' : '视频'}文件不存在或无法读取：${path.basename(inputPath)}。`,
        { executable: this.ffmpegPath, args: [], cause: error },
      );
    }
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

  private async assertOverwriteAllowed(
    outputPath: string,
    overwrite: boolean,
  ): Promise<void> {
    if (overwrite) return;
    if (await this.pathExists(outputPath)) {
      throw new FFmpegAdapterError(
        'OUTPUT_ALREADY_EXISTS',
        '视频输出文件已存在，请选择其他路径或允许覆盖。',
        { executable: this.ffmpegPath, args: [] },
      );
    }
  }

  private async commitTemporaryOutput(
    temporaryOutputPath: string,
    outputPath: string,
    overwrite: boolean,
    args: readonly string[],
    result: ProcessResult,
  ): Promise<void> {
    await this.assertOverwriteAllowed(outputPath, overwrite);
    try {
      await rename(temporaryOutputPath, outputPath);
    } catch (error) {
      throw new FFmpegAdapterError(
        'OUTPUT_NOT_WRITABLE',
        '视频已编码，但无法提交到目标输出文件。',
        {
          executable: this.ffmpegPath,
          args,
          exitCode: result.code,
          signal: result.signal,
          stderr: technicalTail(result.stderr),
          cause: error,
        },
      );
    }
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await stat(filePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw new FFmpegAdapterError(
        'OUTPUT_NOT_WRITABLE',
        '无法检查视频输出文件状态。',
        { executable: this.ffmpegPath, args: [], cause: error },
      );
    }
  }

  private async cleanupTemporaryOutput(
    temporaryOutputPath: string,
    originalError: unknown,
  ): Promise<void> {
    try {
      await rm(temporaryOutputPath, { force: true });
    } catch (cleanupError) {
      if (originalError instanceof FFmpegAdapterError) {
        originalError.diagnostics.cleanupError = cleanupError;
        originalError.message = `${originalError.message} 同时无法清理本 Job 的临时媒体文件，请关闭占用该文件的程序后重试。`;
      }
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

  private mapMuxFailure(
    args: readonly string[],
    result: ProcessResult,
    audioPath: string,
  ): FFmpegAdapterError {
    const stderr = technicalTail(result.stderr);
    if (/unknown encoder ['"]?aac/iu.test(stderr)) {
      return new FFmpegAdapterError(
        'ENCODER_UNAVAILABLE',
        '当前 FFmpeg 不包含 AAC 编码器，无法合成带声音的视频。',
        {
          executable: this.ffmpegPath,
          args,
          exitCode: result.code,
          signal: result.signal,
          stderr,
        },
      );
    }
    if (
      /invalid data found|error while decoding|could not find codec parameters|invalid.*audio|failed to open codec/iu.test(
        stderr,
      )
    ) {
      return new FFmpegAdapterError(
        'AUDIO_INPUT_INVALID',
        `无法解码音频文件：${path.basename(audioPath)}。`,
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
        'FFmpeg 无法写入含声视频输出文件。',
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
      `音视频合成失败（FFmpeg 退出码 ${result.code ?? 'unknown'}）。`,
      {
        executable: this.ffmpegPath,
        args,
        exitCode: result.code,
        signal: result.signal,
        stderr,
      },
    );
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

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FFmpegAdapter,
  FFmpegAdapterError,
  type ProcessResult,
  type ProcessRunOptions,
  type ProcessRunner,
} from '../../src/main/services/FFmpegAdapter';

type FakeResponse =
  | ProcessResult
  | Error
  | ((
      executable: string,
      args: readonly string[],
      options?: ProcessRunOptions,
    ) => Promise<ProcessResult> | ProcessResult);

const VERSION_RESULT: ProcessResult = {
  code: 0,
  signal: null,
  stdout: 'ffmpeg version test-build Copyright test\n',
  stderr: '',
};
const ENCODERS_RESULT: ProcessResult = {
  code: 0,
  signal: null,
  stdout: ' V..... libx264 H.264 encoder\n',
  stderr: '',
};

class FakeRunner implements ProcessRunner {
  readonly calls: Array<{
    executable: string;
    args: readonly string[];
    options?: ProcessRunOptions;
  }> = [];

  constructor(private readonly responses: FakeResponse[]) {}

  async run(
    executable: string,
    args: readonly string[],
    options?: ProcessRunOptions,
  ): Promise<ProcessResult> {
    this.calls.push({ executable, args: [...args], options });
    const response = this.responses.shift();
    if (!response) throw new Error('FakeRunner has no queued response.');
    if (response instanceof Error) throw response;
    if (typeof response === 'function') {
      return response(executable, args, options);
    }
    return response;
  }
}

async function writeFrames(directory: string, indices: number[]) {
  await mkdir(directory, { recursive: true });
  await Promise.all(
    indices.map((index) =>
      writeFile(
        path.join(directory, `frame_${String(index).padStart(6, '0')}.png`),
        new Uint8Array([137, 80, 78, 71]),
      ),
    ),
  );
}

describe('FFmpegAdapter', () => {
  let temporaryRoot: string;

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'panda-stage-ffmpeg-'));
  });

  afterEach(async () => {
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  it('reads the FFmpeg version and requires libx264', async () => {
    const runner = new FakeRunner([VERSION_RESULT, ENCODERS_RESULT]);
    const adapter = new FFmpegAdapter({
      ffmpegPath: 'C:\\Tools With Spaces\\ffmpeg.exe',
      runner,
    });

    await expect(adapter.validateExecutable()).resolves.toEqual({
      executable: 'C:\\Tools With Spaces\\ffmpeg.exe',
      versionLine: 'ffmpeg version test-build Copyright test',
      hasLibx264: true,
    });
    expect(runner.calls.map((call) => call.args)).toEqual([
      ['-version'],
      ['-hide_banner', '-encoders'],
    ]);
  });

  it('rejects an FFmpeg build without libx264', async () => {
    const runner = new FakeRunner([
      VERSION_RESULT,
      { code: 0, signal: null, stdout: ' V..... libx265 HEVC encoder', stderr: '' },
    ]);
    const adapter = new FFmpegAdapter({ runner });

    await expect(adapter.validateExecutable()).rejects.toMatchObject({
      code: 'ENCODER_UNAVAILABLE',
      message: expect.stringContaining('libx264'),
    });
  });

  it('passes paths containing spaces as individual arguments and encodes every frame', async () => {
    const framesDirectory = path.join(temporaryRoot, 'frames with spaces');
    const outputDirectory = path.join(temporaryRoot, 'output with spaces');
    const outputPath = path.join(outputDirectory, 'probe video.mp4');
    await writeFrames(
      framesDirectory,
      Array.from({ length: 72 }, (_, index) => index),
    );
    await mkdir(outputDirectory);
    const runner = new FakeRunner([
      VERSION_RESULT,
      ENCODERS_RESULT,
      async (_executable, args) => {
        await writeFile(args.at(-1) ?? '', new Uint8Array([0, 0, 0, 1]));
        return { code: 0, signal: null, stdout: '', stderr: 'encoding log' };
      },
    ]);
    const adapter = new FFmpegAdapter({
      ffmpegPath: 'C:\\Tools With Spaces\\ffmpeg.exe',
      runner,
    });

    const result = await adapter.encodePngSequence({
      framesDirectory,
      outputPath,
      fps: 24,
      overwrite: true,
    });
    const encodeCall = runner.calls[2];

    expect(result.frameCount).toBe(72);
    expect(encodeCall?.args).toContain(
      path.join(framesDirectory, 'frame_%06d.png'),
    );
    expect(encodeCall?.args.at(-1)).toBe(outputPath);
    expect(encodeCall?.args).toContain('libx264');
    expect(encodeCall?.args).toContain('yuv420p');
    expect(encodeCall?.args).toContain('-an');
  });

  it('rejects a missing frame before spawning FFmpeg', async () => {
    const framesDirectory = path.join(temporaryRoot, 'frames');
    await writeFrames(framesDirectory, [0, 2]);
    const runner = new FakeRunner([]);
    const adapter = new FFmpegAdapter({ runner });

    await expect(
      adapter.encodePngSequence({
        framesDirectory,
        outputPath: path.join(temporaryRoot, 'out.mp4'),
        fps: 24,
      }),
    ).rejects.toMatchObject({
      code: 'FRAME_SEQUENCE_INVALID',
      message: expect.stringContaining('frame_000001.png'),
    });
    expect(runner.calls).toHaveLength(0);
  });

  it('maps a missing executable to a readable error', async () => {
    const missing = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    const adapter = new FFmpegAdapter({
      ffmpegPath: 'C:\\missing tools\\ffmpeg.exe',
      runner: new FakeRunner([missing]),
    });

    await expect(adapter.getVersion()).rejects.toMatchObject({
      code: 'EXECUTABLE_NOT_FOUND',
      message: '找不到媒体工具：ffmpeg.exe。请配置开发环境路径。',
    });
  });

  it('rejects an invalid output directory before spawning FFmpeg', async () => {
    const framesDirectory = path.join(temporaryRoot, 'frames');
    const parentFile = path.join(temporaryRoot, 'not-a-directory');
    await writeFrames(framesDirectory, [0]);
    await writeFile(parentFile, 'file');
    const runner = new FakeRunner([]);
    const adapter = new FFmpegAdapter({ runner });

    await expect(
      adapter.encodePngSequence({
        framesDirectory,
        outputPath: path.join(parentFile, 'out.mp4'),
        fps: 24,
      }),
    ).rejects.toMatchObject({ code: 'OUTPUT_NOT_WRITABLE' });
    expect(runner.calls).toHaveLength(0);
  });

  it('keeps stderr in diagnostics without dumping it into the user message', async () => {
    const framesDirectory = path.join(temporaryRoot, 'frames');
    await writeFrames(framesDirectory, [0]);
    const technicalDetail = 'internal filter graph exploded';
    const runner = new FakeRunner([
      VERSION_RESULT,
      ENCODERS_RESULT,
      { code: 17, signal: null, stdout: '', stderr: technicalDetail },
    ]);
    const adapter = new FFmpegAdapter({ runner });

    let failure: FFmpegAdapterError | null = null;
    try {
      await adapter.encodePngSequence({
        framesDirectory,
        outputPath: path.join(temporaryRoot, 'out.mp4'),
        fps: 24,
      });
    } catch (error) {
      failure = error as FFmpegAdapterError;
    }

    expect(failure).toMatchObject({
      code: 'PROCESS_FAILED',
      message: '视频编码失败（FFmpeg 退出码 17）。',
    });
    expect(failure?.message).not.toContain(technicalDetail);
    expect(failure?.diagnostics.stderr).toContain(technicalDetail);
  });

  it('maps an aborted child signal to a cancellation error', async () => {
    const framesDirectory = path.join(temporaryRoot, 'frames');
    await writeFrames(framesDirectory, [0]);
    const controller = new AbortController();
    const runner = new FakeRunner([
      VERSION_RESULT,
      ENCODERS_RESULT,
      (_executable, _args, options) => {
        expect(options?.signal).toBe(controller.signal);
        controller.abort();
        return {
          code: null,
          signal: 'SIGTERM',
          stdout: '',
          stderr: 'received termination',
        };
      },
    ]);
    const adapter = new FFmpegAdapter({ runner });

    await expect(
      adapter.encodePngSequence(
        {
          framesDirectory,
          outputPath: path.join(temporaryRoot, 'out.mp4'),
          fps: 24,
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({
      code: 'PROCESS_CANCELLED',
      diagnostics: { signal: 'SIGTERM' },
    });
  });

  it('treats a child signal without an abort request as a process failure', async () => {
    const framesDirectory = path.join(temporaryRoot, 'frames');
    await writeFrames(framesDirectory, [0]);
    const runner = new FakeRunner([
      VERSION_RESULT,
      ENCODERS_RESULT,
      { code: null, signal: 'SIGSEGV', stdout: '', stderr: 'crash detail' },
    ]);
    const adapter = new FFmpegAdapter({ runner });

    await expect(
      adapter.encodePngSequence({
        framesDirectory,
        outputPath: path.join(temporaryRoot, 'out.mp4'),
        fps: 24,
      }),
    ).rejects.toMatchObject({
      code: 'PROCESS_FAILED',
      diagnostics: { signal: 'SIGSEGV' },
    });
  });

  it('parses ffprobe output and rejects media parameter mismatches', async () => {
    const rawProbe = {
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          pix_fmt: 'yuv420p',
          width: 1920,
          height: 1080,
          avg_frame_rate: '24/1',
          nb_read_frames: '72',
          duration: '3.000000',
        },
      ],
      format: { duration: '3.000000' },
    };
    const runner = new FakeRunner([
      {
        code: 0,
        signal: null,
        stdout: JSON.stringify(rawProbe),
        stderr: '',
      },
    ]);
    const adapter = new FFmpegAdapter({ runner });
    const probe = await adapter.probeVideo(path.join(temporaryRoot, 'out.mp4'));

    expect(probe).toMatchObject({
      codecName: 'h264',
      pixelFormat: 'yuv420p',
      width: 1920,
      height: 1080,
      fps: 24,
      frameCount: 72,
      durationSeconds: 3,
      hasAudio: false,
    });
    expect(() =>
      adapter.assertProbeMatches(probe, {
        codecName: 'h264',
        pixelFormat: 'yuv420p',
        width: 1920,
        height: 1080,
        fps: 24,
        frameCount: 71,
        durationSeconds: 3,
      }),
    ).toThrow(/frames=72/);
  });
});

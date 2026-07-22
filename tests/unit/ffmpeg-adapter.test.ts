import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FFmpegAdapter,
  FFmpegAdapterError,
  NodeProcessRunner,
  type ProcessResult,
  type ProcessRunOptions,
  type ProcessRunner,
} from '../../src/main/services/FFmpegAdapter';
import { EncodePngSequenceRequestSchema } from '../../src/shared/ffmpeg-types';

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
    let temporaryOutputPath = '';
    const runner = new FakeRunner([
      VERSION_RESULT,
      ENCODERS_RESULT,
      async (_executable, args) => {
        temporaryOutputPath = args.at(-1) ?? '';
        await writeFile(temporaryOutputPath, new Uint8Array([0, 0, 0, 1]));
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
      overwrite: false,
    });
    const encodeCall = runner.calls[2];

    expect(result.frameCount).toBe(72);
    expect(encodeCall?.args).toContain(
      path.join(framesDirectory, 'frame_%06d.png'),
    );
    expect(path.dirname(temporaryOutputPath)).toBe(outputDirectory);
    expect(temporaryOutputPath).not.toBe(outputPath);
    expect(temporaryOutputPath).toMatch(/\.mp4$/iu);
    expect(encodeCall?.args[0]).toBe('-n');
    expect(encodeCall?.args).toContain('libx264');
    expect(encodeCall?.args).toContain('yuv420p');
    expect(encodeCall?.args).toContain('-an');
    await expect(stat(outputPath)).resolves.toMatchObject({ size: 4 });
    await expect(stat(temporaryOutputPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects overwrite=false before FFmpeg starts and preserves the existing output', async () => {
    const framesDirectory = path.join(temporaryRoot, 'frames');
    const outputPath = path.join(temporaryRoot, 'existing.mp4');
    await writeFrames(framesDirectory, [0]);
    await writeFile(outputPath, 'original video');
    const runner = new FakeRunner([]);
    const adapter = new FFmpegAdapter({ runner });

    await expect(
      adapter.encodePngSequence({
        framesDirectory,
        outputPath,
        fps: 24,
        overwrite: false,
      }),
    ).rejects.toMatchObject({
      code: 'OUTPUT_ALREADY_EXISTS',
      message: expect.stringContaining('已存在'),
    });
    expect(runner.calls).toHaveLength(0);
    await expect(readFile(outputPath, 'utf8')).resolves.toBe('original video');
  });

  it('replaces the official output only after a successful overwrite encode', async () => {
    const framesDirectory = path.join(temporaryRoot, 'frames');
    const outputPath = path.join(temporaryRoot, 'existing.mp4');
    await writeFrames(framesDirectory, [0]);
    await writeFile(outputPath, 'original video');
    let temporaryOutputPath = '';
    const runner = new FakeRunner([
      VERSION_RESULT,
      ENCODERS_RESULT,
      async (_executable, args) => {
        temporaryOutputPath = args.at(-1) ?? '';
        await writeFile(temporaryOutputPath, 'new video');
        return { code: 0, signal: null, stdout: '', stderr: '' };
      },
    ]);
    const adapter = new FFmpegAdapter({ runner });

    await expect(
      adapter.encodePngSequence({
        framesDirectory,
        outputPath,
        fps: 24,
        overwrite: true,
      }),
    ).resolves.toMatchObject({ outputPath });
    await expect(readFile(outputPath, 'utf8')).resolves.toBe('new video');
    await expect(stat(temporaryOutputPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('keeps an existing target intact when the final rename cannot replace it', async () => {
    const framesDirectory = path.join(temporaryRoot, 'frames');
    const outputPath = path.join(temporaryRoot, 'occupied.mp4');
    const markerPath = path.join(outputPath, 'original-marker.txt');
    await writeFrames(framesDirectory, [0]);
    await mkdir(outputPath);
    await writeFile(markerPath, 'original target');
    let temporaryOutputPath = '';
    const runner = new FakeRunner([
      VERSION_RESULT,
      ENCODERS_RESULT,
      async (_executable, args) => {
        temporaryOutputPath = args.at(-1) ?? '';
        await writeFile(temporaryOutputPath, 'new video');
        return { code: 0, signal: null, stdout: '', stderr: '' };
      },
    ]);
    const adapter = new FFmpegAdapter({ runner });

    await expect(
      adapter.encodePngSequence({
        framesDirectory,
        outputPath,
        fps: 24,
        overwrite: true,
      }),
    ).rejects.toMatchObject({ code: 'OUTPUT_NOT_WRITABLE' });
    await expect(readFile(markerPath, 'utf8')).resolves.toBe('original target');
    await expect(stat(temporaryOutputPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.each(['output.mp4', 'output.MP4'])(
    'accepts the MP4 output extension in %s',
    (outputPath) => {
      expect(
        EncodePngSequenceRequestSchema.safeParse({
          framesDirectory: 'frames',
          outputPath,
          fps: 24,
        }).success,
      ).toBe(true);
    },
  );

  it('rejects a non-MP4 output extension', () => {
    const result = EncodePngSequenceRequestSchema.safeParse({
      framesDirectory: 'frames',
      outputPath: 'output.mkv',
      fps: 24,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('.mp4');
    }
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
    const outputPath = path.join(temporaryRoot, 'out.mp4');
    await writeFrames(framesDirectory, [0]);
    await writeFile(outputPath, 'original video');
    const technicalDetail = 'internal filter graph exploded';
    let temporaryOutputPath = '';
    const runner = new FakeRunner([
      VERSION_RESULT,
      ENCODERS_RESULT,
      async (_executable, args) => {
        temporaryOutputPath = args.at(-1) ?? '';
        await writeFile(temporaryOutputPath, 'partial video');
        return { code: 17, signal: null, stdout: '', stderr: technicalDetail };
      },
    ]);
    const adapter = new FFmpegAdapter({ runner });

    let failure: FFmpegAdapterError | null = null;
    try {
      await adapter.encodePngSequence({
        framesDirectory,
        outputPath,
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
    await expect(readFile(outputPath, 'utf8')).resolves.toBe('original video');
    await expect(stat(temporaryOutputPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('maps an aborted child signal to a cancellation error', async () => {
    const framesDirectory = path.join(temporaryRoot, 'frames');
    const outputPath = path.join(temporaryRoot, 'out.mp4');
    await writeFrames(framesDirectory, [0]);
    await writeFile(outputPath, 'original video');
    const controller = new AbortController();
    let temporaryOutputPath = '';
    const runner = new FakeRunner([
      VERSION_RESULT,
      ENCODERS_RESULT,
      async (_executable, args, options) => {
        expect(options?.signal).toBe(controller.signal);
        temporaryOutputPath = args.at(-1) ?? '';
        await writeFile(temporaryOutputPath, 'partial video');
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
          outputPath,
          fps: 24,
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({
      code: 'PROCESS_CANCELLED',
      diagnostics: { signal: 'SIGTERM' },
    });
    await expect(readFile(outputPath, 'utf8')).resolves.toBe('original video');
    await expect(stat(temporaryOutputPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('preserves the encoding error when partial-output cleanup fails', async () => {
    const framesDirectory = path.join(temporaryRoot, 'frames');
    const outputPath = path.join(temporaryRoot, 'official.mp4');
    await writeFrames(framesDirectory, [0]);
    await writeFile(outputPath, 'original video');
    let temporaryOutputPath = '';
    const runner = new FakeRunner([
      VERSION_RESULT,
      ENCODERS_RESULT,
      async (_executable, args) => {
        temporaryOutputPath = args.at(-1) ?? '';
        await mkdir(temporaryOutputPath);
        return { code: 29, signal: null, stdout: '', stderr: 'encode failed' };
      },
    ]);
    const adapter = new FFmpegAdapter({ runner });

    await expect(
      adapter.encodePngSequence({
        framesDirectory,
        outputPath,
        fps: 24,
      }),
    ).rejects.toMatchObject({
      code: 'PROCESS_FAILED',
      message: expect.stringMatching(
        /视频编码失败（FFmpeg 退出码 29）。.*无法清理本 Job 的临时媒体文件/,
      ),
      diagnostics: { cleanupError: expect.anything() },
    });
    await expect(readFile(outputPath, 'utf8')).resolves.toBe('original video');
    await expect(stat(temporaryOutputPath)).resolves.toMatchObject({});
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

describe('NodeProcessRunner Job-scoped cancellation', () => {
  it('terminates only the child carrying the aborted signal', async () => {
    const runner = new NodeProcessRunner();
    const unrelated = runner.run(process.execPath, [
      '-e',
      'setTimeout(() => process.exit(0), 250)',
    ]);
    const controller = new AbortController();
    const targeted = runner.run(
      process.execPath,
      ['-e', 'setTimeout(() => process.exit(0), 10000)'],
      { signal: controller.signal },
    );

    while (runner.getActiveProcesses().length < 2) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const targetedPid = runner
      .getActiveProcesses()
      .find((entry) => entry.args.some((argument) => argument.includes('10000')))
      ?.pid;
    expect(targetedPid).not.toBeNull();
    controller.abort();
    const targetedResult = await targeted;
    expect(targetedResult.code === 0 && targetedResult.signal === null).toBe(
      false,
    );
    expect(runner.getActiveProcesses()).toHaveLength(1);
    await expect(unrelated).resolves.toMatchObject({ code: 0, signal: null });
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });
});

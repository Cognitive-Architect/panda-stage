import {
  mkdtemp,
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
  type ProcessResult,
  type ProcessRunOptions,
  type ProcessRunner,
} from '../../src/main/services/FFmpegAdapter';
import { MuxSingleAudioRequestSchema } from '../../src/shared/ffmpeg-types';

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
const AUDIO_ENCODERS_RESULT: ProcessResult = {
  code: 0,
  signal: null,
  stdout: ' A..... aac AAC encoder\n V..... libx264 H.264 encoder\n',
  stderr: '',
};

function audioProbeResult(channels: number | undefined): ProcessResult {
  return {
    code: 0,
    signal: null,
    stdout: JSON.stringify({
      streams: [
        {
          codec_type: 'audio',
          codec_name: 'pcm_s16le',
          sample_rate: '48000',
          channels,
          duration: '3.000000',
        },
      ],
      format: { duration: '3.000000' },
    }),
    stderr: '',
  };
}

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
    return typeof response === 'function'
      ? response(executable, args, options)
      : response;
  }
}

describe('FFmpegAdapter single-audio mux', () => {
  let temporaryRoot: string;
  let videoPath: string;
  let audioPath: string;

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'panda-stage-mux-'));
    videoPath = path.join(temporaryRoot, 'silent video.mp4');
    audioPath = path.join(temporaryRoot, 'probe audio.wav');
    await writeFile(videoPath, 'video input');
    await writeFile(audioPath, 'audio input');
  });

  afterEach(async () => {
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  it('requires startMs to be a non-negative integer', () => {
    const baseRequest = {
      videoPath,
      audioPath,
      outputPath: path.join(temporaryRoot, 'output.mp4'),
    };

    expect(
      MuxSingleAudioRequestSchema.safeParse({ ...baseRequest, startMs: 0 })
        .success,
    ).toBe(true);
    expect(
      MuxSingleAudioRequestSchema.safeParse({ ...baseRequest, startMs: 375 })
        .success,
    ).toBe(true);
    expect(
      MuxSingleAudioRequestSchema.safeParse({ ...baseRequest, startMs: 0.5 })
        .success,
    ).toBe(false);
    expect(
      MuxSingleAudioRequestSchema.safeParse({ ...baseRequest, startMs: -1 })
        .success,
    ).toBe(false);
  });

  it('rejects an FFmpeg build without the AAC encoder', async () => {
    const runner = new FakeRunner([
      VERSION_RESULT,
      { code: 0, signal: null, stdout: ' V..... libx264 H.264', stderr: '' },
    ]);
    const adapter = new FFmpegAdapter({ runner });

    await expect(adapter.validateAudioMuxExecutable()).rejects.toMatchObject({
      code: 'ENCODER_UNAVAILABLE',
      message: expect.stringContaining('AAC'),
    });
  });

  it.each([
    { channels: 1, startMs: 400, expectedDelay: '400' },
    { channels: 2, startMs: 400, expectedDelay: '400|400' },
    { channels: 2, startMs: 0, expectedDelay: '0|0' },
  ])(
    'builds $channels-channel delay $expectedDelay for startMs=$startMs',
    async ({ channels, startMs, expectedDelay }) => {
      const outputPath = path.join(temporaryRoot, `output ${startMs}.mp4`);
      let temporaryOutputPath = '';
      const runner = new FakeRunner([
        audioProbeResult(channels),
        VERSION_RESULT,
        AUDIO_ENCODERS_RESULT,
        async (_executable, args) => {
          temporaryOutputPath = args.at(-1) ?? '';
          await writeFile(temporaryOutputPath, `muxed ${startMs}`);
          return { code: 0, signal: null, stdout: '', stderr: 'mux log' };
        },
      ]);
      const adapter = new FFmpegAdapter({ runner });

      await expect(
        adapter.muxSingleAudio({
          videoPath,
          audioPath,
          startMs,
          outputPath,
          overwrite: false,
        }),
      ).resolves.toMatchObject({ outputPath, videoPath, audioPath, startMs });

      const muxArgs = runner.calls[3]?.args ?? [];
      expect(muxArgs).toContain(videoPath);
      expect(muxArgs).toContain(audioPath);
      expect(muxArgs).toContain(
        `[1:a:0]adelay=${expectedDelay}[delayed_audio]`,
      );
      expect(muxArgs).toContain('copy');
      expect(muxArgs).toContain('aac');
      expect(muxArgs).not.toContain('-shortest');
      expect(muxArgs.join(' ')).not.toMatch(/\batempo\b|\bamix\b/u);
      expect(path.dirname(temporaryOutputPath)).toBe(temporaryRoot);
      expect(temporaryOutputPath).not.toBe(outputPath);
      expect(temporaryOutputPath).toMatch(/\.mp4$/iu);
      await expect(readFile(outputPath, 'utf8')).resolves.toBe(
        `muxed ${startMs}`,
      );
      await expect(stat(temporaryOutputPath)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );

  it.each([0, undefined, 1.5])(
    'rejects invalid channel metadata %s before starting the mux process',
    async (channels) => {
      const runner = new FakeRunner([audioProbeResult(channels)]);
      const adapter = new FFmpegAdapter({ runner });

      await expect(
        adapter.muxSingleAudio({
          videoPath,
          audioPath,
          startMs: 400,
          outputPath: path.join(
            temporaryRoot,
            `invalid-channels-${String(channels)}.mp4`,
          ),
        }),
      ).rejects.toMatchObject({
        code: 'AUDIO_INPUT_INVALID',
        message: expect.stringContaining('声道信息无效'),
      });
      expect(runner.calls).toHaveLength(1);
      expect(runner.calls[0]?.args).toContain('-show_streams');
      expect(runner.calls[0]?.args).not.toContain('-filter_complex');
    },
  );

  it('rejects missing video and audio files before FFmpeg starts', async () => {
    const missingVideoRunner = new FakeRunner([]);
    const missingAudioRunner = new FakeRunner([]);

    await expect(
      new FFmpegAdapter({ runner: missingVideoRunner }).muxSingleAudio({
        videoPath: path.join(temporaryRoot, 'missing video.mp4'),
        audioPath,
        startMs: 0,
        outputPath: path.join(temporaryRoot, 'video-missing.mp4'),
      }),
    ).rejects.toMatchObject({ code: 'VIDEO_INPUT_INVALID' });
    await expect(
      new FFmpegAdapter({ runner: missingAudioRunner }).muxSingleAudio({
        videoPath,
        audioPath: path.join(temporaryRoot, 'missing audio.wav'),
        startMs: 0,
        outputPath: path.join(temporaryRoot, 'audio-missing.mp4'),
      }),
    ).rejects.toMatchObject({
      code: 'AUDIO_INPUT_INVALID',
      message: expect.stringContaining('missing audio.wav'),
    });
    expect(missingVideoRunner.calls).toHaveLength(0);
    expect(missingAudioRunner.calls).toHaveLength(0);
  });

  it('rejects an invalid output directory before FFmpeg starts', async () => {
    const parentFile = path.join(temporaryRoot, 'not-a-directory');
    await writeFile(parentFile, 'file');
    const runner = new FakeRunner([]);

    await expect(
      new FFmpegAdapter({ runner }).muxSingleAudio({
        videoPath,
        audioPath,
        startMs: 0,
        outputPath: path.join(parentFile, 'output.mp4'),
      }),
    ).rejects.toMatchObject({ code: 'OUTPUT_NOT_WRITABLE' });
    expect(runner.calls).toHaveLength(0);
  });

  it('reports a corrupt WAV before mux and can retry successfully', async () => {
    const corruptAudioPath = path.join(temporaryRoot, '损坏 audio.wav');
    const failedOutputPath = path.join(temporaryRoot, 'failed.mp4');
    const recoveredOutputPath = path.join(temporaryRoot, 'recovered.mp4');
    await writeFile(corruptAudioPath, 'not a wav');
    const runner = new FakeRunner([
      {
        code: 1,
        signal: null,
        stdout: '',
        stderr: 'Invalid data found when processing input',
      },
      audioProbeResult(1),
      VERSION_RESULT,
      AUDIO_ENCODERS_RESULT,
      async (_executable, args) => {
        await writeFile(args.at(-1) ?? '', 'recovered mux');
        return { code: 0, signal: null, stdout: '', stderr: '' };
      },
    ]);
    const adapter = new FFmpegAdapter({ runner });

    await expect(
      adapter.muxSingleAudio({
        videoPath,
        audioPath: corruptAudioPath,
        startMs: 200,
        outputPath: failedOutputPath,
      }),
    ).rejects.toMatchObject({
      code: 'AUDIO_INPUT_INVALID',
      message: expect.stringContaining('损坏 audio.wav'),
    });
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.args).not.toContain('-filter_complex');
    await expect(
      adapter.muxSingleAudio({
        videoPath,
        audioPath,
        startMs: 200,
        outputPath: recoveredOutputPath,
      }),
    ).resolves.toMatchObject({ outputPath: recoveredOutputPath });
    await expect(readFile(recoveredOutputPath, 'utf8')).resolves.toBe(
      'recovered mux',
    );
  });

  it('parses and strictly validates H.264 plus AAC ffprobe metadata', async () => {
    const rawProbe = {
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          pix_fmt: 'yuv420p',
          width: 1920,
          height: 1080,
          avg_frame_rate: '24/1',
          nb_frames: '72',
          duration: '3.000000',
        },
        {
          codec_type: 'audio',
          codec_name: 'aac',
          sample_rate: '48000',
          channels: 1,
          start_time: '0.000000',
          duration: '3.400000',
        },
      ],
      format: { duration: '3.400000' },
    };
    const adapter = new FFmpegAdapter({
      runner: new FakeRunner([
        {
          code: 0,
          signal: null,
          stdout: JSON.stringify(rawProbe),
          stderr: '',
        },
      ]),
    });

    const probe = await adapter.probeVideo(path.join(temporaryRoot, 'mux.mp4'));
    expect(probe).toMatchObject({
      codecName: 'h264',
      audioCodecName: 'aac',
      audioSampleRate: 48_000,
      audioChannels: 1,
      durationSeconds: 3,
      audioDurationSeconds: 3.4,
      formatDurationSeconds: 3.4,
    });
    expect(() =>
      adapter.assertMuxProbeMatches(probe, {
        videoCodecName: 'h264',
        pixelFormat: 'yuv420p',
        width: 1_920,
        height: 1_080,
        fps: 24,
        frameCount: 72,
        audioCodecName: 'aac',
        audioSampleRate: 48_000,
        audioChannels: 1,
        videoDurationSeconds: 3,
        audioDurationSeconds: 3.4,
        formatDurationSeconds: 3.4,
      }),
    ).not.toThrow();
    expect(() =>
      adapter.assertMuxProbeMatches(probe, {
        videoCodecName: 'h264',
        pixelFormat: 'yuv420p',
        width: 1_920,
        height: 1_080,
        fps: 24,
        frameCount: 72,
        audioCodecName: 'aac',
        audioSampleRate: 48_000,
        audioChannels: 1,
        videoDurationSeconds: 3,
        audioDurationSeconds: 3.1,
        formatDurationSeconds: 3.4,
      }),
    ).toThrow(/audio_duration=3.4/u);
    expect(() =>
      adapter.assertMuxProbeMatches(probe, {
        videoCodecName: 'h264',
        pixelFormat: 'yuv420p',
        width: 1_920,
        height: 1_080,
        fps: 24,
        frameCount: 71,
        audioCodecName: 'aac',
        audioSampleRate: 48_000,
        audioChannels: 1,
        videoDurationSeconds: 3,
        audioDurationSeconds: 3.4,
        formatDurationSeconds: 3.4,
      }),
    ).toThrow(/frames=72/u);
  });

  it('reads the WAV duration and channel metadata through ffprobe', async () => {
    const rawProbe = {
      streams: [
        {
          codec_type: 'audio',
          codec_name: 'pcm_s16le',
          sample_rate: '48000',
          channels: 1,
          duration: '3.000000',
        },
      ],
      format: { duration: '3.000000' },
    };
    const adapter = new FFmpegAdapter({
      runner: new FakeRunner([
        {
          code: 0,
          signal: null,
          stdout: JSON.stringify(rawProbe),
          stderr: '',
        },
      ]),
    });

    await expect(adapter.probeAudioFile(audioPath)).resolves.toMatchObject({
      codecName: 'pcm_s16le',
      sampleRate: 48_000,
      channels: 1,
      durationSeconds: 3,
    });
  });

  it('parses leading-silence timing evidence from FFmpeg diagnostics', async () => {
    const adapter = new FFmpegAdapter({
      runner: new FakeRunner([
        {
          code: 0,
          signal: null,
          stdout: '',
          stderr:
            '[silencedetect] silence_start: 0\n' +
            '[silencedetect] silence_end: 0.400646 | silence_duration: 0.400646\n',
        },
      ]),
    });

    await expect(
      adapter.analyzeAudioTiming(path.join(temporaryRoot, 'mux.mp4')),
    ).resolves.toMatchObject({
      leadingSilenceEndSeconds: 0.400646,
      silenceStartsSeconds: [0],
      silenceEndsSeconds: [0.400646],
    });
  });
});

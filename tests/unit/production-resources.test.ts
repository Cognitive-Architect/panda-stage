import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveMediaToolPaths } from '../../src/main/services/production-resources';

describe('production media resources', () => {
  it('ignores development overrides in a packaged application', () => {
    const checked: string[] = [];
    const result = resolveMediaToolPaths({
      isPackaged: true,
      resourcesPath: 'C:\\Program Files\\Panda Stage\\resources',
      platform: 'win32',
      environment: {
        PANDA_STAGE_FFMPEG_PATH: 'D:\\developer\\ffmpeg.exe',
        PANDA_STAGE_FFPROBE_PATH: 'D:\\developer\\ffprobe.exe',
      },
      assertReadable: (filePath) => checked.push(filePath),
    });

    expect(result.source).toBe('packaged-resources');
    expect(result.ffmpegPath).toBe(
      path.win32.join(
        'C:\\Program Files\\Panda Stage\\resources',
        'media',
        'ffmpeg.exe',
      ),
    );
    expect(result.ffprobePath).not.toContain('developer');
    expect(checked).toHaveLength(3);
  });

  it('fails with a recovery-oriented packaged-resource error', () => {
    expect(() =>
      resolveMediaToolPaths({
        isPackaged: true,
        resourcesPath: 'C:\\Panda\\resources',
        platform: 'win32',
        assertReadable: () => {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        },
      }),
    ).toThrow(/packaged resource is missing.*Reinstall/iu);
  });

  it('allows explicit tools only in development', () => {
    const result = resolveMediaToolPaths({
      isPackaged: false,
      resourcesPath: 'ignored',
      platform: 'win32',
      environment: {
        PANDA_STAGE_FFMPEG_PATH: 'D:\\tools\\ffmpeg.exe',
        PANDA_STAGE_FFPROBE_PATH: 'D:\\tools\\ffprobe.exe',
        PANDA_STAGE_PROBE_AUDIO_PATH: 'D:\\audio\\tone.wav',
      },
    });
    expect(result).toMatchObject({
      ffmpegPath: 'D:\\tools\\ffmpeg.exe',
      ffprobePath: 'D:\\tools\\ffprobe.exe',
      audioProbePath: 'D:\\audio\\tone.wav',
      source: 'development-environment',
    });
  });
});

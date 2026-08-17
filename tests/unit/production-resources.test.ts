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
      assertReadable: () => undefined,
      resolvePackageJson: () => {
        throw new Error('explicit overrides must not resolve packages');
      },
    });
    expect(result).toMatchObject({
      ffmpegPath: 'D:\\tools\\ffmpeg.exe',
      ffprobePath: 'D:\\tools\\ffprobe.exe',
      audioProbePath: 'D:\\audio\\tone.wav',
      source: 'development-environment',
    });
  });

  it('resolves repo-installed Windows binaries when PATH has no media tools', () => {
    const packageJsonPaths = new Map([
      [
        '@ffmpeg-installer/win32-x64',
        'D:\\checkout-a\\node_modules\\@ffmpeg-installer\\win32-x64\\package.json',
      ],
      [
        '@ffprobe-installer/win32-x64',
        'D:\\checkout-a\\node_modules\\@ffprobe-installer\\win32-x64\\package.json',
      ],
    ]);
    const checked: string[] = [];
    const result = resolveMediaToolPaths({
      isPackaged: false,
      resourcesPath: 'ignored',
      platform: 'win32',
      environment: {},
      assertReadable: (filePath) => checked.push(filePath),
      resolvePackageJson: (packageName) => {
        const packageJsonPath = packageJsonPaths.get(packageName);
        if (!packageJsonPath) throw new Error(`unexpected package ${packageName}`);
        return packageJsonPath;
      },
    });

    expect(result.ffmpegPath).toBe(
      'D:\\checkout-a\\node_modules\\@ffmpeg-installer\\win32-x64\\ffmpeg.exe',
    );
    expect(result.ffprobePath).toBe(
      'D:\\checkout-a\\node_modules\\@ffprobe-installer\\win32-x64\\ffprobe.exe',
    );
    expect(checked).toEqual([result.ffmpegPath, result.ffprobePath]);
  });

  it.skipIf(process.platform !== 'win32')(
    'uses the installed package locations by default on Windows',
    () => {
      const result = resolveMediaToolPaths({
        isPackaged: false,
        resourcesPath: 'ignored',
        platform: 'win32',
        environment: {},
      });

      expect(result.ffmpegPath).toMatch(
        /node_modules[\\/]@ffmpeg-installer[\\/]win32-x64[\\/]ffmpeg\.exe$/iu,
      );
      expect(result.ffprobePath).toMatch(
        /node_modules[\\/]@ffprobe-installer[\\/]win32-x64[\\/]ffprobe\.exe$/iu,
      );
    },
  );

  it('keeps development resolution independent of the repository absolute location', () => {
    const resolveFrom = (repositoryRoot: string) =>
      resolveMediaToolPaths({
        isPackaged: false,
        resourcesPath: 'ignored',
        platform: 'win32',
        environment: {},
        assertReadable: () => undefined,
        resolvePackageJson: (packageName) =>
          path.win32.join(
            repositoryRoot,
            'node_modules',
            packageName,
            'package.json',
          ),
      });

    const first = resolveFrom('D:\\checkout-a');
    const second = resolveFrom('E:\\checkout-b');

    expect(first.ffmpegPath).toBe(
      'D:\\checkout-a\\node_modules\\@ffmpeg-installer\\win32-x64\\ffmpeg.exe',
    );
    expect(second.ffmpegPath).toBe(
      'E:\\checkout-b\\node_modules\\@ffmpeg-installer\\win32-x64\\ffmpeg.exe',
    );
    expect(first.ffmpegPath).not.toContain('D:\\panda-stage-main');
    expect(second.ffmpegPath).not.toContain('D:\\panda-stage-main');
  });

  it('reports an actionable error when the repo-installed binary is unavailable', () => {
    expect(() =>
      resolveMediaToolPaths({
        isPackaged: false,
        resourcesPath: 'ignored',
        platform: 'win32',
        environment: {},
        resolvePackageJson: () => {
          throw Object.assign(new Error('missing package'), { code: 'MODULE_NOT_FOUND' });
        },
      }),
    ).toThrow(
      /development media tool is unavailable.*FFmpeg.*pnpm install.*PANDA_STAGE_FFMPEG_PATH/iu,
    );
  });
});

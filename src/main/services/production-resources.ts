import { accessSync, constants } from 'node:fs';
import path from 'node:path';

export interface MediaToolPaths {
  ffmpegPath: string;
  ffprobePath: string;
  audioProbePath: string;
  source: 'packaged-resources' | 'development-environment';
}

export interface ResolveMediaToolPathsOptions {
  isPackaged: boolean;
  resourcesPath: string;
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  assertReadable?: (filePath: string) => void;
}

function requireReadable(filePath: string): void {
  accessSync(filePath, constants.R_OK);
}

function assertResource(
  label: string,
  filePath: string,
  assertReadable: (filePath: string) => void,
): void {
  try {
    assertReadable(filePath);
  } catch (error) {
    throw new Error(
      `Panda Stage packaged resource is missing or unreadable: ${label} (${filePath}). Reinstall the application from a complete distribution.`,
      { cause: error },
    );
  }
}

export function resolveMediaToolPaths(
  options: ResolveMediaToolPathsOptions,
): MediaToolPaths {
  const environment = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;
  const assertReadable = options.assertReadable ?? requireReadable;

  if (options.isPackaged) {
    const mediaDirectory = path.join(options.resourcesPath, 'media');
    const ffmpegPath = path.join(
      mediaDirectory,
      platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
    );
    const ffprobePath = path.join(
      mediaDirectory,
      platform === 'win32' ? 'ffprobe.exe' : 'ffprobe',
    );
    const audioProbePath = path.join(
      options.resourcesPath,
      'probe',
      'preview-tone.wav',
    );
    assertResource('FFmpeg', ffmpegPath, assertReadable);
    assertResource('FFprobe', ffprobePath, assertReadable);
    assertResource('probe audio', audioProbePath, assertReadable);
    return {
      ffmpegPath,
      ffprobePath,
      audioProbePath,
      source: 'packaged-resources',
    };
  }

  return {
    ffmpegPath:
      environment.PANDA_STAGE_FFMPEG_PATH?.trim() ||
      (platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
    ffprobePath:
      environment.PANDA_STAGE_FFPROBE_PATH?.trim() ||
      (platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'),
    audioProbePath:
      environment.PANDA_STAGE_PROBE_AUDIO_PATH?.trim() ||
      path.resolve('public/probe/preview-tone.wav'),
    source: 'development-environment',
  };
}

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
  resolvePackageJson?: (packageName: string) => string;
}

interface DevelopmentMediaToolSpec {
  label: string;
  environmentName: 'PANDA_STAGE_FFMPEG_PATH' | 'PANDA_STAGE_FFPROBE_PATH';
  packageName: string;
  executableName: string;
  nonWindowsFallback: string;
}

const DEVELOPMENT_MEDIA_TOOLS = {
  ffmpeg: {
    label: 'FFmpeg',
    environmentName: 'PANDA_STAGE_FFMPEG_PATH',
    packageName: '@ffmpeg-installer/win32-x64',
    executableName: 'ffmpeg.exe',
    nonWindowsFallback: 'ffmpeg',
  },
  ffprobe: {
    label: 'FFprobe',
    environmentName: 'PANDA_STAGE_FFPROBE_PATH',
    packageName: '@ffprobe-installer/win32-x64',
    executableName: 'ffprobe.exe',
    nonWindowsFallback: 'ffprobe',
  },
} satisfies Record<'ffmpeg' | 'ffprobe', DevelopmentMediaToolSpec>;

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

function resolveInstalledWindowsBinary(
  spec: DevelopmentMediaToolSpec,
  resolvePackageJson: (packageName: string) => string,
): string {
  let packageJsonPath: string;
  try {
    packageJsonPath = resolvePackageJson(spec.packageName);
  } catch (error) {
    throw new Error(
      `Panda Stage development media tool is unavailable: ${spec.label} is not installed. Run pnpm install or set ${spec.environmentName} to a valid executable.`,
      { cause: error },
    );
  }
  return path.join(path.dirname(packageJsonPath), spec.executableName);
}

function assertDevelopmentResource(
  spec: DevelopmentMediaToolSpec,
  filePath: string,
  assertReadable: (filePath: string) => void,
): void {
  try {
    assertReadable(filePath);
  } catch (error) {
    throw new Error(
      `Panda Stage development media tool is missing or unreadable: ${spec.label}. Run pnpm install or set ${spec.environmentName} to a valid executable.`,
      { cause: error },
    );
  }
}

function resolveDevelopmentToolPath(
  spec: DevelopmentMediaToolSpec,
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
  assertReadable: (filePath: string) => void,
  resolvePackageJson: (packageName: string) => string,
): string {
  const explicitPath = environment[spec.environmentName]?.trim();
  const filePath =
    explicitPath ||
    (platform === 'win32'
      ? resolveInstalledWindowsBinary(spec, resolvePackageJson)
      : spec.nonWindowsFallback);

  if (explicitPath || platform === 'win32') {
    assertDevelopmentResource(spec, filePath, assertReadable);
  }
  return filePath;
}

export function resolveMediaToolPaths(
  options: ResolveMediaToolPathsOptions,
): MediaToolPaths {
  const environment = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;
  const assertReadable = options.assertReadable ?? requireReadable;
  const resolvePackageJson =
    options.resolvePackageJson ??
    ((packageName: string) => require.resolve(`${packageName}/package.json`));

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
    ffmpegPath: resolveDevelopmentToolPath(
      DEVELOPMENT_MEDIA_TOOLS.ffmpeg,
      platform,
      environment,
      assertReadable,
      resolvePackageJson,
    ),
    ffprobePath: resolveDevelopmentToolPath(
      DEVELOPMENT_MEDIA_TOOLS.ffprobe,
      platform,
      environment,
      assertReadable,
      resolvePackageJson,
    ),
    audioProbePath:
      environment.PANDA_STAGE_PROBE_AUDIO_PATH?.trim() ||
      path.resolve('public/probe/preview-tone.wav'),
    source: 'development-environment',
  };
}

import { spawn } from 'node:child_process';
import path from 'node:path';
import {
  CacheService,
  THUMBNAIL_MAX_EDGE,
} from './CacheService';
import { MediaInspectionService } from './MediaInspectionService';

const MAX_STDERR_CHARS = 8_000;

export interface ThumbnailGenerator {
  generate(
    sourcePath: string,
    outputPath: string,
    sourceWidth: number,
    sourceHeight: number,
  ): Promise<void>;
}

export class ThumbnailGenerationError extends Error {
  constructor(
    readonly kind: 'invalid-image' | 'processor-unavailable',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ThumbnailGenerationError';
  }
}

export class FFmpegThumbnailGenerator implements ThumbnailGenerator {
  constructor(private readonly ffmpegPath: string) {}

  async generate(
    sourcePath: string,
    outputPath: string,
    sourceWidth: number,
    sourceHeight: number,
  ): Promise<void> {
    const boxWidth = Math.min(THUMBNAIL_MAX_EDGE, sourceWidth);
    const boxHeight = Math.min(THUMBNAIL_MAX_EDGE, sourceHeight);
    const args = [
      '-v',
      'error',
      '-nostdin',
      '-y',
      '-i',
      path.resolve(sourcePath),
      '-frames:v',
      '1',
      '-vf',
      `scale=${boxWidth}:${boxHeight}:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba`,
      '-f',
      'image2',
      '-vcodec',
      'png',
      path.resolve(outputPath),
    ];

    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.ffmpegPath, args, {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-MAX_STDERR_CHARS);
      });
      child.once('error', (error) => {
        reject(
          new ThumbnailGenerationError(
            'processor-unavailable',
            `无法启动缩略图生成器处理“${path.basename(sourcePath)}”。`,
            { cause: error },
          ),
        );
      });
      child.once('close', (code, signal) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new ThumbnailGenerationError(
            'invalid-image',
            `无法解码图片“${path.basename(sourcePath)}”并生成缩略图。`,
            {
              cause: new Error(
                `FFmpeg exited with code ${String(code)} and signal ${String(signal)}: ${stderr}`,
              ),
            },
          ),
        );
      });
    });
  }
}

export interface ThumbnailDescriptor {
  relativePath: string;
  width: number;
  height: number;
  cacheHit: boolean;
}

export class ThumbnailService {
  constructor(
    private readonly cache: CacheService,
    private readonly generator: ThumbnailGenerator,
    private readonly inspection = new MediaInspectionService(),
  ) {}

  async ensureThumbnail(input: {
    projectRoot: string;
    sourcePath: string;
    sha256: string;
    width: number;
    height: number;
  }): Promise<ThumbnailDescriptor> {
    const cacheKey = this.cache.thumbnailKey(input.sha256);
    if (await this.cache.hasThumbnail(input.projectRoot, cacheKey)) {
      try {
        const cachedPath = this.cache.thumbnailPath(
          input.projectRoot,
          cacheKey,
        );
        const dimensions = await this.inspectThumbnail(cachedPath);
        return {
          relativePath:
            this.cache.thumbnailRelativePath(cacheKey),
          ...dimensions,
          cacheHit: true,
        };
      } catch {
        await this.cache.removeThumbnail(input.projectRoot, cacheKey);
      }
    }

    let generatedDimensions:
      | { width: number; height: number }
      | undefined;
    const cached = await this.cache.ensureThumbnail(
      input.projectRoot,
      cacheKey,
      async (temporaryPath) => {
        await this.generator.generate(
          input.sourcePath,
          temporaryPath,
          input.width,
          input.height,
        );
        generatedDimensions =
          await this.inspectThumbnail(temporaryPath);
      },
    );
    const dimensions =
      generatedDimensions ?? (await this.inspectThumbnail(cached.filePath));
    return {
      relativePath: cached.relativePath,
      ...dimensions,
      cacheHit: cached.cacheHit,
    };
  }

  private async inspectThumbnail(
    filePath: string,
  ): Promise<{ width: number; height: number }> {
    const inspected = await this.inspection.inspect(filePath, 'image/png');
    if (
      inspected.kind !== 'image' ||
      inspected.width === undefined ||
      inspected.height === undefined ||
      inspected.width > THUMBNAIL_MAX_EDGE ||
      inspected.height > THUMBNAIL_MAX_EDGE
    ) {
      throw new ThumbnailGenerationError(
        'invalid-image',
        `缩略图“${path.basename(filePath)}”尺寸无效。`,
      );
    }
    return { width: inspected.width, height: inspected.height };
  }
}

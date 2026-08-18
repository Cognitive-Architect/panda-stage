import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  ProjectSchema,
  type Project,
} from '../../domain';
import {
  AssetCanvasImageReadRequestSchema,
  CANVAS_IMAGE_MAX_BYTES,
  type AssetCanvasImageReadRequest,
  type AssetCanvasImageReadResponse,
} from '../../shared/asset-canvas-image-api';
import { MediaInspectionService } from './MediaInspectionService';

export interface AssetCanvasImageServiceOptions {
  getCurrentProjectSnapshot: (
    projectRoot: string,
  ) => { project: Project } | null;
  inspectionService?: MediaInspectionService;
}

/**
 * Reads the original imported image for the active editor canvas.
 *
 * This service deliberately has no disk cache: thumbnails are a separate
 * small-card concern. Reads are lazy and deduplicated only while in flight;
 * the renderer owns any object URLs it creates from the bounded response and
 * revokes them when the consuming view becomes stale.
 */
export class AssetCanvasImageService {
  private readonly getCurrentProjectSnapshot: (
    projectRoot: string,
  ) => { project: Project } | null;
  private readonly inspectionService: MediaInspectionService;
  private readonly activeReads = new Map<
    string,
    Promise<AssetCanvasImageReadResponse>
  >();

  constructor(options: AssetCanvasImageServiceOptions) {
    this.getCurrentProjectSnapshot = options.getCurrentProjectSnapshot;
    this.inspectionService =
      options.inspectionService ?? new MediaInspectionService();
  }

  read(rawRequest: unknown): Promise<AssetCanvasImageReadResponse> {
    let request: AssetCanvasImageReadRequest;
    try {
      request = AssetCanvasImageReadRequestSchema.parse(rawRequest);
    } catch {
      return Promise.resolve(
        this.failure(
          'ASSET_CANVAS_IMAGE_INVALID_REQUEST',
          this.requestAssetId(rawRequest),
          'Canvas image request is invalid.',
        ),
      );
    }

    const key = `${request.projectRoot}\u0000${request.assetId}\u0000${request.sha256}`;
    const active = this.activeReads.get(key);
    if (active) return active;

    const read = this.readValidated(request).finally(() => {
      this.activeReads.delete(key);
    });
    this.activeReads.set(key, read);
    return read;
  }

  private async readValidated(
    request: AssetCanvasImageReadRequest,
  ): Promise<AssetCanvasImageReadResponse> {
    let snapshot: { project: Project } | null;
    try {
      snapshot = this.getCurrentProjectSnapshot(request.projectRoot);
    } catch (error) {
      return this.failure(
        'ASSET_CANVAS_IMAGE_READ_FAILED',
        request.assetId,
        `Unable to read the current project snapshot: ${this.errorText(error)}`,
      );
    }
    if (!snapshot) {
      return this.failure(
        'ASSET_CANVAS_IMAGE_PROJECT_NOT_TRACKED',
        request.assetId,
        'The project is not currently tracked by the Main Process.',
      );
    }

    let project: Project;
    try {
      project = ProjectSchema.parse(snapshot.project);
    } catch (error) {
      return this.failure(
        'ASSET_CANVAS_IMAGE_READ_FAILED',
        request.assetId,
        `The current project snapshot is invalid: ${this.errorText(error)}`,
      );
    }

    const asset = project.assets.find(
      (candidate) => candidate.id === request.assetId,
    );
    if (!asset) {
      return this.failure(
        'ASSET_CANVAS_IMAGE_ASSET_NOT_FOUND',
        request.assetId,
        'The project does not contain this asset.',
      );
    }
    if (asset.sha256 !== request.sha256) {
      return this.failure(
        'ASSET_CANVAS_IMAGE_HASH_MISMATCH',
        request.assetId,
        'The asset content hash no longer matches the current project.',
      );
    }

    const mimeType = asset.mimeType;
    if (
      asset.kind !== 'image' ||
      (mimeType !== 'image/png' && mimeType !== 'image/jpeg')
    ) {
      return this.failure(
        'ASSET_CANVAS_IMAGE_READ_FAILED',
        request.assetId,
        'The asset is not a supported PNG or JPEG image.',
      );
    }

    const sourcePath = await this.resolveAssetPath(
      request.projectRoot,
      asset.relativePath,
    );
    if (!sourcePath) {
      return this.failure(
        'ASSET_CANVAS_IMAGE_READ_FAILED',
        request.assetId,
        'The asset source is missing or outside the project assets directory.',
      );
    }

    try {
      const sourceStats = await stat(sourcePath);
      if (!sourceStats.isFile() || sourceStats.size <= 0) {
        throw new Error('The source is not a non-empty regular file.');
      }
      if (sourceStats.size > CANVAS_IMAGE_MAX_BYTES) {
        throw new Error(
          `The source exceeds the ${CANVAS_IMAGE_MAX_BYTES}-byte canvas image limit.`,
        );
      }

      const inspected = await this.inspectionService.inspect(
        sourcePath,
        mimeType,
      );
      if (
        inspected.kind !== 'image' ||
        inspected.mimeType !== mimeType ||
        inspected.width !== asset.width ||
        inspected.height !== asset.height
      ) {
        throw new Error(
          `The source metadata does not match the project asset (${asset.width}x${asset.height}).`,
        );
      }

      const bytes = await readFile(sourcePath);
      if (bytes.byteLength === 0) {
        throw new Error('The source is empty.');
      }
      if (bytes.byteLength > CANVAS_IMAGE_MAX_BYTES) {
        throw new Error(
          `The source exceeds the ${CANVAS_IMAGE_MAX_BYTES}-byte canvas image limit.`,
        );
      }
      const actualSha256 = createHash('sha256')
        .update(bytes)
        .digest('hex');
      if (actualSha256 !== request.sha256) {
        return this.failure(
          'ASSET_CANVAS_IMAGE_HASH_MISMATCH',
          request.assetId,
          'The source file hash does not match the project asset.',
        );
      }

      return {
        ok: true,
        status: 'ready',
        assetId: request.assetId,
        mimeType,
        width: asset.width,
        height: asset.height,
        byteLength: bytes.byteLength,
        bytes,
      };
    } catch (error) {
      return this.failure(
        'ASSET_CANVAS_IMAGE_READ_FAILED',
        request.assetId,
        `Unable to read the original canvas image: ${this.errorText(error)}`,
      );
    }
  }

  private async resolveAssetPath(
    projectRoot: string,
    relativePath: string,
  ): Promise<string | null> {
    const assetsRoot = path.resolve(projectRoot, 'assets');
    const assetPath = path.resolve(projectRoot, relativePath);
    if (!this.isInsideDirectory(assetsRoot, assetPath)) return null;

    try {
      const [realAssetsRoot, realAssetPath] = await Promise.all([
        realpath(assetsRoot),
        realpath(assetPath),
      ]);
      return this.isInsideDirectory(realAssetsRoot, realAssetPath)
        ? realAssetPath
        : null;
    } catch {
      return null;
    }
  }

  private isInsideDirectory(directory: string, candidate: string): boolean {
    const relative = path.relative(directory, candidate);
    return (
      relative.length > 0 &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  }

  private requestAssetId(rawRequest: unknown): string {
    try {
      if (
        typeof rawRequest === 'object' &&
        rawRequest !== null &&
        'assetId' in rawRequest &&
        typeof rawRequest.assetId === 'string'
      ) {
        return rawRequest.assetId;
      }
    } catch {
      // Treat hostile accessors as an invalid request without exposing them.
    }
    return '(invalid)';
  }

  private errorText(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return (
      Array.from(message, (character) => {
        const code = character.charCodeAt(0);
        return code <= 0x1f || code === 0x7f ? ' ' : character;
      })
        .join('')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 900) || 'Operation failed.'
    );
  }

  private failure(
    code:
      | 'ASSET_CANVAS_IMAGE_INVALID_REQUEST'
      | 'ASSET_CANVAS_IMAGE_PROJECT_NOT_TRACKED'
      | 'ASSET_CANVAS_IMAGE_ASSET_NOT_FOUND'
      | 'ASSET_CANVAS_IMAGE_HASH_MISMATCH'
      | 'ASSET_CANVAS_IMAGE_READ_FAILED',
    assetId: string,
    message: string,
  ): AssetCanvasImageReadResponse {
    return {
      ok: false,
      error: {
        code,
        message: this.errorText(message).slice(0, 1_000),
        assetId: this.errorText(assetId).slice(0, 200),
      },
    };
  }
}

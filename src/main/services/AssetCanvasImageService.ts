import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import {
  ProjectSchema,
  type Project,
} from '../../domain';
import { isGeneratedFlaSvgAsset } from '../../domain/selectors/isGeneratedFlaSvgAsset';
import {
  AssetCanvasImageReadRequestSchema,
  CANVAS_IMAGE_MAX_BYTES,
  type AssetCanvasImageReadRequest,
  type AssetCanvasImageReadResponse,
} from '../../shared/asset-canvas-image-api';
import { MediaInspectionService } from './MediaInspectionService';
import { filesystemPermissionErrorCode } from './filesystem-permission-error';
import { resolveProjectAssetPath } from './project-asset-path';
import { parseFlaVideoFrameAssetKey } from '../../shared/fla-video-clock';
import type { FlaEmbeddedVideoService } from './FlaEmbeddedVideoService';

export function isSafeGeneratedFlaSvg(
  bytes: Uint8Array,
  width: number,
  height: number,
): boolean {
  let svg: string;
  try {
    svg = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  if (
    /<!DOCTYPE|<!ENTITY|<script\b|<foreignObject\b|<iframe\b|<object\b|<embed\b|\bon[a-z]+\s*=/iu.test(svg) ||
    /javascript:/iu.test(svg)
  ) return false;
  const root = svg.match(/<svg\b([^>]*)>/u)?.[1];
  if (!root || !/\bxmlns=["']http:\/\/www\.w3\.org\/2000\/svg["']/u.test(root)) return false;
  const svgWidth = root.match(/\bwidth=["']([0-9]+(?:\.[0-9]+)?)["']/u)?.[1];
  const svgHeight = root.match(/\bheight=["']([0-9]+(?:\.[0-9]+)?)["']/u)?.[1];
  if (Number(svgWidth) !== width || Number(svgHeight) !== height) return false;
  const hrefs = [...svg.matchAll(/\b(?:xlink:)?href=["']([^"']+)["']/gu)];
  return hrefs.every((match) => {
    const href = match[1] ?? '';
    return href.startsWith('#') || /^data:image\/png;base64,[a-z0-9+/=]+$/iu.test(href);
  });
}

export interface AssetCanvasImageServiceOptions {
  getCurrentProjectSnapshot: (
    projectRoot: string,
  ) => { project: Project } | null;
  inspectionService?: MediaInspectionService;
  embeddedVideoService?: Pick<FlaEmbeddedVideoService, 'readSampleFrame'>;
}

/**
 * Reads the original imported image for the active editor canvas.
 *
 * This service deliberately has no disk cache: thumbnails are a separate
 * small-card concern. Reads are lazy and deduplicated only while in flight;
 * object URL ownership remains with a later renderer/UI issue.
 */
export class AssetCanvasImageService {
  private readonly getCurrentProjectSnapshot: (
    projectRoot: string,
  ) => { project: Project } | null;
  private readonly inspectionService: MediaInspectionService;
  private readonly embeddedVideoService?: Pick<FlaEmbeddedVideoService, 'readSampleFrame'>;
  private readonly activeReads = new Map<
    string,
    Promise<AssetCanvasImageReadResponse>
  >();

  constructor(options: AssetCanvasImageServiceOptions) {
    this.getCurrentProjectSnapshot = options.getCurrentProjectSnapshot;
    this.inspectionService =
      options.inspectionService ?? new MediaInspectionService();
    this.embeddedVideoService = options.embeddedVideoService;
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

    const videoFrameKey = parseFlaVideoFrameAssetKey(request.assetId);
    if (videoFrameKey) {
      const videoAsset = project.assets.find(
        (candidate) => candidate.id === videoFrameKey.assetId && candidate.kind === 'video',
      );
      if (!videoAsset || videoAsset.kind !== 'video') {
        return this.failure(
          'ASSET_CANVAS_IMAGE_ASSET_NOT_FOUND',
          request.assetId,
          'The project does not contain this embedded video asset.',
        );
      }
      if (videoAsset.sha256 !== request.sha256) {
        return this.failure(
          'ASSET_CANVAS_IMAGE_HASH_MISMATCH',
          request.assetId,
          'The embedded video content hash no longer matches the current project.',
        );
      }
      if (!this.embeddedVideoService) {
        return this.failure(
          'ASSET_CANVAS_IMAGE_READ_FAILED',
          request.assetId,
          'Embedded video frame decoder is unavailable.',
          videoAsset.relativePath,
        );
      }
      const decoded = await this.embeddedVideoService.readSampleFrame({
        projectRoot: request.projectRoot,
        asset: videoAsset,
        sampleIndex: videoFrameKey.sampleIndex,
      });
      if (!decoded.ok) {
        return this.failure(
          'ASSET_CANVAS_IMAGE_READ_FAILED',
          request.assetId,
          decoded.message,
          videoAsset.relativePath,
        );
      }
      const copiedBytes = Uint8Array.from(decoded.bytes);
      return {
        ok: true,
        status: 'ready',
        assetId: request.assetId,
        mimeType: 'image/png',
        width: videoAsset.width,
        height: videoAsset.height,
        byteLength: copiedBytes.byteLength,
        bytes: copiedBytes,
      };
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
    const generatedFlaSvg = isGeneratedFlaSvgAsset(project, asset);
    if (
      asset.kind !== 'image' ||
      (mimeType !== 'image/png' && mimeType !== 'image/jpeg' && (mimeType !== 'image/svg+xml' || !generatedFlaSvg))
    ) {
      return this.failure(
        'ASSET_CANVAS_IMAGE_READ_FAILED',
        request.assetId,
        'The asset is not a supported PNG or JPEG image.',
      );
    }

    let sourcePath: string | null;
    try {
      sourcePath = await this.resolveAssetPath(
        request.projectRoot,
        asset.relativePath,
        generatedFlaSvg,
      );
    } catch (error) {
      const permissionCode = filesystemPermissionErrorCode(error);
      return this.failure(
        generatedFlaSvg && isMissingPathError(error)
          ? 'ASSET_CANVAS_IMAGE_SOURCE_MISSING'
          : 'ASSET_CANVAS_IMAGE_READ_FAILED',
        request.assetId,
        permissionCode
          ? `Unable to read the original canvas image (${permissionCode}).`
          : 'The asset source is missing or outside the project assets directory.',
        generatedFlaSvg ? asset.relativePath : undefined,
      );
    }
    if (!sourcePath) {
      return this.failure(
        'ASSET_CANVAS_IMAGE_READ_FAILED',
        request.assetId,
        'The asset source is missing or outside the project assets directory.',
        generatedFlaSvg ? asset.relativePath : undefined,
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

      if (!generatedFlaSvg) {
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
      if (generatedFlaSvg && !isSafeGeneratedFlaSvg(bytes, asset.width, asset.height)) {
        throw new Error('The FLA Graphic vector frame is not a bounded Panda-generated SVG.');
      }
      const actualSha256 = createHash('sha256')
        .update(bytes)
        .digest('hex');
      if (actualSha256 !== request.sha256) {
        return this.failure(
          'ASSET_CANVAS_IMAGE_HASH_MISMATCH',
          request.assetId,
          'The source file hash does not match the project asset.',
          generatedFlaSvg ? asset.relativePath : undefined,
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
      const permissionCode = filesystemPermissionErrorCode(error);
      return this.failure(
        'ASSET_CANVAS_IMAGE_READ_FAILED',
        request.assetId,
        permissionCode
          ? `Unable to read the original canvas image (${permissionCode}).`
          : `Unable to read the original canvas image: ${this.errorText(error)}`,
        generatedFlaSvg ? asset.relativePath : undefined,
      );
    }
  }

  private async resolveAssetPath(
    projectRoot: string,
    relativePath: string,
    generatedFlaSvg: boolean,
  ): Promise<string | null> {
    return resolveProjectAssetPath(projectRoot, relativePath, {
      preservePermissionErrors: true,
      preserveMissingErrors: generatedFlaSvg,
    });
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
      | 'ASSET_CANVAS_IMAGE_SOURCE_MISSING'
      | 'ASSET_CANVAS_IMAGE_READ_FAILED',
    assetId: string,
    message: string,
    relativePath?: string,
  ): AssetCanvasImageReadResponse {
    return {
      ok: false,
      error: {
        code,
        message: this.errorText(message).slice(0, 1_000),
        assetId: this.errorText(assetId).slice(0, 200),
        ...(relativePath ? { relativePath } : {}),
      },
    };
  }
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

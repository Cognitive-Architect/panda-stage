import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { ProjectSchema, type Project } from '../../domain';
import {
  ASSET_PREVIEW_AUDIO_MAX_BYTES,
  AssetPreviewAudioReadRequestSchema,
  type AssetPreviewAudioReadRequest,
  type AssetPreviewAudioReadResponse,
} from '../../shared/asset-preview-audio-api';
import { MediaInspectionService } from './MediaInspectionService';

export interface AssetPreviewAudioServiceOptions {
  getCurrentProjectSnapshot: (
    projectRoot: string,
  ) => { project: Project } | null;
  inspectionService?: MediaInspectionService;
}

/**
 * Secure, read-only bridge for Product Preview audio.
 *
 * The renderer supplies the project-root/asset/hash tuple that it already
 * owns. Main re-checks the tracked Project, the asset kind and hash, the
 * assets-directory containment, media signature, size, and final content hash
 * before returning bytes. The response deliberately contains no filesystem
 * path or raw error text.
 */
export class AssetPreviewAudioService {
  private readonly getCurrentProjectSnapshot: (
    projectRoot: string,
  ) => { project: Project } | null;
  private readonly inspectionService: MediaInspectionService;
  private readonly activeReads = new Map<
    string,
    Promise<AssetPreviewAudioReadResponse>
  >();

  constructor(options: AssetPreviewAudioServiceOptions) {
    this.getCurrentProjectSnapshot = options.getCurrentProjectSnapshot;
    this.inspectionService =
      options.inspectionService ?? new MediaInspectionService();
  }

  read(rawRequest: unknown): Promise<AssetPreviewAudioReadResponse> {
    let request: AssetPreviewAudioReadRequest;
    try {
      request = AssetPreviewAudioReadRequestSchema.parse(rawRequest);
    } catch {
      return Promise.resolve(
        this.failure(
          'ASSET_PREVIEW_AUDIO_INVALID_REQUEST',
          this.requestAssetId(rawRequest),
          'Audio preview request is invalid.',
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
    request: AssetPreviewAudioReadRequest,
  ): Promise<AssetPreviewAudioReadResponse> {
    let snapshot: { project: Project } | null;
    try {
      snapshot = this.getCurrentProjectSnapshot(request.projectRoot);
    } catch {
      return this.failure(
        'ASSET_PREVIEW_AUDIO_READ_FAILED',
        request.assetId,
        'Unable to read the current project snapshot.',
      );
    }
    if (!snapshot) {
      return this.failure(
        'ASSET_PREVIEW_AUDIO_PROJECT_NOT_TRACKED',
        request.assetId,
        'The project is not currently tracked by the Main Process.',
      );
    }

    let project: Project;
    try {
      project = ProjectSchema.parse(snapshot.project);
    } catch {
      return this.failure(
        'ASSET_PREVIEW_AUDIO_READ_FAILED',
        request.assetId,
        'The current project snapshot is invalid.',
      );
    }

    const asset = project.assets.find(
      (candidate) => candidate.id === request.assetId,
    );
    if (!asset) {
      return this.failure(
        'ASSET_PREVIEW_AUDIO_ASSET_NOT_FOUND',
        request.assetId,
        'The project does not contain this asset.',
      );
    }
    if (asset.kind !== 'audio') {
      return this.failure(
        'ASSET_PREVIEW_AUDIO_NOT_AUDIO',
        request.assetId,
        'The project asset is not audio.',
      );
    }
    if (asset.sha256 !== request.sha256) {
      return this.failure(
        'ASSET_PREVIEW_AUDIO_HASH_MISMATCH',
        request.assetId,
        'The asset content hash no longer matches the current project.',
      );
    }
    if (asset.mimeType !== 'audio/mpeg' && asset.mimeType !== 'audio/wav') {
      return this.failure(
        'ASSET_PREVIEW_AUDIO_READ_FAILED',
        request.assetId,
        'The asset MIME type is not supported for preview.',
      );
    }

    const sourcePath = await this.resolveAssetPath(
      request.projectRoot,
      asset.relativePath,
    );
    if (!sourcePath) {
      return this.failure(
        'ASSET_PREVIEW_AUDIO_READ_FAILED',
        request.assetId,
        'The audio source is missing or outside the project assets directory.',
      );
    }

    try {
      const sourceStats = await stat(sourcePath);
      if (!sourceStats.isFile() || sourceStats.size <= 0) {
        throw new Error('not a regular non-empty file');
      }
      if (sourceStats.size > ASSET_PREVIEW_AUDIO_MAX_BYTES) {
        throw new Error('source exceeds preview limit');
      }

      const inspected = await this.inspectionService.inspect(
        sourcePath,
        asset.mimeType,
      );
      if (
        inspected.kind !== 'audio' ||
        inspected.mimeType !== asset.mimeType
      ) {
        throw new Error('source media metadata does not match the project');
      }

      const bytes = await readFile(sourcePath);
      if (
        bytes.byteLength === 0 ||
        bytes.byteLength > ASSET_PREVIEW_AUDIO_MAX_BYTES
      ) {
        throw new Error('source byte length is outside the preview limit');
      }
      const actualSha256 = createHash('sha256')
        .update(bytes)
        .digest('hex');
      if (actualSha256 !== request.sha256) {
        return this.failure(
          'ASSET_PREVIEW_AUDIO_HASH_MISMATCH',
          request.assetId,
          'The source file hash does not match the project asset.',
        );
      }

      return {
        ok: true,
        status: 'ready',
        assetId: request.assetId,
        mimeType: asset.mimeType,
        byteLength: bytes.byteLength,
        bytes: new Uint8Array(bytes),
      };
    } catch {
      return this.failure(
        'ASSET_PREVIEW_AUDIO_READ_FAILED',
        request.assetId,
        'Unable to read and validate the audio source.',
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
        typeof rawRequest.assetId === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
          rawRequest.assetId,
        )
      ) {
        return rawRequest.assetId;
      }
    } catch {
      // Treat hostile accessors as an invalid request without exposing them.
    }
    return '(invalid)';
  }

  private failure(
    code:
      | 'ASSET_PREVIEW_AUDIO_INVALID_REQUEST'
      | 'ASSET_PREVIEW_AUDIO_PROJECT_NOT_TRACKED'
      | 'ASSET_PREVIEW_AUDIO_ASSET_NOT_FOUND'
      | 'ASSET_PREVIEW_AUDIO_NOT_AUDIO'
      | 'ASSET_PREVIEW_AUDIO_HASH_MISMATCH'
      | 'ASSET_PREVIEW_AUDIO_READ_FAILED',
    assetId: string,
    message: string,
  ): AssetPreviewAudioReadResponse {
    return {
      ok: false,
      error: {
        code,
        // eslint-disable-next-line no-control-regex
        message: message.replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 1_000),
        assetId: assetId.slice(0, 200),
      },
    };
  }
}

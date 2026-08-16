import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { ProjectSchema, type Project } from '../../domain';
import {
  ASSET_AUDIO_MAX_BYTES,
  AssetAudioReadRequestSchema,
  type AssetAudioReadErrorCode,
  type AssetAudioReadRequest,
  type AssetAudioReadResponse,
} from '../../shared/asset-audio-api';

export interface AssetAudioSourceServiceOptions {
  getCurrentProjectSnapshot: (
    projectRoot: string,
  ) => { project: Project } | null;
}

/** Reads a project-owned audio file into a bounded data URL for preview only. */
export class AssetAudioSourceService {
  private readonly getCurrentProjectSnapshot: (
    projectRoot: string,
  ) => { project: Project } | null;

  constructor(options: AssetAudioSourceServiceOptions) {
    this.getCurrentProjectSnapshot = options.getCurrentProjectSnapshot;
  }

  async read(rawRequest: unknown): Promise<AssetAudioReadResponse> {
    let request: AssetAudioReadRequest;
    try {
      request = AssetAudioReadRequestSchema.parse(rawRequest);
    } catch {
      return this.failure(
        'ASSET_AUDIO_INVALID_REQUEST',
        this.requestAssetId(rawRequest),
        'Audio source request is invalid.',
      );
    }

    let snapshot: { project: Project } | null;
    try {
      snapshot = this.getCurrentProjectSnapshot(request.projectRoot);
    } catch (error) {
      return this.failure(
        'ASSET_AUDIO_READ_FAILED',
        request.assetId,
        `Unable to read the current project snapshot: ${this.errorText(error)}`,
      );
    }
    if (!snapshot) {
      return this.failure(
        'ASSET_AUDIO_PROJECT_NOT_TRACKED',
        request.assetId,
        'The project is not currently tracked by the Main Process.',
      );
    }

    let project: Project;
    try {
      project = ProjectSchema.parse(snapshot.project);
    } catch (error) {
      return this.failure(
        'ASSET_AUDIO_READ_FAILED',
        request.assetId,
        `The current project snapshot is invalid: ${this.errorText(error)}`,
      );
    }
    const asset = project.assets.find(
      (candidate) => candidate.id === request.assetId,
    );
    if (!asset) {
      return this.failure(
        'ASSET_AUDIO_ASSET_NOT_FOUND',
        request.assetId,
        'The project does not contain this asset.',
      );
    }
    if (asset.kind !== 'audio' || !asset.mimeType.startsWith('audio/')) {
      return this.failure(
        'ASSET_AUDIO_ASSET_INVALID',
        request.assetId,
        'The project asset is not a supported audio source.',
      );
    }
    if (asset.sha256 !== request.sha256) {
      return this.failure(
        'ASSET_AUDIO_HASH_MISMATCH',
        request.assetId,
        'The source file hash does not match the project asset.',
      );
    }

    const sourcePath = await this.resolveAssetPath(
      request.projectRoot,
      asset.relativePath,
    );
    if (!sourcePath) {
      return this.failure(
        'ASSET_AUDIO_SOURCE_MISSING',
        request.assetId,
        'The audio source is missing or outside the project assets directory.',
      );
    }

    try {
      const sourceStats = await stat(sourcePath);
      if (!sourceStats.isFile() || sourceStats.size <= 0) {
        return this.failure(
          'ASSET_AUDIO_SOURCE_MISSING',
          request.assetId,
          'The audio source is not a non-empty regular file.',
        );
      }
      if (sourceStats.size > ASSET_AUDIO_MAX_BYTES) {
        return this.failure(
          'ASSET_AUDIO_TOO_LARGE',
          request.assetId,
          `The audio source exceeds the ${ASSET_AUDIO_MAX_BYTES}-byte preview limit.`,
        );
      }
      const bytes = await readFile(sourcePath);
      if (bytes.byteLength > ASSET_AUDIO_MAX_BYTES) {
        return this.failure(
          'ASSET_AUDIO_TOO_LARGE',
          request.assetId,
          `The audio source exceeds the ${ASSET_AUDIO_MAX_BYTES}-byte preview limit.`,
        );
      }
      const actualSha256 = createHash('sha256').update(bytes).digest('hex');
      if (actualSha256 !== request.sha256) {
        return this.failure(
          'ASSET_AUDIO_HASH_MISMATCH',
          request.assetId,
          'The source file hash does not match the project asset.',
        );
      }
      return {
        ok: true,
        status: 'ready',
        assetId: asset.id,
        mimeType: asset.mimeType,
        byteLength: bytes.byteLength,
        dataUrl: `data:${asset.mimeType};base64,${bytes.toString('base64')}`,
      };
    } catch (error) {
      return this.failure(
        'ASSET_AUDIO_READ_FAILED',
        request.assetId,
        `Unable to read the audio source: ${this.errorText(error)}`,
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
    if (
      typeof rawRequest === 'object' &&
      rawRequest !== null &&
      'assetId' in rawRequest &&
      typeof rawRequest.assetId === 'string'
    ) {
      return rawRequest.assetId;
    }
    return '(invalid)';
  }

  private errorText(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return Array.from(message, (character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f ? ' ' : character;
    }).join('').slice(0, 900);
  }

  private failure(
    code: AssetAudioReadErrorCode,
    assetId: string,
    message: string,
  ): AssetAudioReadResponse {
    return {
      ok: false,
      error: {
        code,
        message: this.errorText(message).trim() || 'Audio source read failed.',
        assetId: this.errorText(assetId).slice(0, 200),
      },
    } as AssetAudioReadResponse;
  }
}

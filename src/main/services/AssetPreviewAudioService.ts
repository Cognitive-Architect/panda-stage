import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { mkdtemp, readFile, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { DialogueSilenceIntervalsSchema, type DialogueSilenceIntervals } from '../../shared/dialogue-silence';
import type { FFmpegAdapter } from './FFmpegAdapter';
import path from 'node:path';
import { ProjectSchema, type Project } from '../../domain';
import {
  ASSET_PREVIEW_AUDIO_MAX_BYTES,
  AssetDialogueSilenceRequestSchema,
  type AssetDialogueSilenceRequest,
  AssetPreviewAudioReadRequestSchema,
  type AssetPreviewAudioErrorResponse,
  type AssetPreviewAudioInfoResponse,
  type AssetPreviewAudioReadRequest,
  type AssetPreviewAudioReadResponse,
} from '../../shared/asset-preview-audio-api';
import { MediaInspectionService } from './MediaInspectionService';
import { filesystemPermissionErrorCode } from './filesystem-permission-error';
import { resolveProjectAssetPath } from './project-asset-path';

import { MOUTH_POSE_SAMPLE_RATE, MouthPoseAnalysisRequestSchema, type MouthPoseAnalysisResponse } from '../../shared/mouth-pose-analysis-api';
import { analyzeMouthPosePcm } from './analyze-mouth-pose-pcm';

export interface AssetPreviewAudioServiceOptions {
  getCurrentProjectSnapshot: (
    projectRoot: string,
  ) => { project: Project } | null;
  inspectionService?: MediaInspectionService;
  /** Reuse only a successful hash check for the same immutable project/file identity. */
  enableValidatedHashIndex?: boolean;
  audioTiming?: Pick<FFmpegAdapter, 'analyzeAudioTiming'> & Partial<Pick<FFmpegAdapter, 'decodeMouthPosePcm'>>;
}

export interface AssetPreviewAudioHashIndexSnapshot {
  enabled: boolean;
  entries: number;
  hits: number;
  misses: number;
  sha256Computations: number;
  evictions: number;
}

const ASSET_PREVIEW_AUDIO_HASH_INDEX_MAX_ENTRIES = 32;
const MIN_DIALOGUE_PAUSE_MS = 240;
const MAX_BRIDGED_SOUND_MS = 40;

/**
 * Secure, read-only bridge prepared for the later Product Preview phase.
 * Main revalidates project identity, asset kind/hash, path containment, media
 * signature and a byte limit; no filesystem path or raw error crosses IPC.
 */
export class AssetPreviewAudioService {
  private readonly getCurrentProjectSnapshot: (
    projectRoot: string,
  ) => { project: Project } | null;
  private readonly inspectionService: MediaInspectionService;
  private readonly enableValidatedHashIndex: boolean;
  private readonly validatedHashes = new Map<string, string>();
  private readonly audioTiming: AssetPreviewAudioServiceOptions['audioTiming'];
  private readonly mouthPoseJobs = new Map<string, AbortController>();
  private readonly silenceBySource = new Map<string, Promise<DialogueSilenceIntervals | null>>();
  private hashIndexHits = 0;
  private hashIndexMisses = 0;
  private sha256Computations = 0;
  private hashIndexEvictions = 0;
  private readonly activeReads = new Map<
    string,
    Promise<AssetPreviewAudioReadResponse>
  >();

  constructor(options: AssetPreviewAudioServiceOptions) {
    this.getCurrentProjectSnapshot = options.getCurrentProjectSnapshot;
    this.inspectionService =
      options.inspectionService ?? new MediaInspectionService();
    this.enableValidatedHashIndex = options.enableValidatedHashIndex ?? false;
    this.audioTiming = options.audioTiming;
  }

  getHashValidationIndexSnapshot(): AssetPreviewAudioHashIndexSnapshot {
    return {
      enabled: this.enableValidatedHashIndex,
      entries: this.validatedHashes.size,
      hits: this.hashIndexHits,
      misses: this.hashIndexMisses,
      sha256Computations: this.sha256Computations,
      evictions: this.hashIndexEvictions,
    };
  }

  async analyzeDialogueSilence(rawRequest: unknown): Promise<DialogueSilenceIntervals | null> {
    const request = AssetDialogueSilenceRequestSchema.parse(rawRequest);
    if (!this.audioTiming) return null;
    const snapshot = this.getCurrentProjectSnapshot(request.projectRoot);
    const asset = snapshot?.project.assets.find(candidate => candidate.id === request.assetId);
    if (asset?.kind !== 'audio' || asset.sha256 !== request.sha256) return null;
    const key = JSON.stringify([request.projectRoot, request.assetId, request.sha256]);
    const pending = this.silenceBySource.get(key);
    if (pending) return pending;

    const analysis = this.readDialogueSilence(request, asset.durationMs).catch(() => null);
    this.silenceBySource.set(key, analysis);
    if (this.silenceBySource.size > ASSET_PREVIEW_AUDIO_HASH_INDEX_MAX_ENTRIES) {
      const oldest = this.silenceBySource.keys().next().value;
      if (oldest !== undefined) this.silenceBySource.delete(oldest);
    }
    return analysis;
  }

  cancelMouthPoseAnalysis(requestId: string): void {
    this.mouthPoseJobs.get(requestId)?.abort();
  }

  async analyzeMouthPoses(rawRequest: unknown): Promise<MouthPoseAnalysisResponse> {
    const request = MouthPoseAnalysisRequestSchema.parse(rawRequest);
    if (!this.audioTiming?.decodeMouthPosePcm || this.mouthPoseJobs.size >= 2 ||
        this.mouthPoseJobs.has(request.requestId)) return null;
    const controller = new AbortController();
    this.mouthPoseJobs.set(request.requestId, controller);
    let directory: string | undefined;
    let input: string | undefined;
    let output: string | undefined;
    try {
      const source = await this.read({
        projectRoot: request.projectRoot, assetId: request.assetId, sha256: request.sha256,
      });
      controller.signal.throwIfAborted();
      if (!source.ok) return null;
      directory = await mkdtemp(path.join(tmpdir(), 'panda-mouth-pose-'));
      input = path.join(directory, source.mimeType === 'audio/wav' ? 'source.wav' : 'source.mp3');
      output = path.join(directory, 'voice.s16le');
      await writeFile(input, source.bytes, { flag: 'wx' });
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
      await this.audioTiming.decodeMouthPosePcm(input, output, request.sourceStartMs, request.durationMs, signal);
      const info = await stat(output);
      const maximumBytes = 2 * Math.ceil(request.durationMs * MOUTH_POSE_SAMPLE_RATE / 1000);
      if (info.size <= 0 || info.size > maximumBytes + 2) return null;
      const pcm = await readFile(output);
      signal.throwIfAborted();
      return analyzeMouthPosePcm(pcm, request.durationMs);
    } catch {
      return null;
    } finally {
      this.mouthPoseJobs.delete(request.requestId);
      if (output) await unlink(output).catch(() => undefined);
      if (input) await unlink(input).catch(() => undefined);
      if (directory) await rmdir(directory).catch(() => undefined);
    }
  }

  private async readDialogueSilence(
    request: AssetDialogueSilenceRequest,
    durationMs?: number,
  ): Promise<DialogueSilenceIntervals | null> {
    const source = await this.read(request);
    if (!source.ok || !this.audioTiming) return null;
    // Analyze the same verified bytes that the preview audio reader would use.
    const directory = await mkdtemp(path.join(tmpdir(), 'panda-dialogue-'));
    const file = path.join(directory, source.mimeType === 'audio/wav' ? 'source.wav' : 'source.mp3');
    try {
      await writeFile(file, source.bytes, { flag: 'wx' });
      const timing = await this.audioTiming.analyzeAudioTiming(file, AbortSignal.timeout(20_000));
      const starts = timing.silenceStartsSeconds;
      const ends = timing.silenceEndsSeconds;
      if (ends.length > starts.length || starts.length - ends.length > 1) return null;
      const joined: DialogueSilenceIntervals = [];
      for (const [index, seconds] of starts.entries()) {
        const start = Math.round(seconds * 1_000);
        const end = ends[index] === undefined ? durationMs : Math.min(
          durationMs ?? Number.POSITIVE_INFINITY, Math.round(ends[index]! * 1_000),
        );
        if (end === undefined) continue;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= end) return null;
        const prior = joined.at(-1);
        if (prior && start < prior[0]) return null;
        if (prior && start - prior[1] <= MAX_BRIDGED_SOUND_MS) prior[1] = Math.max(prior[1], end);
        else joined.push([start, end]);
      }
      return DialogueSilenceIntervalsSchema.parse(joined.filter(([start, end]) => end - start >= MIN_DIALOGUE_PAUSE_MS));
    } finally {
      await unlink(file).catch(() => undefined);
      await rmdir(directory).catch(() => undefined);
    }
  }

  async getInfo(rawRequest: unknown): Promise<AssetPreviewAudioInfoResponse> {
    let request: AssetPreviewAudioReadRequest;
    try {
      request = AssetPreviewAudioReadRequestSchema.parse(rawRequest);
    } catch {
      return this.failure(
        'ASSET_PREVIEW_AUDIO_INVALID_REQUEST',
        this.requestAssetId(rawRequest),
        'Audio preview request is invalid.',
      );
    }

    let snapshot: { project: Project } | null;
    try {
      snapshot = this.getCurrentProjectSnapshot(request.projectRoot);
    } catch {
      return this.failure(
        'ASSET_PREVIEW_AUDIO_READ_FAILED', request.assetId,
        'Unable to read the current project snapshot.',
      );
    }
    if (!snapshot) {
      return this.failure(
        'ASSET_PREVIEW_AUDIO_PROJECT_NOT_TRACKED', request.assetId,
        'The project is not currently tracked by the Main Process.',
      );
    }

    let project: Project;
    try {
      project = ProjectSchema.parse(snapshot.project);
    } catch {
      return this.failure(
        'ASSET_PREVIEW_AUDIO_READ_FAILED', request.assetId,
        'The current project snapshot is invalid.',
      );
    }
    const asset = project.assets.find((candidate) => candidate.id === request.assetId);
    if (!asset) {
      return this.failure(
        'ASSET_PREVIEW_AUDIO_ASSET_NOT_FOUND', request.assetId,
        'The project does not contain this asset.',
      );
    }
    if (asset.kind !== 'audio') {
      return this.failure(
        'ASSET_PREVIEW_AUDIO_NOT_AUDIO', request.assetId,
        'The project asset is not audio.',
      );
    }
    if (asset.sha256 !== request.sha256) {
      return this.failure(
        'ASSET_PREVIEW_AUDIO_HASH_MISMATCH', request.assetId,
        'The asset content hash no longer matches the current project.',
      );
    }
    if (asset.mimeType !== 'audio/mpeg' && asset.mimeType !== 'audio/wav') {
      return this.failure(
        'ASSET_PREVIEW_AUDIO_READ_FAILED', request.assetId,
        'The asset MIME type is not supported for preview.',
      );
    }

    try {
      const sourcePath = await this.resolveAssetPath(request.projectRoot, asset.relativePath);
      if (!sourcePath) throw new Error('audio source is outside project assets');
      const before = await stat(sourcePath, { bigint: true });
      if (!before.isFile() || before.size <= 0n || before.size > BigInt(ASSET_PREVIEW_AUDIO_MAX_BYTES)) {
        throw new Error('audio source size is outside preview limits');
      }
      if (request.expectedByteLength !== undefined && before.size !== BigInt(request.expectedByteLength)) {
        throw new Error('audio source size changed after preview preflight');
      }
      const after = await stat(sourcePath, { bigint: true });
      const beforeFingerprint = this.fileFingerprint(before);
      const afterFingerprint = this.fileFingerprint(after);
      if (!beforeFingerprint || beforeFingerprint !== afterFingerprint) {
        throw new Error('audio source changed while its size was measured');
      }
      return {
        ok: true,
        status: 'ready',
        assetId: asset.id,
        mimeType: asset.mimeType,
        byteLength: Number(after.size),
      };
    } catch (error) {
      const permissionCode = filesystemPermissionErrorCode(error);
      return this.failure(
        'ASSET_PREVIEW_AUDIO_READ_FAILED', request.assetId,
        permissionCode
          ? `Unable to inspect the audio source (${permissionCode}).`
          : 'The audio source is missing, unstable, or outside the project assets directory.',
      );
    }
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

    let sourcePath: string | null;
    try {
      sourcePath = await this.resolveAssetPath(
        request.projectRoot,
        asset.relativePath,
      );
    } catch (error) {
      const permissionCode = filesystemPermissionErrorCode(error);
      return this.failure(
        'ASSET_PREVIEW_AUDIO_READ_FAILED',
        request.assetId,
        permissionCode
          ? `Unable to read and validate the audio source (${permissionCode}).`
          : 'The audio source is missing or outside the project assets directory.',
      );
    }
    if (!sourcePath) {
      return this.failure(
        'ASSET_PREVIEW_AUDIO_READ_FAILED',
        request.assetId,
        'The audio source is missing or outside the project assets directory.',
      );
    }

    try {
      const sourceStats = await stat(sourcePath, { bigint: true });
      if (!sourceStats.isFile() || sourceStats.size <= 0n) {
        throw new Error('not a regular non-empty file');
      }
      if (sourceStats.size > BigInt(ASSET_PREVIEW_AUDIO_MAX_BYTES)) {
        throw new Error('source exceeds preview limit');
      }
      if (request.expectedByteLength !== undefined && sourceStats.size !== BigInt(request.expectedByteLength)) {
        throw new Error('source size changed after preview preflight');
      }
      const inspected = await this.inspectionService.inspect(
        sourcePath,
        asset.mimeType,
      );
      if (inspected.kind !== 'audio' || inspected.mimeType !== asset.mimeType) {
        throw new Error('source media metadata does not match the project');
      }
      const bytes = await readFile(sourcePath);
      if (
        bytes.byteLength === 0 ||
        bytes.byteLength > ASSET_PREVIEW_AUDIO_MAX_BYTES
      ) {
        throw new Error('source byte length is outside the preview limit');
      }
      const afterReadStats = await stat(sourcePath, { bigint: true });
      const beforeFingerprint = this.fileFingerprint(sourceStats);
      const afterFingerprint = this.fileFingerprint(afterReadStats);
      const stableFile = beforeFingerprint !== null && beforeFingerprint === afterFingerprint &&
        BigInt(bytes.byteLength) === afterReadStats.size;
      const hashIndexKey = this.hashIndexKey(request, project, asset.id, sourcePath);
      const indexedFingerprint = this.enableValidatedHashIndex
        ? this.validatedHashes.get(hashIndexKey) ?? null
        : null;
      const hashIndexHit = this.enableValidatedHashIndex && stableFile &&
        indexedFingerprint !== null && indexedFingerprint === afterFingerprint;
      if (hashIndexHit) {
        this.hashIndexHits += 1;
        this.validatedHashes.delete(hashIndexKey);
        this.validatedHashes.set(hashIndexKey, afterFingerprint);
      } else {
        if (this.enableValidatedHashIndex) {
          this.hashIndexMisses += 1;
          this.validatedHashes.delete(hashIndexKey);
        }
        this.sha256Computations += 1;
        const actualSha256 = createHash('sha256').update(bytes).digest('hex');
        if (actualSha256 !== request.sha256) {
          return this.failure(
            'ASSET_PREVIEW_AUDIO_HASH_MISMATCH',
            request.assetId,
            'The source file hash does not match the project asset.',
          );
        }
        if (this.enableValidatedHashIndex && stableFile && afterFingerprint) {
          this.validatedHashes.set(hashIndexKey, afterFingerprint);
          while (this.validatedHashes.size > ASSET_PREVIEW_AUDIO_HASH_INDEX_MAX_ENTRIES) {
            const oldestKey = this.validatedHashes.keys().next().value;
            if (oldestKey === undefined) break;
            this.validatedHashes.delete(oldestKey);
            this.hashIndexEvictions += 1;
          }
        }
      }
      return {
        ok: true,
        status: 'ready',
        assetId: request.assetId,
        mimeType: asset.mimeType,
        byteLength: bytes.byteLength,
        bytes,
      };
    } catch (error) {
      const permissionCode = filesystemPermissionErrorCode(error);
      return this.failure(
        'ASSET_PREVIEW_AUDIO_READ_FAILED',
        request.assetId,
        permissionCode
          ? `Unable to read and validate the audio source (${permissionCode}).`
          : 'Unable to read and validate the audio source.',
      );
    }
  }

  private async resolveAssetPath(
    projectRoot: string,
    relativePath: string,
  ): Promise<string | null> {
    return resolveProjectAssetPath(projectRoot, relativePath, {
      preservePermissionErrors: true,
    });
  }

  private hashIndexKey(
    request: AssetPreviewAudioReadRequest,
    project: Project,
    assetId: string,
    sourcePath: string,
  ): string {
    return [path.resolve(request.projectRoot), project.id, project.updatedAt, assetId,
      request.sha256, path.resolve(sourcePath)].join('\u0000');
  }

  private fileFingerprint(stats: BigIntStats): string | null {
    if (stats.ino === 0n) return null;
    return [stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs, stats.birthtimeNs].join(':');
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
      // Hostile accessors are treated as an invalid request.
    }
    return '(invalid)';
  }

  private failure(
    code: AssetPreviewAudioErrorResponse['error']['code'],
    assetId: string,
    message: string,
  ): AssetPreviewAudioErrorResponse {
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

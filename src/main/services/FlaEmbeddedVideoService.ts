import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AudioClipService,
  evaluateShotAtTime,
  ProjectSchema,
  type AudioAsset,
  type Layer,
  type Project,
  type Shot,
  type VideoAsset,
} from '../../domain';
import { sanitizeAssetFileName } from '../../shared/asset-name';
import type { AssetFileExtension } from '../../shared/asset-name';
import {
  evaluateFlaVideoClock,
  parseFlaVideoFrameAssetKey,
  planEmbeddedVideoAudioClips,
  type FlaVideoClockSample,
  type FlaVideoNestedHostClock,
} from '../../shared/fla-video-clock';
import type { FFmpegAdapter } from './FFmpegAdapter';
import type { FlaImportService } from './FlaImportService';
import type { ProjectService } from './ProjectService';
import { resolveProjectAssetPath } from './project-asset-path';

export interface ImportEmbeddedVideoInput {
  readonly sessionId: string;
  readonly videoName: string;
  readonly projectRoot: string;
  readonly shotId: string;
  readonly startTimeMs?: number;
  readonly playbackMode?: 'play-once' | 'loop' | 'single-frame';
  readonly trimStartMs?: number;
  readonly trimEndMs?: number;
  readonly heldFrameIndex?: number;
  readonly sourceFps?: number;
  readonly includeAudio?: boolean;
  readonly x?: number;
  readonly y?: number;
  readonly signal?: AbortSignal;
}

export interface ImportEmbeddedVideoResult {
  readonly ok: true;
  readonly project: Project;
  readonly videoAsset: VideoAsset;
  readonly layer: Layer;
  readonly audioAsset?: AudioAsset;
  readonly audioClipId?: string;
  readonly audioClipIds?: readonly string[];
  readonly diagnostics?: readonly string[];
  readonly reusedVideoAsset: boolean;
}

export interface ReadVideoSampleFrameResult {
  readonly ok: true;
  readonly assetId: string;
  readonly sampleIndex: number;
  readonly mimeType: 'image/png';
  readonly bytes: Uint8Array;
  readonly fromCache: boolean;
}

export interface ReadVideoSampleFrameFailure {
  readonly ok: false;
  readonly code: 'STALE_REQUEST' | 'ASSET_MISSING' | 'DECODE_FAILED' | 'CANCELLED';
  readonly message: string;
}

interface DecodedSequenceEntry {
  readonly key: string;
  readonly directory: string;
  readonly framePaths: readonly string[];
  lastUsedAt: number;
}

const MAX_CACHED_VIDEO_SEQUENCES = 8;
const MAX_CACHED_PNG_BYTES = 64;

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function extensionForVideoMime(mimeType: string): '.mp4' | '.mov' | '.webm' {
  if (mimeType === 'video/quicktime') return '.mov';
  if (mimeType === 'video/webm') return '.webm';
  return '.mp4';
}

async function writeUniqueProjectAsset(
  projectRoot: string,
  baseName: string,
  extension: '.mp4' | '.mov' | '.webm' | '.wav',
  bytes: Uint8Array,
): Promise<string> {
  const assetsDir = path.join(projectRoot, 'assets');
  await mkdir(assetsDir, { recursive: true });
  const sanitizedBase = sanitizeAssetFileName(baseName, '.wav' as AssetFileExtension);
  const parsedBase = path.parse(sanitizedBase);
  for (let suffix = 0; suffix < 1_000; suffix += 1) {
    const candidateName = suffix === 0
      ? `${parsedBase.name}${extension}`
      : `${parsedBase.name}-${suffix + 1}${extension}`;
    const candidatePath = path.join(assetsDir, candidateName);
    const exists = await stat(candidatePath).then(() => true, () => false);
    if (exists) continue;
    const tempPath = path.join(assetsDir, `.tmp-${randomUUID()}${extension}`);
    try {
      await writeFile(tempPath, bytes, { flag: 'wx' });
      await rename(tempPath, candidatePath);
      return `assets/${candidateName}`;
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
  throw new Error('Unable to allocate a unique asset path in project assets directory.');
}

/**
 * Formal embedded-video lifecycle owner (E-F04 / E07-A):
 * - Ingests native FLA embedded video into formal project assets + Video Layer
 *   (and optional synchronized AudioAsset/AudioClip when hasAudio).
 * - Decodes frames sequentially in ONE FFmpeg call per asset (never per-frame
 *   FFmpeg spawning) with bounded cache, cancellation, stale-seek protection,
 *   and local failure isolation.
 */
export class FlaEmbeddedVideoService {
  private readonly decodedSequences = new Map<string, DecodedSequenceEntry>();
  private readonly inFlightDecodes = new Map<string, Promise<DecodedSequenceEntry>>();
  private readonly framePngCache = new Map<string, { readonly bytes: Uint8Array; lastUsedAt: number }>();
  private readonly latestTokenByAsset = new Map<string, number>();

  constructor(
    private readonly deps: {
      readonly flaImportService?: Pick<FlaImportService, 'prepareEmbeddedVideo'>;
      readonly projectService?: Pick<ProjectService, 'open' | 'save'>;
      readonly ffmpegAdapter: Pick<
        FFmpegAdapter,
        'probeFlaNativeVideo' | 'decodeFlaVideoFramesSequential' | 'extractFlaVideoAudioTrack' | 'probeAudioFile'
      >;
      readonly audioClipService?: AudioClipService;
    },
  ) {}

  /**
   * Formal product loop: extract native embedded video from an active FLA session,
   * persist the original media into <projectRoot>/assets/, register VideoAsset +
   * optional AudioAsset/AudioClip + Video Layer, and save project.json atomically.
   */
  async importFromFlaSession(
    input: ImportEmbeddedVideoInput,
  ): Promise<ImportEmbeddedVideoResult> {
    const signal = input.signal ?? new AbortController().signal;
    signal.throwIfAborted();
    if (!this.deps.flaImportService || !this.deps.projectService) {
      throw new Error('FlaImportService and ProjectService are required for FLA embedded video import.');
    }
    const prepared = await this.deps.flaImportService.prepareEmbeddedVideo(
      input.sessionId,
      input.videoName,
      this.deps.ffmpegAdapter,
      signal,
    );
    if (!prepared) {
      throw new Error(`Embedded video "${input.videoName}" could not be extracted from FLA session.`);
    }
    signal.throwIfAborted();

    const opened = await this.deps.projectService.open(input.projectRoot);
    const project = ProjectSchema.parse(opened.project);
    const shotIndex = project.shots.findIndex((shot) => shot.id === input.shotId);
    if (shotIndex < 0) {
      throw new Error(`Target Shot "${input.shotId}" was not found in project.`);
    }
    const shot = project.shots[shotIndex]!;
    const mediaSha256 = sha256Hex(prepared.bytes);
    const ext = extensionForVideoMime(prepared.mimeType);
    const firstTick = prepared.metadata.presentationTicks[0]!;
    const durationMs = Math.max(
      1,
      Math.round(
        ((prepared.metadata.endTick - firstTick) * prepared.metadata.timeBase.numerator * 1_000) /
          prepared.metadata.timeBase.denominator,
      ),
    );

    const existingVideo = project.assets.find(
      (asset): asset is VideoAsset => asset.kind === 'video' && asset.sha256 === mediaSha256,
    );
    let videoAsset: VideoAsset;
    let reusedVideoAsset = false;
    let nextAssets = [...project.assets];

    if (existingVideo) {
      videoAsset = existingVideo;
      reusedVideoAsset = true;
    } else {
      const relativePath = await writeUniqueProjectAsset(
        input.projectRoot,
        input.videoName,
        ext,
        prepared.bytes,
      );
      videoAsset = {
        id: randomUUID(),
        kind: 'video',
        name: input.videoName.trim() || 'Embedded Video',
        relativePath,
        mimeType: prepared.mimeType,
        sha256: mediaSha256,
        width: prepared.metadata.width,
        height: prepared.metadata.height,
        durationMs,
        videoTiming: {
          codec: prepared.metadata.codec,
          streamIndex: prepared.metadata.streamIndex,
          ...(prepared.metadata.audioStreamIndex !== undefined
            ? { audioStreamIndex: prepared.metadata.audioStreamIndex }
            : {}),
          ...(prepared.metadata.audioStartOffsetMs !== undefined
            ? { audioStartOffsetMs: prepared.metadata.audioStartOffsetMs }
            : {}),
          timeBase: { ...prepared.metadata.timeBase },
          startTick: prepared.metadata.startTick,
          endTick: prepared.metadata.endTick,
          presentationTicks: [...prepared.metadata.presentationTicks],
          hasAudio: prepared.metadata.hasAudio,
        },
        flaVideoSource: {
          sourceBasename: path.basename(prepared.originalEntryName),
          sourceSha256: prepared.sourceSha256,
          videoItemName: input.videoName,
          originalEntryName: prepared.originalEntryName,
        },
      };
      nextAssets.push(videoAsset);
    }

    let audioAsset: AudioAsset | undefined;
    let audioClipId: string | undefined;
    const audioClipIds: string[] = [];
    const importDiagnostics: string[] = [];
    let nextProject: Project = { ...project, assets: nextAssets };

    if (prepared.metadata.hasAudio && input.includeAudio !== false) {
      const videoFullPath = await resolveProjectAssetPath(input.projectRoot, videoAsset.relativePath);
      if (!videoFullPath) {
        throw new Error(`Persisted video asset "${videoAsset.relativePath}" could not be resolved.`);
      }
      const tempAudioDir = await mkdtemp(path.join(tmpdir(), 'panda-stage-video-audio-'));
      try {
        const tempWavPath = path.join(tempAudioDir, 'track.wav');
        await this.deps.ffmpegAdapter.extractFlaVideoAudioTrack(
          {
            videoPath: videoFullPath,
            outputWavPath: tempWavPath,
            audioStreamIndex: videoAsset.videoTiming.audioStreamIndex,
          },
          signal,
        );
        const wavBytes = await readFile(tempWavPath);
        const wavSha256 = sha256Hex(wavBytes);
        const existingAudio = nextAssets.find(
          (asset): asset is AudioAsset => asset.kind === 'audio' && asset.sha256 === wavSha256,
        );
        if (existingAudio) {
          audioAsset = existingAudio;
        } else {
          const probeAudio = await this.deps.ffmpegAdapter.probeAudioFile(tempWavPath, signal);
          const audioDurationMs = Math.max(1, Math.round(probeAudio.durationSeconds * 1_000));
          const audioRelativePath = await writeUniqueProjectAsset(
            input.projectRoot,
            `${input.videoName}-audio`,
            '.wav',
            wavBytes,
          );
          audioAsset = {
            id: randomUUID(),
            kind: 'audio',
            name: `${input.videoName.trim() || 'Embedded Video'} 音轨`,
            relativePath: audioRelativePath,
            mimeType: 'audio/wav',
            sha256: wavSha256,
            durationMs: audioDurationMs,
          };
          nextAssets = [...nextAssets, audioAsset];
          nextProject = { ...nextProject, assets: nextAssets };
        }
        const plannedAudio = planEmbeddedVideoAudioClips({
          shotDurationMs: shot.durationMs,
          layerStartTimeMs: input.startTimeMs,
          videoDurationMs: durationMs,
          audioDurationMs: audioAsset.durationMs ?? durationMs,
          audioStartOffsetMs: videoAsset.videoTiming.audioStartOffsetMs,
          playbackMode: input.playbackMode,
          trimStartMs: input.trimStartMs,
          trimEndMs: input.trimEndMs,
        });
        importDiagnostics.push(...plannedAudio.diagnostics);
        if (plannedAudio.clips.length > 0) {
          const audioClipService = this.deps.audioClipService ?? new AudioClipService();
          for (let clipIndex = 0; clipIndex < plannedAudio.clips.length; clipIndex += 1) {
            const planned = plannedAudio.clips[clipIndex]!;
            nextProject = audioClipService.create(nextProject, {
              shotId: shot.id,
              assetId: audioAsset.id,
              name: plannedAudio.clips.length > 1
                ? `${audioAsset.name} #${clipIndex + 1}`
                : audioAsset.name,
              role: 'sfx',
              startMs: planned.startMs,
              endMs: planned.endMs,
              offsetMs: planned.offsetMs,
            });
            const createdId = nextProject.shots[shotIndex]!.audioClips.at(-1)?.id;
            if (createdId) audioClipIds.push(createdId);
          }
          audioClipId = audioClipIds[0];
        }
      } finally {
        await rm(tempAudioDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }

    const updatedShot = nextProject.shots[shotIndex]!;
    const maxZ = updatedShot.layers.reduce((max, item) => Math.max(max, item.zIndex), -1);
    const layer: Layer = {
      id: randomUUID(),
      name: input.videoName.trim() || 'Embedded Video',
      source: {
        kind: 'video',
        assetId: videoAsset.id,
        ...(input.playbackMode ? { playbackMode: input.playbackMode } : {}),
        ...(input.trimStartMs !== undefined ? { trimStartMs: input.trimStartMs } : {}),
        ...(input.trimEndMs !== undefined ? { trimEndMs: input.trimEndMs } : {}),
        ...(input.heldFrameIndex !== undefined ? { heldFrameIndex: input.heldFrameIndex } : {}),
        ...(input.sourceFps !== undefined ? { sourceFps: input.sourceFps } : {}),
        ...(audioAsset ? { audioAssetId: audioAsset.id } : {}),
      },
      anchor: 'center',
      x: input.x ?? project.width / 2,
      y: input.y ?? project.height / 2,
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 0,
      opacity: 1,
      visible: true,
      locked: false,
      flipX: false,
      zIndex: maxZ + 1,
      startTimeMs: input.startTimeMs ?? 0,
    };

    const nextShots = [...nextProject.shots];
    nextShots[shotIndex] = {
      ...updatedShot,
      layers: [...updatedShot.layers, layer],
    };
    const finalProject = ProjectSchema.parse({
      ...nextProject,
      shots: nextShots,
      updatedAt: new Date().toISOString(),
    });
    const saved = await this.deps.projectService.save(input.projectRoot, finalProject);
    return {
      ok: true,
      project: saved.project,
      videoAsset,
      layer,
      ...(audioAsset ? { audioAsset } : {}),
      ...(audioClipId ? { audioClipId } : {}),
      ...(audioClipIds.length > 0 ? { audioClipIds } : {}),
      ...(importDiagnostics.length > 0 ? { diagnostics: importDiagnostics } : {}),
      reusedVideoAsset,
    };
  }

  /**
   * Evaluates deterministic display sample and reads its decoded PNG frame from
   * the bounded sequential decode cache. Guards against stale rapid-seek overwrites
   * and isolates decode failures to the affected video node.
   */
  async readSampleFrameAtTime(input: {
    readonly projectRoot: string;
    readonly project: Project;
    readonly assetId: string;
    readonly shotTimeMs: number;
    readonly layerStartTimeMs?: number;
    readonly playbackMode?: 'play-once' | 'loop' | 'single-frame';
    readonly trimStartMs?: number;
    readonly trimEndMs?: number;
    readonly heldFrameIndex?: number;
    readonly sourceFps?: number;
    readonly nestedHost?: FlaVideoNestedHostClock;
    readonly requestToken?: number;
    readonly signal?: AbortSignal;
  }): Promise<
    | (ReadVideoSampleFrameResult & { readonly sample: FlaVideoClockSample })
    | ReadVideoSampleFrameFailure
  > {
    const asset = input.project.assets.find(
      (candidate): candidate is VideoAsset => candidate.id === input.assetId && candidate.kind === 'video',
    );
    if (!asset) {
      return { ok: false, code: 'ASSET_MISSING', message: `Video asset ${input.assetId} is missing.` };
    }
    const sample = evaluateFlaVideoClock({
      shotTimeMs: input.shotTimeMs,
      layerStartTimeMs: input.layerStartTimeMs,
      timing: asset.videoTiming,
      playbackMode: input.playbackMode,
      trimStartMs: input.trimStartMs,
      trimEndMs: input.trimEndMs,
      heldFrameIndex: input.heldFrameIndex,
      sourceFps: input.sourceFps,
      nestedHost: input.nestedHost,
    });
    if (!sample) {
      return { ok: false, code: 'DECODE_FAILED', message: 'Video timing metadata could not select a frame.' };
    }
    const frameResult = await this.readSampleFrame({
      projectRoot: input.projectRoot,
      asset,
      sampleIndex: sample.sampleIndex,
      requestToken: input.requestToken,
      signal: input.signal,
    });
    return frameResult.ok ? { ...frameResult, sample } : frameResult;
  }

  async readSampleFrame(input: {
    readonly projectRoot: string;
    readonly asset: VideoAsset;
    readonly sampleIndex: number;
    readonly requestToken?: number;
    readonly signal?: AbortSignal;
  }): Promise<ReadVideoSampleFrameResult | ReadVideoSampleFrameFailure> {
    const tokenKey = `${input.projectRoot}\u0000${input.asset.id}`;
    if (input.requestToken !== undefined) {
      const priorToken = this.latestTokenByAsset.get(tokenKey) ?? -1;
      if (input.requestToken < priorToken) {
        return { ok: false, code: 'STALE_REQUEST', message: 'Superseded by a newer video seek.' };
      }
      this.latestTokenByAsset.set(tokenKey, input.requestToken);
    }
    const isStale = () =>
      input.requestToken !== undefined &&
      (this.latestTokenByAsset.get(tokenKey) ?? -1) > input.requestToken;

    const cacheKey = `${input.projectRoot}\u0000${input.asset.id}\u0000${input.asset.sha256 ?? ''}`;
    const pngKey = `${cacheKey}\u0000${input.sampleIndex}`;
    const cachedPng = this.framePngCache.get(pngKey);
    if (cachedPng) {
      cachedPng.lastUsedAt = Date.now();
      return {
        ok: true,
        assetId: input.asset.id,
        sampleIndex: input.sampleIndex,
        mimeType: 'image/png',
        bytes: cachedPng.bytes,
        fromCache: true,
      };
    }

    try {
      const sequence = await this.ensureDecodedSequence(input.projectRoot, input.asset, cacheKey, input.signal);
      if (input.signal?.aborted) {
        return { ok: false, code: 'CANCELLED', message: 'Video frame decode cancelled.' };
      }
      if (isStale()) {
        return { ok: false, code: 'STALE_REQUEST', message: 'Superseded by a newer video seek.' };
      }
      if (input.sampleIndex < 0 || input.sampleIndex >= sequence.framePaths.length) {
        return {
          ok: false,
          code: 'DECODE_FAILED',
          message: `Requested video sample #${input.sampleIndex} is outside decoded frame count (${sequence.framePaths.length}).`,
        };
      }
      const framePath = sequence.framePaths[input.sampleIndex];
      if (!framePath) {
        return { ok: false, code: 'DECODE_FAILED', message: 'Decoded video frame is unavailable.' };
      }
      const bytes = new Uint8Array(await readFile(framePath));
      if (isStale()) {
        return { ok: false, code: 'STALE_REQUEST', message: 'Superseded by a newer video seek.' };
      }
      this.storePngInCache(pngKey, bytes);
      return {
        ok: true,
        assetId: input.asset.id,
        sampleIndex: input.sampleIndex,
        mimeType: 'image/png',
        bytes,
        fromCache: false,
      };
    } catch (error) {
      if (input.signal?.aborted) {
        return { ok: false, code: 'CANCELLED', message: 'Video frame decode cancelled.' };
      }
      return {
        ok: false,
        code: 'DECODE_FAILED',
        message: error instanceof Error ? error.message : 'Unable to decode embedded video frame.',
      };
    }
  }

  private async ensureDecodedSequence(
    projectRoot: string,
    asset: VideoAsset,
    cacheKey: string,
    signal?: AbortSignal,
  ): Promise<DecodedSequenceEntry> {
    const existing = this.decodedSequences.get(cacheKey);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing;
    }
    const inFlight = this.inFlightDecodes.get(cacheKey);
    if (inFlight) return inFlight;

    const promise = (async (): Promise<DecodedSequenceEntry> => {
      const videoPath = await resolveProjectAssetPath(projectRoot, asset.relativePath);
      if (!videoPath) {
        throw new Error(`Video asset "${asset.relativePath}" is outside the project or missing.`);
      }
      const directory = await mkdtemp(path.join(tmpdir(), 'panda-stage-video-cache-'));
      try {
        const decoded = await this.deps.ffmpegAdapter.decodeFlaVideoFramesSequential(
          {
            videoPath,
            outputDirectory: directory,
            maxFrames: asset.videoTiming.presentationTicks.length,
            streamIndex: asset.videoTiming.streamIndex,
            expectedFrameCount: asset.videoTiming.presentationTicks.length,
          },
          signal,
        );
        const entry: DecodedSequenceEntry = {
          key: cacheKey,
          directory,
          framePaths: decoded.framePaths,
          lastUsedAt: Date.now(),
        };
        await this.evictOldestSequencesIfNeeded();
        this.decodedSequences.set(cacheKey, entry);
        return entry;
      } catch (error) {
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
    })().finally(() => {
      this.inFlightDecodes.delete(cacheKey);
    });
    this.inFlightDecodes.set(cacheKey, promise);
    return promise;
  }

  private storePngInCache(key: string, bytes: Uint8Array): void {
    if (this.framePngCache.size >= MAX_CACHED_PNG_BYTES) {
      let oldestKey: string | undefined;
      let oldestTime = Infinity;
      for (const [k, entry] of this.framePngCache) {
        if (entry.lastUsedAt < oldestTime) {
          oldestTime = entry.lastUsedAt;
          oldestKey = k;
        }
      }
      if (oldestKey) this.framePngCache.delete(oldestKey);
    }
    this.framePngCache.set(key, { bytes, lastUsedAt: Date.now() });
  }

  private async evictOldestSequencesIfNeeded(): Promise<void> {
    while (this.decodedSequences.size >= MAX_CACHED_VIDEO_SEQUENCES) {
      let oldestKey: string | undefined;
      let oldestTime = Infinity;
      for (const [k, entry] of this.decodedSequences) {
        if (entry.lastUsedAt < oldestTime) {
          oldestTime = entry.lastUsedAt;
          oldestKey = k;
        }
      }
      if (!oldestKey) break;
      const entry = this.decodedSequences.get(oldestKey);
      this.decodedSequences.delete(oldestKey);
      if (entry) {
        await rm(entry.directory, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  async dispose(): Promise<void> {
    const directories = [...this.decodedSequences.values()].map((entry) => entry.directory);
    this.decodedSequences.clear();
    this.framePngCache.clear();
    this.latestTokenByAsset.clear();
    await Promise.all(
      directories.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)),
    );
  }
}

export const EXPORT_RENDERER_VIDEO_FRAME_CACHE_LIMIT = 16;
const MAX_MAIN_EXPORT_PNG_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_EXPORT_VIDEO_FRAMES_PER_RENDER = 16;
const MAX_EXPORT_DIAGNOSTICS = 32;

export interface ExportVideoFramePayload {
  readonly assetId: string;
  readonly mimeType: 'image/png';
  readonly bytes: Uint8Array<ArrayBuffer>;
}

/**
 * On-demand video frame supplier for formal export (E-F07 / E-F11):
 * - Decodes each frozen video asset ONCE sequentially to jobDirectory on disk.
 * - Never loads all decoded PNGs into RAM or bulk-copies them into loadFormal IPC.
 * - Supplies only the active PTS sample(s) needed by each renderFrame, mirroring
 *   the hidden renderer's bounded 16-entry LRU cache so repeated samples transfer 0 bytes.
 */
export class ExportVideoFrameSupply {
  private readonly pngCache = new Map<string, Uint8Array<ArrayBuffer>>();
  private pngCacheBytes = 0;
  private readonly rendererCacheOrder: string[] = [];
  private readonly diagnostics = new Set<string>();
  private totalFramesTransferred = 0;
  private peakFramesPerTransfer = 0;

  constructor(
    private readonly decodedByAssetId: ReadonlyMap<
      string,
      { readonly assetName: string; readonly sha256: string; readonly framePaths: readonly string[] }
    >,
    initialDiagnostics: readonly string[],
  ) {
    for (const diag of initialDiagnostics) {
      this.addDiagnostic(diag);
    }
  }

  get hasVideoAssets(): boolean {
    return this.decodedByAssetId.size > 0 || this.diagnostics.size > 0;
  }

  getDiagnostics(): string[] {
    return [...this.diagnostics];
  }

  getTransferStats(): {
    readonly totalFramesTransferred: number;
    readonly peakFramesPerTransfer: number;
    readonly cachedBytes: number;
    readonly cachedEntries: number;
  } {
    return {
      totalFramesTransferred: this.totalFramesTransferred,
      peakFramesPerTransfer: this.peakFramesPerTransfer,
      cachedBytes: this.pngCacheBytes,
      cachedEntries: this.pngCache.size,
    };
  }

  /** Resets the mirrored renderer cache when a new formal load starts (e.g., sprite sheet). */
  resetRendererCacheMirror(): void {
    this.rendererCacheOrder.length = 0;
  }

  async collectVideoFramesForShotTime(
    project: Project,
    shot: Shot,
    shotLocalTimeMs: number,
    signal?: AbortSignal,
    outputLayerId?: string,
  ): Promise<ExportVideoFramePayload[]> {
    if (!this.hasVideoAssets) return [];
    const evaluated = evaluateShotAtTime(shot, shotLocalTimeMs, project);
    const neededKeys: string[] = [];
    for (const layer of evaluated.layers) {
      if (!layer.visible || (outputLayerId && layer.id !== outputLayerId)) continue;
      if (!layer.assetId) continue;
      const parsed = parseFlaVideoFrameAssetKey(layer.assetId);
      if (!parsed) continue;
      if (!neededKeys.includes(layer.assetId)) neededKeys.push(layer.assetId);
    }
    if (neededKeys.length === 0) return [];

    const payloads: ExportVideoFramePayload[] = [];
    let batchBytes = 0;
    for (const frameKey of neededKeys) {
      signal?.throwIfAborted();
      const parsed = parseFlaVideoFrameAssetKey(frameKey);
      if (!parsed) continue;
      const entry = this.decodedByAssetId.get(parsed.assetId);
      if (!entry) {
        // Already diagnosed during initial sequential decode if decode failed; otherwise record missing.
        const asset = project.assets.find((a) => a.id === parsed.assetId);
        const alreadyRecorded = [...this.diagnostics].some((d) => d.includes(parsed.assetId));
        if (!alreadyRecorded) {
          this.addDiagnostic(
            `视频素材“${asset?.name ?? parsed.assetId}”未就绪，已跳过该视频画面。`,
          );
        }
        continue;
      }
      if (parsed.sampleIndex < 0 || parsed.sampleIndex >= entry.framePaths.length) {
        this.addDiagnostic(
          `视频素材“${entry.assetName}”缺少第 ${parsed.sampleIndex + 1} 帧（已解码 ${entry.framePaths.length} 帧），已跳过该帧画面。`,
        );
        continue;
      }
      // If the hidden renderer's bounded LRU already holds this exact assetId+sha256+sample, touch LRU and send 0 bytes.
      const rendererKey = `${entry.sha256}\u0000${frameKey}`;
      const existingIdx = this.rendererCacheOrder.indexOf(rendererKey);
      if (existingIdx >= 0) {
        this.rendererCacheOrder.splice(existingIdx, 1);
        this.rendererCacheOrder.push(rendererKey);
        continue;
      }
      if (payloads.length >= MAX_EXPORT_VIDEO_FRAMES_PER_RENDER) {
        this.addDiagnostic(
          `单帧导出视频样本数超出 ${MAX_EXPORT_VIDEO_FRAMES_PER_RENDER} 帧预算，已跳过多余视频画面。`,
        );
        break;
      }
      const bytes = await this.readFramePng(rendererKey, entry.framePaths[parsed.sampleIndex]!, entry.assetName);
      if (!bytes) continue;
      if (batchBytes + bytes.byteLength > 64 * 1024 * 1024) {
        this.addDiagnostic(
          `单帧导出视频数据超出 64 MiB 预算，已跳过“${entry.assetName}”第 ${parsed.sampleIndex + 1} 帧。`,
        );
        continue;
      }
      batchBytes += bytes.byteLength;
      payloads.push({
        assetId: frameKey,
        mimeType: 'image/png',
        bytes,
      });
      this.rendererCacheOrder.push(rendererKey);
      while (this.rendererCacheOrder.length > EXPORT_RENDERER_VIDEO_FRAME_CACHE_LIMIT) {
        this.rendererCacheOrder.shift();
      }
    }
    this.totalFramesTransferred += payloads.length;
    if (payloads.length > this.peakFramesPerTransfer) {
      this.peakFramesPerTransfer = payloads.length;
    }
    return payloads;
  }

  private async readFramePng(
    cacheKey: string,
    framePath: string,
    assetName: string,
  ): Promise<Uint8Array<ArrayBuffer> | null> {
    const cached = this.pngCache.get(cacheKey);
    if (cached) {
      // Refresh LRU order.
      this.pngCache.delete(cacheKey);
      this.pngCache.set(cacheKey, cached);
      return cached;
    }
    try {
      const raw = await readFile(framePath);
      const bytes = Uint8Array.from(raw);
      if (bytes.byteLength <= MAX_MAIN_EXPORT_PNG_CACHE_BYTES) {
        while (
          this.pngCache.size >= EXPORT_RENDERER_VIDEO_FRAME_CACHE_LIMIT ||
          this.pngCacheBytes + bytes.byteLength > MAX_MAIN_EXPORT_PNG_CACHE_BYTES
        ) {
          const oldest = this.pngCache.keys().next().value;
          if (!oldest) break;
          const evicted = this.pngCache.get(oldest);
          this.pngCache.delete(oldest);
          if (evicted) this.pngCacheBytes -= evicted.byteLength;
        }
        this.pngCache.set(cacheKey, bytes);
        this.pngCacheBytes += bytes.byteLength;
      }
      return bytes;
    } catch (error) {
      this.addDiagnostic(
        `读取视频素材“${assetName}”解码帧失败：${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private addDiagnostic(message: string): void {
    const trimmed = message.trim().slice(0, 500);
    if (!trimmed || this.diagnostics.size >= MAX_EXPORT_DIAGNOSTICS) return;
    this.diagnostics.add(trimmed);
  }
}

/**
 * Decodes each frozen video asset ONCE sequentially to jobDirectory on disk and
 * returns an on-demand ExportVideoFrameSupply (never reading all PNGs into RAM).
 */
export async function prepareExportVideoFrameSupply(input: {
  readonly project: Project;
  readonly media: readonly {
    readonly assetId: string;
    readonly kind: 'image' | 'audio' | 'video';
    readonly mimeType: string;
    readonly bytes: Uint8Array;
  }[];
  readonly jobDirectory: string;
  readonly adapter: Pick<FFmpegAdapter, 'decodeFlaVideoFramesSequential'>;
  readonly signal?: AbortSignal;
}): Promise<ExportVideoFrameSupply> {
  const videoEntries = input.media.filter((entry) => entry.kind === 'video');
  const decodedByAssetId = new Map<
    string,
    { readonly assetName: string; readonly sha256: string; readonly framePaths: readonly string[] }
  >();
  const diagnostics: string[] = [];

  for (const entry of videoEntries) {
    input.signal?.throwIfAborted();
    const asset = input.project.assets.find(
      (candidate): candidate is VideoAsset => candidate.id === entry.assetId && candidate.kind === 'video',
    );
    if (!asset) continue;
    const decodeDir = path.join(input.jobDirectory, `video-${entry.assetId}`);
    const stagedVideoPath = path.join(decodeDir, `source${extensionForVideoMime(entry.mimeType)}`);
    try {
      await mkdir(decodeDir, { recursive: true });
      await writeFile(stagedVideoPath, entry.bytes, { flag: 'wx' });
      const decoded = await input.adapter.decodeFlaVideoFramesSequential(
        {
          videoPath: stagedVideoPath,
          outputDirectory: decodeDir,
          maxFrames: asset.videoTiming.presentationTicks.length,
          streamIndex: asset.videoTiming.streamIndex,
          expectedFrameCount: asset.videoTiming.presentationTicks.length,
        },
        input.signal,
      );
      decodedByAssetId.set(asset.id, {
        assetName: asset.name,
        sha256: asset.sha256 ?? sha256Hex(entry.bytes),
        framePaths: decoded.framePaths,
      });
    } catch (error) {
      if (input.signal?.aborted) throw error;
      diagnostics.push(
        `内嵌视频“${asset.name}”(${asset.id}) 解码失败，已局部跳过该视频画面：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return new ExportVideoFrameSupply(decodedByAssetId, diagnostics);
}

/**
 * Legacy helper retained for unit diagnostics checks; formal ExportService uses
 * prepareExportVideoFrameSupply for bounded on-demand per-frame delivery (E-F07).
 */
export async function prepareExportVideoFrameMedia(input: {
  readonly project: Project;
  readonly media: readonly {
    readonly assetId: string;
    readonly kind: 'image' | 'audio' | 'video';
    readonly mimeType: string;
    readonly bytes: Uint8Array;
  }[];
  readonly jobDirectory: string;
  readonly adapter: Pick<FFmpegAdapter, 'decodeFlaVideoFramesSequential'>;
  readonly signal?: AbortSignal;
}): Promise<{
  readonly frameMedia: readonly {
    readonly assetId: string;
    readonly mimeType: 'image/png';
    readonly bytes: Uint8Array;
  }[];
  readonly diagnostics: readonly string[];
}> {
  const supply = await prepareExportVideoFrameSupply(input);
  return { frameMedia: [], diagnostics: supply.getDiagnostics() };
}

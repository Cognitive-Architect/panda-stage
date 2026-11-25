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
import { EXPORT_VIDEO_FRAME_CACHE_LIMIT, storeExportVideoFrame, touchExportVideoFrame } from '../../shared/export-video-frame-cache';
import type { AssetFileExtension } from '../../shared/asset-name';
import {
  evaluateFlaVideoClock,
  parseFlaVideoFrameAssetKey,
  planEmbeddedVideoAudioClips,
  type FlaVideoClockSample,
  type FlaVideoNestedHostClock,
} from '../../shared/fla-video-clock';
import {
  FlaVideoImportRequestSchema,
  FlaVideoImportResponseSchema,
  type FlaVideoImportErrorCode,
  type FlaVideoImportResponse,
} from '../../shared/fla-video-api';
import type { FFmpegAdapter } from './FFmpegAdapter';
import type { FlaImportService } from './FlaImportService';
import { ProjectServiceError, type ProjectService, type ProjectTransaction } from './ProjectService';
import { AtomicWriteCommitRejectedError } from './ProjectFileSystemService';
import { resolveProjectAssetPath } from './project-asset-path';

export interface FlaEmbeddedVideoProjectSnapshot {
  readonly project: Project;
  readonly revision: number;
  readonly openInstanceId?: number | null;
}

export class FlaEmbeddedVideoImportError extends Error {
  readonly currentProject?: Project;
  readonly currentRevision?: number;

  constructor(
    readonly code: FlaVideoImportErrorCode,
    readonly projectRoot: string,
    message: string,
    details: {
      cause?: unknown;
      currentProject?: Project;
      currentRevision?: number;
    } = {},
  ) {
    super(message, { cause: details.cause });
    this.name = 'FlaEmbeddedVideoImportError';
    this.currentProject = details.currentProject;
    this.currentRevision = details.currentRevision;
  }
}

export interface ImportEmbeddedVideoInput {
  readonly sessionId: string;
  readonly videoName: string;
  readonly projectRoot: string;
  readonly project?: Project;
  readonly baseRevision?: number;
  readonly openInstanceId?: number;
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
  readonly baseRevision: number;
  readonly savedRevision: number;
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
): Promise<{ readonly relativePath: string; readonly fullPath: string }> {
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
      return { relativePath: `assets/${candidateName}`, fullPath: candidatePath };
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
  throw new Error('Unable to allocate a unique asset path in project assets directory.');
}

function requestProjectRootFromRaw(rawRequest: unknown): string {
  if (
    typeof rawRequest === 'object' &&
    rawRequest !== null &&
    'projectRoot' in rawRequest &&
    typeof rawRequest.projectRoot === 'string' &&
    rawRequest.projectRoot.trim()
  ) {
    return rawRequest.projectRoot;
  }
  return '(unknown project)';
}

/**
 * Formal embedded-video lifecycle owner (E-F04 / E-F06 / E-F07 / E-F10 / E-F11):
 * - Ingests native FLA embedded video into formal project assets + Video Layer
 *   (and optional synchronized AudioAsset/AudioClip when hasAudio) against the
 *   active in-memory project snapshot & revision with atomic rollback.
 * - Decodes frames sequentially in ONE FFmpeg call per asset (never per-frame
 *   FFmpeg spawning) with bounded cache, cancellation, stale-seek protection,
 *   and local failure isolation.
 */
export class FlaEmbeddedVideoService {
  private readonly decodedSequences = new Map<string, DecodedSequenceEntry>();
  private readonly inFlightDecodes = new Map<string, Promise<DecodedSequenceEntry>>();
  private readonly framePngCache = new Map<string, { readonly bytes: Uint8Array; lastUsedAt: number }>();
  private readonly latestTokenByAsset = new Map<string, number>();
  private readonly activeImportsBySession = new Map<string, Set<AbortController>>();

  constructor(
    private readonly deps: {
      readonly flaImportService?: Pick<FlaImportService, 'prepareEmbeddedVideo'>;
      readonly projectService?: Pick<ProjectService, 'open' | 'save'> & Partial<Pick<ProjectService, 'transact'>>;
      readonly getCurrentProjectSnapshot?: (projectRoot: string) => FlaEmbeddedVideoProjectSnapshot | null;
      readonly ffmpegAdapter: Pick<
        FFmpegAdapter,
        'probeFlaNativeVideo' | 'decodeFlaVideoFramesSequential' | 'extractFlaVideoAudioTrack' | 'probeAudioFile'
      >;
      readonly audioClipService?: AudioClipService;
    },
  ) {}

  cancelImportsForSession(sessionId: string): boolean {
    const active = this.activeImportsBySession.get(sessionId);
    if (!active || active.size === 0) return false;
    for (const controller of active) {
      controller.abort();
    }
    this.activeImportsBySession.delete(sessionId);
    return true;
  }

  cancelActiveImports(): void {
    for (const sessionId of this.activeImportsBySession.keys()) {
      this.cancelImportsForSession(sessionId);
    }
  }

  /**
   * Formal IPC entry point (E-F06): validates the strict request schema, runs the
   * revision-checked transactional import against the live in-memory project
   * snapshot, and returns a validated discriminated union response.
   */
  async importFromFlaSessionRequest(rawRequest: unknown): Promise<FlaVideoImportResponse> {
    const fallbackRoot = requestProjectRootFromRaw(rawRequest);
    const parsed = FlaVideoImportRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      return FlaVideoImportResponseSchema.parse({
        ok: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'FLA embedded video import request is invalid.',
          projectRoot: fallbackRoot,
        },
      });
    }
    const request = parsed.data;
    try {
      const result = await this.importFromFlaSession({
        sessionId: request.sessionId,
        videoName: request.videoName,
        projectRoot: request.projectRoot,
        project: request.project,
        baseRevision: request.baseRevision,
        openInstanceId: request.openInstanceId,
        shotId: request.shotId,
        ...(request.startTimeMs !== undefined ? { startTimeMs: request.startTimeMs } : {}),
        ...(request.playbackMode !== undefined ? { playbackMode: request.playbackMode } : {}),
        ...(request.trimStartMs !== undefined ? { trimStartMs: request.trimStartMs } : {}),
        ...(request.trimEndMs !== undefined ? { trimEndMs: request.trimEndMs } : {}),
        ...(request.heldFrameIndex !== undefined ? { heldFrameIndex: request.heldFrameIndex } : {}),
        ...(request.sourceFps !== undefined ? { sourceFps: request.sourceFps } : {}),
        ...(request.includeAudio !== undefined ? { includeAudio: request.includeAudio } : {}),
        ...(request.x !== undefined ? { x: request.x } : {}),
        ...(request.y !== undefined ? { y: request.y } : {}),
      });
      return FlaVideoImportResponseSchema.parse({
        ok: true,
        status: 'completed',
        project: result.project,
        baseRevision: result.baseRevision,
        savedRevision: result.savedRevision,
        videoAsset: result.videoAsset,
        layer: result.layer,
        ...(result.audioAsset ? { audioAsset: result.audioAsset } : {}),
        ...(result.audioClipId ? { audioClipId: result.audioClipId } : {}),
        ...(result.audioClipIds ? { audioClipIds: [...result.audioClipIds] } : {}),
        ...(result.diagnostics ? { diagnostics: [...result.diagnostics] } : {}),
        reusedVideoAsset: result.reusedVideoAsset,
      });
    } catch (error) {
      if (error instanceof FlaEmbeddedVideoImportError) {
        return FlaVideoImportResponseSchema.parse({
          ok: false,
          error: {
            code: error.code,
            message: error.message.trim().slice(0, 1_000) || 'Unable to import FLA embedded video.',
            projectRoot: error.projectRoot,
            ...(error.currentProject ? { currentProject: error.currentProject } : {}),
            ...(error.currentRevision !== undefined ? { currentRevision: error.currentRevision } : {}),
          },
        });
      }
      const message =
        error instanceof Error && error.message.trim()
          ? error.message.trim().slice(0, 1_000)
          : 'Unable to import FLA embedded video.';
      return FlaVideoImportResponseSchema.parse({
        ok: false,
        error: {
          code: 'VIDEO_IMPORT_FAILED',
          message,
          projectRoot: request.projectRoot,
        },
      });
    }
  }

  private assertTrackedSnapshotCurrent(input: ImportEmbeddedVideoInput): FlaEmbeddedVideoProjectSnapshot | null {
    const { projectRoot, project: requestedProject, baseRevision: expectedRevision, openInstanceId } = input;
    const tracked = this.deps.getCurrentProjectSnapshot?.(projectRoot) ?? null;
    if (openInstanceId !== undefined && (!tracked || tracked.openInstanceId !== openInstanceId)) {
      throw new FlaEmbeddedVideoImportError(
        'STALE_PROJECT_REVISION', projectRoot,
        'The Project was closed or reopened before the FLA embedded video could be imported.',
      );
    }
    if (!tracked) return null;
    if (expectedRevision !== undefined && tracked.revision !== expectedRevision) {
      throw new FlaEmbeddedVideoImportError(
        'STALE_PROJECT_REVISION',
        projectRoot,
        'The Project changed before the FLA embedded video could be imported. Refresh and retry.',
        {
          currentProject: tracked.project,
          currentRevision: tracked.revision,
        },
      );
    }
    if (requestedProject && tracked.project.id !== requestedProject.id) {
      throw new FlaEmbeddedVideoImportError(
        'STALE_PROJECT_REVISION',
        projectRoot,
        'The Project identity changed before the FLA embedded video could be imported.',
        {
          currentProject: tracked.project,
          currentRevision: tracked.revision,
        },
      );
    }
    return tracked;
  }

  /**
   * Formal product loop: extract native embedded video from an active FLA session,
   * persist the original media into <projectRoot>/assets/, register VideoAsset +
   * optional AudioAsset/AudioClip + Video Layer against the active in-memory
   * project snapshot (preserving unsaved edits), and save project.json atomically
   * with full file rollback on failure or cancellation.
   */
  async importFromFlaSession(
    input: ImportEmbeddedVideoInput,
  ): Promise<ImportEmbeddedVideoResult> {
    const sessionController = new AbortController();
    let sessionControllers = this.activeImportsBySession.get(input.sessionId);
    if (!sessionControllers) {
      sessionControllers = new Set();
      this.activeImportsBySession.set(input.sessionId, sessionControllers);
    }
    sessionControllers.add(sessionController);
    const signal = input.signal
      ? AbortSignal.any([input.signal, sessionController.signal])
      : sessionController.signal;

    const throwIfCancelled = () => {
      if (signal.aborted) {
        throw new FlaEmbeddedVideoImportError(
          'VIDEO_IMPORT_CANCELLED',
          input.projectRoot,
          'FLA embedded video import was cancelled.',
        );
      }
    };

    try {
      throwIfCancelled();
      if (!this.deps.flaImportService || !this.deps.projectService) {
        throw new FlaEmbeddedVideoImportError(
          'VIDEO_IMPORT_FAILED',
          input.projectRoot,
          'FlaImportService and ProjectService are required for FLA embedded video import.',
        );
      }

      // Fail fast on stale revision before running ffprobe or touching disk.
      this.assertTrackedSnapshotCurrent(input);
      if (input.openInstanceId !== undefined && !this.deps.projectService.transact) {
        throw new FlaEmbeddedVideoImportError(
          'VIDEO_IMPORT_FAILED', input.projectRoot, 'Formal video import requires a Project transaction.',
        );
      }

      const prepared = await this.deps.flaImportService.prepareEmbeddedVideo(
        input.sessionId,
        input.videoName,
        this.deps.ffmpegAdapter,
        signal,
      );
      throwIfCancelled();
      if (!prepared) {
        throw new FlaEmbeddedVideoImportError(
          'SESSION_NOT_FOUND',
          input.projectRoot,
          `Embedded video "${input.videoName}" could not be extracted from FLA session.`,
        );
      }

      const executeMutation = async (
        diskProject: Project,
        saveProject: (project: Project, savedRevision: number) => Promise<Project>,
      ): Promise<ImportEmbeddedVideoResult> => {
        throwIfCancelled();
        const tracked = this.assertTrackedSnapshotCurrent(input);
        const authoritativeBase = ProjectSchema.parse(
          input.openInstanceId !== undefined ? tracked!.project : input.project ?? tracked?.project ?? diskProject,
        );
        if (diskProject.id !== authoritativeBase.id) {
          throw new FlaEmbeddedVideoImportError(
            'STALE_PROJECT_REVISION',
            input.projectRoot,
            'The Project identity on disk does not match the active editor session.',
            tracked
              ? { currentProject: tracked.project, currentRevision: tracked.revision }
              : undefined,
          );
        }

        const baseRevision = input.baseRevision ?? tracked?.revision ?? 0;
        const savedRevision = baseRevision + 1;

        const shotIndex = authoritativeBase.shots.findIndex((shot) => shot.id === input.shotId);
        if (shotIndex < 0) {
          throw new FlaEmbeddedVideoImportError(
            'VIDEO_IMPORT_FAILED',
            input.projectRoot,
            `Target Shot "${input.shotId}" was not found in project.`,
          );
        }
        const shot = authoritativeBase.shots[shotIndex]!;
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

        const writtenAssetFullPaths: string[] = [];
        let projectSaved = false;
        try {
          const existingVideo = authoritativeBase.assets.find(
            (asset): asset is VideoAsset => asset.kind === 'video' && asset.sha256 === mediaSha256,
          );
          let videoAsset: VideoAsset;
          let reusedVideoAsset = false;
          let nextAssets = [...authoritativeBase.assets];

          if (existingVideo) {
            videoAsset = existingVideo;
            reusedVideoAsset = true;
          } else {
            const written = await writeUniqueProjectAsset(
              input.projectRoot,
              input.videoName,
              ext,
              prepared.bytes,
            );
            writtenAssetFullPaths.push(written.fullPath);
            videoAsset = {
              id: randomUUID(),
              kind: 'video',
              name: input.videoName.trim() || 'Embedded Video',
              relativePath: written.relativePath,
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

          throwIfCancelled();

          let audioAsset: AudioAsset | undefined;
          let audioClipId: string | undefined;
          const audioClipIds: string[] = [];
          const importDiagnostics: string[] = [];
          let nextProject: Project = { ...authoritativeBase, assets: nextAssets };

          if (prepared.metadata.hasAudio && input.includeAudio !== false) {
            const videoFullPath = await resolveProjectAssetPath(input.projectRoot, videoAsset.relativePath);
            if (!videoFullPath) {
              throw new FlaEmbeddedVideoImportError(
                'VIDEO_IMPORT_FAILED',
                input.projectRoot,
                `Persisted video asset "${videoAsset.relativePath}" could not be resolved.`,
              );
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
              throwIfCancelled();
              const wavBytes = await readFile(tempWavPath);
              const wavSha256 = sha256Hex(wavBytes);
              const existingAudio = nextAssets.find(
                (asset): asset is AudioAsset => asset.kind === 'audio' && asset.sha256 === wavSha256,
              );
              if (existingAudio) {
                audioAsset = existingAudio;
              } else {
                const probeAudio = await this.deps.ffmpegAdapter.probeAudioFile(tempWavPath, signal);
                throwIfCancelled();
                const audioDurationMs = Math.max(1, Math.round(probeAudio.durationSeconds * 1_000));
                const writtenAudio = await writeUniqueProjectAsset(
                  input.projectRoot,
                  `${input.videoName}-audio`,
                  '.wav',
                  wavBytes,
                );
                writtenAssetFullPaths.push(writtenAudio.fullPath);
                audioAsset = {
                  id: randomUUID(),
                  kind: 'audio',
                  name: `${input.videoName.trim() || 'Embedded Video'} 音轨`,
                  relativePath: writtenAudio.relativePath,
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

          throwIfCancelled();
          // Re-verify tracked revision immediately before committing project.json (TOCTOU guard).
          this.assertTrackedSnapshotCurrent(input);

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
            x: input.x ?? authoritativeBase.width / 2,
            y: input.y ?? authoritativeBase.height / 2,
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
          const savedProject = await saveProject(finalProject, savedRevision);
          projectSaved = true;
          return {
            ok: true,
            project: savedProject,
            baseRevision,
            savedRevision,
            videoAsset,
            layer,
            ...(audioAsset ? { audioAsset } : {}),
            ...(audioClipId ? { audioClipId } : {}),
            ...(audioClipIds.length > 0 ? { audioClipIds } : {}),
            ...(importDiagnostics.length > 0 ? { diagnostics: importDiagnostics } : {}),
            reusedVideoAsset,
          };
        } catch (error) {
          if (!projectSaved) {
            for (const filePath of writtenAssetFullPaths) {
              await rm(filePath, { force: true }).catch(() => undefined);
            }
          }
          throw error;
        }
      };

      const projectService = this.deps.projectService;
      if (typeof projectService.transact === 'function') {
        try {
          return await projectService.transact(
            input.projectRoot,
            async (transaction: ProjectTransaction) =>
              executeMutation(transaction.existingDocument.project, async (project, savedRevision) => {
                const saved = await transaction.save(project, savedRevision, () => {
                  throwIfCancelled();
                  this.assertTrackedSnapshotCurrent(input);
                });
                return saved.project;
              }),
          );
        } catch (error) {
          const cause = error instanceof AtomicWriteCommitRejectedError ? error.cause : error;
          if (cause instanceof FlaEmbeddedVideoImportError) throw cause;
          if (error instanceof ProjectServiceError && error.code === 'PROJECT_SAVE_STALE_REVISION') {
            const tracked = this.deps.getCurrentProjectSnapshot?.(input.projectRoot) ?? null;
            throw new FlaEmbeddedVideoImportError(
              'STALE_PROJECT_REVISION',
              input.projectRoot,
              'The Project changed before the FLA embedded video could be saved. Refresh and retry.',
              {
                cause: error,
                currentProject: tracked?.project,
                currentRevision: tracked?.revision,
              },
            );
          }
          if (signal.aborted) {
            throw new FlaEmbeddedVideoImportError(
              'VIDEO_IMPORT_CANCELLED',
              input.projectRoot,
              'FLA embedded video import was cancelled.',
              { cause: error },
            );
          }
          throw error;
        }
      }

      const opened = await projectService.open(input.projectRoot);
      return await executeMutation(opened.project, async (project) => {
        const saved = await projectService.save(input.projectRoot, project);
        return saved.project;
      });
    } catch (error) {
      if (error instanceof FlaEmbeddedVideoImportError) throw error;
      if (signal.aborted) {
        throw new FlaEmbeddedVideoImportError(
          'VIDEO_IMPORT_CANCELLED',
          input.projectRoot,
          'FLA embedded video import was cancelled.',
          { cause: error },
        );
      }
      throw error;
    } finally {
      const remaining = this.activeImportsBySession.get(input.sessionId);
      remaining?.delete(sessionController);
      if (remaining && remaining.size === 0) {
        this.activeImportsBySession.delete(input.sessionId);
      }
    }
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
    this.cancelActiveImports();
    const directories = [...this.decodedSequences.values()].map((entry) => entry.directory);
    this.decodedSequences.clear();
    this.framePngCache.clear();
    this.latestTokenByAsset.clear();
    await Promise.all(
      directories.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)),
    );
  }
}

const MAX_MAIN_EXPORT_PNG_CACHE_BYTES = 32 * 1024 * 1024;
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
  private readonly rendererCache = new Map<string, true>();
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
    this.rendererCache.clear();
  }

  async collectVideoFramesForShotTime(
    project: Project,
    shot: Shot,
    shotLocalTimeMs: number,
    signal?: AbortSignal,
    outputLayerId?: string,
  ): Promise<{ videoFrames: ExportVideoFramePayload[]; videoFrameCacheTouches: string[] }> {
    const videoFrames: ExportVideoFramePayload[] = [];
    const videoFrameCacheTouches: string[] = [];
    const update = { videoFrames, videoFrameCacheTouches };
    if (!this.hasVideoAssets) return update;
    const evaluated = evaluateShotAtTime(shot, shotLocalTimeMs, project);
    const neededKeys: string[] = [];
    for (const layer of evaluated.layers) {
      if (!layer.visible || (outputLayerId && layer.id !== outputLayerId)) continue;
      if (!layer.assetId) continue;
      const parsed = parseFlaVideoFrameAssetKey(layer.assetId);
      if (!parsed) continue;
      if (!neededKeys.includes(layer.assetId)) neededKeys.push(layer.assetId);
    }
    if (neededKeys.length > EXPORT_VIDEO_FRAME_CACHE_LIMIT) {
      this.addDiagnostic(
        `单帧导出视频样本数超出 ${EXPORT_VIDEO_FRAME_CACHE_LIMIT} 帧预算，已跳过多余视频画面。`,
      );
      neededKeys.length = EXPORT_VIDEO_FRAME_CACHE_LIMIT;
    }
    // Touch current hits before adding any misses so a frame being drawn cannot be evicted by this update.
    const misses = neededKeys.filter((key) => {
      if (!touchExportVideoFrame(this.rendererCache, key)) return true;
      videoFrameCacheTouches.push(key);
      return false;
    });
    let batchBytes = 0;
    for (const frameKey of misses) {
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
      const rendererKey = `${entry.sha256}\u0000${frameKey}`;
      const bytes = await this.readFramePng(rendererKey, entry.framePaths[parsed.sampleIndex]!, entry.assetName);
      if (!bytes) continue;
      if (batchBytes + bytes.byteLength > 64 * 1024 * 1024) {
        this.addDiagnostic(
          `单帧导出视频数据超出 64 MiB 预算，已跳过“${entry.assetName}”第 ${parsed.sampleIndex + 1} 帧。`,
        );
        continue;
      }
      batchBytes += bytes.byteLength;
      videoFrames.push({
        assetId: frameKey,
        mimeType: 'image/png',
        bytes,
      });
      storeExportVideoFrame(this.rendererCache, frameKey, true);
    }
    this.totalFramesTransferred += videoFrames.length;
    if (videoFrames.length > this.peakFramesPerTransfer) {
      this.peakFramesPerTransfer = videoFrames.length;
    }
    return update;
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
          this.pngCache.size >= EXPORT_VIDEO_FRAME_CACHE_LIMIT ||
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

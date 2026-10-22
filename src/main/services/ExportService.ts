import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { buildExportAudioMixPlan } from '../../domain/export-audio-mix-plan';
import type { ExportAudioMixPlan } from '../../shared/audio-mix-types';
import {
  ExportProbeConfigSchema,
  FullProbeExportRequestSchema,
  MAX_PENDING_FRAMES,
  formalFrameCount,
  iterateFormalFrameSchedule,
  type ExportFrameReady,
  type ExportJobPhase,
  type ExportJobStatus,
  type ExportJobUpdate,
  type ExportLoadProbeRequest,
  type ExportLoadFormalRequest,
  type ExportProbeConfig,
  type ExportProbeLoaded,
  type ExportRenderFrameRequest,
  type FullProbeExportRequest,
} from '../../shared/export-types';
import type {
  AudioProbeResult,
  MuxAudioMixRequest,
  VideoProbeResult,
} from '../../shared/ffmpeg-types';
import type { FrozenExportInput } from './ExportPreparationService';
import type { FrameFileSystem } from './FileSystemService';

export interface FrameRenderer {
  loadProbe(request: ExportLoadProbeRequest): Promise<ExportProbeLoaded>;
  loadFormal?(request: ExportLoadFormalRequest): Promise<{ jobId: string; acknowledged: true }>;
  renderFrame(request: ExportRenderFrameRequest): Promise<ExportFrameReady>;
  cancelJob(jobId: string): boolean;
  prepareJob?(): Promise<void>;
  releaseJob?(jobId: string): void;
}

export interface FullProbeMediaAdapter {
  encodePngSequence(
    request: {
      framesDirectory: string;
      outputPath: string;
      fps: 24;
      overwrite: boolean;
    },
    signal?: AbortSignal,
  ): Promise<unknown>;
  muxSingleAudio(
    request: {
      videoPath: string;
      audioPath: string;
      startMs: number;
      outputPath: string;
      overwrite: boolean;
    },
    signal?: AbortSignal,
  ): Promise<unknown>;
  probeAudioFile?(
    audioPath: string,
    signal?: AbortSignal,
  ): Promise<AudioProbeResult>;
  muxAudioMix?(
    request: MuxAudioMixRequest,
    signal?: AbortSignal,
  ): Promise<unknown>;
  probeVideo(videoPath: string, signal?: AbortSignal): Promise<VideoProbeResult>;
  getActiveProcessCount?(): number;
}

export interface ExportJobRecord {
  jobId: string;
  status: ExportJobStatus;
  phase: ExportJobPhase;
  durationMs: number;
  totalFrames: number;
  completedFrames: number;
  outputDirectory: string | null;
  error: string | null;
}

interface FrameExportMetrics {
  peakPendingWrites: number;
  totalBytes: number;
  elapsedMs: number;
  memory: {
    heapUsedStart: number;
    heapUsedPeak: number;
    heapUsedEnd: number;
    rssStart: number;
    rssPeak: number;
    rssEnd: number;
  };
}

export interface ExportProbeResult extends ExportJobRecord, FrameExportMetrics {
  status: 'completed';
  phase: 'finished';
  outputDirectory: string;
}

export interface FullProbeExportResult extends ExportJobRecord {
  status: 'completed';
  phase: 'finished';
  outputDirectory: null;
  projectDirectory: string;
  outputPath: string;
  probe: VideoProbeResult;
  elapsedMs: number;
  render: FrameExportMetrics;
}

export interface FullProbeExportHandle {
  jobId: string;
  completion: Promise<FullProbeExportResult>;
}

interface ActiveJob {
  jobId: string;
  controller: AbortController;
  acceptsCancellation: boolean;
}

class ExportCancelledError extends Error {}
class ExportCleanupError extends Error {
  constructor(
    readonly resource: 'job-directory' | 'final-output-staging',
    message: string,
    readonly originalError?: unknown,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class ExportJobError extends Error {
  constructor(
    readonly jobId: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`Export Job ${jobId}: ${message}`, options);
    this.name = 'ExportJobError';
  }
}

type JobListener = (update: ExportJobUpdate) => void;

export class ExportService {
  private readonly jobs = new Map<string, ExportJobRecord>();
  private readonly completedOutputPaths = new Map<string, string>();
  private readonly listeners = new Set<JobListener>();
  private activeJob: ActiveJob | null = null;

  constructor(
    private readonly renderer: FrameRenderer,
    private readonly fileSystem: FrameFileSystem,
    private readonly mediaAdapter?: FullProbeMediaAdapter,
  ) {}

  getActiveJobId(): string | null {
    return this.activeJob?.jobId ?? null;
  }

  getActiveProcessCount(): number {
    return this.mediaAdapter?.getActiveProcessCount?.() ?? 0;
  }

  getJob(jobId: string): ExportJobRecord | null {
    const job = this.jobs.get(jobId);
    return job ? { ...job } : null;
  }

  getCompletedOutputPath(jobId: string): string | null {
    return this.completedOutputPaths.get(jobId) ?? null;
  }

  subscribe(listener: JobListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  cancelJob(jobId: string): boolean {
    const active = this.activeJob;
    if (!active || active.jobId !== jobId) {
      return false;
    }
    if (!active.acceptsCancellation) {
      return false;
    }
    const record = this.requireJob(jobId);
    if (active.controller.signal.aborted) {
      return true;
    }
    record.status = 'cancelling';
    this.emit(record);
    active.controller.abort();
    this.renderer.cancelJob(jobId);
    return true;
  }

  cancelActiveJob(): boolean {
    const jobId = this.getActiveJobId();
    return jobId ? this.cancelJob(jobId) : false;
  }

  async cleanupJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job?.outputDirectory) {
      return;
    }
    const directory = job.outputDirectory;
    job.phase = 'cleaning';
    this.emit(job);
    try {
      await this.fileSystem.cleanupJobDirectory(directory);
      job.outputDirectory = null;
      this.emit(job);
    } catch (error) {
      const reason = this.errorMessage(error);
      job.status = 'failed';
      job.error = `临时目录清理失败：${reason}`;
      this.emit(job);
      throw new ExportJobError(jobId, job.error, { cause: error });
    }
  }

  async runProbe(rawConfig: ExportProbeConfig): Promise<ExportProbeResult> {
    const config = ExportProbeConfigSchema.parse(rawConfig);
    const active = this.createJob(config);
    const record = this.requireJob(active.jobId);
    let jobDirectory: string | null = null;

    try {
      jobDirectory = await this.fileSystem.createJobDirectory(active.jobId);
      record.outputDirectory = jobDirectory;
      const metrics = await this.renderFrames(
        active,
        record,
        config,
        jobDirectory,
        () => this.renderer.loadProbe({ jobId: active.jobId, ...config }),
      );
      this.throwIfCancelled(active);
      record.status = 'completed';
      record.phase = 'finished';
      this.emit(record);
      return {
        ...record,
        status: 'completed',
        phase: 'finished',
        outputDirectory: jobDirectory,
        ...metrics,
      };
    } catch (error) {
      throw await this.finishFailedJob(active, record, jobDirectory, error);
    } finally {
      this.clearActiveJob(active);
    }
  }

  startFullProbe(rawRequest: FullProbeExportRequest): FullProbeExportHandle {
    const request = FullProbeExportRequestSchema.parse(rawRequest);
    if (!this.mediaAdapter) {
      throw new Error('Full probe export requires an FFmpeg adapter.');
    }
    const active = this.createJob(request);
    return {
      jobId: active.jobId,
      completion: this.executeFullProbe(active, request, this.mediaAdapter),
    };
  }

  startFormalExport(
    input: FrozenExportInput,
    assertOutputTargetUnchanged: () => Promise<void>,
  ): FullProbeExportHandle {
    if (!this.mediaAdapter) {
      throw new Error('Formal export requires an FFmpeg adapter.');
    }
    if (!this.renderer.loadFormal) {
      throw new Error('Formal export requires the formal hidden renderer.');
    }
    const shot = input.candidate.project.shots[0];
    if (!shot) throw new Error('Formal export candidate has no Shot.');
    if (
      (shot.audioClips?.length ?? 0) > 0 &&
      (!this.mediaAdapter.probeAudioFile || !this.mediaAdapter.muxAudioMix)
    ) {
      throw new Error('Formal export requires audio preflight and mixing.');
    }
    const active = this.createJob({
      durationMs: shot.durationMs,
      fps: input.candidate.renderSettings.fps,
    });
    return {
      jobId: active.jobId,
      completion: this.executeFormalExport(
        active,
        input,
        assertOutputTargetUnchanged,
        this.mediaAdapter,
      ),
    };
  }

  async runFullProbe(
    rawRequest: FullProbeExportRequest,
  ): Promise<FullProbeExportResult> {
    return this.startFullProbe(rawRequest).completion;
  }

  private async executeFullProbe(
    active: ActiveJob,
    request: FullProbeExportRequest,
    adapter: FullProbeMediaAdapter,
  ): Promise<FullProbeExportResult> {
    const record = this.requireJob(active.jobId);
    const startedAt = performance.now();
    let jobDirectory: string | null = null;
    let finalOutputStagingPath: string | null = null;
    let rendererPrepared = false;

    try {
      const outputPath = await this.fileSystem.prepareFinalOutput(
        request.outputPath,
        request.overwrite,
      );
      finalOutputStagingPath =
        this.fileSystem.createFinalOutputStagingPath(active.jobId, outputPath);
      const projectDirectory =
        await this.fileSystem.assertReadableProjectDirectory(
          request.projectDirectory,
        );
      this.throwIfCancelled(active);
      await this.renderer.prepareJob?.();
      rendererPrepared = true;
      this.throwIfCancelled(active);
      jobDirectory = await this.fileSystem.createJobDirectory(active.jobId);
      record.outputDirectory = jobDirectory;

      const render = await this.renderFrames(
        active,
        record,
        request,
        jobDirectory,
        () =>
          this.renderer.loadProbe({
            jobId: active.jobId,
            durationMs: request.durationMs,
            fps: request.fps,
          }),
      );
      this.throwIfCancelled(active);

      record.phase = 'encoding';
      this.emit(record);
      const silentVideoPath = path.join(jobDirectory, 'probe-silent.mp4');
      await adapter.encodePngSequence(
        {
          framesDirectory: jobDirectory,
          outputPath: silentVideoPath,
          fps: request.fps,
          overwrite: true,
        },
        active.controller.signal,
      );
      this.throwIfCancelled(active);

      record.phase = 'muxing';
      this.emit(record);
      await adapter.muxSingleAudio(
        {
          videoPath: silentVideoPath,
          audioPath: request.audioPath,
          startMs: request.audioStartMs,
          outputPath: finalOutputStagingPath,
          overwrite: false,
        },
        active.controller.signal,
      );
      this.throwIfCancelled(active);
      const probe = await adapter.probeVideo(
        finalOutputStagingPath,
        active.controller.signal,
      );
      this.throwIfCancelled(active);

      await this.cleanupDirectory(record, jobDirectory);
      jobDirectory = null;
      this.throwIfCancelled(active);
      record.phase = 'committing';
      active.acceptsCancellation = false;
      this.emit(record);
      await this.fileSystem.commitFinalOutput(
        finalOutputStagingPath,
        outputPath,
        request.overwrite,
      );
      finalOutputStagingPath = null;
      this.completedOutputPaths.set(active.jobId, outputPath);
      record.status = 'completed';
      record.phase = 'finished';
      this.emit(record);
      return {
        ...record,
        status: 'completed',
        phase: 'finished',
        outputDirectory: null,
        projectDirectory,
        outputPath,
        probe,
        elapsedMs: Math.round(performance.now() - startedAt),
        render,
      };
    } catch (error) {
      let failure = error;
      if (finalOutputStagingPath) {
        try {
          await this.fileSystem.cleanupFinalOutputStaging(
            finalOutputStagingPath,
          );
        } catch (cleanupError) {
          failure = new ExportCleanupError(
            'final-output-staging',
            `最终输出暂存清理失败：${this.errorMessage(cleanupError)}`,
            error,
            { cause: new AggregateError([error, cleanupError]) },
          );
        }
      }
      throw await this.finishFailedJob(
        active,
        record,
        jobDirectory,
        failure,
      );
    } finally {
      try {
        if (rendererPrepared) {
          this.renderer.releaseJob?.(active.jobId);
        }
      } finally {
        this.clearActiveJob(active);
      }
    }
  }

  private async executeFormalExport(
    active: ActiveJob,
    input: FrozenExportInput,
    assertOutputTargetUnchanged: () => Promise<void>,
    adapter: FullProbeMediaAdapter,
  ): Promise<FullProbeExportResult> {
    const record = this.requireJob(active.jobId);
    const startedAt = performance.now();
    const shot = input.candidate.project.shots[0]!;
    const outputPath = input.candidate.outputIntent.targetPath;
    let jobDirectory: string | null = null;
    let finalOutputStagingPath: string | null = null;
    let rendererPrepared = false;

    try {
      await assertOutputTargetUnchanged();
      const resolvedOutputPath = await this.fileSystem.prepareFormalOutput(
        outputPath,
      );
      finalOutputStagingPath = this.fileSystem.createFinalOutputStagingPath(
        active.jobId,
        resolvedOutputPath,
      );
      this.throwIfCancelled(active);
      await this.renderer.prepareJob?.();
      rendererPrepared = true;
      this.throwIfCancelled(active);
      jobDirectory = await this.fileSystem.createJobDirectory(active.jobId);
      record.outputDirectory = jobDirectory;
      const audioMixPlan = await this.prepareFormalAudioMixPlan(
        input,
        jobDirectory,
        adapter,
        active,
      );
      this.throwIfCancelled(active);

      const render = await this.renderFrames(
        active,
        record,
        {
          durationMs: shot.durationMs,
          fps: input.candidate.renderSettings.fps,
        },
        jobDirectory,
        () =>
          this.renderer.loadFormal!({
            jobId: active.jobId,
            project: input.candidate.project,
            cameraMode: input.candidate.cameraMode,
            media: input.media
              .filter((entry) => entry.kind === 'image')
              .map(({ assetId, mimeType, bytes }) => ({
                assetId,
                mimeType,
                bytes,
              })),
          }),
      );
      this.throwIfCancelled(active);

      record.phase = 'encoding';
      this.emit(record);
      const silentVideoPath = audioMixPlan
        ? path.join(jobDirectory, 'formal-silent.mp4')
        : finalOutputStagingPath;
      await adapter.encodePngSequence(
        {
          framesDirectory: jobDirectory,
          outputPath: silentVideoPath,
          fps: input.candidate.renderSettings.fps,
          overwrite: false,
        },
        active.controller.signal,
      );
      this.throwIfCancelled(active);

      if (audioMixPlan) {
        record.phase = 'muxing';
        this.emit(record);
        await adapter.muxAudioMix!(
          {
            videoPath: silentVideoPath,
            audioMixPlan,
            outputPath: finalOutputStagingPath,
            overwrite: false,
          },
          active.controller.signal,
        );
        this.throwIfCancelled(active);
      }

      record.phase = 'probing';
      this.emit(record);
      const probe = await adapter.probeVideo(
        finalOutputStagingPath,
        active.controller.signal,
      );
      this.assertFormalProbeMatches(
        probe,
        input.candidate.renderSettings.fps,
        record.totalFrames,
        audioMixPlan,
      );
      this.throwIfCancelled(active);

      await this.cleanupDirectory(record, jobDirectory);
      jobDirectory = null;
      this.throwIfCancelled(active);
      record.phase = 'committing';
      active.acceptsCancellation = false;
      this.emit(record);
      await assertOutputTargetUnchanged();
      await this.fileSystem.commitFormalOutputNoReplace(
        finalOutputStagingPath,
        resolvedOutputPath,
      );
      finalOutputStagingPath = null;
      this.completedOutputPaths.set(active.jobId, resolvedOutputPath);
      record.status = 'completed';
      record.phase = 'finished';
      this.emit(record);
      return {
        ...record,
        status: 'completed',
        phase: 'finished',
        outputDirectory: null,
        projectDirectory: input.candidate.projectRoot,
        outputPath: resolvedOutputPath,
        probe,
        elapsedMs: Math.round(performance.now() - startedAt),
        render,
      };
    } catch (error) {
      let failure = error;
      if (finalOutputStagingPath) {
        try {
          await this.fileSystem.cleanupFinalOutputStaging(
            finalOutputStagingPath,
          );
        } catch (cleanupError) {
          failure = new ExportCleanupError(
            'final-output-staging',
            `Final output staging cleanup failed: ${this.errorMessage(cleanupError)}`,
            error,
            { cause: new AggregateError([error, cleanupError]) },
          );
        }
      }
      throw await this.finishFailedJob(
        active,
        record,
        jobDirectory,
        failure,
      );
    } finally {
      try {
        if (rendererPrepared) this.renderer.releaseJob?.(active.jobId);
      } finally {
        this.clearActiveJob(active);
      }
    }
  }

  private assertFormalProbeMatches(
    probe: VideoProbeResult,
    fps: 24,
    frameCount: number,
    audioMixPlan: ExportAudioMixPlan | null,
  ): void {
    const failures: string[] = [];
    if (probe.codecName !== 'h264') failures.push('codec');
    if (probe.pixelFormat !== 'yuv420p') failures.push('pixel format');
    if (probe.width !== 1_920 || probe.height !== 1_080) {
      failures.push('frame size');
    }
    if (!Number.isFinite(probe.fps) || Math.abs(probe.fps - fps) > 0.001) {
      failures.push('frame rate');
    }
    if (probe.frameCount !== frameCount) failures.push('frame count');
    if (audioMixPlan) {
      if (!probe.hasAudio) failures.push('audio stream missing');
      if (probe.audioStreamCount !== 1) failures.push('audio stream count');
      if (probe.audioCodecName !== 'aac') failures.push('audio codec');
      if (probe.audioSampleRate !== 48_000) failures.push('audio sample rate');
      if (!probe.audioChannels || probe.audioChannels <= 0) {
        failures.push('audio channels');
      }
      const expectedAudioDurationSeconds =
        Math.max(...audioMixPlan.clips.map((clip) => clip.endMs)) / 1_000;
      if (
        !Number.isFinite(probe.audioDurationSeconds) ||
        Math.abs(
          (probe.audioDurationSeconds ?? Number.NaN) -
            expectedAudioDurationSeconds,
        ) > 0.08
      ) {
        failures.push('audio duration');
      }
    } else if (probe.hasAudio || probe.audioStreamCount !== 0) {
      failures.push('unexpected audio stream');
    }
    const expectedDurationSeconds = frameCount / fps;
    if (
      !Number.isFinite(probe.durationSeconds) ||
      Math.abs(probe.durationSeconds - expectedDurationSeconds) > 0.08
    ) {
      failures.push('duration');
    }
    if (failures.length > 0) {
      throw new Error('Formal MP4 verification failed: ' + failures.join(', '));
    }
  }

  private async prepareFormalAudioMixPlan(
    input: FrozenExportInput,
    jobDirectory: string,
    adapter: FullProbeMediaAdapter,
    active: ActiveJob,
  ): Promise<ExportAudioMixPlan | null> {
    const shot = input.candidate.project.shots[0];
    if (!shot || (shot.audioClips?.length ?? 0) === 0) return null;
    if (!adapter.probeAudioFile || !adapter.muxAudioMix) {
      throw new Error('Formal export requires audio preflight and mixing.');
    }

    const frozenAudio = new Map(
      input.media
        .filter((entry) => entry.kind === 'audio')
        .map((entry) => [entry.assetId, entry]),
    );
    const sourcePaths = new Map<string, string>();
    for (const clip of shot.audioClips) {
      if (
        !Number.isSafeInteger(clip.startMs) ||
        !Number.isSafeInteger(clip.endMs) ||
        !Number.isSafeInteger(clip.offsetMs) ||
        clip.startMs >= clip.endMs ||
        clip.endMs > shot.durationMs
      ) {
        throw new Error(`Audio clip ${clip.id} has an invalid Shot range.`);
      }
      const asset = input.candidate.project.assets.find(
        (candidate) => candidate.id === clip.assetId,
      );
      const media = frozenAudio.get(clip.assetId);
      if (!asset || asset.kind !== 'audio' || !media) {
        throw new Error(`Audio clip ${clip.id} has no frozen audio asset.`);
      }
      if (!sourcePaths.has(clip.assetId)) {
        const extension =
          media.mimeType === 'audio/mpeg'
            ? '.mp3'
            : media.mimeType === 'audio/wav'
              ? '.wav'
              : null;
        if (!extension) {
          throw new Error(`Audio asset ${asset.id} has an unsupported format.`);
        }
        const sourcePath = await this.fileSystem.writeFrozenAudio(
          jobDirectory,
          `audio-${asset.id}${extension}`,
          media.bytes,
        );
        this.throwIfCancelled(active);
        const probe = await adapter.probeAudioFile(
          sourcePath,
          active.controller.signal,
        );
        this.throwIfCancelled(active);
        if (
          !Number.isFinite(probe.durationSeconds) ||
          probe.durationSeconds <= 0 ||
          !Number.isInteger(probe.channels) ||
          probe.channels <= 0
        ) {
          throw new Error(`Audio asset ${asset.id} has invalid media metadata.`);
        }
        const sourceDurationMs = probe.durationSeconds * 1_000;
        const assetClips = shot.audioClips.filter(
          (candidate) => candidate.assetId === clip.assetId,
        );
        for (const assetClip of assetClips) {
          const requestedSourceEndMs =
            assetClip.offsetMs + (assetClip.endMs - assetClip.startMs);
          if (
            !Number.isSafeInteger(requestedSourceEndMs) ||
            requestedSourceEndMs > sourceDurationMs
          ) {
            throw new Error(
              `Audio clip ${assetClip.id} exceeds the frozen source duration.`,
            );
          }
        }
        sourcePaths.set(clip.assetId, sourcePath);
      }
    }

    return buildExportAudioMixPlan(
      shot.durationMs,
      shot.audioClips.map((clip) => {
        const sourcePath = sourcePaths.get(clip.assetId);
        if (!sourcePath) {
          throw new Error(`Audio clip ${clip.id} has no prepared source path.`);
        }
        return {
          clipId: clip.id,
          assetId: clip.assetId,
          role: clip.role,
          sourcePath,
          startMs: clip.startMs,
          endMs: clip.endMs,
          offsetMs: clip.offsetMs,
          volume: clip.volume,
        };
      }),
    );
  }

  private async renderFrames(
    active: ActiveJob,
    record: ExportJobRecord,
    config: { durationMs: number; fps: 24 },
    jobDirectory: string,
    loadProject: () => Promise<unknown>,
  ): Promise<FrameExportMetrics> {
    const totalFrames = formalFrameCount(config.durationMs, config.fps);
    if (totalFrames !== record.totalFrames) {
      throw new Error('Export frame schedule did not match the task record.');
    }
    const startedAt = performance.now();
    const startMemory = process.memoryUsage();
    let heapUsedPeak = startMemory.heapUsed;
    let rssPeak = startMemory.rss;
    let peakPendingWrites = 0;
    let totalBytes = 0;
    let writeFailure: Error | null = null;
    const pendingWrites = new Set<Promise<void>>();

    const waitForWriteSlot = async (): Promise<void> => {
      this.throwIfCancelled(active);
      if (writeFailure) throw writeFailure;
      while (pendingWrites.size >= MAX_PENDING_FRAMES) {
        record.phase = 'writing';
        this.emit(record);
        await Promise.race(pendingWrites);
        this.throwIfCancelled(active);
        if (writeFailure) throw writeFailure;
      }
      if (writeFailure) throw writeFailure;
    };

    try {
      record.phase = 'preparing';
      this.emit(record);
      await loadProject();
      this.throwIfCancelled(active);

      for (const frame of iterateFormalFrameSchedule(
        config.durationMs,
        config.fps,
      )) {
        await waitForWriteSlot();
        record.phase = 'rendering';
        this.emit(record);
        const rendered = await this.renderer.renderFrame({
          jobId: active.jobId,
          frameIndex: frame.frameIndex,
          timeMs: frame.timeMs,
        });
        this.throwIfCancelled(active);
        if (
          rendered.jobId !== active.jobId ||
          rendered.frameIndex !== frame.frameIndex ||
          rendered.timeMs !== frame.timeMs
        ) {
          throw new Error(
            `Renderer returned mismatched frame ${rendered.frameIndex}.`,
          );
        }

        totalBytes += rendered.pngBytes.byteLength;
        const writeTask = this.fileSystem
          .writeFrame(jobDirectory, frame.fileName, rendered.pngBytes)
          .then(
            () => {
              record.completedFrames += 1;
              this.emit(record);
            },
            (error: unknown) => {
              writeFailure =
                error instanceof Error
                  ? error
                  : new Error('Frame write failed.');
            },
          )
          .finally(() => pendingWrites.delete(writeTask));
        pendingWrites.add(writeTask);
        peakPendingWrites = Math.max(peakPendingWrites, pendingWrites.size);

        const memory = process.memoryUsage();
        heapUsedPeak = Math.max(heapUsedPeak, memory.heapUsed);
        rssPeak = Math.max(rssPeak, memory.rss);
      }

      if (pendingWrites.size > 0) {
        record.phase = 'writing';
        this.emit(record);
      }
      await Promise.all(pendingWrites);
      if (writeFailure) throw writeFailure;
      this.throwIfCancelled(active);
    } catch (error) {
      await Promise.all(pendingWrites);
      if (active.controller.signal.aborted) {
        throw new ExportCancelledError('cancel requested');
      }
      throw error;
    }

    const endMemory = process.memoryUsage();
    return {
      peakPendingWrites,
      totalBytes,
      elapsedMs: Math.round(performance.now() - startedAt),
      memory: {
        heapUsedStart: startMemory.heapUsed,
        heapUsedPeak,
        heapUsedEnd: endMemory.heapUsed,
        rssStart: startMemory.rss,
        rssPeak,
        rssEnd: endMemory.rss,
      },
    };
  }

  private createJob(config: { durationMs: number; fps: 24 }): ActiveJob {
    if (this.activeJob) {
      throw new ExportJobError(
        this.activeJob.jobId,
        'another invocation attempted to start while this Job is running.',
      );
    }
    const jobId = randomUUID();
    const record: ExportJobRecord = {
      jobId,
      status: 'running',
      phase: 'preparing',
      durationMs: config.durationMs,
      totalFrames: formalFrameCount(config.durationMs, config.fps),
      completedFrames: 0,
      outputDirectory: null,
      error: null,
    };
    const active = {
      jobId,
      controller: new AbortController(),
      acceptsCancellation: true,
    };
    this.jobs.set(jobId, record);
    this.activeJob = active;
    this.emit(record);
    return active;
  }

  private async cleanupDirectory(
    record: ExportJobRecord,
    directory: string,
  ): Promise<void> {
    record.phase = 'cleaning';
    this.emit(record);
    try {
      await this.fileSystem.cleanupJobDirectory(directory);
    } catch (error) {
      throw new ExportCleanupError(
        'job-directory',
        `临时目录清理失败：${this.errorMessage(error)}`,
        undefined,
        { cause: error },
      );
    }
    record.outputDirectory = null;
    this.emit(record);
  }

  private async finishFailedJob(
    active: ActiveJob,
    record: ExportJobRecord,
    jobDirectory: string | null,
    error: unknown,
  ): Promise<ExportJobError> {
    const cancelled = active.controller.signal.aborted;
    const cleanupErrors: unknown[] = [];
    if (error instanceof ExportCleanupError) {
      cleanupErrors.push(error);
    }
    if (
      jobDirectory &&
      !(
        error instanceof ExportCleanupError &&
        error.resource === 'job-directory'
      )
    ) {
      try {
        await this.cleanupDirectory(record, jobDirectory);
      } catch (caughtCleanupError) {
        cleanupErrors.push(caughtCleanupError);
      }
    }

    if (cleanupErrors.length > 0) {
      const originalError =
        error instanceof ExportCleanupError && error.originalError
          ? error.originalError
          : error;
      record.status = 'failed';
      record.phase = 'finished';
      record.error = `原始错误：${this.errorMessage(originalError)}；清理错误：${cleanupErrors.map((cleanupError) => this.errorMessage(cleanupError)).join('；')} 下一步：关闭占用文件或目录的程序后重试。`;
      this.emit(record);
      return new ExportJobError(active.jobId, record.error, {
        cause: new AggregateError([error, ...cleanupErrors]),
      });
    }

    record.status = cancelled ? 'cancelled' : 'failed';
    record.phase = 'finished';
    record.error = cancelled
      ? '导出已取消并完成资源清理；可以立即重新导出。'
      : `${this.errorMessage(error)} 下一步：检查输入路径和媒体工具后重试。`;
    this.emit(record);
    return new ExportJobError(active.jobId, record.error, { cause: error });
  }

  private throwIfCancelled(active: ActiveJob): void {
    if (active.controller.signal.aborted) {
      throw new ExportCancelledError('cancel requested');
    }
  }

  private clearActiveJob(active: ActiveJob): void {
    if (this.activeJob === active) {
      this.activeJob = null;
    }
  }

  private requireJob(jobId: string): ExportJobRecord {
    const record = this.jobs.get(jobId);
    if (!record) throw new Error(`Unknown Export Job ${jobId}.`);
    return record;
  }

  private emit(record: ExportJobRecord): void {
    const update: ExportJobUpdate = {
      jobId: record.jobId,
      status: record.status,
      phase: record.phase,
      completedFrames: record.completedFrames,
      totalFrames: record.totalFrames,
      error: record.error,
    };
    for (const listener of this.listeners) listener(update);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

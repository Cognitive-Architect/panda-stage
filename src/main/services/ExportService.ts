import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  ExportProbeConfigSchema,
  FullProbeExportRequestSchema,
  MAX_PENDING_FRAMES,
  createFrameSchedule,
  type ExportFrameReady,
  type ExportJobPhase,
  type ExportJobStatus,
  type ExportJobUpdate,
  type ExportLoadProbeRequest,
  type ExportProbeConfig,
  type ExportProbeLoaded,
  type ExportRenderFrameRequest,
  type FullProbeExportRequest,
} from '../../shared/export-types';
import type { VideoProbeResult } from '../../shared/ffmpeg-types';
import type { FrameFileSystem } from './FileSystemService';

export interface FrameRenderer {
  loadProbe(request: ExportLoadProbeRequest): Promise<ExportProbeLoaded>;
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

  private async renderFrames(
    active: ActiveJob,
    record: ExportJobRecord,
    config: ExportProbeConfig,
    jobDirectory: string,
  ): Promise<FrameExportMetrics> {
    const probeConfig = ExportProbeConfigSchema.parse({
      durationMs: config.durationMs,
      fps: config.fps,
    });
    const schedule = createFrameSchedule(probeConfig);
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
      await this.renderer.loadProbe({ jobId: active.jobId, ...probeConfig });
      this.throwIfCancelled(active);

      for (const frame of schedule) {
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

  private createJob(config: ExportProbeConfig): ActiveJob {
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
      totalFrames: createFrameSchedule({
        durationMs: config.durationMs,
        fps: config.fps,
      }).length,
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

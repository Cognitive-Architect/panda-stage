import { randomUUID } from 'node:crypto';
import {
  ExportProbeConfigSchema,
  MAX_PENDING_FRAMES,
  createFrameSchedule,
  type ExportFrameReady,
  type ExportJobStatus,
  type ExportLoadProbeRequest,
  type ExportProbeConfig,
  type ExportProbeLoaded,
  type ExportRenderFrameRequest,
} from '../../shared/export-types';
import type { FrameFileSystem } from './FileSystemService';

export interface FrameRenderer {
  loadProbe(request: ExportLoadProbeRequest): Promise<ExportProbeLoaded>;
  renderFrame(request: ExportRenderFrameRequest): Promise<ExportFrameReady>;
}

export interface ExportJobRecord {
  jobId: string;
  status: ExportJobStatus;
  durationMs: number;
  totalFrames: number;
  completedFrames: number;
  outputDirectory: string | null;
  error: string | null;
}

export interface ExportProbeResult extends ExportJobRecord {
  status: 'completed';
  outputDirectory: string;
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

interface ActiveJob {
  jobId: string;
  cancelRequested: boolean;
}

class ExportCancelledError extends Error {}

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

export class ExportService {
  private readonly jobs = new Map<string, ExportJobRecord>();
  private activeJob: ActiveJob | null = null;

  constructor(
    private readonly renderer: FrameRenderer,
    private readonly fileSystem: FrameFileSystem,
  ) {}

  getActiveJobId(): string | null {
    return this.activeJob?.jobId ?? null;
  }

  getJob(jobId: string): ExportJobRecord | null {
    const job = this.jobs.get(jobId);
    return job ? { ...job } : null;
  }

  cancelActiveJob(): boolean {
    if (!this.activeJob) {
      return false;
    }
    this.activeJob.cancelRequested = true;
    return true;
  }

  async cleanupJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job?.outputDirectory) {
      return;
    }
    await this.fileSystem.cleanupJobDirectory(job.outputDirectory);
    job.outputDirectory = null;
  }

  async runProbe(rawConfig: ExportProbeConfig): Promise<ExportProbeResult> {
    const config = ExportProbeConfigSchema.parse(rawConfig);
    if (this.activeJob) {
      throw new ExportJobError(
        this.activeJob.jobId,
        'another invocation attempted to start while this Job is running.',
      );
    }

    const jobId = randomUUID();
    const schedule = createFrameSchedule(config);
    const record: ExportJobRecord = {
      jobId,
      status: 'running',
      durationMs: config.durationMs,
      totalFrames: schedule.length,
      completedFrames: 0,
      outputDirectory: null,
      error: null,
    };
    this.jobs.set(jobId, record);
    this.activeJob = { jobId, cancelRequested: false };

    const startedAt = performance.now();
    const startMemory = process.memoryUsage();
    let heapUsedPeak = startMemory.heapUsed;
    let rssPeak = startMemory.rss;
    let peakPendingWrites = 0;
    let totalBytes = 0;
    let jobDirectory: string | null = null;
    let writeFailure: Error | null = null;
    const pendingWrites = new Set<Promise<void>>();

    const waitForWriteSlot = async (): Promise<void> => {
      if (writeFailure) {
        throw writeFailure;
      }
      while (pendingWrites.size >= MAX_PENDING_FRAMES) {
        await Promise.race(pendingWrites);
        if (writeFailure) {
          throw writeFailure;
        }
      }
      if (writeFailure) {
        throw writeFailure;
      }
    };

    try {
      jobDirectory = await this.fileSystem.createJobDirectory(jobId);
      record.outputDirectory = jobDirectory;
      await this.renderer.loadProbe({ jobId, ...config });

      for (const frame of schedule) {
        if (this.activeJob.cancelRequested) {
          throw new ExportCancelledError('cancel requested');
        }
        await waitForWriteSlot();

        const rendered = await this.renderer.renderFrame({
          jobId,
          frameIndex: frame.frameIndex,
          timeMs: frame.timeMs,
        });
        if (
          rendered.jobId !== jobId ||
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
          .catch((error: unknown) => {
            writeFailure =
              error instanceof Error ? error : new Error('Frame write failed.');
          })
          .finally(() => pendingWrites.delete(writeTask));
        pendingWrites.add(writeTask);
        peakPendingWrites = Math.max(peakPendingWrites, pendingWrites.size);
        void writeTask.then(() => {
          record.completedFrames += 1;
        });

        const memory = process.memoryUsage();
        heapUsedPeak = Math.max(heapUsedPeak, memory.heapUsed);
        rssPeak = Math.max(rssPeak, memory.rss);
      }

      await Promise.all(pendingWrites);
      if (writeFailure) {
        throw writeFailure;
      }
      if (this.activeJob.cancelRequested) {
        throw new ExportCancelledError('cancel requested');
      }

      const endMemory = process.memoryUsage();
      record.status = 'completed';
      return {
        ...record,
        status: 'completed',
        outputDirectory: jobDirectory,
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
    } catch (error) {
      await Promise.all(pendingWrites);
      if (jobDirectory) {
        await this.fileSystem.cleanupJobDirectory(jobDirectory);
        record.outputDirectory = null;
      }
      const cancelled = error instanceof ExportCancelledError;
      record.status = cancelled ? 'cancelled' : 'failed';
      record.error = error instanceof Error ? error.message : String(error);
      throw new ExportJobError(
        jobId,
        cancelled ? 'cancelled and cleaned up.' : record.error,
        { cause: error },
      );
    } finally {
      this.activeJob = null;
    }
  }
}

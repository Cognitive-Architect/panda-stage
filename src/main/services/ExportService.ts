import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, open, rmdir, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { projectDurationMs } from '../../domain/selectors/projectDuration';
import {
  buildExportAudioMixPlan,
  buildFormalExportAudioMixPlan,
} from '../../domain';
import type { ExportAudioMixPlan } from '../../shared/audio-mix-types';
import {
  ExportProbeConfigSchema,
  FullProbeExportRequestSchema,
  MAX_PENDING_FRAMES,
  formalFrameCount,
  formatFrameFileName,
  formatSpriteSheetFrameName,
  formatSpriteSheetPageImageName,
  frameTimeMs,
  iterateFormalProjectFrameSchedule,
  iterateFormalFrameSchedule,
  planPngSequenceFrames,
  planSpriteSheetPages,
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
  type ProjectFrameScheduleEntry,
  type SpriteSheetPlan,
} from '../../shared/export-types';
import {
  SpriteSheetAtlasOptionsSchema,
  type SpriteSheetAtlasOptions,
} from '../../shared/export-preparation-types';
import {
  StreamingSpriteSheetPacker,
  buildPixiPageManifest,
  decodeRgbaPng,
  formatPixiPageJsonName,
  scaleRgbaImage,
  trimRgbaImage,
  type FlushedAtlasPage,
  type PackedSpriteFrame,
} from './sprite-sheet-atlas';
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
  prepareJob?(kind?: 'probe' | 'formal'): Promise<void>;
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
  encodeSpriteSheet?(request: {
    framesDirectory: string;
    outputPath: string;
    frameCount: number;
    columns: number;
    rows: number;
    fps: number;
  }, signal?: AbortSignal): Promise<void>;
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
  attemptId?: string;
  snapshotId?: string;
  status: ExportJobStatus;
  phase: ExportJobPhase;
  durationMs: number;
  totalFrames: number;
  completedFrames: number;
  outputDirectory: string | null;
  error: string | null;
  originalError?: string | null;
  cleanupError?: string | null;
  outputPath?: string;
  incomplete?: boolean;
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
  completion?: Promise<unknown>;
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

  canCancelJob(jobId: string): boolean {
    return (
      this.activeJob?.jobId === jobId &&
      this.activeJob.acceptsCancellation &&
      !this.activeJob.controller.signal.aborted
    );
  }

  async waitForJob(jobId: string): Promise<void> {
    const active = this.activeJob;
    if (!active || active.jobId !== jobId) return;
    await active.completion?.then(
      () => undefined,
      () => undefined,
    );
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
      job.originalError = null;
      job.cleanupError = reason;
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
    const audioMixPlan = buildExportAudioMixPlan(
      request.durationMs,
      request.audioClips,
    );
    const active = this.createJob(request);
    const completion = this.executeFullProbe(
      active,
      request,
      audioMixPlan,
      this.mediaAdapter,
    );
    active.completion = completion;
    return {
      jobId: active.jobId,
      completion,
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
    const project = input.candidate.project;
    if (project.shots.length === 0) {
      throw new Error('Formal export candidate has no Shot.');
    }
    const durationMs = projectDurationMs(project);
    if (
      project.shots.some((shot) => shot.audioClips.length > 0) &&
      (!this.mediaAdapter.probeAudioFile || !this.mediaAdapter.muxAudioMix)
    ) {
      throw new Error('Formal export requires audio preflight and mixing.');
    }
    const active = this.createJob({
      durationMs,
      fps: input.candidate.renderSettings.fps,
      attemptId: input.candidate.attemptId,
      snapshotId: input.candidate.snapshotId,
    });
    const completion = this.executeFormalExport(
      active,
      input,
      assertOutputTargetUnchanged,
      this.mediaAdapter,
    );
    active.completion = completion;
    return {
      jobId: active.jobId,
      completion,
    };
  }

  startPngSequenceExport(input: FrozenExportInput, assertOutputTargetUnchanged: () => Promise<void>): {
    jobId: string;
    completion: Promise<{ outputPath: string }>;
  } {
    const settings = input.candidate.pngSequence;
    if (!settings || !this.renderer.loadFormal) throw new Error('PNG export requires a frozen Shot and the formal renderer.');
    const schedule = planPngSequenceFrames(input.candidate.project, settings);
    const { width, height } = input.candidate.renderSettings;
    const atlasOptions = settings.spriteSheet && settings.spriteSheetOptions
      ? SpriteSheetAtlasOptionsSchema.parse(settings.spriteSheetOptions)
      : undefined;
    const spriteSheetPlan = settings.spriteSheet && !atlasOptions
      ? planSpriteSheetPages(schedule.totalFrames, width, height)
      : undefined;
    const active = this.createJob({ durationMs: schedule.shot.durationMs, fps: input.candidate.renderSettings.fps,
      totalFrames: schedule.totalFrames, attemptId: input.candidate.attemptId, snapshotId: input.candidate.snapshotId });
    const completion = atlasOptions
      ? this.executePackedSpriteSheet(active, input, schedule, atlasOptions, assertOutputTargetUnchanged)
      : spriteSheetPlan
        ? this.executeSpriteSheet(active, input, schedule, spriteSheetPlan, assertOutputTargetUnchanged)
        : this.executePngSequence(active, input, schedule, assertOutputTargetUnchanged);
    active.completion = completion;
    return { jobId: active.jobId, completion };
  }

  private async executePngSequence(active: ActiveJob, input: FrozenExportInput, schedule: ReturnType<typeof planPngSequenceFrames>,
    assertOutputTargetUnchanged: () => Promise<void>): Promise<{ outputPath: string }> {
    const record = this.requireJob(active.jobId);
    const outputPath = input.candidate.outputIntent.targetPath;
    const marker = path.join(outputPath, 'incomplete.json');
    let ownsOutput = false;
    let ownsMarker = false;
    let rendererPrepared = false;
    try {
      await assertOutputTargetUnchanged();
      this.throwIfCancelled(active);
      await mkdir(outputPath);
      ownsOutput = true;
      record.outputPath = outputPath;
      record.incomplete = true;
      await writeFile(marker, JSON.stringify({ status: 'incomplete', totalFrames: record.totalFrames }), { flag: 'wx' });
      ownsMarker = true;
      this.throwIfCancelled(active);
      await this.renderer.prepareJob?.('formal');
      rendererPrepared = true;
      await this.renderPngExportFrames(active, record, input, schedule, outputPath,
        (fileName, bytes) => writeNewPngFrame(path.join(outputPath, fileName), bytes));
      this.throwIfCancelled(active);
      active.acceptsCancellation = false;
      record.phase = 'committing';
      this.emit(record);
      await unlink(marker);
      record.incomplete = false;
      record.status = 'completed';
      record.phase = 'finished';
      this.completedOutputPaths.set(active.jobId, outputPath);
      this.emit(record);
      return { outputPath };
    } catch (error) {
      const cancelled = active.controller.signal.aborted;
      record.status = cancelled ? 'cancelled' : 'failed';
      record.phase = 'finished';
      record.error = cancelled ? 'PNG 序列导出已取消。' : `PNG 序列导出失败：${this.errorMessage(error)}`;
      if (ownsOutput) {
        this.completedOutputPaths.set(active.jobId, outputPath);
        record.error += `保留 ${record.completedFrames}/${record.totalFrames} 帧。`;
      }
      if (ownsMarker) {
        await writeFile(marker, JSON.stringify({ status: record.status, completedFrames: record.completedFrames,
          totalFrames: record.totalFrames }, null, 2)).catch(() => undefined);
      }
      this.emit(record);
      throw new ExportJobError(active.jobId, record.error, { cause: error });
    } finally {
      try { if (rendererPrepared) this.renderer.releaseJob?.(active.jobId); }
      finally { this.clearActiveJob(active); }
    }
  }

  private async renderPngExportFrames(
    active: ActiveJob,
    record: ExportJobRecord,
    input: FrozenExportInput,
    schedule: ReturnType<typeof planPngSequenceFrames>,
    directory: string,
    write: (fileName: string, bytes: Uint8Array) => Promise<void>,
  ): Promise<void> {
    const project = { ...input.candidate.project, shots: [schedule.shot] };
    await this.renderFrames(active, record, { durationMs: schedule.shot.durationMs, fps: input.candidate.renderSettings.fps },
      directory, () => this.renderer.loadFormal!({
        jobId: active.jobId, project, cameraMode: input.candidate.cameraMode,
        ...(input.candidate.pngSequence?.transparent ? {} : { solidClear: true }),
        ...(input.candidate.dialogueSilence ? { dialogueSilence: input.candidate.dialogueSilence } : {}),
        media: input.media.filter(entry => entry.kind === 'image').map(({ assetId, mimeType, bytes }) => ({ assetId, mimeType, bytes })),
      }), project, {
        frames: schedule.frames(), totalFrames: schedule.totalFrames, maxPendingWrites: 1, write,
      });
  }

  private async executeSpriteSheet(
    active: ActiveJob,
    input: FrozenExportInput,
    schedule: ReturnType<typeof planPngSequenceFrames>,
    plan: SpriteSheetPlan,
    assertOutputTargetUnchanged: () => Promise<void>,
  ): Promise<{ outputPath: string }> {
    const record = this.requireJob(active.jobId);
    const outputPath = input.candidate.outputIntent.targetPath;
    const { width, height, fps } = input.candidate.renderSettings;
    let jobDirectory: string | null = null;
    let rendererPrepared = false;
    try {
      if (!this.mediaAdapter?.encodeSpriteSheet) throw new Error('精灵图编码器当前不可用。');
      await assertOutputTargetUnchanged();
      this.throwIfCancelled(active);
      jobDirectory = await this.fileSystem.createJobDirectory(active.jobId);
      record.outputDirectory = jobDirectory;
      await this.renderer.prepareJob?.('formal');
      rendererPrepared = true;
      const directory = jobDirectory;
      const singleShotProject = { ...input.candidate.project, shots: [schedule.shot] };
      record.phase = 'preparing';
      this.emit(record);
      await this.renderer.loadFormal!({
        jobId: active.jobId,
        project: singleShotProject,
        cameraMode: input.candidate.cameraMode,
        ...(input.candidate.pngSequence?.transparent ? {} : { solidClear: true }),
        ...(input.candidate.dialogueSilence ? { dialogueSilence: input.candidate.dialogueSilence } : {}),
        media: input.media
          .filter((entry) => entry.kind === 'image')
          .map(({ assetId, mimeType, bytes }) => ({ assetId, mimeType, bytes })),
      });
      this.throwIfCancelled(active);

      const allScheduledFrames = Array.from(schedule.frames());
      const stagedPages: Array<{ stagedPng: string; imageName: string }> = [];
      const manifestFrames: Array<{
        index: number;
        name: string;
        timeMs: number;
        durationMs: number;
        page: number;
        frame: { x: number; y: number; w: number; h: number };
        rotated: false;
        trimmed: false;
        sourceSize: { w: number; h: number };
      }> = [];

      for (const page of plan.pages) {
        this.throwIfCancelled(active);
        const pageSlice = allScheduledFrames.slice(page.frameStart, page.frameStart + page.frameCount);
        const pageFrames: ProjectFrameScheduleEntry[] = pageSlice.map((entry, localIndex) => ({
          ...entry,
          fileName: formatFrameFileName(localIndex),
        }));

        await this.renderFrames(
          active,
          record,
          { durationMs: schedule.shot.durationMs, fps },
          directory,
          async () => undefined,
          singleShotProject,
          {
            frames: pageFrames,
            totalFrames: page.frameCount,
            skipLoad: true,
            maxPendingWrites: 1,
            write: (fileName, bytes) => {
              assertExportPngSize(bytes, width, height);
              return this.fileSystem.writeFrame(directory, fileName, bytes);
            },
          },
        );
        this.throwIfCancelled(active);

        record.phase = 'encoding';
        this.emit(record);
        const stagedPng = path.join(directory, page.imageName);
        await this.mediaAdapter.encodeSpriteSheet(
          {
            framesDirectory: directory,
            outputPath: stagedPng,
            frameCount: page.frameCount,
            columns: page.columns,
            rows: page.rows,
            fps,
          },
          active.controller.signal,
        );
        this.throwIfCancelled(active);
        await assertSpriteSheetPng(stagedPng, page.width, page.height);
        stagedPages.push({ stagedPng, imageName: page.imageName });

        // Remove this page's raw frames immediately so we never retain multiple pages' frames on disk.
        for (let localIndex = 0; localIndex < page.frameCount; localIndex += 1) {
          await unlink(path.join(directory, formatFrameFileName(localIndex))).catch(() => undefined);
        }

        for (let localIndex = 0; localIndex < pageSlice.length; localIndex += 1) {
          const entry = pageSlice[localIndex]!;
          const nextTimeMs = frameTimeMs(schedule.firstFrameIndex + entry.frameIndex + 1, fps);
          manifestFrames.push({
            index: entry.frameIndex,
            name: formatSpriteSheetFrameName(entry.frameIndex),
            timeMs: entry.timeMs,
            durationMs: Math.max(1, nextTimeMs - entry.timeMs),
            page: page.pageIndex,
            frame: {
              x: (localIndex % page.columns) * width,
              y: Math.floor(localIndex / page.columns) * height,
              w: width,
              h: height,
            },
            rotated: false,
            trimmed: false,
            sourceSize: { w: width, h: height },
          });
        }
      }

      const isMultiPage = plan.pages.length > 1;
      const firstPage = plan.pages[0]!;
      const manifest = isMultiPage
        ? {
            frames: manifestFrames,
            pages: plan.pages.map((page) => ({
              index: page.pageIndex,
              image: page.imageName,
              size: { w: page.width, h: page.height },
              columns: page.columns,
              rows: page.rows,
              frameStart: page.frameStart,
              frameCount: page.frameCount,
            })),
            meta: {
              image: firstPage.imageName,
              images: plan.pages.map((page) => page.imageName),
              pageCount: plan.pages.length,
              fps,
              size: { w: firstPage.width, h: firstPage.height },
              origin: 'top-left',
              units: 'px',
            },
          }
        : {
            frames: manifestFrames,
            meta: {
              image: firstPage.imageName,
              fps,
              size: { w: firstPage.width, h: firstPage.height },
              origin: 'top-left',
              units: 'px',
            },
          };

      await assertOutputTargetUnchanged();
      this.throwIfCancelled(active);
      active.acceptsCancellation = false;
      record.phase = 'committing';
      this.emit(record);
      await publishSpriteSheetArtifacts(outputPath, stagedPages, [
        { fileName: 'sprite-sheet.json', content: JSON.stringify(manifest, null, 2) + '\n' },
      ]);
      record.outputPath = outputPath;
      this.completedOutputPaths.set(active.jobId, outputPath);
      await this.cleanupDirectory(record, jobDirectory);
      jobDirectory = null;
      record.status = 'completed';
      record.phase = 'finished';
      this.emit(record);
      return { outputPath };
    } catch (error) {
      throw await this.finishFailedJob(active, record, jobDirectory, error);
    } finally {
      try { if (rendererPrepared) this.renderer.releaseJob?.(active.jobId); }
      finally { this.clearActiveJob(active); }
    }
  }

  private async executePackedSpriteSheet(
    active: ActiveJob,
    input: FrozenExportInput,
    schedule: ReturnType<typeof planPngSequenceFrames>,
    atlasOptions: SpriteSheetAtlasOptions,
    assertOutputTargetUnchanged: () => Promise<void>,
  ): Promise<{ outputPath: string }> {
    const record = this.requireJob(active.jobId);
    const outputPath = input.candidate.outputIntent.targetPath;
    const { width, height, fps } = input.candidate.renderSettings;
    let jobDirectory: string | null = null;
    let rendererPrepared = false;
    try {
      await assertOutputTargetUnchanged();
      this.throwIfCancelled(active);
      jobDirectory = await this.fileSystem.createJobDirectory(active.jobId);
      record.outputDirectory = jobDirectory;
      await this.renderer.prepareJob?.('formal');
      rendererPrepared = true;
      const directory = jobDirectory;
      const singleShotProject = { ...input.candidate.project, shots: [schedule.shot] };
      const anchor = atlasOptions.anchor ?? { x: 0.5, y: 0.5 };
      const packer = new StreamingSpriteSheetPacker({
        trim: atlasOptions.trim,
        scale: atlasOptions.scale,
        padding: atlasOptions.padding,
        extrusion: atlasOptions.extrusion,
        anchor,
      });

      const stagedPages: Array<{
        pageIndex: number;
        stagedPng: string;
        width: number;
        height: number;
        frames: PackedSpriteFrame[];
      }> = [];

      const stageFlushedPage = async (page: FlushedAtlasPage): Promise<void> => {
        const stagedPng = path.join(directory, `staged-page-${String(page.pageIndex).padStart(3, '0')}.png`);
        await writeFile(stagedPng, page.pngBytes);
        await assertSpriteSheetPng(stagedPng, page.width, page.height);
        stagedPages.push({
          pageIndex: page.pageIndex,
          stagedPng,
          width: page.width,
          height: page.height,
          frames: page.frames,
        });
      };

      const allScheduledFrames = Array.from(schedule.frames());
      let cursor = 0;

      await this.renderFrames(
        active,
        record,
        { durationMs: schedule.shot.durationMs, fps },
        directory,
        () =>
          this.renderer.loadFormal!({
            jobId: active.jobId,
            project: singleShotProject,
            cameraMode: input.candidate.cameraMode,
            ...(input.candidate.dialogueSilence ? { dialogueSilence: input.candidate.dialogueSilence } : {}),
            media: input.media
              .filter((entry) => entry.kind === 'image')
              .map(({ assetId, mimeType, bytes }) => ({ assetId, mimeType, bytes })),
          }),
        singleShotProject,
        {
          frames: allScheduledFrames,
          totalFrames: schedule.totalFrames,
          maxPendingWrites: 1,
          write: async (_fileName, bytes) => {
            assertExportPngSize(bytes, width, height);
            const entry = allScheduledFrames[cursor]!;
            cursor += 1;
            const decoded = decodeRgbaPng(bytes);
            const scaled = scaleRgbaImage(decoded, atlasOptions.scale);
            const trimmed = trimRgbaImage(scaled, atlasOptions.trim);
            const nextTimeMs = frameTimeMs(schedule.firstFrameIndex + entry.frameIndex + 1, fps);
            const flushed = packer.addFrame(
              {
                index: entry.frameIndex,
                name: formatSpriteSheetFrameName(entry.frameIndex),
                timeMs: entry.timeMs,
                durationMs: Math.max(1, nextTimeMs - entry.timeMs),
              },
              trimmed,
            );
            if (flushed) {
              await stageFlushedPage(flushed);
            }
          },
        },
      );
      this.throwIfCancelled(active);

      record.phase = 'encoding';
      this.emit(record);
      const finalPage = packer.flushCurrentPage();
      if (finalPage) {
        await stageFlushedPage(finalPage);
      }
      if (stagedPages.length === 0) {
        throw new Error('没有可排入精灵图的有效帧。');
      }
      this.throwIfCancelled(active);

      const pageCount = stagedPages.length;
      const allFrames = stagedPages.flatMap((page) => page.frames);
      const allFrameNames = allFrames.map((frame) => frame.name);
      const animationName = atlasOptions.animationName?.trim() || schedule.shot.name.trim() || 'clip';

      const pngOutputs = stagedPages.map((page) => ({
        stagedPng: page.stagedPng,
        imageName: formatSpriteSheetPageImageName(page.pageIndex, pageCount),
      }));

      const jsonOutputs: Array<{ fileName: string; content: string }> = [];
      if (atlasOptions.format === 'pixi') {
        const pixiSheetNames: string[] = [];
        for (const page of stagedPages) {
          const imageName = formatSpriteSheetPageImageName(page.pageIndex, pageCount);
          const jsonName = formatPixiPageJsonName(page.pageIndex, pageCount);
          pixiSheetNames.push(jsonName);
          const pixiManifest = buildPixiPageManifest({
            pageIndex: page.pageIndex,
            pageCount,
            imageName,
            width: page.width,
            height: page.height,
            pageFrames: page.frames,
            allFrameNames,
            animationName,
          });
          jsonOutputs.push({
            fileName: jsonName,
            content: JSON.stringify(pixiManifest, null, 2) + '\n',
          });
        }
        if (pageCount > 1) {
          const masterManifest = {
            format: 'panda-sprite-sheet-master',
            pixiEntry: pixiSheetNames[0]!,
            pixiSheets: pixiSheetNames,
            frames: allFrames,
            pages: stagedPages.map((page, idx) => ({
              index: page.pageIndex,
              image: pngOutputs[idx]!.imageName,
              pixiManifest: pixiSheetNames[idx]!,
              size: { w: page.width, h: page.height },
              frameCount: page.frames.length,
            })),
            meta: {
              image: pngOutputs[0]!.imageName,
              images: pngOutputs.map((entry) => entry.imageName),
              pageCount,
              fps,
              scale: atlasOptions.scale,
              padding: atlasOptions.padding,
              extrusion: atlasOptions.extrusion,
              anchor,
              trimmed: atlasOptions.trim,
              origin: 'top-left',
              units: 'px',
            },
          };
          jsonOutputs.push({
            fileName: 'sprite-sheet.json',
            content: JSON.stringify(masterManifest, null, 2) + '\n',
          });
        }
      } else {
        const pandaManifest = {
          frames: allFrames,
          ...(pageCount > 1
            ? {
                pages: stagedPages.map((page, idx) => ({
                  index: page.pageIndex,
                  image: pngOutputs[idx]!.imageName,
                  size: { w: page.width, h: page.height },
                  frameCount: page.frames.length,
                })),
              }
            : {}),
          meta: {
            image: pngOutputs[0]!.imageName,
            ...(pageCount > 1
              ? { images: pngOutputs.map((entry) => entry.imageName), pageCount }
              : {}),
            fps,
            size: { w: stagedPages[0]!.width, h: stagedPages[0]!.height },
            scale: atlasOptions.scale,
            padding: atlasOptions.padding,
            extrusion: atlasOptions.extrusion,
            anchor,
            trimmed: atlasOptions.trim,
            origin: 'top-left',
            units: 'px',
          },
        };
        jsonOutputs.push({
          fileName: 'sprite-sheet.json',
          content: JSON.stringify(pandaManifest, null, 2) + '\n',
        });
      }

      await assertOutputTargetUnchanged();
      this.throwIfCancelled(active);
      active.acceptsCancellation = false;
      record.phase = 'committing';
      this.emit(record);
      await publishSpriteSheetArtifacts(outputPath, pngOutputs, jsonOutputs);
      record.outputPath = outputPath;
      this.completedOutputPaths.set(active.jobId, outputPath);
      await this.cleanupDirectory(record, jobDirectory);
      jobDirectory = null;
      record.status = 'completed';
      record.phase = 'finished';
      this.emit(record);
      return { outputPath };
    } catch (error) {
      throw await this.finishFailedJob(active, record, jobDirectory, error);
    } finally {
      try { if (rendererPrepared) this.renderer.releaseJob?.(active.jobId); }
      finally { this.clearActiveJob(active); }
    }
  }

  async runFullProbe(
    rawRequest: FullProbeExportRequest,
  ): Promise<FullProbeExportResult> {
    return this.startFullProbe(rawRequest).completion;
  }

  private async executeFullProbe(
    active: ActiveJob,
    request: FullProbeExportRequest,
    audioMixPlan: ReturnType<typeof buildExportAudioMixPlan>,
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
      await this.renderer.prepareJob?.('probe');
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
      if (!adapter.muxAudioMix) {
        throw new Error('Full probe export requires audio mixing support.');
      }
      await adapter.muxAudioMix(
        {
          videoPath: silentVideoPath,
          audioMixPlan,
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
    const project = input.candidate.project;
    const durationMs = projectDurationMs(project);
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
      await this.renderer.prepareJob?.('formal');
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
          durationMs,
          fps: input.candidate.renderSettings.fps,
        },
        jobDirectory,
        () =>
          this.renderer.loadFormal!({
            jobId: active.jobId,
            project: input.candidate.project,
            cameraMode: input.candidate.cameraMode,
            ...(input.candidate.dialogueSilence ? { dialogueSilence: input.candidate.dialogueSilence } : {}),
            media: input.media
              .filter((entry) => entry.kind === 'image')
              .map(({ assetId, mimeType, bytes }) => ({
                assetId,
                mimeType,
                bytes,
              })),
          }),
        project,
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
      const expectedAudioDurationSeconds = audioMixPlan.durationMs / 1_000;
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
    const project = input.candidate.project;
    const durationMs = projectDurationMs(project);
    if (!project.shots.some((shot) => shot.audioClips.length > 0)) return null;
    if (!adapter.probeAudioFile || !adapter.muxAudioMix) {
      throw new Error('Formal export requires audio preflight and mixing.');
    }

    const frozenAudio = new Map(
      input.media
        .filter((entry) => entry.kind === 'audio')
        .map((entry) => [entry.assetId, entry]),
    );
    const sourcePaths = new Map<string, string>();
    const sourceDurations = new Map<string, number>();
    const mappedClips: Array<{
      shotStartMs: number;
      clip: (typeof project.shots)[number]['audioClips'][number];
    }> = [];
    let shotStartMs = 0;
    for (const shot of project.shots) {
      if (!Number.isSafeInteger(shotStartMs + shot.durationMs)) {
        throw new Error('Formal export Project duration exceeds the safe range.');
      }
      for (const clip of shot.audioClips) {
        if (
          !Number.isSafeInteger(clip.startMs) ||
          !Number.isSafeInteger(clip.endMs) ||
          !Number.isSafeInteger(clip.offsetMs) ||
          clip.startMs < 0 ||
          clip.offsetMs < 0 ||
          clip.startMs >= clip.endMs ||
          clip.endMs > shot.durationMs
        ) {
          throw new Error(`Audio clip ${clip.id} has an invalid Shot range.`);
        }
        const asset = project.assets.find(
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
          sourcePaths.set(clip.assetId, sourcePath);
          sourceDurations.set(clip.assetId, probe.durationSeconds * 1_000);
        }
        const requestedSourceEndMs =
          clip.offsetMs + (clip.endMs - clip.startMs);
        if (
          !Number.isSafeInteger(requestedSourceEndMs) ||
          requestedSourceEndMs > (sourceDurations.get(clip.assetId) ?? 0)
        ) {
          throw new Error(
            `Audio clip ${clip.id} exceeds the frozen source duration.`,
          );
        }
        mappedClips.push({ shotStartMs, clip });
      }
      shotStartMs += shot.durationMs;
    }

    return buildFormalExportAudioMixPlan(
      durationMs,
      mappedClips.map(({ shotStartMs: prefixMs, clip }) => {
        const sourcePath = sourcePaths.get(clip.assetId);
        const startMs = prefixMs + clip.startMs;
        const endMs = prefixMs + clip.endMs;
        if (!sourcePath || !Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs)) {
          throw new Error(`Audio clip ${clip.id} has no safe Project time mapping.`);
        }
        return {
          clipId: clip.id,
          assetId: clip.assetId,
          role: clip.role,
          sourcePath,
          startMs,
          endMs,
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
    project?: FrozenExportInput['candidate']['project'],
    schedule?: { frames: Iterable<ProjectFrameScheduleEntry>; totalFrames: number; maxPendingWrites: number;
      skipLoad?: boolean;
      write: (fileName: string, bytes: Uint8Array) => Promise<void> },
  ): Promise<FrameExportMetrics> {
    const totalFrames = schedule?.totalFrames ?? formalFrameCount(config.durationMs, config.fps);
    if (schedule?.skipLoad) {
      if (record.completedFrames + totalFrames > record.totalFrames) {
        throw new Error('Export frame schedule exceeded the task record.');
      }
    } else if (totalFrames !== record.totalFrames) {
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
      while (pendingWrites.size >= (schedule?.maxPendingWrites ?? MAX_PENDING_FRAMES)) {
        record.phase = 'writing';
        this.emit(record);
        await Promise.race(pendingWrites);
        this.throwIfCancelled(active);
        if (writeFailure) throw writeFailure;
      }
      if (writeFailure) throw writeFailure;
    };

    try {
      if (!schedule?.skipLoad) {
        record.phase = 'preparing';
        this.emit(record);
        await loadProject();
        this.throwIfCancelled(active);
      }

      const frames = schedule?.frames ?? (project
        ? iterateFormalProjectFrameSchedule(project, config.fps)
        : iterateFormalFrameSchedule(config.durationMs, config.fps));
      for (const frame of frames) {
        await waitForWriteSlot();
        record.phase = 'rendering';
        this.emit(record);
        const request: ExportRenderFrameRequest = {
          jobId: active.jobId,
          frameIndex: frame.frameIndex,
          timeMs: frame.timeMs,
          ...(project
            ? {
                shotId: (frame as ProjectFrameScheduleEntry).shotId,
                shotLocalTimeMs: (frame as ProjectFrameScheduleEntry)
                  .shotLocalTimeMs,
              }
            : {}),
        };
        const rendered = await this.renderer.renderFrame(request);
        this.throwIfCancelled(active);
        if (
          rendered.jobId !== active.jobId ||
          rendered.frameIndex !== frame.frameIndex ||
          rendered.timeMs !== frame.timeMs ||
          rendered.shotId !== request.shotId ||
          rendered.shotLocalTimeMs !== request.shotLocalTimeMs
        ) {
          throw new Error(
            `Renderer returned mismatched frame ${rendered.frameIndex}.`,
          );
        }

        totalBytes += rendered.pngBytes.byteLength;
        const writeTask = (schedule ? schedule.write(frame.fileName, rendered.pngBytes)
          : this.fileSystem.writeFrame(jobDirectory, frame.fileName, rendered.pngBytes))
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

  private createJob(config: {
    durationMs: number;
    fps: 24;
    attemptId?: string;
    snapshotId?: string;
    totalFrames?: number;
  }): ActiveJob {
    if (this.activeJob) {
      throw new ExportJobError(
        this.activeJob.jobId,
        'another invocation attempted to start while this Job is running.',
      );
    }
    const jobId = randomUUID();
    const record: ExportJobRecord = {
      jobId,
      ...(config.attemptId ? { attemptId: config.attemptId } : {}),
      ...(config.snapshotId ? { snapshotId: config.snapshotId } : {}),
      status: 'running',
      phase: 'preparing',
      durationMs: config.durationMs,
      totalFrames: config.totalFrames ?? formalFrameCount(config.durationMs, config.fps),
      completedFrames: 0,
      outputDirectory: null,
      error: null,
      originalError: null,
      cleanupError: null,
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
      record.originalError =
        error instanceof ExportCleanupError && !error.originalError
          ? null
          : this.errorMessage(originalError);
      record.cleanupError = cleanupErrors
        .map((cleanupError) => this.errorMessage(cleanupError))
        .join('；');
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
    record.originalError = cancelled ? null : this.errorMessage(error);
    record.cleanupError = null;
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
      ...(record.attemptId ? { attemptId: record.attemptId } : {}),
      ...(record.snapshotId ? { snapshotId: record.snapshotId } : {}),
      status: record.status,
      phase: record.phase,
      completedFrames: record.completedFrames,
      totalFrames: record.totalFrames,
      error: record.error,
      ...(record.outputPath ? { outputPath: record.outputPath, incomplete: record.incomplete } : {}),
      ...(record.originalError !== undefined
        ? { originalError: record.originalError }
        : {}),
      ...(record.cleanupError !== undefined
        ? { cleanupError: record.cleanupError }
        : {}),
    };
    for (const listener of this.listeners) listener(update);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

function assertExportPngSize(bytes: Uint8Array, width: number, height: number): void {
  const header = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(26, bytes.byteLength));
  if (header.length !== 26 || header.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      header.readUInt32BE(16) !== width || header.readUInt32BE(20) !== height) {
    throw new Error('A PNG did not match the scheduled export dimensions.');
  }
}

async function assertSpriteSheetPng(filePath: string, width: number, height: number): Promise<void> {
  const handle = await open(filePath, 'r');
  try {
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(26), 0, 26, 0);
    assertExportPngSize(buffer.subarray(0, bytesRead), width, height);
    if (buffer[24] !== 8 || buffer[25] !== 6) {
      throw new Error('The sprite sheet encoder did not produce the expected RGBA PNG.');
    }
  } finally {
    await handle.close();
  }
}

async function publishSpriteSheetArtifacts(
  outputPath: string,
  stagedPages: ReadonlyArray<{ stagedPng: string; imageName: string }>,
  jsonFiles: ReadonlyArray<{ fileName: string; content: string }>,
): Promise<void> {
  await mkdir(outputPath);
  const publishedFiles: string[] = [];
  try {
    for (const { stagedPng, imageName } of stagedPages) {
      const pngPath = path.join(outputPath, imageName);
      await copyFile(stagedPng, pngPath, constants.COPYFILE_EXCL);
      publishedFiles.push(pngPath);
    }
    for (const { fileName, content } of jsonFiles) {
      const jsonPath = path.join(outputPath, fileName);
      await writeNewPngFrame(jsonPath, Buffer.from(content));
      publishedFiles.push(jsonPath);
    }
  } catch (error) {
    const rollbackFailures: unknown[] = [];
    for (let index = publishedFiles.length - 1; index >= 0; index -= 1) {
      await unlink(publishedFiles[index]!).catch((failure: unknown) => rollbackFailures.push(failure));
    }
    await rmdir(outputPath).catch((failure: unknown) => rollbackFailures.push(failure));
    if (rollbackFailures.length > 0) {
      throw new AggregateError([error, ...rollbackFailures], '精灵图未完整写入，且无法清理输出目录。', { cause: error });
    }
    throw error;
  }
}

async function writeNewPngFrame(filePath: string, bytes: Uint8Array): Promise<void> {
  const file = await open(filePath, 'wx');
  try {
    await file.writeFile(bytes);
    await file.close();
  } catch (error) {
    await file.close().catch(() => undefined);
    await unlink(filePath).catch(() => undefined);
    throw error;
  }
}

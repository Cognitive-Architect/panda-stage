import { BrowserWindow } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { IpcChannels } from '../../../shared/ipc-channels';
import { FPS, MAX_EXPORT_PENDING_FRAMES, EXPORT_FRAME_RETRY_MAX } from '../../../shared/constants';
import type { ExportConfig, ExportProgress, RenderFrameResult } from '../../../shared/types';
import { createExportWindow, getExportWindow, closeExportWindow } from '../window';
import { FFmpegAdapter } from './FFmpegAdapter';

interface PendingFrame {
  frameIndex: number;
  timeMs: number;
  retries: number;
  state: 'pending' | 'writing' | 'done' | 'error';
}

export class ExportService {
  private mainWindow: BrowserWindow;
  private config: ExportConfig;
  private totalFrames: number;
  private currentFrameIndex: number = 0;
  private pendingFrames: Map<number, PendingFrame> = new Map();
  private cancelled: boolean = false;
  private ffmpegAdapter: FFmpegAdapter;
  private resolvePromise: ((value: void) => void) | null = null;
  private rejectPromise: ((reason: Error) => void) | null = null;
  private exportPromise: Promise<void> | null = null;
  private pendingSlotsResolver: (() => void) | null = null;
  private allPendingResolver: (() => void) | null = null;

  constructor(mainWindow: BrowserWindow, config: ExportConfig) {
    this.mainWindow = mainWindow;
    this.config = config;
    const totalDurationMs = config.project.shots.reduce((sum, shot) => sum + shot.durationMs, 0);
    this.totalFrames = Math.max(1, Math.ceil(totalDurationMs / (1000 / FPS)));
    this.ffmpegAdapter = new FFmpegAdapter();
  }

  async start(): Promise<void> {
    if (this.exportPromise) {
      throw new Error('Export already in progress');
    }

    this.exportPromise = new Promise((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });

    try {
      await fs.mkdir(this.config.tempDir, { recursive: true });

      const exportWindow = await createExportWindow();
      if (!exportWindow || exportWindow.isDestroyed()) {
        throw new Error('Failed to create export window');
      }

      this.pushProgress({
        stage: 'rendering',
        totalFrames: this.totalFrames,
        message: 'Initializing export...',
      });

      // 发送完整 Project 数据（仅一次）
      exportWindow.webContents.send(IpcChannels.EXPORT_START, this.config.project);

      // 启动串行帧调度器（背压控制）
      await this.runFrameScheduler(exportWindow);

      this.pushProgress({
        stage: 'audio',
        totalFrames: this.totalFrames,
        message: 'Processing audio...',
      });

      this.pushProgress({
        stage: 'encoding',
        totalFrames: this.totalFrames,
        message: 'Encoding video...',
      });

      await this.encodeVideo();

      this.pushProgress({
        stage: 'complete',
        totalFrames: this.totalFrames,
        message: 'Export complete',
      });

      this.mainWindow.webContents.send(IpcChannels.EXPORT_COMPLETE, this.config.outputPath);

      if (this.resolvePromise) {
        this.resolvePromise();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.pushProgress({
        stage: 'error',
        totalFrames: this.totalFrames,
        message,
      });
      this.mainWindow.webContents.send(IpcChannels.EXPORT_ERROR, message);
      if (this.rejectPromise) {
        this.rejectPromise(error instanceof Error ? error : new Error(message));
      }
    } finally {
      await this.cleanup();
    }

    return this.exportPromise;
  }

  private async runFrameScheduler(exportWindow: BrowserWindow): Promise<void> {
    while (this.currentFrameIndex < this.totalFrames && !this.cancelled) {
      // 背压控制：pending 帧数限制
      if (this.pendingFrames.size >= MAX_EXPORT_PENDING_FRAMES) {
        await this.waitForPendingSlots();
        if (this.cancelled) break;
      }

      // 串行发送：一次只发一个 render:frame
      const frameIndex = this.currentFrameIndex;
      const timeMs = frameIndex * (1000 / FPS);

      const pendingFrame: PendingFrame = {
        frameIndex,
        timeMs,
        retries: 0,
        state: 'pending',
      };
      this.pendingFrames.set(frameIndex, pendingFrame);

      exportWindow.webContents.send(IpcChannels.RENDER_FRAME, { frameIndex, timeMs });
      this.currentFrameIndex++;
    }

    await this.waitForAllPendingFrames();
  }

  private async waitForPendingSlots(): Promise<void> {
    return new Promise((resolve) => {
      this.pendingSlotsResolver = resolve;
      this.checkPendingResolvers();
    });
  }

  private async waitForAllPendingFrames(): Promise<void> {
    return new Promise((resolve) => {
      this.allPendingResolver = resolve;
      this.checkPendingResolvers();
    });
  }

  private checkPendingResolvers(): void {
    if (this.pendingSlotsResolver && (this.pendingFrames.size < MAX_EXPORT_PENDING_FRAMES || this.cancelled)) {
      const resolver = this.pendingSlotsResolver;
      this.pendingSlotsResolver = null;
      resolver();
    }
    if (this.allPendingResolver) {
      const hasPending = Array.from(this.pendingFrames.values()).some(
        (f) => f.state === 'pending' || f.state === 'writing'
      );
      if (!hasPending || this.cancelled) {
        const resolver = this.allPendingResolver;
        this.allPendingResolver = null;
        resolver();
      }
    }
  }

  // 方式 A: Renderer 通知 frame-ready，主进程调用 capturePage() + toPNG()
  async handleFrameReady(frameIndex: number): Promise<void> {
    const pendingFrame = this.pendingFrames.get(frameIndex);
    if (!pendingFrame || pendingFrame.state !== 'pending') return;

    const exportWindow = getExportWindow();
    if (!exportWindow || exportWindow.isDestroyed()) {
      this.handleFrameError(frameIndex, 'Export window destroyed');
      return;
    }

    try {
      pendingFrame.state = 'writing';

      const image = await exportWindow.webContents.capturePage();
      const buffer = image.toPNG();

      const framePath = path.join(
        this.config.tempDir,
        `frame_${String(frameIndex).padStart(6, '0')}.png`
      );
      // 流式异步写入，不用 writeFileSync
      await fs.writeFile(framePath, buffer);

      pendingFrame.state = 'done';
      this.pendingFrames.delete(frameIndex);

      this.pushProgress({
        stage: 'rendering',
        frameIndex,
        totalFrames: this.totalFrames,
        message: `Rendered frame ${frameIndex + 1}/${this.totalFrames}`,
      });

      this.checkPendingResolvers();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.handleFrameError(frameIndex, message);
    }
  }

  // 方式 B: 接收 canvas.toBlob() 获取的 Uint8Array
  async handleFrameResult(result: RenderFrameResult): Promise<void> {
    const pendingFrame = this.pendingFrames.get(result.frameIndex);
    if (!pendingFrame || pendingFrame.state !== 'pending') return;

    try {
      pendingFrame.state = 'writing';

      const framePath = path.join(
        this.config.tempDir,
        `frame_${String(result.frameIndex).padStart(6, '0')}.png`
      );
      // 流式异步写入，不用 writeFileSync
      await fs.writeFile(framePath, Buffer.from(result.buffer));

      pendingFrame.state = 'done';
      this.pendingFrames.delete(result.frameIndex);

      this.pushProgress({
        stage: 'rendering',
        frameIndex: result.frameIndex,
        totalFrames: this.totalFrames,
        message: `Rendered frame ${result.frameIndex + 1}/${this.totalFrames}`,
      });

      this.checkPendingResolvers();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.handleFrameError(result.frameIndex, message);
    }
  }

  handleFrameError(frameIndex: number, error: string): void {
    const pendingFrame = this.pendingFrames.get(frameIndex);
    if (!pendingFrame) return;

    if (pendingFrame.retries < EXPORT_FRAME_RETRY_MAX) {
      // 重试：最多两次
      pendingFrame.retries++;
      pendingFrame.state = 'pending';

      const exportWindow = getExportWindow();
      if (exportWindow && !exportWindow.isDestroyed()) {
        exportWindow.webContents.send(IpcChannels.RENDER_FRAME, {
          frameIndex,
          timeMs: pendingFrame.timeMs,
        });
      }

      this.pushProgress({
        stage: 'rendering',
        frameIndex,
        totalFrames: this.totalFrames,
        message: `Retrying frame ${frameIndex + 1} (attempt ${pendingFrame.retries})`,
      });
    } else {
      // 失败终止：不回退到主窗口，不继续导出
      pendingFrame.state = 'error';
      this.cancelled = true;

      this.pushProgress({
        stage: 'error',
        frameIndex,
        totalFrames: this.totalFrames,
        message: `Frame ${frameIndex + 1} failed after ${EXPORT_FRAME_RETRY_MAX} retries: ${error}`,
      });

      this.mainWindow.webContents.send(
        IpcChannels.EXPORT_ERROR,
        `Frame ${frameIndex + 1} failed: ${error}`
      );

      if (this.rejectPromise) {
        this.rejectPromise(new Error(`Frame ${frameIndex + 1} failed: ${error}`));
      }

      this.checkPendingResolvers();
    }
  }

  async cancel(): Promise<void> {
    this.cancelled = true;

    const exportWindow = getExportWindow();
    if (exportWindow && !exportWindow.isDestroyed()) {
      exportWindow.webContents.send(IpcChannels.RENDER_CANCEL);
    }

    this.pushProgress({
      stage: 'cancelled',
      totalFrames: this.totalFrames,
      message: 'Export cancelled',
    });

    this.checkPendingResolvers();

    if (this.exportPromise) {
      await this.exportPromise.catch(() => {
        // ignore cancellation rejection
      });
    }
  }

  private async encodeVideo(): Promise<void> {
    const frameListPath = path.join(this.config.tempDir, 'frame_list.txt');
    const lines: string[] = [];
    const frameDurationSec = (1000 / FPS / 1000).toFixed(6);

    for (let i = 0; i < this.totalFrames; i++) {
      const framePath = path.join(
        this.config.tempDir,
        `frame_${String(i).padStart(6, '0')}.png`
      );
      lines.push(`file '${framePath}'`);
      lines.push(`duration ${frameDurationSec}`);
    }

    // 最后一帧重复（concat demuxer 要求最后一行是 file）
    const lastFramePath = path.join(
      this.config.tempDir,
      `frame_${String(this.totalFrames - 1).padStart(6, '0')}.png`
    );
    lines.push(`file '${lastFramePath}'`);

    await fs.writeFile(frameListPath, lines.join('\n'));

    const ffmpegPath = await this.ffmpegAdapter.findFfmpeg();
    this.ffmpegAdapter.setPath(ffmpegPath);

    await this.ffmpegAdapter.encodeFrames(
      frameListPath,
      this.config.outputPath,
      (progress) => {
        this.pushProgress({
          stage: 'encoding',
          totalFrames: this.totalFrames,
          message: `Encoding: ${progress.percent.toFixed(1)}%`,
        });
      }
    );
  }

  private pushProgress(progress: ExportProgress): void {
    if (!this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IpcChannels.EXPORT_PROGRESS, progress);
    }
  }

  private async cleanup(): Promise<void> {
    closeExportWindow();
    if (this.cancelled) {
      try {
        await fs.rm(this.config.tempDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

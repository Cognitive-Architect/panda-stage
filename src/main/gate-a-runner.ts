import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { BrowserWindow } from 'electron';
import { registerIpcHandlers } from './ipc/register-ipc-handlers';
import { ExportService } from './services/ExportService';
import { FFmpegAdapter } from './services/FFmpegAdapter';
import { FileSystemService } from './services/FileSystemService';
import type { MediaToolPaths } from './services/production-resources';
import { HiddenWindowManager } from './windows/hidden-window-manager';
import { createMainWindow } from './windows/main-window';
import { frameTimeMs } from '../shared/export-types';
import { evaluateSubtitleAtTime } from '../shared/preview/subtitle-engine';
import {
  PROBE_PROJECT,
  PROBE_SUBTITLE_CUES,
} from '../shared/probe/probe-project';

const CONFIG = {
  durationMs: 3_000,
  fps: 24 as const,
  audioStartMs: 400,
};
const KEY_FRAMES = [0, 24, 48, 71] as const;
const PREVIEW_READY_TIMEOUT_MS = 15_000;

interface PreviewFrameEvidence {
  frameIndex: number;
  timeMs: number;
  path: string;
  width: number;
  height: number;
  source: 'StagePreview/CanvasStage main-window canvas';
}

async function waitForPreviewFrame(
  previewWindow: BrowserWindow,
  token: string,
  timeMs: number,
): Promise<void> {
  const deadline = Date.now() + PREVIEW_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const ready = await previewWindow.webContents.executeJavaScript(
      `(() => {
        const panel = document.querySelector('[data-testid="preview-panel"]');
        const stage = panel?.querySelector('[data-testid="stage-renderer"]');
        return document.documentElement.dataset.gatePreviewReady === ${JSON.stringify(token)} &&
          panel?.getAttribute('data-preview-render-source') === 'packaged-main-preview-gate' &&
          Number(stage?.getAttribute('data-stage-time')) === ${timeMs} &&
          stage?.getAttribute('data-stage-ready') === 'true';
      })()`,
      true,
    );
    if (ready === true) return;
    await delay(25);
  }
  throw new Error(`Main preview frame at ${timeMs}ms did not become ready.`);
}

async function captureMainPreviewFrames(
  previewWindow: BrowserWindow,
  outputDirectory: string,
): Promise<PreviewFrameEvidence[]> {
  await mkdir(outputDirectory, { recursive: true });
  const evidence: PreviewFrameEvidence[] = [];
  for (const frameIndex of KEY_FRAMES) {
    const timeMs = frameTimeMs(frameIndex);
    const token = `gate-a-main-preview-${frameIndex}-${timeMs}`;
    await previewWindow.webContents.executeJavaScript(
      `window.dispatchEvent(new CustomEvent('panda-stage:gate-preview-time', {
        detail: ${JSON.stringify({ timeMs, token })}
      }))`,
      true,
    );
    await waitForPreviewFrame(previewWindow, token, timeMs);
    const capture = (await previewWindow.webContents.executeJavaScript(
      `(() => {
        const canvas = document.querySelector(
          '[data-testid="preview-panel"] [data-testid="stage-renderer"] canvas'
        );
        if (!(canvas instanceof HTMLCanvasElement)) {
          throw new Error('Main StagePreview CanvasStage canvas is unavailable.');
        }
        return {
          width: canvas.width,
          height: canvas.height,
          dataUrl: canvas.toDataURL('image/png')
        };
      })()`,
      true,
    )) as { width: number; height: number; dataUrl: string };
    if (capture.width !== 1_920 || capture.height !== 1_080) {
      throw new Error(
        `Main preview canvas is ${capture.width}x${capture.height}; expected 1920x1080.`,
      );
    }
    const prefix = 'data:image/png;base64,';
    if (!capture.dataUrl.startsWith(prefix)) {
      throw new Error('Main preview canvas did not return a PNG data URL.');
    }
    const outputPath = path.join(
      outputDirectory,
      `main-preview-frame-${String(frameIndex).padStart(6, '0')}.png`,
    );
    await writeFile(outputPath, Buffer.from(capture.dataUrl.slice(prefix.length), 'base64'));
    evidence.push({
      frameIndex,
      timeMs,
      path: outputPath,
      width: capture.width,
      height: capture.height,
      source: 'StagePreview/CanvasStage main-window canvas',
    });
  }
  return evidence;
}

async function verifyChromiumPlayback(mediaPath: string): Promise<{
  source: 'packaged Electron Chromium HTMLVideoElement';
  videoWidth: number;
  videoHeight: number;
  durationSeconds: number;
  muted: boolean;
  startTimeSeconds: number;
  endTimeSeconds: number;
  advancedSeconds: number;
}> {
  const playbackWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const playbackPagePath = path.join(
    path.dirname(mediaPath),
    '.panda-stage-gate-playback.html',
  );
  try {
    await writeFile(
      playbackPagePath,
      '<!doctype html><meta charset="utf-8"><video id="gate-video" playsinline></video>',
      'utf8',
    );
    await playbackWindow.loadFile(playbackPagePath);
    const mediaUrl = pathToFileURL(mediaPath).toString();
    const result = (await playbackWindow.webContents.executeJavaScript(
      `(async () => {
        const video = document.getElementById('gate-video');
        video.src = ${JSON.stringify(mediaUrl)};
        video.muted = false;
        await new Promise((resolve, reject) => {
          video.addEventListener('loadedmetadata', resolve, { once: true });
          video.addEventListener('error', () => reject(new Error('HTMLVideoElement failed to load the Gate MP4.')), { once: true });
        });
        await video.play();
        const startTimeSeconds = video.currentTime;
        await new Promise((resolve) => setTimeout(resolve, 700));
        const endTimeSeconds = video.currentTime;
        video.pause();
        return {
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          durationSeconds: video.duration,
          muted: video.muted,
          startTimeSeconds,
          endTimeSeconds,
          advancedSeconds: endTimeSeconds - startTimeSeconds
        };
      })()`,
      true,
    )) as {
      videoWidth: number;
      videoHeight: number;
      durationSeconds: number;
      muted: boolean;
      startTimeSeconds: number;
      endTimeSeconds: number;
      advancedSeconds: number;
    };
    if (
      result.videoWidth !== 1_920 ||
      result.videoHeight !== 1_080 ||
      Math.abs(result.durationSeconds - 3.4) > 0.08 ||
      result.muted ||
      result.advancedSeconds < 0.3
    ) {
      throw new Error(`Packaged Chromium playback mismatch: ${JSON.stringify(result)}`);
    }
    return {
      source: 'packaged Electron Chromium HTMLVideoElement',
      ...result,
    };
  } finally {
    playbackWindow.destroy();
    await rm(playbackPagePath, { force: true });
  }
}

async function waitForCancellation(
  service: ExportService,
  outputPath: string,
  request: {
    projectDirectory: string;
    audioPath: string;
    durationMs: number;
    fps: 24;
    audioStartMs: number;
  },
): Promise<Record<string, unknown>> {
  const handle = service.startFullProbe({
    ...request,
    outputPath,
    overwrite: false,
  });
  let cancellationAccepted = false;
  let cancellationAttempted = false;
  const unsubscribe = service.subscribe((update) => {
    if (
      update.jobId === handle.jobId &&
      update.phase === 'rendering' &&
      update.completedFrames >= 1 &&
      !cancellationAttempted
    ) {
      cancellationAttempted = true;
      cancellationAccepted = service.cancelJob(handle.jobId);
    }
  });
  try {
    await handle.completion;
    throw new Error('Packaged cancellation probe unexpectedly completed.');
  } catch (error) {
    const record = service.getJob(handle.jobId);
    if (!cancellationAccepted || record?.status !== 'cancelled') {
      throw error;
    }
    return {
      jobId: handle.jobId,
      cancellationAccepted,
      status: record.status,
      error: record.error,
      activeJobAfter: service.getActiveJobId(),
      activeProcessesAfter: service.getActiveProcessCount(),
    };
  } finally {
    unsubscribe();
  }
}

export async function runPackagedGateA(
  mediaTools: MediaToolPaths,
  outputRoot: string,
): Promise<void> {
  const hiddenWindowManager = new HiddenWindowManager();
  const adapter = new FFmpegAdapter({
    ffmpegPath: mediaTools.ffmpegPath,
    ffprobePath: mediaTools.ffprobePath,
  });
  const frameRoot = path.join(outputRoot, '临时帧');
  const fileSystem = new FileSystemService(frameRoot);
  const service = new ExportService(hiddenWindowManager, fileSystem, adapter);
  const projectDirectory = path.join(outputRoot, '项目 快照 🐼');
  const exportsDirectory = path.join(outputRoot, '三次 导出 🎬');
  const previewDirectory = path.join(outputRoot, '主预览关键帧');
  await mkdir(projectDirectory, { recursive: true });
  await mkdir(exportsDirectory, { recursive: true });

  const snapshot = { project: PROBE_PROJECT, config: CONFIG };
  const serializedSnapshot = JSON.stringify(snapshot);
  const configHash = createHash('sha256')
    .update(serializedSnapshot)
    .digest('hex');
  await writeFile(
    path.join(projectDirectory, 'Gate A 同一项目快照.json'),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    'utf8',
  );

  let previewWindow: BrowserWindow | null = null;
  const removeIpcHandlers = registerIpcHandlers({
    getMainWindow: () => previewWindow,
    getHiddenWindow: () => hiddenWindowManager.getWindow(),
    markHiddenReady: (senderId) => hiddenWindowManager.markReady(senderId),
    markProbeLoaded: (senderId, payload) =>
      hiddenWindowManager.markProbeLoaded(senderId, payload),
    markFrameReady: (senderId, payload) =>
      hiddenWindowManager.markFrameReady(senderId, payload),
    markFrameFailed: (senderId, payload) =>
      hiddenWindowManager.markFrameFailed(senderId, payload),
    startFullProbe: () => {
      throw new Error('Gate A does not accept renderer-started exports.');
    },
    cancelExport: (jobId) => ({
      jobId,
      accepted: service.cancelJob(jobId),
      status: service.getJob(jobId)?.status ?? 'cancelled',
    }),
  });

  const request = {
    projectDirectory,
    audioPath: mediaTools.audioProbePath,
    ...CONFIG,
  };
  try {
    const ffmpeg = await adapter.validateExecutable();
    const audio = await adapter.validateAudioMuxExecutable();
    previewWindow = await createMainWindow({ gateA: true, show: false });
    const previewFrames = await captureMainPreviewFrames(
      previewWindow,
      previewDirectory,
    );
    previewWindow.destroy();
    previewWindow = null;
    const cancellation = await waitForCancellation(
      service,
      path.join(exportsDirectory, '已取消.mp4'),
      request,
    );
    const cancelledOutputEntries = await readdir(exportsDirectory);
    if (cancelledOutputEntries.length !== 0) {
      throw new Error('Packaged cancellation left an output or staging file.');
    }

    const runs = [];
    for (let index = 1; index <= 3; index += 1) {
      const outputPath = path.join(
        exportsDirectory,
        `熊猫片场 Gate A 第 ${index} 次 🐼.mp4`,
      );
      const result = await service.runFullProbe({
        ...request,
        outputPath,
        overwrite: false,
      });
      adapter.assertMuxProbeMatches(result.probe, {
        videoCodecName: 'h264',
        pixelFormat: 'yuv420p',
        width: 1_920,
        height: 1_080,
        fps: 24,
        frameCount: 72,
        audioCodecName: 'aac',
        audioSampleRate: 48_000,
        audioChannels: 1,
        videoDurationSeconds: 3,
        audioDurationSeconds: 3.4,
        formatDurationSeconds: 3.4,
        durationToleranceSeconds: 0.05,
      });
      const timing = await adapter.analyzeAudioTiming(outputPath);
      if (Math.abs(timing.leadingSilenceEndSeconds - 0.4) > 0.02) {
        throw new Error(
          `Run ${index} audio onset is ${timing.leadingSilenceEndSeconds}s.`,
        );
      }
      runs.push({
        index,
        jobId: result.jobId,
        outputPath,
        configHash,
        probe: result.probe,
        leadingSilenceEndSeconds: timing.leadingSilenceEndSeconds,
        elapsedMs: result.elapsedMs,
      });
    }
    const playback = await verifyChromiumPlayback(runs[0]!.outputPath);

    const remainingFrameJobs = await readdir(frameRoot).catch(() => []);
    if (
      remainingFrameJobs.length !== 0 ||
      service.getActiveJobId() !== null ||
      service.getActiveProcessCount() !== 0
    ) {
      throw new Error('Packaged Gate A left active export resources.');
    }
    const subtitles = KEY_FRAMES.map((frameIndex) => {
      const timeMs = frameTimeMs(frameIndex);
      return {
        frameIndex,
        timeMs,
        text: evaluateSubtitleAtTime(PROBE_SUBTITLE_CUES, timeMs)?.text ?? null,
      };
    });
    await writeFile(
      path.join(outputRoot, 'packaged-gate-results.json'),
      `${JSON.stringify(
        {
          status: 'PASS',
          packaged: true,
          resourceSource: mediaTools.source,
          resourcePaths: mediaTools,
          configHash,
          previewFrames,
          subtitles,
          playback,
          cancellation,
          cleanup: {
            frameJobEntries: remainingFrameJobs.length,
            activeJobId: service.getActiveJobId(),
            activeProcesses: service.getActiveProcessCount(),
          },
          mediaValidation: {
            ffmpegVersion: ffmpeg.versionLine,
            ffmpegExecutable: ffmpeg.executable,
            audioEncoderVersion: audio.versionLine,
          },
          runs,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  } finally {
    if (previewWindow && !previewWindow.isDestroyed()) previewWindow.destroy();
    removeIpcHandlers();
    hiddenWindowManager.close();
  }
}

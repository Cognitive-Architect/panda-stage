import { createHash } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { registerIpcHandlers } from './ipc/register-ipc-handlers';
import { ExportService } from './services/ExportService';
import { FFmpegAdapter } from './services/FFmpegAdapter';
import { FileSystemService } from './services/FileSystemService';
import type { MediaToolPaths } from './services/production-resources';
import { HiddenWindowManager } from './windows/hidden-window-manager';
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

  const removeIpcHandlers = registerIpcHandlers({
    getMainWindow: () => null,
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
          subtitles,
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
    removeIpcHandlers();
    hiddenWindowManager.close();
  }
}

import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AudioClipService,
  evaluateShotAtTime,
  ProjectSchema,
  type ImageAsset,
  type Layer,
  type Project,
  type VideoAsset,
} from '../../src/domain';
import { listShotGraphicImageAssetsAtTime } from '../../src/domain/selectors/temporalRender';
import { AssetCanvasImageService } from '../../src/main/services/AssetCanvasImageService';
import { ExportPreparationService } from '../../src/main/services/ExportPreparationService';
import { ExportService, type FrameRenderer } from '../../src/main/services/ExportService';
import { FFmpegAdapter } from '../../src/main/services/FFmpegAdapter';
import { FileSystemService } from '../../src/main/services/FileSystemService';
import {
  ExportVideoFrameSupply,
  FlaEmbeddedVideoService,
  prepareExportVideoFrameMedia,
} from '../../src/main/services/FlaEmbeddedVideoService';
import { applyExportJobUpdate } from '../../src/renderer/shell/exportTaskState';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { importFlaEmbeddedVideoToEditor } from '../../src/renderer/features/fla-import/importFlaEmbeddedVideo';
import { CanvasImageResourceSession } from '../../src/renderer/features/canvas/canvasImageResources';
import {
  FlaVideoImportRequestSchema,
  FlaVideoImportResponseSchema,
} from '../../src/shared/fla-video-api';
import { ExportRenderFrameRequestSchema, type ExportJobUpdate } from '../../src/shared/export-types';
import { storeExportVideoFrame, touchExportVideoFrame } from '../../src/shared/export-video-frame-cache';
import { preflightFlaBytes } from '../../src/main/services/fla-import-preflight-service';
import { readFlaEmbeddedVideo } from '../../src/main/services/fla-native-video';
import { ProjectService } from '../../src/main/services/ProjectService';
import { ProjectFileSystemService } from '../../src/main/services/ProjectFileSystemService';
import {
  createFlaVideoPresentationIndex,
  evaluateFlaVideoClock,
  flaVideoFrameAssetKey,
  planEmbeddedVideoAudioClips,
} from '../../src/shared/fla-video-clock';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';

const execFileAsync = promisify(execFile);
const bundledFfmpegPath = path.resolve('node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
const bundledFfprobePath = path.resolve('node_modules/@ffprobe-installer/win32-x64/ffprobe.exe');

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const createdDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

async function createSolidMp4WithAudio(
  outputPath: string,
  options: { fps?: number; durationSec?: number; width?: number; height?: number; includeAudio?: boolean } = {},
): Promise<void> {
  const fps = options.fps ?? 24;
  const durationSec = options.durationSec ?? 0.25; // 6 frames @ 24fps
  const width = options.width ?? 64;
  const height = options.height ?? 64;
  const args: string[] = [
    '-y',
    '-f', 'lavfi',
    '-i', `testsrc=duration=${durationSec}:size=${width}x${height}:rate=${fps}`,
  ];
  if (options.includeAudio !== false) {
    args.push('-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${durationSec}`);
  }
  args.push(
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
  );
  if (options.includeAudio !== false) {
    args.push('-c:a', 'aac', '-b:a', '128k', '-shortest');
  }
  args.push(outputPath);
  await execFileAsync(bundledFfmpegPath, args);
}

async function createToneWav(outputPath: string, frequencyHz: number, durationSec: number): Promise<void> {
  await execFileAsync(bundledFfmpegPath, [
    '-y',
    '-f', 'lavfi',
    '-i', `sine=frequency=${frequencyHz}:sample_rate=48000:duration=${durationSec}`,
    '-ac', '2',
    '-ar', '48000',
    '-c:a', 'pcm_s16le',
    outputPath,
  ]);
}

async function buildFlaWithEmbeddedVideo(videoName: string, mp4Bytes: Uint8Array): Promise<Uint8Array> {
  const prefix = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03, 0x04]);
  const datBytes = Buffer.concat([prefix, mp4Bytes]);
  const docXml = `<?xml version="1.0" encoding="utf-8"?>
<DOMDocument width="640" height="360" frameRate="24" xmlns="http://ns.adobe.com/xfl/2008/">
  <media>
    <DOMVideoItem name="${videoName}" videoType="H264" fps="24" width="64" height="64" videoDataHRef="clip.dat" />
  </media>
  <timelines>
    <DOMTimeline name="Scene 1">
      <layers>
        <DOMLayer name="Layer 1">
          <frames><DOMFrame index="0" duration="6"><elements /></DOMFrame></frames>
        </DOMLayer>
      </layers>
    </DOMTimeline>
  </timelines>
</DOMDocument>`;
  const zip = new JSZip();
  zip.file('DOMDocument.xml', docXml);
  zip.file('bin/clip.dat', datBytes);
  return zip.generateAsync({ type: 'uint8array' });
}

afterEach(async () => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!;
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe('E-F04 deterministic video clock (CFR / VFR / non-zero PTS / trim / loop / nested host)', () => {
  it('handles non-zero PTS, negative PTS, VFR intervals, trim, loop, and single-frame deterministically', () => {
    // Non-zero PTS starting at 90000 ticks (1.0s) in 1/90000 timebase, VFR gaps:
    // Frame 0: [90000, 93600) (40ms)
    // Frame 1: [93600, 102600) (100ms)
    // Frame 2: [102600, 106200) (40ms)
    const vfrTiming = {
      codec: 'h264',
      timeBase: { numerator: 1, denominator: 90_000 },
      startTick: 90_000,
      endTick: 106_200,
      presentationTicks: [90_000, 93_600, 102_600],
      hasAudio: false,
    };
    const index = createFlaVideoPresentationIndex(vfrTiming.presentationTicks, vfrTiming.endTick)!;
    expect(index(90_000)).toBe(0);
    expect(index(93_599)).toBe(0);
    expect(index(93_600)).toBe(1);
    expect(index(102_599)).toBe(1);
    expect(index(102_600)).toBe(2);
    expect(index(106_200)).toBeNull();

    // Non-zero PTS play-once mapping from shotTimeMs:
    expect(evaluateFlaVideoClock({ shotTimeMs: 0, timing: vfrTiming })?.sampleIndex).toBe(0);
    expect(evaluateFlaVideoClock({ shotTimeMs: 39, timing: vfrTiming })?.sampleIndex).toBe(0);
    expect(evaluateFlaVideoClock({ shotTimeMs: 40, timing: vfrTiming })?.sampleIndex).toBe(1);
    expect(evaluateFlaVideoClock({ shotTimeMs: 139, timing: vfrTiming })?.sampleIndex).toBe(1);
    expect(evaluateFlaVideoClock({ shotTimeMs: 140, timing: vfrTiming })?.sampleIndex).toBe(2);
    expect(evaluateFlaVideoClock({ shotTimeMs: 500, timing: vfrTiming })?.sampleIndex).toBe(2);

    // Loop within trim window [40ms, 180ms) => span 140ms:
    expect(evaluateFlaVideoClock({
      shotTimeMs: 0,
      timing: vfrTiming,
      playbackMode: 'loop',
      trimStartMs: 40,
      trimEndMs: 180,
    })?.sampleIndex).toBe(1);
    expect(evaluateFlaVideoClock({
      shotTimeMs: 100,
      timing: vfrTiming,
      playbackMode: 'loop',
      trimStartMs: 40,
      trimEndMs: 180,
    })?.sampleIndex).toBe(2);
    expect(evaluateFlaVideoClock({
      shotTimeMs: 140,
      timing: vfrTiming,
      playbackMode: 'loop',
      trimStartMs: 40,
      trimEndMs: 180,
    })?.sampleIndex).toBe(1);

    // Single-frame mode holds exact frame across any shotTimeMs:
    expect(evaluateFlaVideoClock({
      shotTimeMs: 9_999,
      timing: vfrTiming,
      playbackMode: 'single-frame',
      heldFrameIndex: 1,
    })?.sampleIndex).toBe(1);

    // Negative start PTS still anchors cleanly to local t=0:
    const negTiming = {
      codec: 'h264',
      timeBase: { numerator: 1, denominator: 1_000 },
      startTick: -100,
      endTick: 20,
      presentationTicks: [-100, -60, -20],
      hasAudio: false,
    };
    expect(evaluateFlaVideoClock({ shotTimeMs: 0, timing: negTiming })?.sampleIndex).toBe(0);
    expect(evaluateFlaVideoClock({ shotTimeMs: 45, timing: negTiming })?.sampleIndex).toBe(1);
    expect(evaluateFlaVideoClock({ shotTimeMs: 90, timing: negTiming })?.sampleIndex).toBe(2);
  });

  it('distinguishes nested held Graphic host from independent MovieClip clock', () => {
    const cfr24Timing = {
      codec: 'h264',
      timeBase: { numerator: 1, denominator: 24_000 },
      startTick: 0,
      endTick: 6_000,
      presentationTicks: [0, 1_000, 2_000, 3_000, 4_000, 5_000],
      hasAudio: false,
    };
    // Held Graphic host (single frame at firstFrame=2) stays at sample 2 regardless of shotTimeMs:
    const heldAt0 = evaluateFlaVideoClock({
      shotTimeMs: 0,
      timing: cfr24Timing,
      sourceFps: 24,
      nestedHost: { kind: 'graphic', playbackMode: 'single frame', firstFrame: 2, hostFrameCount: 6, hostFps: 24 },
    });
    const heldAt200 = evaluateFlaVideoClock({
      shotTimeMs: 200,
      timing: cfr24Timing,
      sourceFps: 24,
      nestedHost: { kind: 'graphic', playbackMode: 'single frame', firstFrame: 2, hostFrameCount: 6, hostFps: 24 },
    });
    expect(heldAt0?.sampleIndex).toBe(2);
    expect(heldAt200?.sampleIndex).toBe(2);

    // Independent MovieClip clock advances on its own timeline regardless of host Graphic hold:
    const mcAt0 = evaluateFlaVideoClock({
      shotTimeMs: 0,
      timing: cfr24Timing,
      nestedHost: { kind: 'movieclip', hostFrameCount: 6, hostFps: 24 },
    });
    const mcAt125 = evaluateFlaVideoClock({
      shotTimeMs: 125, // 3 frames @ 24fps
      timing: cfr24Timing,
      nestedHost: { kind: 'movieclip', hostFrameCount: 6, hostFps: 24 },
    });
    expect(mcAt0?.sampleIndex).toBe(0);
    expect(mcAt125?.sampleIndex).toBe(3);
  });
});

describe('E-F04 real Windows FFmpeg embedded-video formal loop', () => {
  it('imports FLA MP4, persists Save/Reopen, seeks deterministically with 1 sequential decode, isolates failure, and exports MP4 + mixed audio', async () => {
    const workDir = await makeTempDir('panda-ef04-');
    const projectRoot = path.join(workDir, 'project.pandastage');
    const mp4Path = path.join(workDir, 'sample.mp4');
    const bgmWavPath = path.join(workDir, 'bgm.wav');

    await createSolidMp4WithAudio(mp4Path, { fps: 24, durationSec: 0.25, width: 64, height: 64, includeAudio: true });
    await createToneWav(bgmWavPath, 220, 0.5);
    const mp4Bytes = await readFile(mp4Path);
    const flaBytes = await buildFlaWithEmbeddedVideo('IntroClip', mp4Bytes);
    const flaArchive = preflightFlaBytes(flaBytes, 'embedded-video.fla');

    // Create a formal project with a background image + an existing BGM AudioClip:
    const projectService = new ProjectService();
    const createdDoc = await projectService.create(projectRoot, { name: 'E-F04 Video Project' });
    const baseProject = createdDoc.project;
    const bgAssetId = randomUUID();
    const bgmAssetId = randomUUID();
    const bgLayerId = randomUUID();
    const shotId = randomUUID();

    const bgSha = createHash('sha256').update(TINY_PNG).digest('hex');
    const bgmBytes = await readFile(bgmWavPath);
    const bgmSha = createHash('sha256').update(bgmBytes).digest('hex');

    const bgAsset: ImageAsset = {
      id: bgAssetId,
      kind: 'image',
      name: 'bg.png',
      relativePath: 'assets/bg.png',
      mimeType: 'image/png',
      sha256: bgSha,
      width: 1,
      height: 1,
      usage: 'background',
      keywords: [],
    };
    const bgLayer: Layer = {
      id: bgLayerId,
      name: 'Background',
      source: { kind: 'asset', assetId: bgAssetId },
      anchor: 'center',
      x: 960,
      y: 540,
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 0,
      opacity: 1,
      visible: true,
      locked: false,
      flipX: false,
      zIndex: 0,
    };

    const initialProject: Project = ProjectSchema.parse({
      ...baseProject,
      assets: [
        bgAsset,
        {
          id: bgmAssetId,
          kind: 'audio',
          name: 'bgm.wav',
          relativePath: 'assets/bgm.wav',
          mimeType: 'audio/wav',
          sha256: bgmSha,
          durationMs: 500,
        },
      ],
      shots: [
        {
          id: shotId,
          name: 'Shot 1',
          durationMs: 500,
          defaultSubtitleStyleId: baseProject.subtitleStyles[0]!.id,
          backgroundLayerId: bgLayerId,
          layers: [bgLayer],
          timelineEvents: [],
          audioClips: [
            {
              id: randomUUID(),
              assetId: bgmAssetId,
              name: 'Existing BGM',
              role: 'bgm',
              startMs: 0,
              endMs: 500,
              offsetMs: 0,
              volume: 0.4,
            },
          ],
          dialogues: [],
        },
      ],
    });
    await writeFile(path.join(projectRoot, 'assets', 'bg.png'), TINY_PNG);
    await writeFile(path.join(projectRoot, 'assets', 'bgm.wav'), bgmBytes);
    await projectService.save(projectRoot, initialProject);

    const ffmpegAdapter = new FFmpegAdapter({
      ffmpegPath: bundledFfmpegPath,
      ffprobePath: bundledFfprobePath,
    });
    const decodeSpy = vi.spyOn(ffmpegAdapter, 'decodeFlaVideoFramesSequential');
    const flaSourceSha = createHash('sha256').update(flaBytes).digest('hex');

    // Use real readFlaEmbeddedVideo + real FFmpegAdapter.probeFlaNativeVideo (exact FlaImportService.prepareEmbeddedVideo logic):
    const flaImportBridge = {
      prepareEmbeddedVideo: async (
        _sessionId: string,
        videoName: string,
        adapter: Pick<FFmpegAdapter, 'probeFlaNativeVideo'>,
        signal: AbortSignal,
      ) => {
        const media = readFlaEmbeddedVideo(flaBytes, flaArchive.entries, videoName);
        if (!media) return null;
        const probeDir = await makeTempDir('panda-ef04-probe-');
        const target = path.join(probeDir, media.mimeType === 'video/mp4' ? 'source.mp4' : 'source.mov');
        await writeFile(target, media.bytes, { flag: 'wx' });
        const metadata = await adapter.probeFlaNativeVideo(target, signal);
        return { ...media, metadata, sourceSha256: flaSourceSha };
      },
    };

    const embeddedVideoService = new FlaEmbeddedVideoService({
      flaImportService: flaImportBridge,
      projectService,
      ffmpegAdapter,
      audioClipService: new AudioClipService(),
    });

    try {
      const imported = await embeddedVideoService.importFromFlaSession({
        sessionId: 'session-ef04',
        videoName: 'IntroClip',
        projectRoot,
        shotId,
        playbackMode: 'play-once',
        startTimeMs: 0,
      });

      expect(imported.ok).toBe(true);
      expect(imported.videoAsset.kind).toBe('video');
      expect(imported.videoAsset.mimeType).toBe('video/mp4');
      expect(imported.videoAsset.videoTiming.presentationTicks.length).toBeGreaterThanOrEqual(6);
      expect(imported.videoAsset.videoTiming.hasAudio).toBe(true);
      expect(imported.audioAsset?.kind).toBe('audio');
      expect(imported.audioClipId).toBeTruthy();

      // Verify original video persisted in <projectRoot>/assets/:
      const persistedStat = await stat(path.join(projectRoot, imported.videoAsset.relativePath));
      expect(persistedStat.size).toBe(mp4Bytes.byteLength);

      // 2. Formal Save & Reopen verification:
      const reopened = await projectService.open(projectRoot);
      const reopenedVideo = reopened.project.assets.find(
        (asset): asset is VideoAsset => asset.id === imported.videoAsset.id && asset.kind === 'video',
      );
      expect(reopenedVideo).toBeDefined();
      expect(reopenedVideo!.videoTiming.presentationTicks).toEqual(imported.videoAsset.videoTiming.presentationTicks);
      expect(reopenedVideo!.flaVideoSource?.videoItemName).toBe('IntroClip');
      expect(reopened.project.shots[0]!.audioClips).toHaveLength(2); // existing BGM + extracted video audio

      // 3. Deterministic Stage/Preview/Export sample parity + single sequential decode across forward/backward seeks:
      const shot = reopened.project.shots[0]!;
      const eval0 = evaluateShotAtTime(shot, 0, reopened.project);
      const eval125 = evaluateShotAtTime(shot, 125, reopened.project);
      const videoLayer0 = eval0.layers.find((l) => l.id === imported.layer.id)!;
      const videoLayer125 = eval125.layers.find((l) => l.id === imported.layer.id)!;
      expect(videoLayer0.assetId).toBe(flaVideoFrameAssetKey(reopenedVideo!.id, 0));
      expect(videoLayer125.assetId).toBe(flaVideoFrameAssetKey(reopenedVideo!.id, 3));

      // Canvas selector for Stage scrub also selects exact frame key:
      const scrubAssets = listShotGraphicImageAssetsAtTime(reopened.project, shot, 125);
      expect(scrubAssets.some((a) => a.id === videoLayer125.assetId)).toBe(true);

      // Forward seek, backward seek, pause -> SINGLE FFmpeg sequential decode call:
      const f0 = await embeddedVideoService.readSampleFrameAtTime({
        projectRoot,
        project: reopened.project,
        assetId: reopenedVideo!.id,
        shotTimeMs: 0,
        requestToken: 1,
      });
      const f3 = await embeddedVideoService.readSampleFrameAtTime({
        projectRoot,
        project: reopened.project,
        assetId: reopenedVideo!.id,
        shotTimeMs: 125,
        requestToken: 2,
      });
      const f0Back = await embeddedVideoService.readSampleFrameAtTime({
        projectRoot,
        project: reopened.project,
        assetId: reopenedVideo!.id,
        shotTimeMs: 0,
        requestToken: 3,
      });
      expect(f0.ok && f3.ok && f0Back.ok).toBe(true);
      if (f0.ok && f3.ok && f0Back.ok) {
        expect(f0.sample.sampleIndex).toBe(0);
        expect(f3.sample.sampleIndex).toBe(3);
        expect(f0Back.sample.sampleIndex).toBe(0);
        expect(f0Back.fromCache).toBe(true);
        // Frame 0 and Frame 3 bytes differ (real testsrc animation) while backward seek matches frame 0 identically:
        expect(Buffer.compare(f0.bytes, f0Back.bytes)).toBe(0);
        expect(Buffer.compare(f0.bytes, f3.bytes)).not.toBe(0);
      }
      expect(decodeSpy).toHaveBeenCalledTimes(1);

      // Stale rapid-seek protection: token 2 after token 3 is rejected as STALE_REQUEST:
      const stale = await embeddedVideoService.readSampleFrameAtTime({
        projectRoot,
        project: reopened.project,
        assetId: reopenedVideo!.id,
        shotTimeMs: 84,
        requestToken: 2,
      });
      expect(stale.ok).toBe(false);
      if (!stale.ok) expect(stale.code).toBe('STALE_REQUEST');

      // Stage/Preview read path via AssetCanvasImageService returns identical PNG bytes:
      const canvasImageService = new AssetCanvasImageService({
        getCurrentProjectSnapshot: (root) => (root === projectRoot ? { project: reopened.project } : null),
        embeddedVideoService,
      });
      const stageRead = await canvasImageService.read({
        projectRoot,
        assetId: videoLayer125.assetId,
        sha256: reopenedVideo!.sha256!,
      });
      expect(stageRead.ok).toBe(true);
      if (stageRead.ok && f3.ok) {
        expect(Buffer.compare(stageRead.bytes, f3.bytes)).toBe(0);
      }
      expect(decodeSpy).toHaveBeenCalledTimes(1);

      // 4. Local failure isolation: corrupt video asset fails locally without deleting original media or crashing healthy sibling layer:
      const corruptVideoPath = path.join(projectRoot, 'assets', 'corrupt.mp4');
      const corruptBytes = Buffer.from('NOT_A_VALID_MP4_STREAM');
      await writeFile(corruptVideoPath, corruptBytes);
      const corruptVideoAsset: VideoAsset = {
        ...reopenedVideo!,
        id: randomUUID(),
        name: 'CorruptVideo',
        relativePath: 'assets/corrupt.mp4',
        sha256: createHash('sha256').update(corruptBytes).digest('hex'),
      };
      const corruptRead = await embeddedVideoService.readSampleFrame({
        projectRoot,
        asset: corruptVideoAsset,
        sampleIndex: 0,
      });
      expect(corruptRead.ok).toBe(false);
      if (!corruptRead.ok) expect(corruptRead.code).toBe('DECODE_FAILED');
      expect((await readFile(corruptVideoPath)).toString('utf8')).toBe('NOT_A_VALID_MP4_STREAM');

      const stageModelWithMissingVideo = buildStageRenderModel(
        reopened.project,
        eval0,
        { [bgAssetId]: 'blob:bg' },
      );
      expect(stageModelWithMissingVideo.layers).toHaveLength(2);
      expect(stageModelWithMissingVideo.layers.find((l) => l.id === bgLayerId)?.sourceUrl).toBe('blob:bg');
      expect(stageModelWithMissingVideo.layers.find((l) => l.id === imported.layer.id)?.sourceUrl).toBe('');

      // 5. Formal Export end-to-end (ExportPreparationService -> ExportService -> real Windows FFmpeg MP4 + mixed audio):
      decodeSpy.mockClear();
      const outMp4 = path.join(workDir, 'formal-out.mp4');
      const prepService = new ExportPreparationService({
        getCurrentProjectSnapshot: (root) =>
          root === projectRoot
            ? { project: reopened.project, revision: 1, dirty: false, openInstanceId: 1 }
            : null,
      });
      const sel = await prepService.selectOutput(
        {
          projectRoot,
          projectId: reopened.project.id,
          projectName: reopened.project.name,
          openInstanceId: 1,
          videoFormat: 'mp4',
        },
        outMp4,
      );
      expect(sel.status).toBe('selected');
      if (sel.status !== 'selected') throw new Error('Select output blocked');

      const prep = await prepService.prepare({
        selectionId: sel.selectionId,
        attemptId: randomUUID(),
        projectRoot,
        projectId: reopened.project.id,
        openInstanceId: 1,
        revision: 1,
        dirty: false,
        cameraMode: 'static',
        videoOutput: { width: 1280, fps: 24 },
        project: reopened.project,
      });
      expect(prep.status).toBe('PREPARATION_READY');
      if (prep.status !== 'PREPARATION_READY') throw new Error(JSON.stringify(prep));

      const frozen = await prepService.acquireCandidateForExport(prep.candidate.snapshotId);
      const sample720PngPath = path.join(workDir, 'frame720.png');
      await execFileAsync(bundledFfmpegPath, [
        '-y', '-f', 'lavfi', '-i', 'color=c=0x224466:s=1280x720:d=0.05', '-frames:v', '1', sample720PngPath,
      ]);
      const solid720pPng = new Uint8Array(await readFile(sample720PngPath));

      let loadFormalIds: string[] = [];
      const rendererVideoCache = new Set<string>();
      let maxVideoFramesPerRender = 0;
      const mockFrameRenderer: FrameRenderer = {
        loadProbe: async () => { throw new Error('unused'); },
        loadFormal: async (req) => {
          loadFormalIds = req.media.map((m) => m.assetId);
          rendererVideoCache.clear();
          return { jobId: req.jobId, acknowledged: true };
        },
        renderFrame: async (req) => {
          if (req.videoFrames) {
            maxVideoFramesPerRender = Math.max(maxVideoFramesPerRender, req.videoFrames.length);
            for (const vf of req.videoFrames) rendererVideoCache.add(vf.assetId);
          }
          const ev = evaluateShotAtTime(shot, req.shotLocalTimeMs ?? req.timeMs, reopened.project);
          const expectedKey = ev.layers.find((l) => l.id === imported.layer.id)!.assetId;
          expect(rendererVideoCache.has(expectedKey!)).toBe(true);
          return {
            jobId: req.jobId,
            frameIndex: req.frameIndex,
            timeMs: req.timeMs,
            shotId: req.shotId,
            shotLocalTimeMs: req.shotLocalTimeMs,
            width: 1280,
            height: 720,
            pngBytes: solid720pPng,
          };
        },
        cancelJob: () => true,
      };

      const exportFs = new FileSystemService(path.join(workDir, 'export-temp'), {
        inspectWindowsVolume: async () => ({ driveType: 'Fixed', fileSystem: 'NTFS' }),
      });
      const exportService = new ExportService(mockFrameRenderer, exportFs, ffmpegAdapter);
      const exportHandle = exportService.startFormalExport(
        frozen,
        () => prepService.assertOutputTargetUnchanged(prep.candidate.snapshotId),
      );
      const exported = await exportHandle.completion;
      expect(exported.status).toBe('completed');
      // E-F07: loadFormal NEVER bulk-loads video frames; frames are supplied on-demand per renderFrame:
      expect(loadFormalIds.some((id) => id.includes('#frame:'))).toBe(false);
      expect(maxVideoFramesPerRender).toBeLessThanOrEqual(1);
      expect(decodeSpy).toHaveBeenCalledTimes(1);
      expect(exported.probe.width).toBe(1280);
      expect(exported.probe.height).toBe(720);
      expect(exported.probe.codecName).toBe('h264');
      expect(exported.probe.hasAudio).toBe(true);
      expect(exported.probe.audioCodecName).toBe('aac');

      await prepService.finalizeCandidateExport(prep.candidate.snapshotId);
      await prepService.dispose();

      // Local failure isolation in export helper:
      const corruptDecodeDir = await makeTempDir('panda-ef04-corrupt-');
      const isolated = await prepareExportVideoFrameMedia({
        project: { ...reopened.project, assets: [...reopened.project.assets, corruptVideoAsset] },
        media: [{ assetId: corruptVideoAsset.id, kind: 'video', mimeType: 'video/mp4', bytes: corruptBytes }],
        jobDirectory: corruptDecodeDir,
        adapter: ffmpegAdapter,
      });
      expect(isolated.frameMedia).toHaveLength(0);
      expect(isolated.diagnostics).toHaveLength(1);
      expect(isolated.diagnostics[0]).toContain('CorruptVideo');
    } finally {
      await embeddedVideoService.dispose();
    }
  }, 60_000);

  it('decodes the exact probe-selected stream when an attached_pic cover is stream 0, rejects frame count mismatch, and aligns audio clips across trim/loop/held/AV-offset/multi-occurrence (E-F10)', async () => {
    const workDir = await makeTempDir('panda-ef10-');
    const coverPng = path.join(workDir, 'cover.png');
    const mainMp4 = path.join(workDir, 'main.mp4');
    const multiStreamMp4 = path.join(workDir, 'with-cover-stream0.mp4');

    // Generate 1-frame red cover PNG and 6-frame testsrc H.264+AAC MP4:
    await execFileAsync(bundledFfmpegPath, [
      '-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=0.05', '-frames:v', '1', coverPng,
    ]);
    await createSolidMp4WithAudio(mainMp4, { fps: 24, durationSec: 0.25, width: 64, height: 64, includeAudio: true });
    // Mux audio as stream 0, playable H.264 video as stream 1, and attached_pic cover as stream 2:
    // (In MP4, attached_pic is stored in covr metadata; placing audio at index 0 guarantees
    // playable video is stream 1 != 0, plus attached_pic is excluded by probe.)
    await execFileAsync(bundledFfmpegPath, [
      '-y',
      '-i', coverPng,
      '-i', mainMp4,
      '-map', '1:a:0',
      '-map', '1:v:0',
      '-map', '0:v:0',
      '-c:a:0', 'copy',
      '-c:v:0', 'copy',
      '-c:v:1', 'mjpeg',
      '-disposition:v:1', 'attached_pic',
      multiStreamMp4,
    ]);

    const ffmpegAdapter = new FFmpegAdapter({
      ffmpegPath: bundledFfmpegPath,
      ffprobePath: bundledFfprobePath,
    });
    const probed = await ffmpegAdapter.probeFlaNativeVideo(multiStreamMp4, new AbortController().signal);
    // Stream 0 is audio, stream 2 is attached_pic => probe MUST select stream 1 (H.264) & stream 0 (audio):
    expect(probed.streamIndex).toBe(1);
    expect(probed.audioStreamIndex).toBe(0);
    expect(probed.presentationTicks.length).toBeGreaterThanOrEqual(6);

    // Sequential decode using probed.streamIndex produces all 6+ frames (not the 1-frame cover image!):
    const decodeDir = await makeTempDir('panda-ef10-dec-');
    const decoded = await ffmpegAdapter.decodeFlaVideoFramesSequential({
      videoPath: multiStreamMp4,
      outputDirectory: decodeDir,
      maxFrames: probed.presentationTicks.length,
      streamIndex: probed.streamIndex,
      expectedFrameCount: probed.presentationTicks.length,
    });
    expect(decoded.framePaths).toHaveLength(probed.presentationTicks.length);
    // Frame 0 and Frame 3 bytes differ (real moving video stream 1, not static cover stream 0):
    const b0 = await readFile(decoded.framePaths[0]!);
    const b3 = await readFile(decoded.framePaths[3]!);
    expect(Buffer.compare(b0, b3)).not.toBe(0);

    // Frame count mismatch must fail explicitly (never silently clamp):
    const mismatchDir = await makeTempDir('panda-ef10-mismatch-');
    await expect(
      ffmpegAdapter.decodeFlaVideoFramesSequential({
        videoPath: multiStreamMp4,
        outputDirectory: mismatchDir,
        maxFrames: 100,
        streamIndex: probed.streamIndex,
        expectedFrameCount: probed.presentationTicks.length + 3,
      }),
    ).rejects.toThrow(/不一致/);

    // Pure clock-aligned audio planning across single-frame (held), trim, A/V PTS skew, loop, and nested host:
    const heldPlan = planEmbeddedVideoAudioClips({
      shotDurationMs: 1_000,
      videoDurationMs: 250,
      audioDurationMs: 250,
      playbackMode: 'single-frame',
    });
    expect(heldPlan.clips).toHaveLength(0);
    expect(heldPlan.diagnostics.length).toBeGreaterThan(0);

    // Trim [50..200) with audio starting 20ms AFTER video (audioStartOffsetMs = +20):
    // visual source 50ms aligns with audio offset 50 - 20 = 30ms, length 150ms.
    const trimPosSkew = planEmbeddedVideoAudioClips({
      shotDurationMs: 1_000,
      layerStartTimeMs: 100,
      videoDurationMs: 250,
      audioDurationMs: 250,
      audioStartOffsetMs: 20,
      playbackMode: 'play-once',
      trimStartMs: 50,
      trimEndMs: 200,
    });
    expect(trimPosSkew.clips).toEqual([{ startMs: 100, endMs: 250, offsetMs: 30 }]);

    // Trim [0..200) with audio starting 30ms AFTER video => clip starts at +30ms delay with audio offset 0:
    const leadDelay = planEmbeddedVideoAudioClips({
      shotDurationMs: 1_000,
      layerStartTimeMs: 100,
      videoDurationMs: 250,
      audioDurationMs: 250,
      audioStartOffsetMs: 30,
      playbackMode: 'play-once',
      trimStartMs: 0,
      trimEndMs: 200,
    });
    expect(leadDelay.clips).toEqual([{ startMs: 130, endMs: 300, offsetMs: 0 }]);

    // Loop mode over 500ms Shot with 200ms trim window [50..250) => 3 non-overlapping aligned occurrences:
    const loopPlan = planEmbeddedVideoAudioClips({
      shotDurationMs: 500,
      layerStartTimeMs: 0,
      videoDurationMs: 250,
      audioDurationMs: 250,
      playbackMode: 'loop',
      trimStartMs: 50,
      trimEndMs: 250,
    });
    expect(loopPlan.clips).toEqual([
      { startMs: 0, endMs: 200, offsetMs: 50 },
      { startMs: 200, endMs: 400, offsetMs: 50 },
      { startMs: 400, endMs: 500, offsetMs: 50 },
    ]);

    // Unsupported nested host clock disables audio explicitly with diagnostic instead of desynced audio:
    const nestedPlan = planEmbeddedVideoAudioClips({
      shotDurationMs: 1_000,
      videoDurationMs: 250,
      audioDurationMs: 250,
      nestedHost: { kind: 'graphic', playbackMode: 'loop', hostFrameCount: 6, hostFps: 24 },
    });
    expect(nestedPlan.clips).toHaveLength(0);
    expect(nestedPlan.diagnostics.length).toBeGreaterThan(0);
  }, 60_000);

  it('supplies two 1200-frame videos on demand within bounded cache/IPC budgets and surfaces corrupt-video diagnostics to export task state (E-F07 / E-F11)', async () => {
    const workDir = await makeTempDir('panda-ef07-ef11-');
    const framePng = path.join(workDir, 'tiny.png');
    await writeFile(framePng, TINY_PNG);

    // 1. E-F07 budget proof: two 1,200-frame videos (2,400 total frames > 2048 loadFormal limit)
    // supply at most 2 frames per renderFrame and keep Main cache <= 16 entries!
    const videoAId = randomUUID();
    const videoBId = randomUUID();
    const ticks1200 = Array.from({ length: 1_200 }, (_, i) => i * 1_000);
    const paths1200 = Array.from({ length: 1_200 }, () => framePng);
    const supply = new ExportVideoFrameSupply(
      new Map([
        [videoAId, { assetName: 'LongClipA', sha256: 'a'.repeat(64), framePaths: paths1200 }],
        [videoBId, { assetName: 'LongClipB', sha256: 'b'.repeat(64), framePaths: paths1200 }],
      ]),
      [],
    );
    const projectService = new ProjectService();
    const projectRoot = path.join(workDir, 'ef07.pandastage');
    const created = await projectService.create(projectRoot, { name: 'EF07 Project' });
    const bgAssetId = randomUUID();
    const bgLayerId = randomUUID();
    const shotId = randomUUID();
    const bgSha = createHash('sha256').update(TINY_PNG).digest('hex');
    const makeVideoAsset = (id: string, name: string): VideoAsset => ({
      id,
      kind: 'video',
      name,
      relativePath: `assets/${name}.mp4`,
      mimeType: 'video/mp4',
      sha256: bgSha,
      width: 64,
      height: 64,
      durationMs: 50_000,
      videoTiming: {
        codec: 'h264',
        streamIndex: 0,
        timeBase: { numerator: 1, denominator: 24_000 },
        startTick: 0,
        endTick: 1_200_000,
        presentationTicks: ticks1200,
        hasAudio: false,
      },
    });
    const project: Project = ProjectSchema.parse({
      ...created.project,
      assets: [
        {
          id: bgAssetId,
          kind: 'image',
          name: 'bg.png',
          relativePath: 'assets/bg.png',
          mimeType: 'image/png',
          sha256: bgSha,
          width: 1,
          height: 1,
          usage: 'background',
          keywords: [],
        },
        makeVideoAsset(videoAId, 'LongClipA'),
        makeVideoAsset(videoBId, 'LongClipB'),
      ],
      shots: [{
        id: shotId,
        name: 'Shot 1',
        durationMs: 2_000,
        defaultSubtitleStyleId: created.project.subtitleStyles[0]!.id,
        backgroundLayerId: bgLayerId,
        layers: [
          {
            id: bgLayerId,
            name: 'Bg',
            source: { kind: 'asset', assetId: bgAssetId },
            anchor: 'center', x: 960, y: 540, scaleX: 1, scaleY: 1,
            rotationDeg: 0, opacity: 1, visible: true, locked: false, flipX: false, zIndex: 0,
          },
          {
            id: randomUUID(),
            name: 'Video A',
            source: { kind: 'video', assetId: videoAId, playbackMode: 'play-once' },
            anchor: 'center', x: 400, y: 300, scaleX: 1, scaleY: 1,
            rotationDeg: 0, opacity: 1, visible: true, locked: false, flipX: false, zIndex: 1, startTimeMs: 0,
          },
          {
            id: randomUUID(),
            name: 'Video B',
            source: { kind: 'video', assetId: videoBId, playbackMode: 'play-once' },
            anchor: 'center', x: 800, y: 300, scaleX: 1, scaleY: 1,
            rotationDeg: 0, opacity: 1, visible: true, locked: false, flipX: false, zIndex: 2, startTimeMs: 0,
          },
        ],
        timelineEvents: [],
        audioClips: [],
        dialogues: [],
      }],
    });
    const shot = project.shots[0]!;
    // Simulate 30 frames at 60fps (~16.67ms step) — consecutive frames reuse same 24fps sample with 0 transferred bytes!
    const batch0 = await supply.collectVideoFramesForShotTime(project, shot, 0);
    expect(batch0.videoFrames).toHaveLength(2);
    const batch16 = await supply.collectVideoFramesForShotTime(project, shot, 17); // still sample 0!
    expect(batch16.videoFrames).toHaveLength(0);
    expect(batch16.videoFrameCacheTouches).toHaveLength(2);
    for (let f = 2; f < 30; f += 1) {
      await supply.collectVideoFramesForShotTime(project, shot, Math.round((f * 1_000) / 60));
    }
    const stats = supply.getTransferStats();
    expect(stats.peakFramesPerTransfer).toBeLessThanOrEqual(2);
    expect(stats.cachedEntries).toBeLessThanOrEqual(16);

    // Reuse an old sample across Shots while adding a new one in the same render.
    supply.resetRendererCacheMirror();
    const rendererCache = new Map<string, Uint8Array>();
    const alternate = ProjectSchema.shape.shots.element.parse({
      ...shot,
      id: randomUUID(),
      layers: shot.layers.map((layer) => layer.source.kind === 'video' && layer.source.assetId === videoBId
        ? { ...layer, source: { ...layer.source, trimStartMs: 340 } }
        : layer),
    });
    const deliver = async (target: typeof shot, timeMs: number) => {
      const update = await supply.collectVideoFramesForShotTime(project, target, timeMs);
      const request = ExportRenderFrameRequestSchema.parse({
        ...update, jobId: randomUUID(), frameIndex: 0, timeMs, shotId: target.id, shotLocalTimeMs: timeMs,
      });
      for (const key of request.videoFrameCacheTouches ?? []) {
        expect(touchExportVideoFrame(rendererCache, key)).toBe(true);
      }
      for (const frame of request.videoFrames ?? []) {
        storeExportVideoFrame(rendererCache, frame.assetId, frame.bytes);
      }
      const samples = evaluateShotAtTime(target, timeMs, project).layers
        .filter((layer) => layer.visible && layer.assetId?.includes('#frame:'));
      expect(samples).toHaveLength(2);
      for (const sample of samples) expect(rendererCache.has(sample.assetId!)).toBe(true);
      return update;
    };
    for (let index = 0; index < 8; index += 1) await deliver(shot, Math.ceil(index * 1_000 / 24));
    expect(rendererCache.size).toBe(16);
    const earliest = [...rendererCache.keys()][0]!;
    expect((await deliver(alternate, 0)).videoFrameCacheTouches).toEqual([earliest]);
    expect((await deliver(shot, 0)).videoFrameCacheTouches).toEqual([earliest]);
    expect(rendererCache.size).toBe(16);

    // 2. E-F11 visible diagnostics: corrupt video + healthy sibling exports cleanly & surfaces visible warning in ExportTaskState:
    const corruptBytes = Buffer.from('CORRUPT_MP4_PAYLOAD');
    const corruptSha = createHash('sha256').update(corruptBytes).digest('hex');
    const corruptAssetId = randomUUID();
    const corruptProjectRoot = path.join(workDir, 'ef11.pandastage');
    const createdCorrupt = await projectService.create(corruptProjectRoot, { name: 'EF11 Corrupt Project' });
    const cBgId = randomUUID();
    const cBgLayerId = randomUUID();
    const cShotId = randomUUID();
    const corruptProject: Project = ProjectSchema.parse({
      ...createdCorrupt.project,
      assets: [
        {
          id: cBgId, kind: 'image', name: 'bg.png', relativePath: 'assets/bg.png',
          mimeType: 'image/png', sha256: bgSha, width: 1, height: 1, usage: 'background', keywords: [],
        },
        {
          id: corruptAssetId, kind: 'video', name: 'BrokenClip', relativePath: 'assets/broken.mp4',
          mimeType: 'video/mp4', sha256: corruptSha, width: 64, height: 64, durationMs: 500,
          videoTiming: {
            codec: 'h264', streamIndex: 0, timeBase: { numerator: 1, denominator: 24_000 },
            startTick: 0, endTick: 6_000, presentationTicks: [0, 1_000, 2_000, 3_000, 4_000, 5_000], hasAudio: false,
          },
        },
      ],
      shots: [{
        id: cShotId, name: 'Shot 1', durationMs: 500,
        defaultSubtitleStyleId: createdCorrupt.project.subtitleStyles[0]!.id,
        backgroundLayerId: cBgLayerId,
        layers: [
          {
            id: cBgLayerId, name: 'HealthyBg', source: { kind: 'asset', assetId: cBgId },
            anchor: 'center', x: 960, y: 540, scaleX: 1, scaleY: 1,
            rotationDeg: 0, opacity: 1, visible: true, locked: false, flipX: false, zIndex: 0,
          },
          {
            id: randomUUID(), name: 'BrokenVideoLayer', source: { kind: 'video', assetId: corruptAssetId },
            anchor: 'center', x: 400, y: 300, scaleX: 1, scaleY: 1,
            rotationDeg: 0, opacity: 1, visible: true, locked: false, flipX: false, zIndex: 1, startTimeMs: 0,
          },
        ],
        timelineEvents: [], audioClips: [], dialogues: [],
      }],
    });
    await writeFile(path.join(corruptProjectRoot, 'assets', 'bg.png'), TINY_PNG);
    await writeFile(path.join(corruptProjectRoot, 'assets', 'broken.mp4'), corruptBytes);
    await projectService.save(corruptProjectRoot, corruptProject);

    const outMp4 = path.join(workDir, 'ef11-degraded.mp4');
    const prepService = new ExportPreparationService({
      getCurrentProjectSnapshot: (root) =>
        root === corruptProjectRoot ? { project: corruptProject, revision: 1, dirty: false, openInstanceId: 1 } : null,
    });
    const sel = await prepService.selectOutput({
      projectRoot: corruptProjectRoot, projectId: corruptProject.id, projectName: corruptProject.name,
      openInstanceId: 1, videoFormat: 'mp4',
    }, outMp4);
    expect(sel.status).toBe('selected');
    if (sel.status !== 'selected') throw new Error('select failed');
    const prep = await prepService.prepare({
      selectionId: sel.selectionId, attemptId: randomUUID(), projectRoot: corruptProjectRoot,
      projectId: corruptProject.id, openInstanceId: 1, revision: 1, dirty: false,
      cameraMode: 'static', videoOutput: { width: 1280, fps: 24 }, project: corruptProject,
    });
    expect(prep.status).toBe('PREPARATION_READY');
    if (prep.status !== 'PREPARATION_READY') throw new Error('prep failed');
    const frozen = await prepService.acquireCandidateForExport(prep.candidate.snapshotId);

    const sample720Path = path.join(workDir, 'ef11-720.png');
    await execFileAsync(bundledFfmpegPath, [
      '-y', '-f', 'lavfi', '-i', 'color=c=0x115522:s=1280x720:d=0.05', '-frames:v', '1', sample720Path,
    ]);
    const solid720 = Uint8Array.from(await readFile(sample720Path));

    const ffmpegAdapter = new FFmpegAdapter({ ffmpegPath: bundledFfmpegPath, ffprobePath: bundledFfprobePath });
    const exportService = new ExportService(
      {
        loadProbe: async () => { throw new Error('unused'); },
        loadFormal: async (req) => ({ jobId: req.jobId, acknowledged: true }),
        renderFrame: async (req) => ({
          jobId: req.jobId, frameIndex: req.frameIndex, timeMs: req.timeMs,
          shotId: req.shotId, shotLocalTimeMs: req.shotLocalTimeMs, width: 1280, height: 720, pngBytes: solid720,
        }),
        cancelJob: () => true,
      },
      new FileSystemService(path.join(workDir, 'ef11-tmp'), {
        inspectWindowsVolume: async () => ({ driveType: 'Fixed', fileSystem: 'NTFS' }),
      }),
      ffmpegAdapter,
    );
    const updates: ExportJobUpdate[] = [];
    const unsubscribe = exportService.subscribe((u) => updates.push(u));
    try {
      const result = await exportService.startFormalExport(
        frozen,
        () => prepService.assertOutputTargetUnchanged(prep.candidate.snapshotId),
      ).completion;
      expect(result.status).toBe('completed');
      expect(result.diagnostics?.length).toBeGreaterThan(0);
      expect(result.diagnostics![0]).toContain('BrokenClip');

      const finalUpdate = updates.find((u) => u.status === 'completed');
      expect(finalUpdate?.diagnostics?.length).toBeGreaterThan(0);
      const taskState = applyExportJobUpdate(
        {
          status: 'running', jobId: result.jobId, attemptId: prep.candidate.attemptId,
          snapshotId: prep.candidate.snapshotId, completedFrames: 0, totalFrames: 12, issues: [],
        },
        finalUpdate!,
      );
      expect(taskState.status).toBe('completed');
      expect(taskState.issues.length).toBeGreaterThan(0);
      expect(taskState.issues[0]!.problem).toContain('BrokenClip');
      expect(taskState.message).toContain('缺失');
      // Original corrupt source file in project assets is preserved intact:
      expect((await readFile(path.join(corruptProjectRoot, 'assets', 'broken.mp4'))).toString('utf8')).toBe('CORRUPT_MP4_PAYLOAD');
    } finally {
      unsubscribe();
      await prepService.dispose();
    }
  }, 60_000);

  it('imports embedded video through the formal IPC/editor-store path preserving unsaved edits, Undo/Redo, stale-revision rejection, failure rollback, and Stage/Preview stale-seek safety (E-F06)', async () => {
    const workDir = await makeTempDir('panda-ef06-');
    const mp4Path = path.join(workDir, 'live.mp4');
    await execFileAsync(bundledFfmpegPath, [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=64x48:rate=10:duration=0.6',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=0.6',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
      mp4Path,
    ]);
    const mp4Bytes = await readFile(mp4Path);
    const flaZip = await buildFlaWithEmbeddedVideo('LiveClip', mp4Bytes);
    const flaPath = path.join(workDir, 'live.fla');
    await writeFile(flaPath, flaZip);
    const preflight = preflightFlaBytes(flaZip, 'live.fla', flaPath);
    const sessionId = randomUUID();

    const projectRoot = path.join(workDir, 'live-project.pandastage');
    let beforeCommit: (() => void) | undefined;
    const projectService = new ProjectService({
      fileSystem: new ProjectFileSystemService({ beforeAtomicReplace: () => beforeCommit?.() }),
    });
    const created = await projectService.create(projectRoot, {
      name: 'live-project',
    });
    const shotId = randomUUID();
    const bgAssetId = randomUUID();
    const bgLayerId = randomUUID();
    await writeFile(path.join(projectRoot, 'assets', 'bg.png'), TINY_PNG);
    const seededProject = ProjectSchema.parse({
      ...created.project,
      assets: [
        {
          id: bgAssetId,
          kind: 'image',
          name: 'bg.png',
          relativePath: 'assets/bg.png',
          mimeType: 'image/png',
          sha256: createHash('sha256').update(TINY_PNG).digest('hex'),
          width: 1,
          height: 1,
          usage: 'background',
          keywords: [],
        },
      ],
      shots: [
        {
          id: shotId,
          name: 'Shot 1',
          durationMs: 1_000,
          defaultSubtitleStyleId: created.project.subtitleStyles[0]!.id,
          backgroundLayerId: bgLayerId,
          layers: [
            {
              id: bgLayerId,
              name: 'Background',
              source: { kind: 'asset', assetId: bgAssetId },
              anchor: 'center',
              x: 960,
              y: 540,
              scaleX: 1,
              scaleY: 1,
              rotationDeg: 0,
              opacity: 1,
              visible: true,
              locked: false,
              flipX: false,
              zIndex: 0,
            },
          ],
          timelineEvents: [],
          audioClips: [],
          dialogues: [],
        },
      ],
    });
    await projectService.save(projectRoot, seededProject);

    // 1. Open in real EditorProjectStore and create unsaved in-memory edits (dirty=true, revision=1):
    const store = new EditorProjectStore();
    store.open(projectRoot, seededProject);
    const openInstanceId = store.getProjectInstanceId()!;
    const unsavedProject: Project = {
      ...seededProject,
      name: 'Unsaved User Draft',
      shots: seededProject.shots.map((s) =>
        s.id === shotId ? { ...s, name: 'Unsaved Shot Edit' } : s,
      ),
    };
    store.updateProject(unsavedProject, 'Unsaved edit before FLA video import');
    expect(store.getSnapshot()?.dirty).toBe(true);
    expect(store.getSnapshot()?.revision).toBe(1);

    // Track in-memory snapshot in Main (mirrors AutosaveService):
    let trackedSnapshot: { project: Project; revision: number; openInstanceId: number } | null = {
      project: seededProject,
      revision: 0,
      openInstanceId,
    };

    const flaImportService = {
      prepareEmbeddedVideo: async (
        reqSessionId: string,
        videoName: string,
        adapter: Pick<FFmpegAdapter, 'probeFlaNativeVideo'>,
        signal: AbortSignal,
      ) => {
        if (reqSessionId !== sessionId) return null;
        const extracted = readFlaEmbeddedVideo(preflight.bytes, preflight.entries, videoName);
        if (!extracted) return null;
        const tmpDir = await makeTempDir('panda-ef06-probe-');
        const tmpFile = path.join(tmpDir, 'source.mp4');
        await writeFile(tmpFile, extracted.bytes);
        const metadata = await adapter.probeFlaNativeVideo(tmpFile, signal);
        return { ...extracted, metadata, sourceSha256: preflight.sha256 };
      },
    };

    const ffmpegAdapter = new FFmpegAdapter({
      ffmpegPath: bundledFfmpegPath,
      ffprobePath: bundledFfprobePath,
    });
    const videoService = new FlaEmbeddedVideoService({
      flaImportService,
      projectService,
      getCurrentProjectSnapshot: (root) => (root === projectRoot ? trackedSnapshot : null),
      ffmpegAdapter,
    });

    try {
      // 2. Stale revision rejection BEFORE touching disk or writing any asset file:
      const staleResponse = await videoService.importFromFlaSessionRequest(
        FlaVideoImportRequestSchema.parse({
          sessionId,
          videoName: 'LiveClip',
          projectRoot,
          project: store.getSnapshot()!.project,
          baseRevision: 1, // Main still tracks revision 0 -> stale!
          openInstanceId,
          shotId,
          playbackMode: 'play-once',
        }),
      );
      expect(staleResponse.ok).toBe(false);
      if (!staleResponse.ok) {
        expect(staleResponse.error.code).toBe('STALE_PROJECT_REVISION');
        expect(staleResponse.error.currentRevision).toBe(0);
      }
      const assetsAfterStale = await readdir(path.join(projectRoot, 'assets')).catch(() => []);
      expect(assetsAfterStale).toEqual(['bg.png']);

      // 3. Failure rollback: simulate audio extraction crash -> newly written .mp4 must be cleaned up!
      const failingVideoService = new FlaEmbeddedVideoService({
        flaImportService,
        projectService,
        getCurrentProjectSnapshot: () => ({
          project: store.getSnapshot()!.project,
          revision: store.getSnapshot()!.revision,
          openInstanceId,
        }),
        ffmpegAdapter: {
          probeFlaNativeVideo: (p, s) => ffmpegAdapter.probeFlaNativeVideo(p, s),
          decodeFlaVideoFramesSequential: (i, s) => ffmpegAdapter.decodeFlaVideoFramesSequential(i, s),
          extractFlaVideoAudioTrack: async () => {
            throw new Error('simulated audio extraction failure');
          },
          probeAudioFile: (p, s) => ffmpegAdapter.probeAudioFile(p, s),
        },
      });
      const failedResp = await failingVideoService.importFromFlaSessionRequest({
        sessionId,
        videoName: 'LiveClip',
        projectRoot,
        project: store.getSnapshot()!.project,
        baseRevision: 1,
        openInstanceId,
        shotId,
        includeAudio: true,
      });
      expect(failedResp.ok).toBe(false);
      const assetsAfterRollback = await readdir(path.join(projectRoot, 'assets')).catch(() => []);
      expect(assetsAfterRollback).toEqual(['bg.png']);

      const current = {
        project: store.getSnapshot()!.project, revision: store.getSnapshot()!.revision, openInstanceId,
      };
      const request = FlaVideoImportRequestSchema.parse({
        sessionId, videoName: 'LiveClip', projectRoot, project: current.project, baseRevision: current.revision,
        openInstanceId, shotId, includeAudio: false,
      });
      const scenarios = [
        { change: () => { trackedSnapshot = null; }, code: 'STALE_PROJECT_REVISION' },
        { change: () => { trackedSnapshot = { ...current, openInstanceId: openInstanceId + 1 }; }, code: 'STALE_PROJECT_REVISION' },
        { change: () => videoService.cancelActiveImports(), code: 'VIDEO_IMPORT_CANCELLED' },
      ];
      trackedSnapshot = null;
      await expect(videoService.importFromFlaSessionRequest(request)).resolves.toMatchObject({
        ok: false, error: { code: 'STALE_PROJECT_REVISION' },
      });
      for (const scenario of scenarios) {
        trackedSnapshot = current;
        beforeCommit = scenario.change;
        await expect(videoService.importFromFlaSessionRequest(request)).resolves.toMatchObject({
          ok: false, error: { code: scenario.code },
        });
        beforeCommit = undefined;
        expect((await projectService.open(projectRoot)).project).toEqual(seededProject);
        expect(await readdir(path.join(projectRoot, 'assets'))).toEqual(['bg.png']);
      }

      // 4. Real product editor flow via importFlaEmbeddedVideoToEditor (syncAutosave + lease + IPC + HistoryStore):
      let selectedLayerId: string | null = null;
      const imported = await importFlaEmbeddedVideoToEditor({
        sessionId,
        videoName: 'LiveClip',
        shotId,
        playbackMode: 'play-once',
        includeAudio: true,
        store,
        syncAutosave: async (snap) => {
          trackedSnapshot = { project: snap.project, revision: snap.revision, openInstanceId };
          return { ok: true };
        },
        importVideo: async (req) => {
          const validatedReq = FlaVideoImportRequestSchema.parse(req);
          return FlaVideoImportResponseSchema.parse(
            await videoService.importFromFlaSessionRequest(validatedReq),
          );
        },
        selectLayer: (layerId) => {
          selectedLayerId = layerId;
        },
      });
      expect(imported.ok).toBe(true);
      if (!imported.ok) throw new Error(imported.error.message);
      expect(selectedLayerId).toBe(imported.layer.id);

      // Unsaved edits were PRESERVED (not overwritten by stale disk open!), and video+audio were added:
      const liveSnapshot = store.getSnapshot()!;
      expect(liveSnapshot.revision).toBe(2);
      expect(liveSnapshot.dirty).toBe(false);
      expect(liveSnapshot.project.name).toBe('Unsaved User Draft');
      expect(liveSnapshot.project.shots[0]!.name).toBe('Unsaved Shot Edit');
      expect(liveSnapshot.project.assets.some((a) => a.id === imported.videoAsset.id && a.kind === 'video')).toBe(true);
      expect(liveSnapshot.project.shots[0]!.layers.some((l) => l.id === imported.layer.id)).toBe(true);
      expect(liveSnapshot.project.shots[0]!.audioClips.length).toBeGreaterThan(0);

      // Undo restores exact pre-import unsaved draft; Redo restores the imported video:
      expect(store.undo()).toBe(true);
      expect(store.getSnapshot()!.project.name).toBe('Unsaved User Draft');
      expect(store.getSnapshot()!.project.shots[0]!.layers.some((l) => l.id === imported.layer.id)).toBe(false);
      expect(store.getSnapshot()!.dirty).toBe(true);
      expect(store.redo()).toBe(true);
      expect(store.getSnapshot()!.project.shots[0]!.layers.some((l) => l.id === imported.layer.id)).toBe(true);

      // Disk save matches reopened project:
      const reopened = await projectService.open(projectRoot);
      expect(reopened.project.name).toBe('Unsaved User Draft');
      expect(reopened.project.shots[0]!.name).toBe('Unsaved Shot Edit');
      expect(reopened.project.assets.some((a) => a.id === imported.videoAsset.id)).toBe(true);

      // 5. Real Stage consumption path (AssetCanvasImageService + CanvasImageResourceSession) stale-seek discard:
      trackedSnapshot = { project: reopened.project, revision: 2, openInstanceId };
      const canvasImageService = new AssetCanvasImageService({
        getCurrentProjectSnapshot: () => ({ project: reopened.project }),
        embeddedVideoService: videoService,
      });
      const frame0Key = evaluateShotAtTime(reopened.project.shots[0]!, 0, reopened.project).layers.find(
        (l) => l.id === imported.layer.id,
      )!.assetId!;
      const frame4Key = evaluateShotAtTime(reopened.project.shots[0]!, 400, reopened.project).layers.find(
        (l) => l.id === imported.layer.id,
      )!.assetId!;
      expect(frame0Key).not.toBe(frame4Key);

      let resolveSlowFrame0!: (resp: Awaited<ReturnType<AssetCanvasImageService['read']>>) => void;
      const slowFrame0Promise = new Promise<Awaited<ReturnType<AssetCanvasImageService['read']>>>((resolve) => {
        resolveSlowFrame0 = resolve;
      });
      const frame0Actual = await canvasImageService.read({
        projectRoot,
        assetId: frame0Key,
        sha256: imported.videoAsset.sha256!,
      });
      const frame4Actual = await canvasImageService.read({
        projectRoot,
        assetId: frame4Key,
        sha256: imported.videoAsset.sha256!,
      });
      expect(frame0Actual.ok && frame4Actual.ok).toBe(true);

      const revokedUrls: string[] = [];
      let nextUrlId = 0;
      const session = new CanvasImageResourceSession({
        readCanvasImage: async (req) =>
          req.assetId === frame0Key ? slowFrame0Promise : frame4Actual,
        createImage: () => {
          const fakeImg = {
            onload: null as null | (() => void),
            onerror: null as null | (() => void),
            _src: '',
            get src() {
              return this._src;
            },
            set src(value: string) {
              this._src = value;
              queueMicrotask(() => this.onload?.());
            },
          };
          return fakeImg as unknown as HTMLImageElement;
        },
        createObjectUrl: () => `blob:video-${++nextUrlId}`,
        revokeObjectUrl: (url) => {
          revokedUrls.push(url);
        },
      });
      const observedStates: Array<ReadonlyMap<string, HTMLImageElement>> = [];
      session.reconcile(
        {
          contextKey: 'ctx-1',
          projectRoot,
          assets: [{ id: frame0Key, sha256: imported.videoAsset.sha256 }],
        },
        (s) => observedStates.push(s.images),
      );
      // Rapid seek to frame 4 BEFORE frame 0 resolves:
      session.reconcile(
        {
          contextKey: 'ctx-1',
          projectRoot,
          assets: [{ id: frame4Key, sha256: imported.videoAsset.sha256 }],
        },
        (s) => observedStates.push(s.images),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      // Now slow stale frame 0 resolves late -> MUST be discarded!
      resolveSlowFrame0(frame0Actual);
      await new Promise((resolve) => setTimeout(resolve, 20));

      const finalImages = session.getSnapshot().images;
      expect(finalImages.has(frame4Key)).toBe(true);
      expect(finalImages.has(frame0Key)).toBe(false);
      session.dispose();
      expect(revokedUrls.length).toBeGreaterThan(0);
    } finally {
      await videoService.dispose();
    }
  }, 60_000);
});

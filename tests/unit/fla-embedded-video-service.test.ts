import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
  FlaEmbeddedVideoService,
  prepareExportVideoFrameMedia,
} from '../../src/main/services/FlaEmbeddedVideoService';
import { preflightFlaBytes } from '../../src/main/services/fla-import-preflight-service';
import { readFlaEmbeddedVideo } from '../../src/main/services/fla-native-video';
import { ProjectService } from '../../src/main/services/ProjectService';
import {
  createFlaVideoPresentationIndex,
  evaluateFlaVideoClock,
  flaVideoFrameAssetKey,
} from '../../src/shared/fla-video-clock';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';

const execFileAsync = promisify(execFile);

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
  await execFileAsync('ffmpeg', args);
}

async function createToneWav(outputPath: string, frequencyHz: number, durationSec: number): Promise<void> {
  await execFileAsync('ffmpeg', [
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

    const ffmpegAdapter = new FFmpegAdapter();
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
      await execFileAsync('ffmpeg', [
        '-y', '-f', 'lavfi', '-i', 'color=c=0x224466:s=1280x720:d=0.05', '-frames:v', '1', sample720PngPath,
      ]);
      const solid720pPng = new Uint8Array(await readFile(sample720PngPath));

      let loadedFrameKeys: string[] = [];
      const mockFrameRenderer: FrameRenderer = {
        loadProbe: async () => { throw new Error('unused'); },
        loadFormal: async (req) => {
          loadedFrameKeys = req.media.map((m) => m.assetId);
          return { jobId: req.jobId, acknowledged: true };
        },
        renderFrame: async (req) => {
          const ev = evaluateShotAtTime(shot, req.shotLocalTimeMs ?? req.timeMs, reopened.project);
          const expectedKey = ev.layers.find((l) => l.id === imported.layer.id)!.assetId;
          expect(loadedFrameKeys).toContain(expectedKey);
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

      const exportFs = new FileSystemService(path.join(workDir, 'export-temp'));
      const exportService = new ExportService(mockFrameRenderer, exportFs, ffmpegAdapter);
      const exportHandle = exportService.startFormalExport(
        frozen,
        () => prepService.assertOutputTargetUnchanged(prep.candidate.snapshotId),
      );
      const exported = await exportHandle.completion;
      expect(exported.status).toBe('completed');
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
});

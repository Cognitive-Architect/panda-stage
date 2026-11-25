import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ProjectSchema,
  ShotService,
  buildFormalExportAudioMixPlan,
} from '../../src/domain';
import { AssetImportService } from '../../src/main/services/AssetImportService';
import { FlaSoundService } from '../../src/main/services/FlaSoundService';
import { MediaInspectionService } from '../../src/main/services/MediaInspectionService';
import { ProjectService } from '../../src/main/services/ProjectService';
import { preflightFlaBytes } from '../../src/main/services/fla-import-preflight-service';
import { FLA_PARSER_COMMIT, FLA_PARSER_ENTRYPOINT, FLA_PARSER_PACKAGE, type FlaInspectionIR } from '../../src/shared/fla-import-api';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function pcmSilence(sampleCount: number, seed: number): Buffer {
  const buf = Buffer.alloc(sampleCount * 2, 0);
  buf.writeInt16LE(seed, 0);
  return buf;
}

describe('S05-A integration: FLA main Scene sound timeline recovery & persistence', () => {
  it('imports deduplicated audio assets, creates editable Shot AudioClips, persists across reopen, and builds export mix plan', async () => {
    const rootParent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-s05a-'));
    tempDirs.push(rootParent);
    const projectRoot = path.join(rootParent, 'scene-audio.pandastage');

    const projectService = new ProjectService();
    const created = await projectService.create(projectRoot, { name: 'S05-A Test' });
    const shotService = new ShotService();
    const projectWithShot = shotService.create(created.project, {
      name: 'Shot 1',
      durationMs: 5000,
    });
    const shotId = projectWithShot.shots[0]!.id;
    await projectService.save(projectRoot, projectWithShot, 1);

    let trackedSnapshot = { project: projectWithShot, revision: 1 };
    const assetImportService = new AssetImportService({
      projectService,
      getCurrentProjectSnapshot: () => trackedSnapshot,
      inspectionService: new MediaInspectionService(),
    });

    // Build synthetic FLA ZIP with 3 distinct embedded PCM sounds
    const zip = new JSZip();
    zip.file('DOMDocument.xml', '<DOMDocument/>');
    zip.file('bin/voice.dat', pcmSilence(4410, 111));
    zip.file('bin/pop.dat', pcmSilence(4410, 222));
    zip.file('bin/bgm.dat', pcmSilence(4410, 333));
    const flaBytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const entries = preflightFlaBytes(flaBytes, 'scene-audio.fla').entries;

    const ir: FlaInspectionIR = {
      source: {
        format: 'fla',
        basename: 'scene-audio.fla',
        byteLength: flaBytes.byteLength,
        sha256: 'b'.repeat(64),
        parser: {
          package: FLA_PARSER_PACKAGE,
          entrypoint: FLA_PARSER_ENTRYPOINT,
          commit: FLA_PARSER_COMMIT,
        },
      },
      document: { width: 1280, height: 720, frameRate: 30, backgroundColor: '#ffffff' },
      media: [],
      sounds: [
        {
          id: 'fla-sound-voice',
          name: 'voice.wav',
          href: 'voice.wav',
          dataHref: 'voice.dat',
          format: '44kHz 16bit Mono',
          sampleCount: 4410,
        },
        {
          id: 'fla-sound-pop',
          name: 'pop.wav',
          href: 'pop.wav',
          dataHref: 'pop.dat',
          format: '44kHz 16bit Mono',
          sampleCount: 4410,
        },
        {
          id: 'fla-sound-bgm',
          name: 'bgm.wav',
          href: 'bgm.wav',
          dataHref: 'bgm.dat',
          format: '44kHz 16bit Mono',
          sampleCount: 4410,
        },
      ],
      timelines: [
        {
          id: 'fla-timeline-scene-1',
          name: 'Scene 1',
          totalFrames: 150,
          layers: [
            {
              id: 'fla-layer-0-voice',
              name: 'Voice',
              sourceLayerIndex: 0,
              visible: true,
              locked: false,
              frames: [
                {
                  id: 'fla-frame-0-0-3',
                  sourceFrameIndex: 3,
                  startFrame: 3,
                  duration: 15,
                  instances: [],
                  sound: {
                    soundId: 'fla-sound-voice',
                    name: 'voice.wav',
                    sync: 'stream',
                    inPoint44: 22_050,
                    outPoint44: 88_200,
                  },
                },
              ],
            },
            {
              id: 'fla-layer-1-sfx',
              name: 'SFX',
              sourceLayerIndex: 1,
              visible: true,
              locked: false,
              frames: [
                {
                  id: 'fla-frame-1-0-10',
                  sourceFrameIndex: 10,
                  startFrame: 10,
                  duration: 1,
                  instances: [],
                  sound: {
                    soundId: 'fla-sound-pop',
                    name: 'pop.wav',
                    sync: 'event',
                    inPoint44: 4_410,
                  },
                },
                {
                  id: 'fla-frame-1-1-140',
                  sourceFrameIndex: 140,
                  startFrame: 140,
                  duration: 1,
                  instances: [],
                  sound: {
                    soundId: 'fla-sound-pop',
                    name: 'pop.wav',
                    sync: 'event',
                  },
                },
                {
                  id: 'fla-frame-1-2-0',
                  sourceFrameIndex: 0,
                  startFrame: 0,
                  duration: 5,
                  instances: [],
                  sound: {
                    soundId: 'fla-sound-bgm',
                    name: 'bgm.wav',
                    sync: 'start',
                    loopMode: 'loop',
                  },
                },
                {
                  id: 'fla-frame-1-3-15',
                  sourceFrameIndex: 15,
                  startFrame: 15,
                  duration: 1,
                  instances: [],
                  sound: {
                    soundId: 'fla-sound-bgm',
                    name: 'bgm.wav',
                    sync: 'stop',
                  },
                },
              ],
            },
          ],
        },
      ],
      compatibility: [],
      summary: { placedInstanceCount: 0, libraryOnlyMediaCount: 0 },
    };

    const sessionId = '00000000-0000-4000-8000-000000001304';
    const flaSoundService = new FlaSoundService(
      (sid, soundId) => {
        if (sid !== sessionId) return null;
        const sound = ir.sounds?.find((s) => s.id === soundId);
        return sound ? { sound, bytes: flaBytes, entries } : null;
      },
      async (filePath) => {
        if (filePath.includes('voice')) {
          return { codecName: 'pcm_s16le', durationSeconds: 3.0, sampleRate: 44100, channels: 1, raw: {} };
        }
        if (filePath.includes('pop')) {
          return { codecName: 'pcm_s16le', durationSeconds: 0.8, sampleRate: 22050, channels: 1, raw: {} };
        }
        return { codecName: 'pcm_s16le', durationSeconds: 4.0, sampleRate: 44100, channels: 1, raw: {} };
      },
      assetImportService,
      undefined,
      {
        getTimelineSession: (sid) => (sid === sessionId ? { ir, bytes: flaBytes, entries } : null),
        projectService,
      },
    );

    const response = await flaSoundService.importSceneTimeline({
      sessionId,
      shotId,
      timelineIndex: 0,
      projectRoot,
      project: projectWithShot,
      baseRevision: 1,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.projectChanged).toBe(true);
    expect(response.savedRevision).toBe(2);
    // All 3 unique sounds imported (including bgm.wav whose infinite loop is diagnosed, NOT dropped)
    expect(response.importedAssetIds).toHaveLength(3);
    expect(response.createdClipIds).toHaveLength(4);
    expect(response.diagnostics).toHaveLength(1);
    expect(response.diagnostics[0]!.code).toBe('unsupported-loop');

    trackedSnapshot = { project: response.project, revision: response.savedRevision };

    // Verify persistence across reopen
    const reopened = await projectService.open(projectRoot);
    expect(ProjectSchema.parse(reopened.project)).toEqual(response.project);
    const shot = reopened.project.shots.find((s) => s.id === shotId)!;
    expect(shot.dialogues).toEqual([]);
    expect(shot.audioClips).toHaveLength(4);

    const [bgmClip, streamClip, event1, event2] = shot.audioClips;
    // bgm.wav started at 0ms and stopped at frame 15 @ 30fps => 500ms
    expect(bgmClip).toMatchObject({ startMs: 0, endMs: 500, offsetMs: 0, role: 'sfx' });
    expect(streamClip).toMatchObject({ startMs: 100, endMs: 600, offsetMs: 500, role: 'sfx' });
    // pop.wav has 22050Hz actual sample rate, yet inPoint44=4410 MUST use 44100Hz => 100ms offset!
    expect(event1).toMatchObject({ startMs: 333, endMs: 1033, offsetMs: 100, role: 'sfx' });
    expect(event2).toMatchObject({ startMs: 4667, endMs: 5000, offsetMs: 0, role: 'sfx' });
    expect(event1!.assetId).toBe(event2!.assetId);

    // Formal export mix plan uses exact persisted clips
    const mixPlan = buildFormalExportAudioMixPlan(
      shot.durationMs,
      shot.audioClips.map((clip) => {
        const asset = reopened.project.assets.find((a) => a.id === clip.assetId)!;
        return {
          clipId: clip.id,
          assetId: clip.assetId,
          role: clip.role,
          sourcePath: path.join(projectRoot, asset.relativePath),
          startMs: clip.startMs,
          endMs: clip.endMs,
          offsetMs: clip.offsetMs,
          volume: clip.volume,
        };
      }),
    );
    expect(mixPlan.clips).toHaveLength(4);
    expect(mixPlan.clips[0]!.endMs).toBe(500);
    expect(mixPlan.clips[1]!.sourceOffsetMs).toBe(500);
    expect(mixPlan.clips[2]!.sourceOffsetMs).toBe(100);
    expect(mixPlan.clips[3]!.endMs).toBe(5000);
  });

  it('S05-C integration: recovers nested Graphic/MovieClip independent instances into shared-asset AudioClips with persistence', async () => {
    const rootParent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-s05c-'));
    tempDirs.push(rootParent);
    const projectRoot = path.join(rootParent, 'nested-audio.pandastage');

    const projectService = new ProjectService();
    const created = await projectService.create(projectRoot, { name: 'S05-C Test' });
    const shotService = new ShotService();
    const projectWithShot = shotService.create(created.project, {
      name: 'Shot 1',
      durationMs: 3000,
    });
    const shotId = projectWithShot.shots[0]!.id;
    await projectService.save(projectRoot, projectWithShot, 1);

    const assetImportService = new AssetImportService({
      projectService,
      getCurrentProjectSnapshot: () => ({ project: projectWithShot, revision: 1 }),
      inspectionService: new MediaInspectionService(),
    });

    const zip = new JSZip();
    zip.file('DOMDocument.xml', '<DOMDocument/>');
    zip.file('bin/step.dat', pcmSilence(4410, 444));
    const flaBytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const entries = preflightFlaBytes(flaBytes, 'nested-audio.fla').entries;

    const ir: FlaInspectionIR = {
      source: {
        format: 'fla',
        basename: 'nested-audio.fla',
        byteLength: flaBytes.byteLength,
        sha256: 'd'.repeat(64),
        parser: {
          package: FLA_PARSER_PACKAGE,
          entrypoint: FLA_PARSER_ENTRYPOINT,
          commit: FLA_PARSER_COMMIT,
        },
      },
      document: { width: 1280, height: 720, frameRate: 25, backgroundColor: '#ffffff' },
      media: [],
      sounds: [
        {
          id: 'fla-sound-step',
          name: 'step.wav',
          href: 'step.wav',
          dataHref: 'step.dat',
          format: '44kHz 16bit Mono',
          sampleCount: 4410,
        },
      ],
      timelines: [
        {
          id: 'fla-timeline-scene-1',
          name: 'Scene 1',
          totalFrames: 40,
          layers: [
            {
              id: 'fla-layer-0-inst-a',
              name: 'InstA',
              sourceLayerIndex: 0,
              visible: true,
              locked: false,
              frames: [
                {
                  id: 'fla-frame-0-0-0',
                  sourceFrameIndex: 0,
                  startFrame: 0,
                  duration: 20,
                  instances: [],
                  symbolInstances: [
                    { libraryItemName: 'FootstepMC', symbolType: 'movieclip', loop: 'loop' },
                  ],
                },
              ],
            },
            {
              id: 'fla-layer-1-inst-b',
              name: 'InstB',
              sourceLayerIndex: 1,
              visible: true,
              locked: false,
              frames: [
                {
                  id: 'fla-frame-1-0-15',
                  sourceFrameIndex: 15,
                  startFrame: 15,
                  duration: 10,
                  instances: [],
                  symbolInstances: [
                    { libraryItemName: 'FootstepMC', symbolType: 'movieclip', loop: 'loop' },
                    { libraryItemName: 'ScriptedMC', symbolType: 'movieclip', loop: 'loop' },
                  ],
                },
              ],
            },
          ],
        },
      ],
      symbolTimelines: [
        {
          name: 'FootstepMC',
          symbolType: 'movieclip',
          totalFrames: 10,
          layers: [
            {
              id: 'fla-layer-sym-0',
              name: 'Audio',
              sourceLayerIndex: 0,
              visible: true,
              locked: false,
              frames: [
                {
                  id: 'fla-frame-sym-0-2',
                  sourceFrameIndex: 2,
                  startFrame: 2,
                  duration: 1,
                  instances: [],
                  sound: {
                    soundId: 'fla-sound-step',
                    name: 'step.wav',
                    sync: 'event',
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'ScriptedMC',
          symbolType: 'movieclip',
          totalFrames: 10,
          hasActionScript: true,
          layers: [],
        },
      ],
      compatibility: [],
      summary: { placedInstanceCount: 0, libraryOnlyMediaCount: 0 },
    };

    const sessionId = '00000000-0000-4000-8000-000000001306';
    const flaSoundService = new FlaSoundService(
      (sid, soundId) => {
        if (sid !== sessionId) return null;
        const sound = ir.sounds?.find((s) => s.id === soundId);
        return sound ? { sound, bytes: flaBytes, entries } : null;
      },
      async () => ({ codecName: 'pcm_s16le', durationSeconds: 0.25, sampleRate: 44100, channels: 1, raw: {} }),
      assetImportService,
      undefined,
      {
        getTimelineSession: (sid) => (sid === sessionId ? { ir, bytes: flaBytes, entries } : null),
        projectService,
      },
    );

    const response = await flaSoundService.importSceneTimeline({
      sessionId,
      shotId,
      timelineIndex: 0,
      projectRoot,
      project: projectWithShot,
      baseRevision: 1,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    // Single audio asset imported and reused across all 3 nested triggers!
    expect(response.importedAssetIds).toHaveLength(1);
    // InstA: frames 2 (80ms) & 12 (480ms); InstB: frame 15+2=17 (680ms)
    expect(response.createdClipIds).toHaveLength(3);
    expect(response.diagnostics).toHaveLength(1);
    expect(response.diagnostics[0]!.code).toBe('unsupported-nested-clock');

    const reopened = await projectService.open(projectRoot);
    const shot = reopened.project.shots.find((s) => s.id === shotId)!;
    expect(shot.audioClips.map((c) => ({ startMs: c.startMs, endMs: c.endMs, assetId: c.assetId }))).toEqual([
      { startMs: 80, endMs: 330, assetId: response.importedAssetIds[0] },
      { startMs: 480, endMs: 730, assetId: response.importedAssetIds[0] },
      { startMs: 680, endMs: 930, assetId: response.importedAssetIds[0] },
    ]);
  });
});
